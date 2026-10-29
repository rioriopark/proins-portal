import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { InsurerBaseRate, PayoutGrade, RepresentativeProduct } from '../lib/types'

// 손보사 대표상품 수정률표 — 예상 수수료 = 월납 영수P × 수정률 × 보험사 기준 지급률(초회/계속) × 직급 지급비율

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`
}

function won(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

export default function CommissionReference() {
  const [products, setProducts] = useState<RepresentativeProduct[]>([])
  const [baseRates, setBaseRates] = useState<InsurerBaseRate[]>([])
  const [grades, setGrades] = useState<PayoutGrade[]>([])
  const [loading, setLoading] = useState(true)
  const [gradeRatio, setGradeRatio] = useState(1)
  const [premiumInput, setPremiumInput] = useState('100,000')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: p }, { data: b }, { data: g }] = await Promise.all([
        supabase.from('representative_products').select('*').order('sort_order'),
        supabase.from('insurer_base_rates').select('*'),
        supabase.from('payout_grades').select('*').order('sort_order'),
      ])
      setProducts(p ?? [])
      setBaseRates(b ?? [])
      setGrades(g ?? [])
      setLoading(false)
    }
    load()
  }, [])

  // 보험사별 가장 최근 기준월만 쓴다
  const { latestProducts, baseByInsurer, month } = useMemo(() => {
    const latestBase = new Map<string, InsurerBaseRate>()
    for (const b of baseRates) {
      const cur = latestBase.get(b.insurer)
      if (!cur || cur.effective_month < b.effective_month) latestBase.set(b.insurer, b)
    }
    const latestMonth = new Map<string, string>()
    for (const p of products) {
      if ((latestMonth.get(p.insurer) ?? '') < p.effective_month) latestMonth.set(p.insurer, p.effective_month)
    }
    return {
      latestProducts: products.filter((p) => latestMonth.get(p.insurer) === p.effective_month),
      baseByInsurer: latestBase,
      month: [...latestMonth.values()].sort().at(-1) ?? '',
    }
  }, [products, baseRates])

  // 종목(건강보험, 어린이보험 …)별로 묶고, 종목 순서는 sort_order 가 처음 나온 순서를 따른다
  const categories = useMemo(() => {
    const map = new Map<string, { name: string; basis: string; rows: RepresentativeProduct[] }>()
    for (const p of latestProducts) {
      const c = map.get(p.category) ?? { name: p.category, basis: p.basis, rows: [] }
      c.rows.push(p)
      map.set(p.category, c)
    }
    return [...map.values()]
  }, [latestProducts])

  const insurers = useMemo(() => [...baseByInsurer.keys()], [baseByInsurer])
  const premium = Number(premiumInput.replace(/,/g, '')) || 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        보험사·종목별 대표상품의 평균 수정률과 영수P 대비 지급률입니다. 지급률 = 수정률 × 보험사 기준 지급률 × 직급 지급비율.
        대표상품 평균 기준의 참고용 예시이며, 실제 가입설계에 따라 수정률은 달라질 수 있습니다.
        연금·저축보험의 유지보수 수수료는 포함하지 않았습니다.{month && <> ({month} 기준)</>}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <select value={gradeRatio} onChange={(e) => setGradeRatio(Number(e.target.value))}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
          <option value={1}>지급비율 100%</option>
          {grades.map((g) => <option key={g.name} value={g.ratio}>{g.name} ({pct(g.ratio)})</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
          월납 영수P
          <input value={premiumInput} inputMode="numeric"
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, '')
              setPremiumInput(digits ? Number(digits).toLocaleString('ko-KR') : '')
            }}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-32 text-right" />
          원
        </label>
      </div>

      {insurers.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-x-auto w-fit max-w-full">
          <table className="text-sm">
            <thead className="text-slate-500 text-xs bg-slate-100">
              <tr>
                <th className="text-left px-4 py-2">보험사 기준 지급률</th>
                {insurers.map((i) => <th key={i} className="text-right px-4 py-2 whitespace-nowrap">{i}</th>)}
              </tr>
            </thead>
            <tbody>
              {(['first_rate', 'renewal_rate'] as const).map((k) => (
                <tr key={k} className="border-t border-slate-50">
                  <td className="px-4 py-1.5 text-slate-700">{k === 'first_rate' ? '초회' : '계속'}</td>
                  {insurers.map((i) => (
                    <td key={i} className="px-4 py-1.5 text-right tabular-nums">{pct(baseByInsurer.get(i)![k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && categories.length === 0 && (
        <p className="text-center text-slate-400 py-6">등록된 대표상품 수정률이 없습니다.</p>
      )}

      <div className="grid gap-3 2xl:grid-cols-2">
        {categories.map((c) => (
          <div key={c.name} className="bg-white rounded-xl shadow overflow-hidden">
            <div className="flex items-center justify-between bg-slate-100 px-4 py-2">
              <p className="font-semibold text-sm text-slate-700">{c.name}</p>
              <span className="text-xs text-slate-500">{c.basis}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs border-b border-slate-100">
                  <tr>
                    <th className="text-left px-3 py-2">보험사</th>
                    <th className="text-left px-3 py-2">상품명</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">수정률</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">초회</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">계속</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">합계</th>
                    {premium > 0 && <th className="text-right px-3 py-2 whitespace-nowrap">예상 수수료</th>}
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((p) => {
                    const base = baseByInsurer.get(p.insurer)
                    const first = base ? p.mod_rate * base.first_rate * gradeRatio : 0
                    const renewal = base ? p.mod_rate * base.renewal_rate * gradeRatio : 0
                    return (
                      <tr key={p.insurer} className="border-t border-slate-50">
                        <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{p.insurer}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-slate-800">{p.product}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(p.mod_rate)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(first)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(renewal)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{pct(first + renewal)}</td>
                        {premium > 0 && (
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-rose-700 whitespace-nowrap">
                            {won(premium * (first + renewal))}원
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
