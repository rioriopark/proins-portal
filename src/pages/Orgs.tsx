import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { toAuthEmail } from '../lib/id'
import { ROLE_LABEL, type Organization, type Profile, type Role } from '../lib/types'

const ROLES: Role[] = ['hq_admin', 'branch_admin', 'store_manager', 'agent']
const GRADE_SUGGESTIONS = [
  '지사장', '본부장', '지점장', '지점장(직영, 인큐)', '지점장(직영, 선임)',
  '본부장(직영사업단)', '직영대표', 'FC_마스터', 'FC_엘리트', 'FC_프로', 'FC',
]

interface Invite {
  email: string
  name: string
  role: Role
  org_id: string
  title: string
  rate_long: number
  rate_general: number
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
}

export default function Orgs() {
  const { profile } = useAuth()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [openOrgs, setOpenOrgs] = useState<Set<string>>(new Set())
  const [orgForm, setOrgForm] = useState({ id: '', name: '', type: 'STORE', parent_id: '' })
  const [inviteForm, setInviteForm] = useState({
    id: '', name: '', role: 'agent' as Role, org_id: '', title: '', rate_long: 1, rate_general: 1, bank: '', account: '',
  })

  async function load() {
    const { data: o } = await supabase.from('organizations').select('*').order('id')
    setOrgs(o ?? [])
    const { data: m } = await supabase.from('profiles').select('*').order('name')
    setMembers(m ?? [])
    const { data: i } = await supabase.from('pending_invites').select('*').order('name')
    setInvites(i ?? [])
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
      ...members.map((m) => ({ key: `p:${m.id}`, kind: 'profile' as const, id: m.id, email: m.email, name: m.name, role: m.role, org_id: m.org_id, title: m.title, rate_long: m.rate_long, rate_general: m.rate_general })),
      ...invites.map((i) => ({ key: `i:${i.email}`, kind: 'invite' as const, email: i.email, name: i.name, role: i.role, org_id: i.org_id, title: i.title, rate_long: i.rate_long, rate_general: i.rate_general })),
    ],
    [members, invites]
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

  const peopleOf = useMemo(() => {
    const map = new Map<string, Person[]>()
    for (const p of people) {
      const list = map.get(p.org_id) ?? []
      list.push(p)
      map.set(p.org_id, list)
    }
    return map
  }, [people])

  async function addOrg(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('organizations').insert({
      id: orgForm.id, name: orgForm.name, type: orgForm.type, parent_id: orgForm.parent_id || null,
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

  async function sendInvite(e: FormEvent) {
    e.preventDefault()
    const { id, ...rest } = inviteForm
    const { error } = await supabase
      .from('pending_invites')
      .insert({ ...rest, email: toAuthEmail(id), invited_by: profile?.id })
    if (error) alert('초대 실패: ' + error.message)
    else {
      setInviteForm((f) => ({ ...f, id: '', name: '', title: '', bank: '', account: '' }))
      load()
    }
  }

  async function updatePerson(p: Person, patch: Partial<{ title: string; rate_long: number; rate_general: number; org_id: string }>) {
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
    const { error } = await supabase.from('profiles').delete().eq('id', p.id!)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  function toggleOrg(id: string) {
    setOpenOrgs((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const isHq = profile?.role === 'hq_admin'

  function renderOrg(org: Organization, depth: number) {
    const kids = childrenOf.get(org.id) ?? []
    const staff = peopleOf.get(org.id) ?? []
    const open = openOrgs.has(org.id)
    return (
      <div key={org.id} style={{ marginLeft: depth * 20 }} className="mb-1">
        <div className="flex items-center gap-2 py-1.5">
          <button onClick={() => toggleOrg(org.id)} className="text-slate-400 w-4 text-left">{open ? '▾' : '▸'}</button>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-white">{org.type}</span>
          <span className="font-medium text-sm text-slate-700">{org.name}</span>
          <span className="text-xs text-slate-400">{staff.length}명</span>
          {isHq && (
            <button onClick={() => deleteOrg(org.id)} className="text-xs text-red-400 hover:text-red-600 ml-1">✕</button>
          )}
        </div>
        {open && (
          <div className="ml-6 border-l border-slate-100 pl-3 space-y-1">
            {staff.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center gap-2 text-xs py-1">
                <span className="w-24 truncate">{p.name} · {ROLE_LABEL[p.role]}</span>
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
                  type="number" min={0} max={100} defaultValue={Math.round(p.rate_long * 100)}
                  onBlur={(e) => updatePerson(p, { rate_long: Number(e.target.value) / 100 })}
                  className="border border-slate-200 rounded px-1.5 py-1 w-14 text-right"
                />
                <span className="text-slate-400">%</span>
                <label className="text-slate-400">일반</label>
                <input
                  type="number" min={0} max={100} defaultValue={Math.round(p.rate_general * 100)}
                  onBlur={(e) => updatePerson(p, { rate_general: Number(e.target.value) / 100 })}
                  className="border border-slate-200 rounded px-1.5 py-1 w-14 text-right"
                />
                <span className="text-slate-400">%</span>
                <select
                  value={p.org_id}
                  onChange={(e) => updatePerson(p, { org_id: e.target.value })}
                  className="border border-slate-200 rounded px-1.5 py-1"
                >
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button onClick={() => removePerson(p)} className="text-red-400 hover:text-red-600">✕</button>
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
        {GRADE_SUGGESTIONS.map((g) => <option key={g} value={g} />)}
      </datalist>

      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-sm mb-3">조직도</h2>
        <div>{roots.map((o) => renderOrg(o, 0))}</div>

        {isHq && (
          <form onSubmit={addOrg} className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <input required placeholder="ID (영문, 예: st-2)" value={orgForm.id}
              onChange={(e) => setOrgForm((f) => ({ ...f, id: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <input required placeholder="조직명" value={orgForm.name}
              onChange={(e) => setOrgForm((f) => ({ ...f, name: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <select value={orgForm.type} onChange={(e) => setOrgForm((f) => ({ ...f, type: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {['HQ', 'REGION', 'CENTER', 'STORE'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={orgForm.parent_id} onChange={(e) => setOrgForm((f) => ({ ...f, parent_id: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">(최상위)</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm">조직 추가</button>
          </form>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-sm mb-3">직원 초대</h2>
        <form onSubmit={sendInvite} className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <input required placeholder="아이디" value={inviteForm.id}
            onChange={(e) => setInviteForm((f) => ({ ...f, id: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input required placeholder="이름" value={inviteForm.name}
            onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <select value={inviteForm.role} onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as Role }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <select value={inviteForm.org_id} onChange={(e) => setInviteForm((f) => ({ ...f, org_id: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input list="grade-suggestions" placeholder="직급" value={inviteForm.title}
            onChange={(e) => setInviteForm((f) => ({ ...f, title: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input type="number" step="0.01" min={0} max={1} placeholder="장기 지급률(0~1)" value={inviteForm.rate_long}
            onChange={(e) => setInviteForm((f) => ({ ...f, rate_long: Number(e.target.value) }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input type="number" step="0.01" min={0} max={1} placeholder="일반 지급률(0~1)" value={inviteForm.rate_general}
            onChange={(e) => setInviteForm((f) => ({ ...f, rate_general: Number(e.target.value) }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="은행 (선택)" value={inviteForm.bank}
            onChange={(e) => setInviteForm((f) => ({ ...f, bank: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="계좌번호 (선택)" value={inviteForm.account}
            onChange={(e) => setInviteForm((f) => ({ ...f, account: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <button className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm">초대장 발급</button>
        </form>
      </div>
    </div>
  )
}
