import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract } from '../lib/types'
import BarChart from '../components/BarChart'

export default function Dashboard() {
  const { profile } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])

  useEffect(() => {
    supabase.from('contracts').select('*').then(({ data }) => setContracts(data ?? []))
  }, [])

  const byMonth = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contracts) map.set(c.month, (map.get(c.month) ?? 0) + c.premium)
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([label, value]) => ({ label, value }))
  }, [contracts])

  const byType = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contracts) map.set(c.type, (map.get(c.type) ?? 0) + c.count)
    return [...map.entries()].map(([label, value]) => ({ label, value }))
  }, [contracts])

  const totalPremium = contracts.reduce((s, c) => s + c.premium, 0)
  const totalCount = contracts.reduce((s, c) => s + c.count, 0)
  const totalCommission = contracts.reduce((s, c) => s + c.commission, 0)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">대시보드</h1>
      <p className="text-sm text-slate-500 -mt-4">{profile?.name}님이 조회 가능한 범위의 실적입니다.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-xs text-slate-500">누적 보험료</p>
          <p className="text-2xl font-bold mt-1">{totalPremium.toLocaleString('ko-KR')}원</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-xs text-slate-500">누적 건수</p>
          <p className="text-2xl font-bold mt-1">{totalCount.toLocaleString('ko-KR')}건</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-xs text-slate-500">누적 수수료</p>
          <p className="text-2xl font-bold mt-1">{totalCommission.toLocaleString('ko-KR')}원</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-sm font-semibold mb-3">월별 보험료 추이</p>
          <BarChart data={byMonth} color="#334155" />
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-sm font-semibold mb-3">계약 구분별 건수</p>
          <BarChart data={byType} color="#b45309" />
        </div>
      </div>
    </div>
  )
}
