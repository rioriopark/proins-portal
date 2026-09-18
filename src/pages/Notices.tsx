import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Banner, Profile } from '../lib/types'

const emptyForm = { title: '', content: '', start_date: '', end_date: '', target_profile_ids: [] as string[] }

export default function Notices() {
  const { profile } = useAuth()
  const isHqOrg = profile?.org_id === 'hq'
  const [banners, setBanners] = useState<Banner[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function load() {
    setLoading(true)
    const { data: b } = await supabase.from('banners').select('*').order('created_at', { ascending: false })
    setBanners(b ?? [])
    if (isHqOrg) {
      const { data: p } = await supabase.from('profiles').select('*').order('name')
      setProfiles(p ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHqOrg])

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(b: Banner) {
    setForm({
      title: b.title,
      content: b.content,
      start_date: b.start_date ?? '',
      end_date: b.end_date ?? '',
      target_profile_ids: b.target_profile_ids,
    })
    setEditingId(b.id)
    setShowForm(true)
  }

  function toggleTarget(id: string) {
    setForm((f) => ({
      ...f,
      target_profile_ids: f.target_profile_ids.includes(id)
        ? f.target_profile_ids.filter((x) => x !== id)
        : [...f.target_profile_ids, id],
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = {
      title: form.title,
      content: form.content,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      target_profile_ids: form.target_profile_ids,
    }
    if (editingId) {
      const { error } = await supabase
        .from('banners')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('banners').insert({ ...payload, sort_order: banners.length })
      if (error) return alert('등록 실패: ' + error.message)
    }
    setShowForm(false)
    setEditingId(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('이 공지사항을 삭제할까요?')) return
    const { error } = await supabase.from('banners').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">공지사항</h1>
          <p className="text-sm text-slate-500 mt-1">본사에서 등록한 공지사항입니다.</p>
        </div>
        {isHqOrg && (
          <button onClick={startCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
            + 공지 등록
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              required
              placeholder="제목"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2 items-center text-sm text-slate-500">
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1"
              />
              <span>~</span>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1"
              />
            </div>
          </div>
          <textarea
            placeholder="내용"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={3}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">
              열람 권한 (선택한 아이디에게만 공개, 아무도 선택하지 않으면 전체 공개)
            </p>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border border-slate-200 rounded-md p-3">
              {profiles.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 cursor-pointer"
                >
                  <input type="checkbox" checked={form.target_profile_ids.includes(p.id)} onChange={() => toggleTarget(p.id)} />
                  {p.name} <span className="text-slate-400">({p.email})</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
              {editingId ? '수정 저장' : '등록'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
              className="text-sm text-slate-500 px-4 py-2"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && banners.length === 0 && <p className="text-center text-slate-400 py-6">등록된 공지사항이 없습니다.</p>}

      <div className="space-y-3">
        {banners.map((b) => (
          <div key={b.id} className="bg-white rounded-xl shadow p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-800">{b.title}</p>
              {(b.start_date || b.end_date) && (
                <p className="text-xs text-slate-400 shrink-0">
                  {b.start_date || '-'} ~ {b.end_date || '-'}
                </p>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{b.content}</p>
            {isHqOrg && (
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => startEdit(b)}
                  className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-600"
                >
                  수정
                </button>
                <button onClick={() => remove(b.id)} className="text-xs border border-red-200 rounded px-3 py-1.5 text-red-500">
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
