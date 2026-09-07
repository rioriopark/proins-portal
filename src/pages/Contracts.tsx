import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
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

// 신규계약은 등록 시점 기준 이번 달 안에서만 영수일을 입력할 수 있도록 범위를 제한한다.
function monthStart() {
  return `${today().slice(0, 7)}-01`
}
function monthEnd() {
  const [y, m] = today().slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export default function Contracts() {
  const { profile, permissions } = useAuth()
  // 계약 등록(신규계약)은 기본적으로 본사관리자와 본사담당자(소속이 본사인 담당자)만 할 수 있고,
  // 그 외 개별적으로 "계약관리" 권한을 부여받은 사람(정보관리/조직관리에서 지정)도 예외적으로 가능하다.
  // can()은 agent가 아니면 자동으로 통과시키므로(지사/지점 관리자까지 다 열림) 여기서는 쓰지 않고,
  // 실제 개별 부여 여부(permissions)만 직접 확인한다.
  const canManage =
    profile?.role === 'hq_admin' || (profile?.role === 'agent' && profile.org_id === 'hq') || permissions.has('contracts')
  // 위촉설계사(소속이 본사가 아닌 담당자)는 본인 예비계약만 직접 등록할 수 있다.
  const isFieldAgent = profile?.role === 'agent' && profile.org_id !== 'hq'
  const [contracts, setContracts] = useState<Contract[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<'전체' | ContractCategory>('전체')
  const [typeFilter, setTypeFilter] = useState<'전체' | ContractType>('전체')
  const [monthFilter, setMonthFilter] = useState<string>('전체')
  const [search, setSearch] = useState('')
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set())
  const [openCompanies, setOpenCompanies] = useState<Set<string>>(new Set())
  const [newContractOpen, setNewContractOpen] = useState(false)
  const [form, setForm] = useState({
    agent_id: profile?.id ?? '',
    receipt_date: today(),
    category: '장기' as ContractCategory,
    type: '신규' as ContractType,
    company: '',
    policy_no: '',
    customer_name: '',
    premium: 0,
    commission: 0,
  })
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ inserted: number; failed: number; errorMessage?: string } | null>(null)
  const [selfReportOpen, setSelfReportOpen] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [selfForm, setSelfForm] = useState({
    receipt_date: today(),
    category: '장기' as '장기' | '일반',
    company: '',
    policy_no: '',
    customer_name: '',
    premium: 0,
  })

  async function load() {
    setLoading(true)
    const c = await fetchAllRows<Contract>((from, to) =>
      supabase
        .from('contracts')
        .select('*')
        .order('receipt_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to)
    )
    setContracts(c)
    if (canManage) {
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
  }, [profile?.id, canManage])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form.receipt_date < monthStart() || form.receipt_date > monthEnd()) {
      alert('신규계약은 이번 달 영수일로만 등록할 수 있습니다.')
      return
    }
    if (!form.policy_no.trim()) {
      alert('증권번호를 입력해야 등록할 수 있습니다.')
      return
    }
    const { error } = await supabase.from('contracts').insert({
      agent_id: form.agent_id || profile?.id,
      month: form.receipt_date.slice(0, 7),
      receipt_date: form.receipt_date,
      category: form.category,
      type: form.type,
      company: form.company,
      policy_no: form.policy_no || null,
      customer_name: form.customer_name,
      count: 1,
      premium: form.premium,
      commission: form.commission,
      // 신규 건은 보험사 확정 계약이 [계약 일괄등록]으로 들어와 매칭되기 전까지 예비계약으로 남긴다.
      is_preliminary: form.type === '신규',
    })
    if (!error) {
      setForm((f) => ({ ...f, company: '', policy_no: '', customer_name: '', premium: 0, commission: 0 }))
      load()
    } else {
      alert('등록 실패: ' + error.message)
    }
  }

  // 신규계약 옆 "엑셀 일괄등록": 담당자명·보험사·계약번호·계약자명·종목·영수일·보험료를 붙여넣어 한 번에 여러 건 등록.
  // 단일 등록 폼과 동일하게 전부 이번 달 영수일 + 증권번호 필수 + 신규(예비계약)로 들어간다.
  interface BulkRow {
    raw: string[]
    agentName: string
    matched?: Profile
    company: string
    policyNo: string
    customerName: string
    category: string
    receiptDate: string
    month: string
    premium: number
    error?: string
  }
  const bulkRows = useMemo<BulkRow[]>(() => {
    if (!bulkText.trim()) return []
    return bulkText.trim().split(/\r?\n/).filter((l) => l.trim()).map((line) => {
      const cols = line.split(/\t|,/).map((c) => c.trim())
      const [agentName, company, policyNo, customerName, category, receiptDateRaw, premiumRaw] = cols
      const receiptDate = (receiptDateRaw ?? '').replace(/[./]/g, '-')
      const month = /^\d{4}-\d{2}/.test(receiptDate) ? receiptDate.slice(0, 7) : ''
      const matched = agents.find((a) => a.name.trim() === (agentName ?? '').trim())
      const premium = Number(String(premiumRaw ?? '').replace(/[,\s원]/g, '')) || 0
      let error: string | undefined
      if (!matched) error = '담당자 매칭 안 됨'
      else if (!receiptDate || receiptDate < monthStart() || receiptDate > monthEnd()) error = '영수일은 이번 달만 가능'
      else if (!['장기', '일반', '자동차'].includes(category ?? '')) error = '종목 값 오류'
      else if (!policyNo) error = '증권번호 없음'
      return { raw: cols, agentName: agentName ?? '', matched, company: company ?? '', policyNo: policyNo ?? '', customerName: customerName ?? '', category: category ?? '', receiptDate, month, premium, error }
    })
  }, [bulkText, agents])
  const bulkValidCount = bulkRows.filter((r) => !r.error).length

  async function handleBulkImport() {
    setBulkBusy(true)
    const payload = bulkRows.filter((r) => !r.error).map((r) => ({
      agent_id: r.matched!.id,
      month: r.month,
      receipt_date: r.receiptDate,
      category: r.category,
      type: '신규',
      company: r.company,
      policy_no: r.policyNo,
      customer_name: r.customerName,
      count: 1,
      premium: r.premium,
      commission: 0,
      is_preliminary: true,
    }))
    let inserted = 0
    let failed = 0
    let errorMessage: string | undefined
    const { error, data } = await supabase.from('contracts').insert(payload).select('id')
    if (error) {
      failed = payload.length
      errorMessage = error.message
      console.error('신규계약 일괄등록 실패:', error)
    } else {
      inserted = data?.length ?? 0
    }
    setBulkBusy(false)
    setBulkResult({ inserted, failed, errorMessage })
    if (!error) {
      setBulkText('')
      load()
    }
  }

  async function handleDownloadSample() {
    const XLSX = await import('xlsx')
    const header = ['담당자명', '보험사', '계약번호', '계약자명', '종목', '영수일', '보험료']
    const example = ['김은지', '삼성화재', '52616634160000', '홍길동', '장기', monthStart(), '2428500']
    const ws = XLSX.utils.aoa_to_sheet([header, example])
    ws['!cols'] = header.map(() => ({ wch: 16 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '신규계약')
    XLSX.writeFile(wb, '신규계약_샘플.xlsx')
  }

  // 위촉설계사가 보험사 확정 전 직접 등록하는 예비계약: 본인 앞으로, 신규/장기·일반만, 이번 달만.
  // 수수료는 아직 몰라 0으로 두고, 익월 본사에서 보험사 확정 계약을 업로드하면 매칭 후 이 예비계약은 삭제된다.
  async function handleSelfReportSubmit(e: FormEvent) {
    e.preventDefault()
    if (selfForm.receipt_date < monthStart() || selfForm.receipt_date > monthEnd()) {
      alert('신규계약은 이번 달 영수일로만 등록할 수 있습니다.')
      return
    }
    if (!selfForm.policy_no.trim()) {
      alert('증권번호를 입력해야 등록할 수 있습니다.')
      return
    }
    const { error } = await supabase.from('contracts').insert({
      agent_id: profile?.id,
      month: selfForm.receipt_date.slice(0, 7),
      receipt_date: selfForm.receipt_date,
      category: selfForm.category,
      type: '신규',
      company: selfForm.company,
      policy_no: selfForm.policy_no,
      customer_name: selfForm.customer_name,
      count: 1,
      premium: selfForm.premium,
      commission: 0,
      is_preliminary: true,
    })
    if (!error) {
      setSelfForm((f) => ({ ...f, company: '', policy_no: '', customer_name: '', premium: 0 }))
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

  const keyword = search.trim().toLowerCase()

  const filtered = useMemo(
    () =>
      contracts.filter((c) => {
        // 예비계약(확정 전)은 계약 리스트에 안 보이고 "예비계약 확인"에서만 관리한다.
        if (c.is_preliminary) return false
        if (categoryFilter !== '전체' && c.category !== categoryFilter) return false
        if (typeFilter !== '전체' && c.type !== typeFilter) return false
        if (monthFilter !== '전체' && c.month !== monthFilter) return false
        if (keyword) {
          const agentName = agentInfo(c).name
          const haystack = [c.customer_name, c.product_name, c.company, c.policy_no, agentName].join(' ').toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      }),
    [contracts, categoryFilter, typeFilter, monthFilter, keyword, agentInfo]
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

  useEffect(() => {
    if (!keyword) return
    setOpenAgents((prev) => {
      const next = new Set(prev)
      groups.forEach((g) => next.add(g.key))
      return next
    })
    setOpenCompanies((prev) => {
      const next = new Set(prev)
      groups.forEach((g) => g.companies.forEach((cg) => next.add(`${g.key}|${cg.company}`)))
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, groups])

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

  // 위촉설계사가 등록한 예비계약을 전부 보여주되(매칭 대기 중인 것 포함), 보험사 확정 계약(예비 아님)이
  // 이미 들어와 있으면 같이 찾아서 본사관리자/본사담당자가 확인 후 예비계약을 정리할 수 있게 한다.
  // 증권번호가 이제 예비계약에도 필수라 우선 증권번호로 정확히 매칭하고,
  // (옛날 데이터 등) 증권번호가 없는 예비계약만 담당자·보험사·고객명으로 대신 매칭한다.
  const preliminaryMatches = useMemo(() => {
    // 본사관리자/본사담당자는 전체를, 위촉설계사는 본인 것만(RLS로 이미 그렇게만 조회됨) 볼 수 있다.
    if (!canManage && !isFieldAgent) return []
    const officialByPolicyNo = new Map<string, Contract[]>()
    const officialByNameKey = new Map<string, Contract[]>()
    for (const c of contracts) {
      if (c.is_preliminary) continue
      if (c.policy_no?.trim()) {
        const key = c.policy_no.trim()
        if (!officialByPolicyNo.has(key)) officialByPolicyNo.set(key, [])
        officialByPolicyNo.get(key)!.push(c)
      }
      const nameKey = `${c.agent_id ?? c.agent_email ?? ''}|${c.company.trim()}|${c.customer_name.trim()}`
      if (!officialByNameKey.has(nameKey)) officialByNameKey.set(nameKey, [])
      officialByNameKey.get(nameKey)!.push(c)
    }
    return contracts
      .filter((c) => c.is_preliminary)
      .map((prelim) => {
        const byPolicyNo = prelim.policy_no?.trim() ? officialByPolicyNo.get(prelim.policy_no.trim()) : undefined
        if (byPolicyNo?.length) return { prelim, matches: byPolicyNo }
        const nameKey = `${prelim.agent_id ?? prelim.agent_email ?? ''}|${prelim.company.trim()}|${prelim.customer_name.trim()}`
        return { prelim, matches: officialByNameKey.get(nameKey) ?? [] }
      })
  }, [contracts, canManage, isFieldAgent])

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

  async function deleteContract(contractId: string) {
    if (!confirm('이 계약을 삭제할까요? 되돌릴 수 없습니다.')) return
    const { error } = await supabase.from('contracts').delete().eq('id', contractId)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  async function reassignAgent(contractId: string, value: string) {
    if (value === 'delete') { deleteContract(contractId); return }
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

      {canManage && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <button
            type="button"
            onClick={() => setNewContractOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
          >
            <span className="inline-block w-3 text-slate-400">{newContractOpen ? '▾' : '▸'}</span>
            <span className="font-semibold text-sm text-slate-700">신규계약</span>
          </button>
          {newContractOpen && (
        <>
        <form onSubmit={handleSubmit} className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
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
            <label className="block text-xs text-slate-500 mb-1">영수일 (이번 달만 등록 가능)</label>
            <input type="date" value={form.receipt_date} min={monthStart()} max={monthEnd()}
              onChange={(e) => setForm((f) => ({ ...f, receipt_date: e.target.value }))}
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
            <label className="block text-xs text-slate-500 mb-1">증권번호 *</label>
            <input value={form.policy_no} onChange={(e) => setForm((f) => ({ ...f, policy_no: e.target.value }))} required
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
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium h-fit">
              계약 등록
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen((v) => !v)}
              className="border border-slate-300 text-slate-600 rounded-md px-4 py-2 text-sm font-medium h-fit hover:bg-slate-50"
            >
              엑셀 일괄등록
            </button>
          </div>
        </form>

          {bulkOpen && (
            <div className="p-5 pt-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-slate-500 font-mono whitespace-pre-wrap break-all">
                  열 순서: 담당자명{'\t'}보험사{'\t'}계약번호{'\t'}계약자명{'\t'}종목{'\t'}영수일{'\t'}보험료
                  {'\n'}예시: 김은지{'\t'}삼성화재{'\t'}52616634160000{'\t'}홍길동{'\t'}장기{'\t'}2026-09-15{'\t'}2428500
                </p>
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="shrink-0 text-xs text-blue-600 hover:underline whitespace-nowrap"
                >
                  샘플 엑셀 다운로드
                </button>
              </div>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={6}
                placeholder="여기에 엑셀 데이터를 붙여넣으세요"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
              />
              {bulkRows.length > 0 && (
                <div className="text-sm text-slate-600">
                  총 {bulkRows.length}행 · 유효 {bulkValidCount}행
                  {bulkValidCount < bulkRows.length && (
                    <span className="text-red-600"> (오류 {bulkRows.length - bulkValidCount}행: {bulkRows.find((r) => r.error)?.error})</span>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={bulkBusy || bulkValidCount === 0}
                onClick={handleBulkImport}
                className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {bulkBusy ? '등록 중…' : `${bulkValidCount}건 일괄 등록`}
              </button>
              {bulkResult && (
                <p className="text-sm">
                  완료: <span className="text-emerald-600 font-medium">{bulkResult.inserted}건 성공</span>
                  {bulkResult.failed > 0 && <span className="text-red-600 font-medium"> · {bulkResult.failed}건 실패</span>}
                  {bulkResult.errorMessage && <span className="block text-xs text-red-600 mt-1">사유: {bulkResult.errorMessage}</span>}
                </p>
              )}
            </div>
          )}
          </>
          )}
        </div>
      )}

      {isFieldAgent && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <button
            type="button"
            onClick={() => setSelfReportOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
          >
            <span className="inline-block w-3 text-slate-400">{selfReportOpen ? '▾' : '▸'}</span>
            <span className="font-semibold text-sm text-slate-700">신규계약</span>
          </button>
          {selfReportOpen && (
            <form onSubmit={handleSelfReportSubmit} className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <p className="col-span-2 md:col-span-4 text-xs text-slate-500 -mt-1 mb-1">
                이번 달 신규 계약(장기·일반)을 증권번호와 함께 미리 등록해두면, 다음 달 보험사 확정 계약이 올라올 때 증권번호로 매칭되어 정리됩니다. 수수료는 확정 후 반영돼요.
              </p>
              <div>
                <label className="block text-xs text-slate-500 mb-1">영수일 (이번 달만 등록 가능)</label>
                <input type="date" value={selfForm.receipt_date} min={monthStart()} max={monthEnd()}
                  onChange={(e) => setSelfForm((f) => ({ ...f, receipt_date: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">종목</label>
                <select value={selfForm.category} onChange={(e) => setSelfForm((f) => ({ ...f, category: e.target.value as '장기' | '일반' }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
                  <option value="장기">장기</option>
                  <option value="일반">일반</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">보험사</label>
                <input value={selfForm.company} onChange={(e) => setSelfForm((f) => ({ ...f, company: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">증권번호 *</label>
                <input value={selfForm.policy_no} onChange={(e) => setSelfForm((f) => ({ ...f, policy_no: e.target.value }))} required
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">고객명</label>
                <input value={selfForm.customer_name} onChange={(e) => setSelfForm((f) => ({ ...f, customer_name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">보험료</label>
                <input type="number" min={0} value={selfForm.premium} onChange={(e) => setSelfForm((f) => ({ ...f, premium: Number(e.target.value) }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium h-fit">
                신규계약 등록
              </button>
            </form>
          )}
        </div>
      )}

      {(canManage || isFieldAgent) && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <button
            type="button"
            onClick={() => setMatchOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
          >
            <span className="inline-block w-3 text-slate-400">{matchOpen ? '▾' : '▸'}</span>
            <span className="font-semibold text-sm text-slate-700">
              예비계약 확인{preliminaryMatches.length > 0 && ` (${preliminaryMatches.length}건)`}
            </span>
          </button>
          {matchOpen && (
            preliminaryMatches.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">등록된 예비계약이 없습니다.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2">담당자</th>
                    <th className="text-left px-4 py-2">고객명 / 증권번호</th>
                    <th className="text-right px-4 py-2">예비 보험료</th>
                    <th className="text-left px-4 py-2">상태</th>
                    <th className="text-right px-4 py-2">확정 보험료</th>
                    <th className="text-left px-4 py-2">확정 지급월</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {preliminaryMatches.map(({ prelim, matches }) => (
                    <tr key={prelim.id} className="border-t border-slate-50">
                      <td className="px-4 py-2">{agentInfo(prelim).name}</td>
                      <td className="px-4 py-2">{prelim.customer_name} / {prelim.policy_no}</td>
                      <td className="px-4 py-2 text-right">{prelim.premium.toLocaleString('ko-KR')}원</td>
                      {matches.length > 0 ? (
                        <>
                          <td className="px-4 py-2">
                            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">확정 계약 매칭됨</span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            {matches[0].premium.toLocaleString('ko-KR')}원
                            {matches.length > 1 && <span className="text-xs text-slate-400"> 외 {matches.length - 1}건</span>}
                          </td>
                          <td className="px-4 py-2">{matches[0].month}</td>
                          <td className="px-4 py-2 text-right">
                            {canManage ? (
                              <button
                                onClick={() => deleteContract(prelim.id)}
                                className="text-xs text-white bg-slate-800 rounded-md px-3 py-1.5 hover:bg-slate-700"
                              >
                                확정 처리(예비 삭제)
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">본사 확인 대기</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2">
                            <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">대기중</span>
                          </td>
                          <td className="px-4 py-2 text-right text-slate-300">-</td>
                          <td className="px-4 py-2 text-slate-300">-</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => deleteContract(prelim.id)}
                              className="text-xs text-rose-600 hover:underline"
                            >
                              삭제
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="계약찾기: 고객명, 상품명, 보험사, 계약번호, 담당자"
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white w-64"
        />
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
                                      <th className="text-left px-3 py-1.5">계약번호</th>
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
                                          <td className="px-3 py-1.5">{c.policy_no ?? '-'}</td>
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
                                                <option value="delete" style={{ color: '#dc2626' }}>삭제</option>
                                              </select>
                                            </td>
                                          )}
                                        </tr>
                                      )
                                    })}
                                    <tr className="border-t border-slate-200 font-semibold">
                                      <td className="px-3 py-1.5" colSpan={4}>합계</td>
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
