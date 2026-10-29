import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import type { ModificationRate } from '../lib/types'

// 한 카드 = 상품 하나. 세부구분(행) × 납기(열) 표로 보여준다
interface ProductGroup {
  key: string
  insurer: string
  line: string
  category: string
  product: string
  note: string
  terms: string[]
  termOrder: Map<string, number>
  segments: { name: string; byTerm: Map<string, number> }[]
}

export default function ModificationRates() {
  const [rows, setRows] = useState<ModificationRate[]>([])
  const [loading, setLoading] = useState(true)
  const [insurer, setInsurer] = useState('')
  const [query, setQuery] = useState('')
  const [premiumInput, setPremiumInput] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await fetchAllRows<ModificationRate>((from, to) =>
        supabase.from('modification_rates').select('*').order('sort_order').range(from, to)
      )
      setRows(data)
      setLoading(false)
    }
    load()
  }, [])

  // 보험사별로 가장 최근 공지만 보여준다
  const latest = useMemo(() => {
    const month = new Map<string, string>()
    for (const r of rows) {
      if ((month.get(r.insurer) ?? '') < r.effective_month) month.set(r.insurer, r.effective_month)
    }
    return { month, rows: rows.filter((r) => month.get(r.insurer) === r.effective_month) }
  }, [rows])

  const insurers = useMemo(() => [...latest.month.keys()].sort((a, b) => a.localeCompare(b, 'ko')), [latest])
  const activeInsurer = insurer || insurers[0] || ''

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map<string, ProductGroup>()
    for (const r of latest.rows) {
      if (r.insurer !== activeInsurer) continue
      if (q && !`${r.category} ${r.product}`.toLowerCase().includes(q)) continue
      const key = r.product
      const g: ProductGroup = map.get(key) ?? {
        key, insurer: r.insurer, line: r.line, category: r.category, product: r.product, note: r.note, terms: [], termOrder: new Map(), segments: [],
      }
      if (!g.terms.includes(r.term)) g.terms.push(r.term)
      g.termOrder.set(r.term, r.term_order)
      let seg = g.segments.find((s) => s.name === r.segment)
      if (!seg) {
        seg = { name: r.segment, byTerm: new Map() }
        g.segments.push(seg)
      }
      seg.byTerm.set(r.term, r.rate_pct)
      map.set(key, g)
    }
    // 빈 칸이 있는 세부구분 때문에 납기가 뒤늦게 나타날 수 있어 원표의 열 순서(term_order)로 다시 정렬
    for (const g of map.values()) g.terms.sort((a, b) => g.termOrder.get(a)! - g.termOrder.get(b)!)
    return [...map.values()]
  }, [latest, activeInsurer, query])

  // 영수P를 넣으면 % 대신 수정P(원)로 보여준다
  const premium = Number(premiumInput.replace(/,/g, '')) || 0
  const display = (pct: number | undefined) => {
    if (pct == null) return '-'
    if (premium > 0) return Math.round((premium * pct) / 100).toLocaleString('ko-KR')
    return String(pct)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        보험사가 공지한 상품별 수정률(%)입니다. 영수P × 수정률 = 수정P이며, 회차별 지급률은 이 수정P에 곱합니다.
        보험사 공지상 단순 참고용이고 수수료 지급의 근거는 아닙니다.
        {activeInsurer && <> ({activeInsurer} {latest.month.get(activeInsurer)} 공지 기준)</>}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {insurers.length > 1 && (
          <select value={activeInsurer} onChange={(e) => setInsurer(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
            {insurers.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품명 검색"
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-48" />
        <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
          월납 영수P
          <input value={premiumInput} inputMode="numeric" placeholder="예: 100,000"
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, '')
              setPremiumInput(digits ? Number(digits).toLocaleString('ko-KR') : '')
            }}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-32 text-right" />
          원 → 수정P
        </label>
      </div>

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && groups.length === 0 && (
        <p className="text-center text-slate-400 py-6">{query ? '검색된 상품이 없습니다.' : '등록된 수정률이 없습니다.'}</p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((g) => (
          <div key={g.key} className="bg-white rounded-xl shadow overflow-hidden">
            <div className="flex items-center justify-between bg-slate-100 px-4 py-2">
              <p className="font-semibold text-sm text-slate-700">
                <span className="text-slate-500 font-normal">[{g.category}]</span> {g.product}
              </p>
              <span className="text-xs text-slate-400">{g.line}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2 whitespace-nowrap">구분</th>
                    {g.terms.map((t) => <th key={t} className="text-right px-3 py-2 whitespace-nowrap">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {g.segments.map((s) => (
                    <tr key={s.name} className="border-t border-slate-50">
                      <td className="px-4 py-1.5 whitespace-nowrap text-slate-700">{s.name}</td>
                      {g.terms.map((t) => (
                        <td key={t} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {display(s.byTerm.get(t))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {g.note && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-50">* {g.note}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
