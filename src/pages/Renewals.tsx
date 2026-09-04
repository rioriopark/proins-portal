import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, ContractCategory, Profile } from '../lib/types'

interface Invite { email: string; name: string }

// 실제 만기일(expiry_date)이 있으면 그 값을 쓰고, 없는 계약(만기일 없이 등록된 건)만 영수일 + 1년으로 추정한다.
function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0, 10)
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function dday(expiry: string, today: string): string {
  const diff = Math.round((new Date(expiry + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) / 86400000)
  if (diff === 0) return 'D-day'
  return diff > 0 ? `D-${diff}` : `D+${-diff}`
}
function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0)
}

const PERIOD_OPTIONS = [
  { value: '7', label: '7일 이내' },
  { value: '30', label: '30일 이내' },
  { value: '60', label: '60일 이내' },
  { value: '90', label: '90일 이내' },
  { value: 'overdue', label: '기한 지남' },
  { value: 'all', label: '전체' },
]

const CATEGORY_OPTIONS: ('전체' | ContractCategory)[] = ['전체', '일반', '자동차']

export default function Renewals() {
  const { profile, can } = useAuth()
  const canManage = can('contracts')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30')
  const [categoryFilter, setCategoryFilter] = useState<'전체' | ContractCategory>('전체')
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('contracts').select('*').in('category', ['일반', '자동차'])
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

  const today = new Date().toISOString().slice(0, 10)

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

  const withExpiry = useMemo(
    () =>
      contracts
        .filter((c) => (c.expiry_date || c.receipt_date) && (categoryFilter === '전체' || c.category === categoryFilter))
        .map((c) => ({ c, expiry: c.expiry_date ?? addYears(c.receipt_date!, 1), estimated: !c.expiry_date })),
    [contracts, categoryFilter],
  )

  const filtered = useMemo(() => {
    if (period === 'all') return withExpiry
    if (period === 'overdue') return withExpiry.filter((r) => r.expiry < today)
    const end = addDays(today, Number(period))
    return withExpiry.filter((r) => r.expiry >= today && r.expiry <= end)
  }, [withExpiry, period, today])

  const groups = useMemo(() => {
    interface Group { key: string; name: string; pending: boolean; rows: { c: Contract; expiry: string; estimated: boolean }[]; premium: number }
    const map = new Map<string, Group>()
    for (const r of filtered) {
      const key = r.c.agent_id ?? r.c.agent_email ?? 'unknown'
      const info = agentInfo(r.c)
      const g = map.get(key) ?? { key, name: info.name, pending: info.pending, rows: [], premium: 0 }
      g.rows.push(r)
      g.premium += r.c.premium
      map.set(key, g)
    }
    return [...map.values()]
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.expiry.localeCompare(b.expiry)) }))
      .sort((a, b) => (a.rows[0]?.expiry ?? '').localeCompare(b.rows[0]?.expiry ?? ''))
  }, [filtered, agentInfo])

  const totalCount = filtered.length
  const totalPremium = sum(filtered, (r) => r.c.premium)

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
        <h1 className="text-xl font-bold text-slate-800">갱신관리</h1>
        <p className="text-sm text-slate-500 mt-1">
          일반/자동차 계약의 영수일 + 1년을 만기 예정일로 추정해 보여줍니다. (장기 계약은 별도 갱신주기를 가져 제외됩니다)
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c === '전체' ? '전체 종목' : c}</option>)}
        </select>
        <span className="text-sm text-slate-500">
          {totalCount}건 · 보험료 합계 {totalPremium.toLocaleString('ko-KR')}원
        </span>
      </div>

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && groups.length === 0 && <p className="text-center text-slate-400 py-6">해당 조건의 갱신 예정 계약이 없습니다.</p>}

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
                      <th className="text-left px-4 py-2">만기예정일</th>
                      <th className="text-left px-4 py-2">보험사</th>
                      <th className="text-left px-4 py-2">상품명</th>
                      <th className="text-left px-4 py-2">고객명</th>
                      <th className="text-left px-4 py-2">종목</th>
                      <th className="text-right px-4 py-2">보험료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(({ c, expiry, estimated }) => {
                      const overdue = expiry < today
                      return (
                        <tr key={c.id} className="border-t border-slate-50">
                          <td className="px-4 py-1.5">
                            <span className={overdue ? 'text-rose-600 font-medium' : 'text-slate-700'}>{expiry}</span>
                            <span className={`ml-1.5 text-xs ${overdue ? 'text-rose-500' : 'text-slate-400'}`}>({dday(expiry, today)})</span>
                            {estimated && <span className="ml-1.5 text-[10px] text-slate-400" title="만기일 미등록 · 영수일+1년으로 추정">추정</span>}
                          </td>
                          <td className="px-4 py-1.5">{c.company}</td>
                          <td className="px-4 py-1.5">{c.product_name}</td>
                          <td className="px-4 py-1.5">{c.customer_name}</td>
                          <td className="px-4 py-1.5">{c.category}</td>
                          <td className="px-4 py-1.5 text-right">{c.premium.toLocaleString('ko-KR')}</td>
                        </tr>
                      )
                    })}
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
