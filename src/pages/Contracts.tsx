import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, ContractCategory, ContractType, Profile } from '../lib/types'

const CATEGORIES: ContractCategory[] = ['장기', '일반', '자동차']
const TYPES: ContractType[] = ['신규', '계속', '환수', '부활', '비례공동']

interface Invite {
  email: string
  name: string
  rate_long: number
  rate_general: number
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function Contracts() {
  const { profile } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<'전체' | ContractCategory>('전체')
  const [typeFilter, setTypeFilter] = useState<'전체' | ContractType>('전체')
  const [monthFilter, setMonthFilter] = useState<string>('전체')
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set())
  const [openCompanies, setOpenCompanies] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({
    agent_id: profile?.id ?? '',
    receipt_date: today(),
    category: '장기' as ContractCategory,
    type: '신규' as ContractType,
    company: '',
    product_name: '',
    customer_name: '',
    premium: 0,
    commission: 0,
  })

  async function load() {
    setLoading(true)
    const { data: c } = await supabase
      .from('contracts')
      .select('*')
      .order('receipt_date', { ascending: false })
      .order('created_at', { ascending: false })
    setContracts(c ?? [])
    if (profile && profile.role !== 'agent') {
      const { data: p } = await supabase.from('profiles').select('*').order('name')
      setAgents(p ?? [])
      const { data: i } = await supabase.from('pending_invites').select('email, name, rate_long, rate_general')
      setInvites(i ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('contracts').insert({
      agent_id: form.agent_id || profile?.id,
      month: form.receipt_date.slice(0, 7),
      receipt_date: form.receipt_date,
      category: form.category,
      type: form.type,
      company: form.company,
      product_name: form.product_name,
      customer_name: form.customer_name,
      count: 1,
      premium: form.premium,
      commission: form.commission,
    })
    if (!error) {
      setForm((f) => ({ ...f, company: '', product_name: '', customer_name: '', premium: 0, commission: 0 }))
      load()
    } else {
      alert('등록 실패: ' + error.message)
    }
  }

  // agent_id/agent_email 로 이름과 지급률을 함께 찾는다
  const agentInfo = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]))
    const byEmail = new Map(invites.map((i) => [i.email, i]))
    return (c: Contract) => {
      if (c.agent_id === profile?.id) return { name: profile.name, rate_long: profile.rate_long, rate_general: profile.rate_general, pending: false }
      if (c.agent_id && byId.has(c.agent_id)) {
        const p = byId.get(c.agent_id)!
        return { name: p.name, rate_long: p.rate_long, rate_general: p.rate_general, pending: false }
      }
      if (c.agent_email && byEmail.has(c.agent_email)) {
        const i = byEmail.get(c.agent_email)!
        return { name: i.name, rate_long: i.rate_long, rate_general: i.rate_general, pending: true }
      }
      return { name: c.agent_email ?? c.agent_id ?? '-', rate_long: 1, rate_general: 1, pending: true }
    }
  }, [agents, invites, profile])

  const rateFor = (c: Contract, info: { rate_long: number; rate_general: number }) =>
    c.category === '장기' ? info.rate_long : info.rate_general

  const months = useMemo(
    () => [...new Set(contracts.map((c) => c.month).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [contracts]
  )

  const filtered = useMemo(
    () =>
      contracts.filter(
        (c) =>
          (categoryFilter === '전체' || c.category === categoryFilter) &&
          (typeFilter === '전체' || c.type === typeFilter) &&
          (monthFilter === '전체' || c.month === monthFilter)
      ),
    [contracts, categoryFilter, typeFilter, monthFilter]
  )

  const groups = useMemo(() => {
    interface CompanyGroup { company: string; rows: Contract[]; premium: number; commission: number }
    interface AgentGroup { key: string; name: string; pending: boolean; premium: number; commission: number; companies: Map<string, CompanyGroup> }
    const map = new Map<string, AgentGroup>()
    for (const c of filtered) {
      const key = c.agent_id ?? c.agent_email ?? 'unknown'
      const info = agentInfo(c)
      const rate = rateFor(c, info)
      const g = map.get(key) ?? { key, name: info.name, pending: info.pending, premium: 0, commission: 0, companies: new Map<string, CompanyGroup>() }
      g.premium += c.premium
      g.commission += c.commission * rate
      const cg = g.companies.get(c.company) ?? { company: c.company, rows: [], premium: 0, commission: 0 }
      cg.rows.push(c)
      cg.premium += c.premium
      cg.commission += c.commission * rate
      g.companies.set(c.company, cg)
      map.set(key, g)
    }
    return [...map.values()]
      .map((g) => ({ ...g, companies: [...g.companies.values()].sort((a, b) => b.premium - a.premium) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [filtered, agentInfo])

  function toggleAgent(key: string) {
    setOpenAgents((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  function toggleCompany(key: string) {
    setOpenCompanies((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const canReassign = profile?.role === 'hq_admin'
  const agentOptions = [
    ...agents.map((a) => ({ value: `p:${a.id}`, label: a.name })),
    ...invites.map((i) => ({ value: `e:${i.email}`, label: `${i.name} (미가입)` })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'ko'))

  function currentAgentValue(c: Contract) {
    if (c.agent_id) return `p:${c.agent_id}`
    if (c.agent_email) return `e:${c.agent_email}`
    return ''
  }

  async function reassignAgent(contractId: string, value: string) {
    const [kind, key] = value.split(/:(.+)/)
    const patch =
      kind === 'p'
        ? { agent_id: key, agent_email: agents.find((a) => a.id === key)?.email ?? null }
        : { agent_id: null, agent_email: key }
    const { error } = await supabase.from('contracts').update(patch).eq('id', contractId)
    if (error) alert('담당자 변경 실패: ' + error.message)
    else load()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">계약관리</h1>

      {profile && profile.role !== 'agent' && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">담당자</label>
            <select
              value={form.agent_id}
              onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">영수일</label>
            <input type="date" value={form.receipt_date} onChange={(e) => setForm((f) => ({ ...f, receipt_date: e.target.value }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">종목</label>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ContractCategory }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">구분</label>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ContractType }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">보험사</label>
            <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">상품명</label>
            <input value={form.product_name} onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">고객명</label>
            <input value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">보험료</label>
            <input type="number" min={0} value={form.premium} onChange={(e) => setForm((f) => ({ ...f, premium: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">수수료(원, 지급률 적용 전)</label>
            <input type="number" value={form.commission} onChange={(e) => setForm((f) => ({ ...f, commission: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium h-fit">
            계약 등록
          </button>
        </form>
      )}

      <div className="flex gap-3">
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
          <option value="전체">전체 기간</option>
          {months.map((m) => {
            const [y, mo] = m.split('-')
            return <option key={m} value={m}>{y}년 {mo}월</option>
          })}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
          <option value="전체">전체 종목</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
          <option value="전체">전체 구분</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && groups.length === 0 && <p className="text-center text-slate-400 py-6">등록된 계약이 없습니다.</p>}

      <div className="space-y-3">
        {groups.map((g) => {
          const agentOpen = openAgents.has(g.key)
          const totalCount = g.companies.reduce((s, cg) => s + cg.rows.length, 0)
          return (
            <div key={g.key} className="bg-white rounded-xl shadow overflow-hidden">
              <button
                onClick={() => toggleAgent(g.key)}
                className="w-full flex items-center justify-between bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
              >
                <p className="font-semibold text-sm text-slate-700 flex items-center gap-1.5">
                  <span className="inline-block w-3 text-slate-400">{agentOpen ? '▾' : '▸'}</span>
                  {g.name}{g.pending && <span className="text-amber-600 font-normal"> (미가입)</span>}
                  <span className="text-xs text-slate-400 font-normal">({g.companies.length}개 보험사)</span>
                </p>
                <p className="text-xs text-slate-500">
                  {totalCount}건 · 보험료 {g.premium.toLocaleString('ko-KR')}원 · 수수료(지급률 적용) {Math.round(g.commission).toLocaleString('ko-KR')}원
                </p>
              </button>

              {agentOpen && (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs border-b border-slate-100">
                    <tr>
                      <th className="text-left px-4 py-2">보험사/상품</th>
                      <th className="text-right px-4 py-2">건수</th>
                      <th className="text-right px-4 py-2">보험료</th>
                      <th className="text-right px-4 py-2">수수료(지급률 적용)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.companies.map((cg) => {
                      const companyKey = `${g.key}|${cg.company}`
                      const companyOpen = openCompanies.has(companyKey)
                      return (
                        <Fragment key={companyKey}>
                          <tr className="border-t border-slate-50">
                            <td colSpan={4} className="p-0">
                              <button
                                onClick={() => toggleCompany(companyKey)}
                                className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-slate-50"
                              >
                                <span className="flex items-center gap-1.5">
                                  <span className="inline-block w-3 text-slate-400">{companyOpen ? '▾' : '▸'}</span>
                                  {cg.company || '(보험사 미입력)'}
                                </span>
                                <span className="flex gap-6 text-slate-600">
                                  <span className="w-12 text-right">{cg.rows.length}</span>
                                  <span className="w-24 text-right">{cg.premium.toLocaleString('ko-KR')}</span>
                                  <span className="w-28 text-right">{Math.round(cg.commission).toLocaleString('ko-KR')}</span>
                                </span>
                              </button>
                            </td>
                          </tr>
                          {companyOpen && (
                            <tr>
                              <td colSpan={4} className="px-4 pb-3">
                                <table className="w-full text-xs border border-slate-100 rounded-md overflow-hidden">
                                  <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                      <th className="text-left px-3 py-1.5">계약자명</th>
                                      <th className="text-left px-3 py-1.5">상품명</th>
                                      <th className="text-left px-3 py-1.5">영수일</th>
                                      <th className="text-right px-3 py-1.5">보험료</th>
                                      <th className="text-right px-3 py-1.5">건별수수료(지급률 {Math.round(rateFor(cg.rows[0], agentInfo(cg.rows[0])) * 100)}% 적용)</th>
                                      {canReassign && <th className="text-left px-3 py-1.5">담당자</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {cg.rows.map((c) => {
                                      const rate = rateFor(c, agentInfo(c))
                                      return (
                                        <tr key={c.id} className="border-t border-slate-100">
                                          <td className="px-3 py-1.5">{c.customer_name}</td>
                                          <td className="px-3 py-1.5">{c.product_name}</td>
                                          <td className="px-3 py-1.5">{c.receipt_date ?? '-'}</td>
                                          <td className="px-3 py-1.5 text-right">{c.premium.toLocaleString('ko-KR')}</td>
                                          <td className="px-3 py-1.5 text-right">{Math.round(c.commission * rate).toLocaleString('ko-KR')}</td>
                                          {canReassign && (
                                            <td className="px-3 py-1.5">
                                              <select
                                                value={currentAgentValue(c)}
                                                onChange={(e) => reassignAgent(c.id, e.target.value)}
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
                                    <tr className="border-t border-slate-200 font-semibold">
                                      <td className="px-3 py-1.5" colSpan={3}>합계</td>
                                      <td className="px-3 py-1.5 text-right">{cg.premium.toLocaleString('ko-KR')}</td>
                                      <td className="px-3 py-1.5 text-right">{Math.round(cg.commission).toLocaleString('ko-KR')}</td>
                                      {canReassign && <td />}
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
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
