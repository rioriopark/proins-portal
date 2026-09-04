import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { InsurerAccount, Profile } from '../lib/types'

const emptyForm = { company: '', login_id: '', password: '', memo: '' }

export default function InsurerAccounts() {
  const { profile } = useAuth()
  const [accounts, setAccounts] = useState<InsurerAccount[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data: a } = await supabase.from('insurer_accounts').select('*').order('company')
    setAccounts(a ?? [])
    const { data: p } = await supabase.from('profiles').select('*').order('name')
    setProfiles(p ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function updaterName(id: string | null) {
    if (!id) return '-'
    return profiles.find((p) => p.id === id)?.name ?? '-'
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copy(key: string, value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200)
    } catch {
      alert('복사에 실패했습니다.')
    }
  }

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(a: InsurerAccount) {
    setForm({ company: a.company, login_id: a.login_id, password: a.password, memo: a.memo })
    setEditingId(a.id)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    const payload = { ...form, updated_by: profile.id, updated_at: new Date().toISOString() }
    if (editingId) {
      const { error } = await supabase.from('insurer_accounts').update(payload).eq('id', editingId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('insurer_accounts').insert(payload)
      if (error) return alert('등록 실패: ' + error.message)
    }
    setShowForm(false)
    setEditingId(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('이 계정 정보를 삭제할까요?')) return
    const { error } = await supabase.from('insurer_accounts').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">보험사 계정</h1>
          <p className="text-sm text-slate-500 mt-1">
            보험사별 대표코드·비밀번호를 본사 담당자끼리 공유합니다. 본사관리자만 조회·수정할 수 있습니다.
          </p>
        </div>
        <button onClick={startCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
          + 계정 등록
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input required placeholder="보험사명" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <input placeholder="대표코드/아이디" value={form.login_id} onChange={(e) => setForm((f) => ({ ...f, login_id: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <input placeholder="비밀번호" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <textarea placeholder="메모 (사이트 주소, 유의사항 등)" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
            rows={2} className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
              {editingId ? '수정 저장' : '등록'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }} className="text-sm text-slate-500 px-4 py-2">
              취소
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && accounts.length === 0 && <p className="text-center text-slate-400 py-6">등록된 계정 정보가 없습니다.</p>}

      {!loading && accounts.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">보험사</th>
                <th className="text-left px-3 py-2">대표코드</th>
                <th className="text-left px-3 py-2">비밀번호</th>
                <th className="text-left px-3 py-2">메모</th>
                <th className="text-left px-3 py-2">최근 수정</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{a.company}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono">{a.login_id || '-'}</span>
                      {a.login_id && (
                        <button onClick={() => copy(`id-${a.id}`, a.login_id)} className="text-xs text-slate-400 hover:text-slate-600">
                          {copiedKey === `id-${a.id}` ? '복사됨' : '복사'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono">
                        {a.password ? (revealed.has(a.id) ? a.password : '•'.repeat(Math.max(6, a.password.length))) : '-'}
                      </span>
                      {a.password && (
                        <>
                          <button onClick={() => toggleReveal(a.id)} className="text-xs text-slate-400 hover:text-slate-600">
                            {revealed.has(a.id) ? '숨기기' : '보기'}
                          </button>
                          <button onClick={() => copy(`pw-${a.id}`, a.password)} className="text-xs text-slate-400 hover:text-slate-600">
                            {copiedKey === `pw-${a.id}` ? '복사됨' : '복사'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{a.memo || '-'}</td>
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-xs">
                    {updaterName(a.updated_by)} · {a.updated_at.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => startEdit(a)} className="text-xs text-slate-500 hover:underline mr-2">수정</button>
                    <button onClick={() => remove(a.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
