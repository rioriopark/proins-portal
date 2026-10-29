import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { LongCommissionRate, PayoutGrade } from '../lib/types'
import ModificationRates from '../components/ModificationRates'
import CommissionReference from '../components/CommissionReference'

// 한 줄 = 보험사·유형·구간 하나. rates[회차-1] = 수정P 대비 %, 미지급 회차는 null
interface RateRow {
  key: string
  insurer: string
  productType: string
  band: string
  bandOrder: number
  rates: (number | null)[]
}

const YEARS = ['초년도', '2차년도', '3차년도']

// 기본으로 보여줄 보험사별 대표 유형 (보험사|유형). 나머지는 '전체 유형 보기'를 켰을 때만 보인다
const FEATURED_TYPES = new Set(['메리츠화재|M1', '삼성화재|S10', 'DB손보|D1', 'KB손보|K3'])

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function pctLabel(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}

function yearSum(rates: (number | null)[], year: number): number {
  return round1(rates.slice(year * 12, year * 12 + 12).reduce<number>((s, r) => s + (r ?? 0), 0))
}

export default function LongRates() {
  const [rates, setRates] = useState<LongCommissionRate[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState('')
  const [insurer, setInsurer] = useState('all')
  const [premiumInput, setPremiumInput] = useState('')
  const [tab, setTab] = useState<'rates' | 'modification'>('rates')
  const [showAll, setShowAll] = useState(false)
  const [grades, setGrades] = useState<PayoutGrade[]>([])
  const [selectedRatio, setSelectedRatio] = useState(1)
  const { profile } = useAuth()
  // 위촉설계사(FC)는 직급을 고를 수 없고, 조직관리에 등록된 본인 장기 지급률로만 본다
  const isAgent = profile?.role === 'agent'
  const gradeRatio = isAgent ? profile.rate_long ?? 1 : selectedRatio

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [data, { data: g }] = await Promise.all([
        fetchAllRows<LongCommissionRate>((from, to) =>
          supabase.from('long_commission_rates').select('*').range(from, to)
        ),
        isAgent ? Promise.resolve({ data: [] as PayoutGrade[] }) : supabase.from('payout_grades').select('*').order('sort_order'),
      ])
      setRates(data)
      setGrades(g ?? [])
      setLoading(false)
    }
    load()
  }, [isAgent])

  const months = useMemo(() => [...new Set(rates.map((r) => r.effective_month))].sort().reverse(), [rates])
  const activeMonth = month || months[0] || ''

  const rows = useMemo(() => {
    const map = new Map<string, RateRow>()
    for (const r of rates) {
      if (r.effective_month !== activeMonth) continue
      const key = `${r.insurer}|${r.product_type}|${r.band}`
      const row = map.get(key) ?? {
        key, insurer: r.insurer, productType: r.product_type, band: r.band, bandOrder: r.band_order, rates: [],
      }
      row.rates[r.installment - 1] = r.rate_pct
      map.set(key, row)
    }
    return [...map.values()].sort((a, b) =>
      a.insurer.localeCompare(b.insurer, 'ko')
      || a.productType.localeCompare(b.productType, 'ko', { numeric: true })
      || a.bandOrder - b.bandOrder)
  }, [rates, activeMonth])

  const insurers = useMemo(() => [...new Set(rows.map((r) => r.insurer))], [rows])
  const visible = useMemo(() => rows.filter((r) =>
    (insurer === 'all' || r.insurer === insurer)
    && (showAll || FEATURED_TYPES.has(`${r.insurer}|${r.productType}`))), [rows, insurer, showAll])

  // 3차년도까지 지급하는 유형이 있을 때만 25~36회 열을 보여준다
  const lastInstallment = useMemo(() => {
    const max = Math.max(0, ...visible.map((r) => r.rates.length))
    return max > 24 ? 36 : 24
  }, [visible])
  const installments = Array.from({ length: lastInstallment }, (_, i) => i + 1)
  const yearCount = lastInstallment / 12

  // 직급 지급비율을 곱하고, 수정P를 넣으면 % 대신 예상 수수료(원)로 보여준다
  const premium = Number(premiumInput.replace(/,/g, '')) || 0
  const display = (pct: number | null, ratio = gradeRatio) => {
    if (pct == null) return ''
    if (premium > 0) return Math.round((premium * pct * ratio) / 100).toLocaleString('ko-KR')
    return String(round1(pct * ratio))
  }
  const gradeName = grades.find((g) => g.ratio === gradeRatio)?.name
  const totalOf = (r: RateRow) =>
    round1(Array.from({ length: yearCount }, (_, y) => yearSum(r.rates, y)).reduce((s, v) => s + v, 0))

  async function downloadExcel() {
    const XLSX = await import('xlsx')
    const scale = (v: number | null) => (v == null ? '' : round1(v * gradeRatio))
    const header = ['보험사', '유형', '구간', ...installments.map((i) => `${i}회`), ...YEARS.slice(0, yearCount), '총계']
    const body = visible.map((r) => {
      const years = Array.from({ length: yearCount }, (_, y) => yearSum(r.rates, y))
      return [r.insurer, r.productType, r.band, ...installments.map((i) => scale(r.rates[i - 1] ?? null)),
        ...years.map(scale), scale(round1(years.reduce((s, v) => s + v, 0)))]
    })
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '회차별 지급률')
    if (grades.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['보험사', '유형', '구간', '100%', ...grades.map((g) => `${g.name} (${pctLabel(g.ratio)})`)],
      ...visible.map((r) => {
        const total = totalOf(r)
        return [r.insurer, r.productType, r.band, total, ...grades.map((g) => round1(total * g.ratio))]
      }),
    ]), '직급별 총계')
    const suffix = isAgent ? `_${profile.name}` : gradeName ? `_${gradeName}` : ''
    XLSX.writeFile(wb, `장기_회차별지급률_${activeMonth}${suffix}.xlsx`)
  }

  const cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">장기 지급률표</h1>
        <p className="text-sm text-slate-500 mt-1">
          보험사 장기보험 회차별 지급률입니다. 모든 값은 월납환산 수정보험료(수정P) 대비 %이고, 빈칸은 미지급 회차입니다.{' '}
          {isAgent
            ? <>본인 장기 지급률({pctLabel(gradeRatio)})을 곱한 값이며, 수정P를 입력하면 회차별 예상 수수료(원)로 바뀝니다.</>
            : <>직급을 고르면 직급 지급비율을 곱한 값으로, 수정P를 입력하면 회차별 예상 수수료(원)로 바뀝니다.</>}
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([['rates', '회차별 지급률'], ['modification', '상품별 수정률']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === key
              ? 'border-slate-800 text-slate-800 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'modification' && (
        <div className="space-y-6">
          {isAgent
            ? <CommissionReference fixedRatio={gradeRatio} fixedLabel={profile.title} />
            : <CommissionReference />}
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 select-none">
              삼성화재 상품별 상세 수정률 (2024-04 공지)
            </summary>
            <div className="mt-3">
              <ModificationRates />
            </div>
          </details>
        </div>
      )}

      {tab === 'rates' && <>
        <div className="flex flex-wrap items-center gap-3">
          {months.length > 1 && (
            <select value={activeMonth} onChange={(e) => setMonth(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
              {months.map((m) => <option key={m} value={m}>{m} 기준</option>)}
            </select>
          )}
          <select value={insurer} onChange={(e) => setInsurer(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
            <option value="all">전체 보험사</option>
            {insurers.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          {isAgent ? (
            <span className="text-sm text-slate-600 whitespace-nowrap">
              {profile.title || '내'} 지급률 <b className="text-rose-700">{pctLabel(gradeRatio)}</b>
            </span>
          ) : (
            <select value={selectedRatio} onChange={(e) => setSelectedRatio(Number(e.target.value))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
              <option value={1}>지급비율 100%</option>
              {grades.map((g) => <option key={g.name} value={g.ratio}>{g.name} ({pctLabel(g.ratio)})</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
            월납환산 수정P
            <input value={premiumInput} inputMode="numeric" placeholder="예: 100,000"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '')
                setPremiumInput(digits ? Number(digits).toLocaleString('ko-KR') : '')
              }}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-32 text-right" />
            원
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 whitespace-nowrap">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            전체 유형 보기
          </label>
          <button onClick={downloadExcel} disabled={visible.length === 0}
            className="ml-auto border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white hover:bg-slate-50 disabled:opacity-40">
            엑셀 다운로드
          </button>
        </div>

        {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
        {!loading && visible.length === 0 && (
          <p className="text-center text-slate-400 py-6">등록된 지급률이 없습니다.</p>
        )}

        {visible.length > 0 && (
          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <table className="text-sm">
              <thead className="text-slate-500 text-xs bg-slate-100">
                <tr>
                  <th className="text-left px-3 py-2 sticky left-0 bg-slate-100 whitespace-nowrap">보험사 · 유형 · 구간</th>
                  {installments.map((i) => <th key={i} className="text-right px-2 py-2 whitespace-nowrap">{i}회</th>)}
                  {YEARS.slice(0, yearCount).map((y) => (
                    <th key={y} className="text-right px-2 py-2 whitespace-nowrap bg-amber-50">{y}</th>
                  ))}
                  <th className="text-right px-3 py-2 whitespace-nowrap bg-amber-100">총계</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, idx) => {
                  const years = Array.from({ length: yearCount }, (_, y) => yearSum(r.rates, y))
                  const total = totalOf(r)
                  const firstOfInsurer = idx === 0 || visible[idx - 1].insurer !== r.insurer
                  return (
                    <tr key={r.key} className={firstOfInsurer ? 'border-t-2 border-slate-200' : 'border-t border-slate-50'}>
                      <td className="px-3 py-1.5 sticky left-0 bg-white whitespace-nowrap">
                        <span className="text-slate-500">{r.insurer}</span>{' '}
                        <span className="font-semibold text-slate-800">{r.productType}</span>
                        {r.band && <span className="text-slate-500"> · {r.band}</span>}
                      </td>
                      {installments.map((i) => <td key={i} className={cell}>{display(r.rates[i - 1] ?? null)}</td>)}
                      {years.map((y, i) => <td key={i} className={`${cell} bg-amber-50 font-medium`}>{display(y)}</td>)}
                      <td className={`${cell} px-3 bg-amber-100 font-semibold text-rose-700`}>{display(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {visible.length > 0 && grades.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">
              직급별 총 지급률{premium > 0 && ' (예상 수수료, 원)'}
            </h2>
            <div className="bg-white rounded-xl shadow overflow-x-auto w-fit max-w-full">
              <table className="text-sm">
                <thead className="text-slate-500 text-xs bg-slate-100">
                  <tr>
                    <th className="text-left px-3 py-2 sticky left-0 bg-slate-100 whitespace-nowrap">보험사 · 유형 · 구간</th>
                    <th className={`text-right px-3 py-2 whitespace-nowrap ${gradeRatio === 1 ? 'bg-amber-100' : ''}`}>100%</th>
                    {grades.map((g) => (
                      <th key={g.name}
                        className={`text-right px-3 py-2 whitespace-nowrap ${g.ratio === gradeRatio ? 'bg-amber-100' : ''}`}>
                        {g.name}<span className="block font-normal">{pctLabel(g.ratio)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, idx) => {
                    const total = totalOf(r)
                    const firstOfInsurer = idx === 0 || visible[idx - 1].insurer !== r.insurer
                    return (
                      <tr key={r.key} className={firstOfInsurer ? 'border-t-2 border-slate-200' : 'border-t border-slate-50'}>
                        <td className="px-3 py-1.5 sticky left-0 bg-white whitespace-nowrap">
                          <span className="text-slate-500">{r.insurer}</span>{' '}
                          <span className="font-semibold text-slate-800">{r.productType}</span>
                          {r.band && <span className="text-slate-500"> · {r.band}</span>}
                        </td>
                        <td className={`${cell} px-3 ${gradeRatio === 1 ? 'bg-amber-50 font-semibold text-rose-700' : ''}`}>
                          {display(total, 1)}
                        </td>
                        {grades.map((g) => (
                          <td key={g.name}
                            className={`${cell} px-3 ${g.ratio === gradeRatio ? 'bg-amber-50 font-semibold text-rose-700' : ''}`}>
                            {display(total, g.ratio)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>}
    </div>
  )
}
