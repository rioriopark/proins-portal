import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, Profile } from '../lib/types'

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Statement() {
  const { profile } = useAuth()
  const [month, setMonth] = useState(thisMonth())
  const [agentId, setAgentId] = useState(profile?.id ?? '')
  const [agents, setAgents] = useState<Profile[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [target, setTarget] = useState<Profile | null>(profile)

  useEffect(() => {
    if (!profile) return
    if (profile.role !== 'agent') {
      supabase.from('profiles').select('*').order('name').then(({ data }) => setAgents(data ?? []))
    }
  }, [profile])

  useEffect(() => {
    setAgentId(profile?.id ?? '')
  }, [profile])

  useEffect(() => {
    if (!agentId) return
    supabase
      .from('contracts')
      .select('*')
      .eq('agent_id', agentId)
      .eq('month', month)
      .then(({ data }) => setContracts(data ?? []))
    if (agentId === profile?.id) setTarget(profile)
    else setTarget(agents.find((a) => a.id === agentId) ?? null)
  }, [agentId, month, agents, profile])

  const rows = useMemo(() => {
    const byKey = new Map<string, { category: string; type: string; count: number; premium: number; raw: number }>()
    for (const c of contracts) {
      const key = `${c.category}__${c.type}`
      const cur = byKey.get(key) ?? { category: c.category, type: c.type, count: 0, premium: 0, raw: 0 }
      cur.count += c.count
      cur.premium += c.premium
      cur.raw += c.commission
      byKey.set(key, cur)
    }
    return [...byKey.values()]
  }, [contracts])

  const rate = (category: string) =>
    target ? (category === '장기' ? target.rate_long : category === '일반' ? target.rate_general : 1) : 1

  const totalPaid = rows.reduce((s, r) => s + r.raw * rate(r.category), 0)
  const deduction = Math.round(totalPaid * 0.033) // 근사 원천세 3.3% — 실제 세율/공제는 회사 정책에 맞게 조정 필요
  const net = totalPaid - deduction

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">수수료명세서</h1>

      <div className="bg-white rounded-xl shadow p-5 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">지급월</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        {profile && profile.role !== 'agent' && (
          <div>
            <label className="block text-xs text-slate-500 mb-1">담당자</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {target && (
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex justify-between border-b border-slate-200 pb-4 mb-4">
            <div>
              <p className="text-lg font-bold">{target.name} 수수료명세서</p>
              <p className="text-sm text-slate-500">{month} · {target.title}</p>
            </div>
            <div className="text-right text-sm text-slate-500">
              <p>은행 {target.bank || '-'}</p>
              <p>계좌 {target.account || '-'}</p>
            </div>
          </div>

          <table className="w-full text-sm mb-4">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">종목</th>
                <th className="text-left px-3 py-2">구분</th>
                <th className="text-right px-3 py-2">건수</th>
                <th className="text-right px-3 py-2">보험료</th>
                <th className="text-right px-3 py-2">지급률</th>
                <th className="text-right px-3 py-2">건별수수료(지급률 적용)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">해당 월 실적이 없습니다.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2 text-right">{r.count}</td>
                  <td className="px-3 py-2 text-right">{r.premium.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right">{Math.round(rate(r.category) * 100)}%</td>
                  <td className="px-3 py-2 text-right">{Math.round(r.raw * rate(r.category)).toLocaleString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">① 합산소득</p>
              <p className="font-bold">{Math.round(totalPaid).toLocaleString('ko-KR')}원</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">② 공제합계</p>
              <p className="font-bold">{deduction.toLocaleString('ko-KR')}원</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">③ 실지급액</p>
              <p className="font-bold text-amber-700">{Math.round(net).toLocaleString('ko-KR')}원</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
