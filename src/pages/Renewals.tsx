import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, ContractCategory, Organization, Profile } from '../lib/types'
import { compareByOrgGradeCode } from '../lib/agentSort'

interface Invite { email: string; name: string; org_id: string; title: string }

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
const RENEWAL_STATUS_OPTIONS = ['갱신완료', '갱신불가', '보류', '건별계약']

interface ReassignOption { kind: 'p' | 'e'; id: string | null; email: string; label: string }

export default function Renewals() {
  const { profile, can } = useAuth()
  const canManage = can('contracts')
  // 담당자 변경은 본사관리자·본부장·지점장·지사장과 담당자 이윤희만 할 수 있다.
  const canReassign =
    profile?.role === 'hq_admin' ||
    ['본부장', '지점장', '지사장'].some((k) => (profile?.title ?? '').includes(k)) ||
    profile?.name === '이윤희'
  const [contracts, setContracts] = useState<Contract[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [reassignOptions, setReassignOptions] = useState<ReassignOption[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30')
  const [categoryFilter, setCategoryFilter] = useState<'전체' | ContractCategory>('전체')
  const [search, setSearch] = useState('')
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await fetchAllRows<Contract>((from, to) =>
        supabase.from('contracts').select('*').in('category', ['일반', '자동차']).range(from, to)
      )
      setContracts(data)
      if (canManage) {
        const [{ data: p }, { data: i }, { data: o }] = await Promise.all([
          supabase.from('profiles').select('*').order('name'),
          supabase.from('pending_invites').select('email, name, org_id, title'),
          supabase.from('organizations').select('*'),
        ])
        setAgents(p ?? [])
        setInvites(i ?? [])
        setOrgs(o ?? [])
      }
      if (canReassign) {
        const { data: ro } = await supabase.rpc('list_renewal_reassign_options')
        setReassignOptions(ro ?? [])
      }
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, canManage, canReassign])

  // 어느 계정에서 갱신여부를 바꾸든, 지금 이 화면을 열어둔 다른 계정에도 실시간으로 반영해
  // 이미 처리된 건이 계속 남아 보이지 않도록 한다.
  useEffect(() => {
    const channel = supabase
      .channel('renewals-contracts-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contracts' }, (payload) => {
        const updated = payload.new as Contract
        setContracts((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const agentInfo = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]))
    const byEmail = new Map(invites.map((i) => [i.email, i]))
    return (c: Contract) => {
      if (c.agent_id === profile?.id) {
        return { name: profile.name, org_id: profile.org_id, title: profile.title, email: profile.email, pending: false }
      }
      if (c.agent_id && byId.has(c.agent_id)) {
        const p = byId.get(c.agent_id)!
        return { name: p.name, org_id: p.org_id, title: p.title, email: p.email, pending: false }
      }
      if (c.agent_email && byEmail.has(c.agent_email)) {
        const i = byEmail.get(c.agent_email)!
        return { name: i.name, org_id: i.org_id, title: i.title, email: i.email, pending: true }
      }
      return { name: c.agent_email ?? c.agent_id ?? '-', org_id: '', title: '', email: c.agent_email ?? '', pending: true }
    }
  }, [agents, invites, profile])

  const keyword = search.trim().toLowerCase()

  const withExpiry = useMemo(() => {
    const rows = contracts
      .filter((c) => {
        if (c.renewal_status) return false
        if (!(c.expiry_date || c.receipt_date)) return false
        // 보험기간이 1년 미만인 단기성 계약(행사·공사기간 담보 등)은 매년 갱신 대상이 아니므로 제외한다.
        if (c.expiry_date && c.receipt_date && c.expiry_date < addYears(c.receipt_date, 1)) return false
        if (categoryFilter !== '전체' && c.category !== categoryFilter) return false
        if (keyword) {
          const haystack = [c.policy_no, c.customer_name, c.insured_name].join(' ').toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      })
      .map((c) => ({ c, expiry: c.expiry_date ?? addYears(c.receipt_date!, 1), estimated: !c.expiry_date }))

    // 증권번호가 같은 계약이 여러 건이면(과거 갱신 이력 등) 보험시기가 가장 최근인 1건만 남긴다.
    // 화면 표시만 걸러낼 뿐 DB의 계약 데이터 자체는 그대로 둔다.
    const latestByPolicy = new Map<string, (typeof rows)[number]>()
    const noPolicyNo: typeof rows = []
    for (const r of rows) {
      if (!r.c.policy_no) {
        noPolicyNo.push(r)
        continue
      }
      const existing = latestByPolicy.get(r.c.policy_no)
      if (!existing || (r.c.receipt_date ?? '') > (existing.c.receipt_date ?? '')) {
        latestByPolicy.set(r.c.policy_no, r)
      }
    }
    return [...latestByPolicy.values(), ...noPolicyNo]
  }, [contracts, categoryFilter, keyword])

  // 갱신완료를 고르면, 만기 다음날을 영수일로 하는 예비계약을 등록해 "계약관리 > 예비계약 확인"에서
  // 보험사 확정 계약이 들어왔을 때 매칭·확정할 수 있게 한다.
  async function setRenewalStatus(c: Contract, expiry: string, status: string) {
    const renewal_status = status || null
    const { error } = await supabase.rpc('set_contract_renewal_status', { contract_id: c.id, status: renewal_status })
    if (error) {
      alert('갱신여부 저장 실패: ' + error.message)
      return
    }
    setContracts((prev) => prev.map((row) => (row.id === c.id ? { ...row, renewal_status } : row)))

    if (status === '갱신완료') {
      const receipt_date = addDays(expiry, 1)
      const { error: prelimError } = await supabase.from('contracts').upsert(
        {
          agent_id: c.agent_id,
          agent_email: c.agent_email,
          month: receipt_date.slice(0, 7),
          category: c.category,
          type: '계속',
          company: c.company,
          policy_no: c.policy_no,
          customer_name: c.customer_name,
          receipt_date,
          count: 1,
          premium: c.premium,
          commission: 0,
          is_preliminary: true,
        },
        { onConflict: 'company,policy_no,month,type,is_preliminary' }
      )
      if (prelimError) alert('예비계약 등록 실패: ' + prelimError.message)
    }
  }

  const agentOptions = reassignOptions
    .map((o) => ({ value: o.kind === 'p' ? `p:${o.id}` : `e:${o.email}`, label: o.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'))

  function currentAgentValue(c: Contract) {
    if (c.agent_id) return `p:${c.agent_id}`
    if (c.agent_email) return `e:${c.agent_email}`
    return ''
  }

  async function reassignAgent(c: Contract, value: string) {
    const [kind, key] = value.split(/:(.+)/)
    const newAgentId = kind === 'p' ? key : null
    const newAgentEmail = kind === 'p' ? reassignOptions.find((o) => o.id === key)?.email ?? null : key
    const { error } = await supabase.rpc('reassign_renewal_contract_agent', {
      contract_id: c.id,
      new_agent_id: newAgentId,
      new_agent_email: newAgentEmail,
    })
    if (error) {
      alert('담당자 변경 실패: ' + error.message)
      return
    }
    setContracts((prev) =>
      prev.map((row) => (row.id === c.id ? { ...row, agent_id: newAgentId, agent_email: newAgentEmail } : row))
    )
  }

  const filtered = useMemo(() => {
    if (period === 'all') return withExpiry
    if (period === 'overdue') return withExpiry.filter((r) => r.expiry < today)
    const end = addDays(today, Number(period))
    return withExpiry.filter((r) => r.expiry >= today && r.expiry <= end)
  }, [withExpiry, period, today])

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])

  const groups = useMemo(() => {
    interface Group {
      key: string; name: string; org_id: string; title: string; email: string
      pending: boolean; rows: { c: Contract; expiry: string; estimated: boolean }[]; premium: number
    }
    const map = new Map<string, Group>()
    for (const r of filtered) {
      const key = r.c.agent_id ?? r.c.agent_email ?? 'unknown'
      const info = agentInfo(r.c)
      const g =
        map.get(key) ??
        { key, name: info.name, org_id: info.org_id, title: info.title, email: info.email, pending: info.pending, rows: [], premium: 0 }
      g.rows.push(r)
      g.premium += r.c.premium
      map.set(key, g)
    }
    return [...map.values()]
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.expiry.localeCompare(b.expiry)) }))
      // 노출 우선순위: 조직(본사>직영>지점) > 직급 > 사번
      .sort((a, b) => compareByOrgGradeCode(a, b, orgsById))
  }, [filtered, agentInfo, orgsById])

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
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="계약찾기: 증권번호, 계약자명, 피보험자명"
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white w-64"
        />
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
                      <th className="text-left px-4 py-2">증권번호</th>
                      <th className="text-left px-4 py-2">만기예정일</th>
                      <th className="text-left px-4 py-2">보험사</th>
                      <th className="text-left px-4 py-2">상품명</th>
                      <th className="text-left px-4 py-2">고객명</th>
                      <th className="text-left px-4 py-2">종목</th>
                      <th className="text-right px-4 py-2">보험료</th>
                      <th className="text-left px-4 py-2">갱신여부</th>
                      {canReassign && <th className="text-left px-4 py-2">담당자</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(({ c, expiry, estimated }) => {
                      const overdue = expiry < today
                      return (
                        <tr key={c.id} className="border-t border-slate-50">
                          <td className="px-4 py-1.5">{c.policy_no ?? '-'}</td>
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
                          <td className="px-4 py-1.5">
                            <select
                              value={c.renewal_status ?? ''}
                              onChange={(e) => setRenewalStatus(c, expiry, e.target.value)}
                              className="border border-slate-200 rounded px-1.5 py-1 text-xs bg-white"
                            >
                              <option value="">선택…</option>
                              {RENEWAL_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          {canReassign && (
                            <td className="px-4 py-1.5">
                              <select
                                value={currentAgentValue(c)}
                                onChange={(e) => reassignAgent(c, e.target.value)}
                                className="border border-slate-200 rounded px-1.5 py-1 text-xs bg-white"
                              >
                                {agentOptions.map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          )}
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
