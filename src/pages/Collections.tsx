import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, Profile } from '../lib/types'

interface Invite { email: string; name: string }

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0)
}

// 보험사 파일마다 "정상"을 표현하는 방식이 다를 수 있어, "정상"이 포함되지 않은 값을 미수금·지연으로 간주한다.
function isProblem(status: string): boolean {
  return !!status && !status.includes('정상')
}

export default function Collections() {
  const { profile, can } = useAuth()
  const canManage = can('contracts')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('problem')
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('contracts').select('*').not('collection_status', 'is', null)
      setContracts(data ?? [])
      if (canManage) {
        const [{ data: p }, { data: i }] = await Promise.all([
          supabase.from('profiles').select('*').order('name'),
          supabase.from('pending_invites').select('email, name'),
        ])
        setAgents(p ?? [])
        setInvites(i ?? [])
      }
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, canManage])

  const agentInfo = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]))
    const byEmail = new Map(invites.map((i) => [i.email, i]))
    return (c: Contract) => {
      if (c.agent_id === profile?.id) return { name: profile.name, pending: false }
      if (c.agent_id && byId.has(c.agent_id)) return { name: byId.get(c.agent_id)!.name, pending: false }
      if (c.agent_email && byEmail.has(c.agent_email)) return { name: byEmail.get(c.agent_email)!.name, pending: true }
      return { name: c.agent_email ?? c.agent_id ?? '-', pending: true }
    }
  }, [agents, invites, profile])

  const distinctStatuses = useMemo(
    () => [...new Set(contracts.map((c) => c.collection_status).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'ko')),
    [contracts],
  )

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return contracts
    if (statusFilter === 'problem') return contracts.filter((c) => isProblem(c.collection_status ?? ''))
    return contracts.filter((c) => c.collection_status === statusFilter)
  }, [contracts, statusFilter])

  const groups = useMemo(() => {
    interface Group { key: string; name: string; pending: boolean; rows: Contract[]; premium: number }
    const map = new Map<string, Group>()
    for (const c of filtered) {
      const key = c.agent_id ?? c.agent_email ?? 'unknown'
      const info = agentInfo(c)
      const g = map.get(key) ?? { key, name: info.name, pending: info.pending, rows: [], premium: 0 }
      g.rows.push(c)
      g.premium += c.premium
      map.set(key, g)
    }
    return [...map.values()]
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => (a.receipt_date ?? '').localeCompare(b.receipt_date ?? '')) }))
      .sort((a, b) => b.rows.length - a.rows.length)
  }, [filtered, agentInfo])

  const totalCount = filtered.length
  const totalPremium = sum(filtered, (c) => c.premium)

  function toggleAgent(key: string) {
    setOpenAgents((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">수금관리</h1>
        <p className="text-sm text-slate-500 mt-1">
          보험사 엑셀 업로드 시 함께 들어온 수금상태(정상집금여부 등)를 기준으로 미수금·지연 계약을 담당자별로 보여줍니다.
          업로드 파일에 수금상태 열이 없으면 여기 나타나지 않습니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
          <option value="problem">미수금·지연만</option>
          <option value="all">전체</option>
          {distinctStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-sm text-slate-500">
          {totalCount}건 · 보험료 합계 {totalPremium.toLocaleString('ko-KR')}원
        </span>
      </div>

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && groups.length === 0 && <p className="text-center text-slate-400 py-6">해당 조건의 계약이 없습니다.</p>}

      <div className="space-y-3">
        {groups.map((g) => {
          const open = openAgents.has(g.key)
          return (
            <div key={g.key} className="bg-white rounded-xl shadow overflow-hidden">
              <button
                onClick={() => toggleAgent(g.key)}
                className="w-full flex items-center justify-between bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
              >
                <p className="font-semibold text-sm text-slate-700 flex items-center gap-1.5">
                  <span className="inline-block w-3 text-slate-400">{open ? '▾' : '▸'}</span>
                  {g.name}{g.pending && <span className="text-amber-600 font-normal"> (미가입)</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {g.rows.length}건 · 보험료 {g.premium.toLocaleString('ko-KR')}원
                </p>
              </button>

              {open && (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs border-b border-slate-100">
                    <tr>
                      <th className="text-left px-4 py-2">수금상태</th>
                      <th className="text-left px-4 py-2">고객명</th>
                      <th className="text-left px-4 py-2">상품명</th>
                      <th className="text-left px-4 py-2">보험사</th>
                      <th className="text-left px-4 py-2">영수일</th>
                      <th className="text-right px-4 py-2">보험료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((c) => (
                      <tr key={c.id} className="border-t border-slate-50">
                        <td className="px-4 py-1.5">
                          <span className={isProblem(c.collection_status ?? '') ? 'text-rose-600 font-medium' : 'text-slate-700'}>
                            {c.collection_status}
                          </span>
                        </td>
                        <td className="px-4 py-1.5">{c.customer_name}</td>
                        <td className="px-4 py-1.5">{c.product_name}</td>
                        <td className="px-4 py-1.5">{c.company}</td>
                        <td className="px-4 py-1.5">{c.receipt_date ?? '-'}</td>
                        <td className="px-4 py-1.5 text-right">{c.premium.toLocaleString('ko-KR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
