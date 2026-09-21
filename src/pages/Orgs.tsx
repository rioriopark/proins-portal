import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { toAuthEmail } from '../lib/id'
import {
  MENU_OPTIONS,
  ROLE_LABEL,
  roleDisplayLabel,
  STATEMENT_VIEW_OPTIONS,
  type Organization,
  type Profile,
  type Role,
} from '../lib/types'
import { AGENT_GRADES as GRADE_SUGGESTIONS, agentCode, compareAgentCode } from '../lib/agentSort'

const ROLES: Role[] = ['hq_admin', 'branch_admin', 'store_manager', 'agent']
// 한글 라벨로도 역할을 매칭할 수 있게 라벨→역할 역조회 맵도 함께 둔다(엑셀 일괄 초대용).
const ROLE_BY_LABEL = new Map<string, Role>(ROLES.map((r) => [ROLE_LABEL[r], r]))

interface Invite {
  email: string
  name: string
  role: Role
  org_id: string
  title: string
  rate_long: number
  rate_general: number
  general_performance_rate: number
}

interface Person {
  key: string
  kind: 'profile' | 'invite'
  id?: string
  email: string
  name: string
  role: Role
  org_id: string
  title: string
  rate_long: number
  rate_general: number
  general_performance_rate: number
}

export default function Orgs() {
  const { profile } = useAuth()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [openOrgs, setOpenOrgs] = useState<Set<string>>(new Set())
  const [orgForm, setOrgForm] = useState({ id: '', name: '', type: 'STORE', parent_id: '' })
  const [inviteForm, setInviteForm] = useState({
    id: '',
    name: '',
    role: 'agent' as Role,
    org_id: '',
    title: '',
    rate_long: 1,
    rate_general: 1,
    bank: '',
    account: '',
  })
  // 위촉설계사 대량 초대: 계약 일괄등록과 동일하게 엑셀 데이터를 붙여넣어 한 번에 여러 명 초대.
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false)
  const [bulkInviteText, setBulkInviteText] = useState('')
  const [inviteSending, setInviteSending] = useState(false)
  const [bulkInviteBusy, setBulkInviteBusy] = useState(false)
  const [bulkInviteResult, setBulkInviteResult] = useState<{
    inserted: number
    failed: number
    errorMessage?: string
  } | null>(null)
  const [grants, setGrants] = useState<{ profile_id: string; menu_key: string }[]>([])

  async function load() {
    const { data: o } = await supabase.from('organizations').select('*').order('id')
    setOrgs(o ?? [])
    const { data: m } = await supabase.from('profiles').select('*').order('name')
    setMembers(m ?? [])
    const { data: i } = await supabase.from('pending_invites').select('*').order('name')
    setInvites(i ?? [])
    const { data: g } = await supabase.from('menu_permissions').select('profile_id, menu_key')
    setGrants(g ?? [])
    if (o && o.length) {
      setOpenOrgs((prev) => (prev.size ? prev : new Set(o.map((x) => x.id))))
      setInviteForm((f) => (f.org_id ? f : { ...f, org_id: o[0].id }))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const people: Person[] = useMemo(
    () => [
      ...members.map((m) => ({
        key: `p:${m.id}`,
        kind: 'profile' as const,
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        org_id: m.org_id,
        title: m.title,
        rate_long: m.rate_long,
        rate_general: m.rate_general,
        general_performance_rate: m.general_performance_rate,
      })),
      ...invites.map((i) => ({
        key: `i:${i.email}`,
        kind: 'invite' as const,
        email: i.email,
        name: i.name,
        role: i.role,
        org_id: i.org_id,
        title: i.title,
        rate_long: i.rate_long,
        rate_general: i.rate_general,
        general_performance_rate: i.general_performance_rate,
      })),
    ],
    [members, invites],
  )

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Organization[]>()
    for (const o of orgs) {
      const list = map.get(o.parent_id) ?? []
      list.push(o)
      map.set(o.parent_id, list)
    }
    return map
  }, [orgs])

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])

  const peopleOf = useMemo(() => {
    const map = new Map<string, Person[]>()
    for (const p of people) {
      const list = map.get(p.org_id) ?? []
      list.push(p)
      map.set(p.org_id, list)
    }
    // 조직별 담당자 목록은 사번 순으로 보여준다.
    for (const list of map.values()) {
      list.sort((a, b) => compareAgentCode(agentCode(a.email), agentCode(b.email)))
    }
    return map
  }, [people])

  async function addOrg(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('organizations').insert({
      id: orgForm.id,
      name: orgForm.name,
      type: orgForm.type,
      parent_id: orgForm.parent_id || null,
    })
    if (error) alert('조직 추가 실패: ' + error.message)
    else {
      setOrgForm({ id: '', name: '', type: 'STORE', parent_id: '' })
      load()
    }
  }

  async function deleteOrg(id: string) {
    if (!confirm('이 조직을 삭제할까요? 하위 조직이나 소속 직원이 있으면 삭제되지 않습니다.')) return
    const { error } = await supabase.from('organizations').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  // 초대장 발급 즉시 아이디/비밀번호를 모두 사번으로 하는 실제 계정을 만들어서, 본인이 따로
  // 회원가입(비밀번호 설정)하지 않아도 바로 로그인할 수 있게 한다.
  async function sendInvite(e: FormEvent) {
    e.preventDefault()
    setInviteSending(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch('/api/admin-create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(inviteForm),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '계정 생성 실패')
      alert(`계정이 생성되었습니다. 아이디/비밀번호: ${inviteForm.id}`)
      setInviteForm((f) => ({ ...f, id: '', name: '', title: '', bank: '', account: '' }))
      load()
    } catch (e) {
      alert('초대 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setInviteSending(false)
    }
  }

  // 열 순서: 아이디·이름·역할(한글 라벨)·소속조직(조직명 정확히 일치)·직급·장기율(%)·일반율(%)·은행(선택)·계좌번호(선택)
  interface BulkInviteRow {
    raw: string[]
    id: string
    name: string
    roleLabel: string
    matchedRole?: Role
    orgName: string
    matchedOrgId?: string
    title: string
    rateLong: number
    rateGeneral: number
    bank: string
    account: string
    error?: string
  }
  const bulkInviteRows = useMemo<BulkInviteRow[]>(() => {
    if (!bulkInviteText.trim()) return []
    const existingEmails = new Set([...members.map((m) => m.email), ...invites.map((i) => i.email)])
    const seenIds = new Set<string>()
    return bulkInviteText
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((line) => {
        // 콤마도 구분자로 취급하면 값에 콤마가 섞인 경우 잘려버리므로 탭만 구분자로 쓴다.
        const cols = line.split('\t').map((c) => c.trim())
        const [id, name, roleLabel, orgName, title, rateLongRaw, rateGeneralRaw, bank, account] = cols
        const matchedRole =
          ROLE_BY_LABEL.get(roleLabel ?? '') ?? ((ROLES as string[]).includes(roleLabel ?? '') ? (roleLabel as Role) : undefined)
        const matchedOrgId = orgs.find((o) => o.name.trim() === (orgName ?? '').trim())?.id
        const rateLong = rateLongRaw?.trim() ? Number(rateLongRaw) : 100
        const rateGeneral = rateGeneralRaw?.trim() ? Number(rateGeneralRaw) : 100
        const email = id ? toAuthEmail(id) : ''
        let error: string | undefined
        if (!id || !name) error = '아이디·이름 필수'
        else if (!matchedRole) error = '역할 값 오류(본사관리자/지사센터관리자/지점관리자/담당자)'
        else if (!matchedOrgId) error = '조직명 불일치'
        else if (Number.isNaN(rateLong) || Number.isNaN(rateGeneral)) error = '지급률 값 오류'
        else if (existingEmails.has(email)) error = '이미 등록/초대된 아이디'
        else if (seenIds.has(email)) error = '목록 내 아이디 중복'
        if (!error) seenIds.add(email)
        return {
          raw: cols,
          id: id ?? '',
          name: name ?? '',
          roleLabel: roleLabel ?? '',
          matchedRole,
          orgName: orgName ?? '',
          matchedOrgId,
          title: title ?? '',
          rateLong,
          rateGeneral,
          bank: bank ?? '',
          account: account ?? '',
          error,
        }
      })
  }, [bulkInviteText, orgs, members, invites])
  const bulkInviteValidCount = bulkInviteRows.filter((r) => !r.error).length

  // 초대장 발급과 동일하게, 일괄 초대도 각 행마다 아이디/비밀번호가 사번인 계정을 즉시 만들어서
  // 회원가입 없이 바로 로그인할 수 있게 한다. createUser는 한 번에 한 명씩만 되는 API라 행별로
  // 순차 호출하고, 실패한 행만 원본 텍스트에 남겨 재시도할 수 있게 한다.
  async function handleBulkInvite() {
    setBulkInviteBusy(true)
    const rows = bulkInviteRows.filter((r) => !r.error)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    let inserted = 0
    const errors: string[] = []
    for (const r of rows) {
      const res = await fetch('/api/admin-create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: r.id,
          name: r.name,
          role: r.matchedRole,
          org_id: r.matchedOrgId,
          title: r.title,
          rate_long: r.rateLong / 100,
          rate_general: r.rateGeneral / 100,
          bank: r.bank,
          account: r.account,
        }),
      })
      if (res.ok) inserted++
      else {
        const body = await res.json().catch(() => ({}))
        errors.push(`${r.id}(${r.name}): ${body.error ?? '계정 생성 실패'}`)
      }
    }
    setBulkInviteBusy(false)
    setBulkInviteResult({ inserted, failed: errors.length, errorMessage: errors.slice(0, 5).join('\n') || undefined })
    if (errors.length === 0) setBulkInviteText('')
    load()
  }

  async function handleDownloadInviteSample() {
    const XLSX = await import('xlsx')
    const header = ['아이디', '이름', '역할', '소속조직', '직급', '장기율(%)', '일반율(%)', '은행', '계좌번호']
    const example = ['44562991', '김철수', '담당자', '부천지점', 'FC', '90', '90', '', '']
    const ws = XLSX.utils.aoa_to_sheet([header, example])
    ws['!cols'] = header.map(() => ({ wch: 14 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '직원초대')
    XLSX.writeFile(wb, '직원초대_샘플.xlsx')
  }

  async function updatePerson(
    p: Person,
    patch: Partial<{
      title: string
      rate_long: number
      rate_general: number
      general_performance_rate: number
      org_id: string
    }>,
  ) {
    const table = p.kind === 'profile' ? 'profiles' : 'pending_invites'
    const match = p.kind === 'profile' ? { id: p.id! } : { email: p.email }
    const { error } = await supabase.from(table).update(patch).match(match)
    if (error) alert('수정 실패: ' + error.message)
    else load()
  }

  async function removePerson(p: Person) {
    if (p.kind === 'invite') {
      await supabase.from('pending_invites').delete().eq('email', p.email)
      load()
      return
    }
    if (!confirm(`${p.name}님의 계정 접근 권한을 제거할까요? (로그인 계정 자체는 남지만 포털 접근이 차단됩니다)`)) return
    // profiles RLS가 본인 소유가 아닌 행의 클라이언트발 삭제를 막고 있어, 서비스 권한으로 대신 지운다.
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    const res = await fetch('/api/admin-delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetProfileId: p.id }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert('삭제 실패: ' + (body.error ?? '알 수 없는 오류'))
    } else load()
  }

  function hasGrant(profileId: string, menuKey: string) {
    return grants.some((g) => g.profile_id === profileId && g.menu_key === menuKey)
  }

  async function toggleGrant(profileId: string, menuKey: string) {
    if (hasGrant(profileId, menuKey)) {
      const { error } = await supabase.from('menu_permissions').delete().match({ profile_id: profileId, menu_key: menuKey })
      if (error) return alert('권한 해제 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('menu_permissions').insert({ profile_id: profileId, menu_key: menuKey })
      if (error) return alert('권한 부여 실패: ' + error.message)
    }
    load()
  }

  function toggleOrg(id: string) {
    setOpenOrgs((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const isHq = profile?.role === 'hq_admin'
  // 본인의 수수료율은 본인이 수정할 수 없고(자기승인 방지), 본사관리자가 아닌 관리자는
  // 하부 조직원의 수수료율을 본인 수수료율보다 높게 설정할 수 없다.
  const maxRatePercent = (field: 'rate_long' | 'rate_general'): number | undefined =>
    isHq || !profile ? undefined : Math.round(profile[field] * 100)

  function renderOrg(org: Organization, depth: number) {
    const kids = childrenOf.get(org.id) ?? []
    const staff = peopleOf.get(org.id) ?? []
    const open = openOrgs.has(org.id)
    return (
      <div key={org.id} style={{ marginLeft: depth * 20 }} className="mb-1">
        <div className="flex items-center gap-2 py-1.5">
          <button onClick={() => toggleOrg(org.id)} className="text-slate-400 w-4 text-left">
            {open ? '▾' : '▸'}
          </button>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-white">{org.type}</span>
          <span className="font-medium text-sm text-slate-700">{org.name}</span>
          <span className="text-xs text-slate-400">{staff.length}명</span>
          {isHq && (
            <button onClick={() => deleteOrg(org.id)} className="text-xs text-red-400 hover:text-red-600 ml-1">
              ✕
            </button>
          )}
        </div>
        {open && (
          <div className="ml-6 border-l border-slate-100 pl-3 space-y-1">
            {staff.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center gap-2 text-xs py-1">
                <span className="w-24 truncate">
                  {p.name} · {roleDisplayLabel(p.role, p.org_id)}
                </span>
                {p.kind === 'invite' && <span className="text-amber-600">(미가입)</span>}
                <input
                  list="grade-suggestions"
                  defaultValue={p.title}
                  onBlur={(e) => e.target.value !== p.title && updatePerson(p, { title: e.target.value })}
                  className="border border-slate-200 rounded px-1.5 py-1 w-32"
                  placeholder="직급"
                />
                <label className="text-slate-400">장기</label>
                <input
                  type="number"
                  min={0}
                  max={maxRatePercent('rate_long') ?? 100}
                  disabled={p.id === profile?.id}
                  title={p.id === profile?.id ? '본인 수수료율은 본인이 수정할 수 없습니다.' : undefined}
                  defaultValue={Math.round(p.rate_long * 100)}
                  onBlur={(e) => {
                    const cap = maxRatePercent('rate_long')
                    let val = Number(e.target.value)
                    if (cap !== undefined && val > cap) {
                      val = cap
                      e.target.value = String(cap)
                      alert(`본인 수수료율(${cap}%)보다 높게 설정할 수 없습니다.`)
                    }
                    updatePerson(p, { rate_long: val / 100 })
                  }}
                  className="border border-slate-200 rounded px-1.5 py-1 w-14 text-right disabled:bg-slate-50 disabled:text-slate-400"
                />
                <span className="text-slate-400">%</span>
                <label className="text-slate-400">일반</label>
                <input
                  type="number"
                  min={0}
                  max={maxRatePercent('rate_general') ?? 100}
                  disabled={p.id === profile?.id}
                  title={p.id === profile?.id ? '본인 수수료율은 본인이 수정할 수 없습니다.' : undefined}
                  defaultValue={Math.round(p.rate_general * 100)}
                  onBlur={(e) => {
                    const cap = maxRatePercent('rate_general')
                    let val = Number(e.target.value)
                    if (cap !== undefined && val > cap) {
                      val = cap
                      e.target.value = String(cap)
                      alert(`본인 수수료율(${cap}%)보다 높게 설정할 수 없습니다.`)
                    }
                    updatePerson(p, { rate_general: val / 100 })
                  }}
                  className="border border-slate-200 rounded px-1.5 py-1 w-14 text-right disabled:bg-slate-50 disabled:text-slate-400"
                />
                <span className="text-slate-400">%</span>
                <label className="text-slate-400" title="수수료명세서 '지급률 자동계산' 시 본인 일반+자동차 실적수수료에 곱해 일반성과로 채운다.">
                  일반성과
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={p.id === profile?.id}
                  title={p.id === profile?.id ? '본인 수수료율은 본인이 수정할 수 없습니다.' : undefined}
                  defaultValue={Math.round(p.general_performance_rate * 100)}
                  onBlur={(e) => {
                    const val = Math.min(100, Math.max(0, Number(e.target.value)))
                    e.target.value = String(val)
                    updatePerson(p, { general_performance_rate: val / 100 })
                  }}
                  className="border border-slate-200 rounded px-1.5 py-1 w-14 text-right disabled:bg-slate-50 disabled:text-slate-400"
                />
                <span className="text-slate-400">%</span>
                {isHq ? (
                  <select
                    value={p.org_id}
                    onChange={(e) => updatePerson(p, { org_id: e.target.value })}
                    className="border border-slate-200 rounded px-1.5 py-1"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-slate-500">{orgsById.get(p.org_id)?.name ?? p.org_id}</span>
                )}
                <button onClick={() => removePerson(p)} className="text-red-400 hover:text-red-600">
                  ✕
                </button>
              </div>
            ))}
            {kids.map((k) => renderOrg(k, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const roots = childrenOf.get(null) ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">조직관리</h1>
      <p className="text-sm text-slate-500 -mt-4">본사 / 본부 / 지사·센터 / 지점 계층과 소속 담당자를 관리합니다.</p>

      <datalist id="grade-suggestions">
        {GRADE_SUGGESTIONS.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-sm mb-3">조직도</h2>
        <div>{roots.map((o) => renderOrg(o, 0))}</div>

        {isHq && (
          <form onSubmit={addOrg} className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <input
              required
              placeholder="ID (영문, 예: st-2)"
              value={orgForm.id}
              onChange={(e) => setOrgForm((f) => ({ ...f, id: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
            <input
              required
              placeholder="조직명"
              value={orgForm.name}
              onChange={(e) => setOrgForm((f) => ({ ...f, name: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
            <select
              value={orgForm.type}
              onChange={(e) => setOrgForm((f) => ({ ...f, type: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            >
              {['HQ', 'REGION', 'CENTER', 'STORE'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={orgForm.parent_id}
              onChange={(e) => setOrgForm((f) => ({ ...f, parent_id: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            >
              <option value="">(최상위)</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm">조직 추가</button>
          </form>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-sm">직원 초대</h2>
          <button
            type="button"
            onClick={() => setBulkInviteOpen((v) => !v)}
            className="border border-slate-300 text-slate-600 rounded-md px-3 py-1 text-xs font-medium hover:bg-slate-50"
          >
            엑셀 일괄 초대
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          초대장 발급 즉시 아이디/비밀번호가 모두 아이디(사번)인 계정이 만들어져 바로 로그인할 수 있습니다.
        </p>
        <form onSubmit={sendInvite} className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <input
            required
            placeholder="아이디"
            value={inviteForm.id}
            onChange={(e) => setInviteForm((f) => ({ ...f, id: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            required
            placeholder="이름"
            value={inviteForm.name}
            onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <select
            value={inviteForm.role}
            onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as Role }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <select
            value={inviteForm.org_id}
            onChange={(e) => setInviteForm((f) => ({ ...f, org_id: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input
            list="grade-suggestions"
            placeholder="직급"
            value={inviteForm.title}
            onChange={(e) => setInviteForm((f) => ({ ...f, title: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            placeholder="장기 지급률(0~1)"
            value={inviteForm.rate_long}
            onChange={(e) => setInviteForm((f) => ({ ...f, rate_long: Number(e.target.value) }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            placeholder="일반 지급률(0~1)"
            value={inviteForm.rate_general}
            onChange={(e) => setInviteForm((f) => ({ ...f, rate_general: Number(e.target.value) }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            placeholder="은행 (선택)"
            value={inviteForm.bank}
            onChange={(e) => setInviteForm((f) => ({ ...f, bank: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            placeholder="계좌번호 (선택)"
            value={inviteForm.account}
            onChange={(e) => setInviteForm((f) => ({ ...f, account: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <button disabled={inviteSending} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm disabled:opacity-50">
            {inviteSending ? '생성 중…' : '초대장 발급'}
          </button>
        </form>

        {bulkInviteOpen && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-slate-500 font-mono whitespace-pre-wrap break-all">
                열 순서: 아이디{'\t'}이름{'\t'}역할{'\t'}소속조직{'\t'}직급{'\t'}장기율(%){'\t'}일반율(%){'\t'}은행{'\t'}계좌번호
                {'\n'}역할은 "본사관리자/지사센터관리자/지점관리자/담당자" 중 하나, 소속조직은 조직도의 조직명과 정확히 일치해야
                합니다.
                {'\n'}예시: 44562991{'\t'}김철수{'\t'}담당자{'\t'}부천지점{'\t'}FC{'\t'}90{'\t'}90
              </p>
              <button
                type="button"
                onClick={handleDownloadInviteSample}
                className="shrink-0 text-xs text-blue-600 hover:underline whitespace-nowrap"
              >
                샘플 엑셀 다운로드
              </button>
            </div>
            <textarea
              value={bulkInviteText}
              onChange={(e) => setBulkInviteText(e.target.value)}
              rows={6}
              placeholder="여기에 엑셀 데이터를 붙여넣으세요"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
            />
            {bulkInviteRows.length > 0 && (
              <div className="text-sm text-slate-600">
                총 {bulkInviteRows.length}행 · 유효 {bulkInviteValidCount}행
                {bulkInviteValidCount < bulkInviteRows.length && (
                  <span className="text-red-600">
                    {' '}
                    (오류 {bulkInviteRows.length - bulkInviteValidCount}행: {bulkInviteRows.find((r) => r.error)?.error})
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              disabled={bulkInviteBusy || bulkInviteValidCount === 0}
              onClick={handleBulkInvite}
              className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {bulkInviteBusy ? '계정 생성 중…' : `${bulkInviteValidCount}명 일괄 초대`}
            </button>
            {bulkInviteResult && (
              <p className="text-sm">
                완료: <span className="text-emerald-600 font-medium">{bulkInviteResult.inserted}명 성공</span>
                {bulkInviteResult.failed > 0 && (
                  <span className="text-red-600 font-medium"> · {bulkInviteResult.failed}명 실패</span>
                )}
                {bulkInviteResult.errorMessage && (
                  <span className="block text-xs text-red-600 mt-1 whitespace-pre-wrap">
                    사유: {bulkInviteResult.errorMessage}
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {isHq && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-sm">포털 항목별 수정권한</h2>
            <p className="text-xs text-slate-500 mt-1">
              담당자(agent)에게 특정 메뉴의 관리자급 수정 권한을 개별로 부여합니다. 본사/지사/지점 관리자는 기본적으로 모든 항목에
              접근 가능하므로 대상에서 제외됩니다. 조직관리는 권한 상승 위험이 있어 개별 부여 대상이 아닙니다.
            </p>
          </div>
          {members.filter((p) => p.role === 'agent').length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">담당자(agent) 계정이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">이름</th>
                    {MENU_OPTIONS.map((m) => (
                      <th key={m.key} className="text-center px-3 py-2">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members
                    .filter((p) => p.role === 'agent')
                    .map((p) => (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium whitespace-nowrap">
                          {p.name} <span className="text-slate-400 text-xs">({p.email})</span>
                        </td>
                        {MENU_OPTIONS.map((m) => (
                          <td key={m.key} className="text-center px-3 py-2">
                            <input type="checkbox" checked={hasGrant(p.id, m.key)} onChange={() => toggleGrant(p.id, m.key)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {isHq && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-sm">수수료명세서 예외 열람 권한</h2>
            <p className="text-xs text-slate-500 mt-1">
              위촉직 설계사는 기본적으로 수수료명세서의 "일반성과" 시상 항목을 볼 수 없습니다(회사 정책). 특정
              설계사에게만 예외적으로 열어주려면 아래에서 체크하세요.
            </p>
          </div>
          {members.filter((p) => p.role === 'agent' && p.org_id !== 'hq').length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">위촉직 설계사 계정이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">이름</th>
                    {STATEMENT_VIEW_OPTIONS.map((m) => (
                      <th key={m.key} className="text-center px-3 py-2">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members
                    .filter((p) => p.role === 'agent' && p.org_id !== 'hq')
                    .map((p) => (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium whitespace-nowrap">
                          {p.name} <span className="text-slate-400 text-xs">({p.email})</span>
                        </td>
                        {STATEMENT_VIEW_OPTIONS.map((m) => (
                          <td key={m.key} className="text-center px-3 py-2">
                            <input type="checkbox" checked={hasGrant(p.id, m.key)} onChange={() => toggleGrant(p.id, m.key)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
