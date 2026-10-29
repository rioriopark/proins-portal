import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import type { LongCommissionRate } from '../lib/types'
import ModificationRates from '../components/ModificationRates'

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

function round1(n: number): number {
  return Math.round(n * 10) / 10
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

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await fetchAllRows<LongCommissionRate>((from, to) =>
        supabase.from('long_commission_rates').select('*').range(from, to)
      )
      setRates(data)
      setLoading(false)
    }
    load()
  }, [])

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
  const visible = useMemo(() => (insurer === 'all' ? rows : rows.filter((r) => r.insurer === insurer)), [rows, insurer])

  // 3차년도까지 지급하는 유형이 있을 때만 25~36회 열을 보여준다
  const lastInstallment = useMemo(() => {
    const max = Math.max(0, ...visible.map((r) => r.rates.length))
    return max > 24 ? 36 : 24
  }, [visible])
  const installments = Array.from({ length: lastInstallment }, (_, i) => i + 1)
  const yearCount = lastInstallment / 12

  // 수정P를 넣으면 % 대신 예상 수수료(원)로 보여준다
  const premium = Number(premiumInput.replace(/,/g, '')) || 0
  const display = (pct: number | null) => {
    if (pct == null) return ''
    if (premium > 0) return Math.round((premium * pct) / 100).toLocaleString('ko-KR')
    return String(round1(pct))
  }

  async function downloadExcel() {
    const XLSX = await import('xlsx')
    const header = ['보험사', '유형', '구간', ...installments.map((i) => `${i}회`), ...YEARS.slice(0, yearCount), '총계']
    const body = visible.map((r) => {
      const years = Array.from({ length: yearCount }, (_, y) => yearSum(r.rates, y))
      return [r.insurer, r.productType, r.band, ...installments.map((i) => r.rates[i - 1] ?? ''), ...years,
        round1(years.reduce((s, v) => s + v, 0))]
    })
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '회차별 지급률')
    XLSX.writeFile(wb, `장기_회차별지급률_${activeMonth}.xlsx`)
  }

  const cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">장기 지급률표</h1>
        <p className="text-sm text-slate-500 mt-1">
          보험사 장기보험 회차별 지급률입니다. 모든 값은 월납환산 수정보험료(수정P) 대비 %이고, 빈칸은 미지급 회차입니다.
          수정P를 입력하면 회차별 예상 수수료(원)로 바뀝니다.
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

      {tab === 'modification' && <ModificationRates />}

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
                  const total = round1(years.reduce((s, v) => s + v, 0))
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
      </>}
    </div>
  )
}
