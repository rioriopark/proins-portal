import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, ContractCategory, ContractType, Profile } from '../lib/types'

const CATEGORIES: ContractCategory[] = ['장기', '일반', '자동차']
const TYPES: ContractType[] = ['신규', '계속', '환수', '부활', '비례공동']

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Contracts() {
  const { profile } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<{ email: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    agent_id: profile?.id ?? '',
    month: thisMonth(),
    category: '장기' as ContractCategory,
    type: '신규' as ContractType,
    company: '',
    count: 1,
    premium: 0,
    commission: 0,
  })

  async function load() {
    setLoading(true)
    const { data: c } = await supabase
      .from('contracts')
      .select('*')
      .order('month', { ascending: false })
      .order('created_at', { ascending: false })
    setContracts(c ?? [])
    if (profile && profile.role !== 'agent') {
      const { data: p } = await supabase.from('profiles').select('*').order('name')
      setAgents(p ?? [])
      const { data: i } = await supabase.from('pending_invites').select('email, name')
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
      ...form,
      agent_id: form.agent_id || profile?.id,
    })
    if (!error) {
      setForm((f) => ({ ...f, company: '', count: 1, premium: 0, commission: 0 }))
      load()
    } else {
      alert('등록 실패: ' + error.message)
    }
  }

  const agentName = (c: Contract) => {
    if (c.agent_id) {
      if (c.agent_id === profile?.id) return profile.name
      return agents.find((a) => a.id === c.agent_id)?.name ?? c.agent_id
    }
    const invited = invites.find((i) => i.email === c.agent_email)
    return invited ? `${invited.name} (미가입)` : `${c.agent_email ?? '-'} (미가입)`
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">계약관리</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        {profile && profile.role !== 'agent' && (
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
        )}
        <div>
          <label className="block text-xs text-slate-500 mb-1">지급월</label>
          <input type="month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
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
          <label className="block text-xs text-slate-500 mb-1">건수</label>
          <input type="number" min={0} value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: Number(e.target.value) }))}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">보험료</label>
          <input type="number" min={0} value={form.premium} onChange={(e) => setForm((f) => ({ ...f, premium: Number(e.target.value) }))}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">수수료(원)</label>
          <input type="number" min={0} value={form.commission} onChange={(e) => setForm((f) => ({ ...f, commission: Number(e.target.value) }))}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium h-fit">
          계약 등록
        </button>
      </form>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-xs">
            <tr>
              <th className="text-left px-4 py-2">지급월</th>
              <th className="text-left px-4 py-2">담당자</th>
              <th className="text-left px-4 py-2">종목</th>
              <th className="text-left px-4 py-2">구분</th>
              <th className="text-left px-4 py-2">보험사</th>
              <th className="text-right px-4 py-2">건수</th>
              <th className="text-right px-4 py-2">보험료</th>
              <th className="text-right px-4 py-2">수수료</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">불러오는 중…</td></tr>}
            {!loading && contracts.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">등록된 계약이 없습니다.</td></tr>
            )}
            {contracts.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{c.month}</td>
                <td className="px-4 py-2">{agentName(c)}</td>
                <td className="px-4 py-2">{c.category}</td>
                <td className="px-4 py-2">{c.type}</td>
                <td className="px-4 py-2">{c.company}</td>
                <td className="px-4 py-2 text-right">{c.count}</td>
                <td className="px-4 py-2 text-right">{c.premium.toLocaleString('ko-KR')}</td>
                <td className="px-4 py-2 text-right">{c.commission.toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
