import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { toAuthEmail } from '../lib/id'
import { ROLE_LABEL, type Organization, type Profile, type Role } from '../lib/types'

const ROLES: Role[] = ['hq_admin', 'branch_admin', 'store_manager', 'agent']

export default function Orgs() {
  const { profile } = useAuth()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [invites, setInvites] = useState<any[]>([])
  const [orgForm, setOrgForm] = useState({ id: '', name: '', type: 'STORE', parent_id: '' })
  const [inviteForm, setInviteForm] = useState({
    id: '', name: '', role: 'agent' as Role, org_id: '', title: '', rate_long: 1, rate_general: 1, bank: '', account: '',
  })

  async function load() {
    const { data: o } = await supabase.from('organizations').select('*').order('id')
    setOrgs(o ?? [])
    const { data: m } = await supabase.from('profiles').select('*').order('name')
    setMembers(m ?? [])
    const { data: i } = await supabase.from('pending_invites').select('*').order('created_at')
    setInvites(i ?? [])
    if (o && o.length && !inviteForm.org_id) setInviteForm((f) => ({ ...f, org_id: o[0].id }))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  async function cancelInvite(email: string) {
    await supabase.from('pending_invites').delete().eq('email', email)
    load()
  }

  const isHq = profile?.role === 'hq_admin'

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">조직관리</h1>

      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-sm mb-3">조직도</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">ID</th>
              <th className="text-left px-3 py-2">이름</th>
              <th className="text-left px-3 py-2">유형</th>
              <th className="text-left px-3 py-2">상위조직</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{o.id}</td>
                <td className="px-3 py-2">{o.name}</td>
                <td className="px-3 py-2">{o.type}</td>
                <td className="px-3 py-2">{o.parent_id ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>

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
          <input placeholder="직급" value={inviteForm.title}
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

        {invites.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-slate-500 mb-2">가입 대기 중 (회원가입하면 자동으로 권한 부여됨)</p>
            <ul className="text-sm space-y-1">
              {invites.map((i) => (
                <li key={i.email} className="flex items-center justify-between border-t border-slate-100 py-1.5">
                  <span>{i.name} ({i.email}) · {ROLE_LABEL[i.role as Role]}</span>
                  <button onClick={() => cancelInvite(i.email)} className="text-xs text-red-500 hover:underline">취소</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-sm mb-3">직원 목록</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">이름</th>
              <th className="text-left px-3 py-2">권한</th>
              <th className="text-left px-3 py-2">소속</th>
              <th className="text-left px-3 py-2">직급</th>
              <th className="text-left px-3 py-2">이메일</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{m.name}</td>
                <td className="px-3 py-2">{ROLE_LABEL[m.role]}</td>
                <td className="px-3 py-2">{orgs.find((o) => o.id === m.org_id)?.name ?? m.org_id}</td>
                <td className="px-3 py-2">{m.title}</td>
                <td className="px-3 py-2 text-slate-500">{m.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
