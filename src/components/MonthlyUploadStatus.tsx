import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// 매월 초 전월분 보험사 파일을 올릴 때, 어느 보험사를 이미 올렸고 어디가 남았는지 한눈에 보이도록
// 보험사별로 해당 지급월의 확정 계약 건수를 센다(예비계약은 제외).
function previousMonth(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthlyUploadStatus({ insurers, refreshKey }: { insurers: string[]; refreshKey: number }) {
  const [month, setMonth] = useState(previousMonth)
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!month) return
    let cancelled = false
    setLoading(true)
    Promise.all(
      insurers.map(async (insurer) => {
        const { count, error } = await supabase
          .from('contracts')
          .select('id', { count: 'exact', head: true })
          .eq('company', insurer)
          .eq('month', month)
          .eq('is_preliminary', false)
        return [insurer, error ? null : (count ?? 0)] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      setCounts(Object.fromEntries(entries))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [insurers, month, refreshKey])

  const doneCount = insurers.filter((i) => (counts[i] ?? 0) > 0).length

  return (
    <div className="bg-white rounded-xl shadow p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm">월별 업로드 현황</h2>
          <p className="text-xs text-slate-500">지급월 기준 확정 계약 건수 · 0건인 보험사는 아직 파일을 올리지 않은 곳입니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {loading ? '확인 중…' : `${doneCount}/${insurers.length}개사 완료`}
          </span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {insurers.map((insurer) => {
          const c = counts[insurer]
          const done = (c ?? 0) > 0
          return (
            <div
              key={insurer}
              className={`rounded-md border px-3 py-2 text-xs ${
                done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
            >
              <div className="font-medium truncate">{insurer}</div>
              <div>{c === undefined ? '…' : c === null ? '조회 실패' : done ? `${c.toLocaleString('ko-KR')}건` : '미업로드'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
