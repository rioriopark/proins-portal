import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { MENU_OPTIONS, type Banner, type EducationEvent, type Profile } from '../lib/types'

const emptyForm = {
  title: '', content: '', start_date: '', end_date: '', target_profile_ids: [] as string[],
}

const emptyEduForm = { title: '', event_date: '', event_time: '' }

export default function Info() {
  const { profile } = useAuth()
  const [banners, setBanners] = useState<Banner[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [grants, setGrants] = useState<{ profile_id: string; menu_key: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  const [eduEvents, setEduEvents] = useState<EducationEvent[]>([])
  const [showEduForm, setShowEduForm] = useState(false)
  const [editingEduId, setEditingEduId] = useState<string | null>(null)
  const [eduForm, setEduForm] = useState(emptyEduForm)

  const isHq = profile?.role === 'hq_admin'

  async function load() {
    setLoading(true)
    const { data: b } = await supabase.from('banners').select('*').order('sort_order')
    setBanners(b ?? [])
    const { data: p } = await supabase.from('profiles').select('*').order('name')
    setProfiles(p ?? [])
    const { data: g } = await supabase.from('menu_permissions').select('profile_id, menu_key')
    setGrants(g ?? [])
    const { data: e } = await supabase.from('education_events').select('*').order('event_date')
    setEduEvents(e ?? [])
    setLoading(false)
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

  useEffect(() => {
    load()
  }, [])

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(b: Banner) {
    setForm({
      title: b.title, content: b.content, start_date: b.start_date ?? '', end_date: b.end_date ?? '',
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
      const { error } = await supabase.from('banners').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId)
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
    if (!confirm('이 배너를 삭제할까요?')) return
    const { error } = await supabase.from('banners').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  function startEduCreate() {
    setEduForm(emptyEduForm)
    setEditingEduId(null)
    setShowEduForm(true)
  }

  function startEduEdit(e: EducationEvent) {
    setEduForm({ title: e.title, event_date: e.event_date, event_time: e.event_time })
    setEditingEduId(e.id)
    setShowEduForm(true)
  }

  async function handleEduSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = { title: eduForm.title, event_date: eduForm.event_date, event_time: eduForm.event_time }
    if (editingEduId) {
      const { error } = await supabase.from('education_events').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingEduId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('education_events').insert(payload)
      if (error) return alert('등록 실패: ' + error.message)
    }
    setShowEduForm(false)
    setEditingEduId(null)
    load()
  }

  async function removeEdu(id: string) {
    if (!confirm('이 교육 일정을 삭제할까요?')) return
    const { error } = await supabase.from('education_events').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  function targetLabel(b: Banner) {
    if (b.target_profile_ids.length === 0) return '전체 공개'
    const names = b.target_profile_ids.map((id) => profiles.find((p) => p.id === id)?.name ?? id)
    return names.join(', ')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">정보관리</h1>
          <p className="text-sm text-slate-500 mt-1">대시보드에 노출되는 공지 배너를 관리하고, 아이디별로 열람 권한을 지정합니다.</p>
        </div>
        {isHq && (
          <button onClick={startCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
            + 배너 등록
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required placeholder="제목" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <div className="flex gap-2 items-center text-sm text-slate-500">
              <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1" />
              <span>~</span>
              <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1" />
            </div>
          </div>
          <textarea placeholder="내용" value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={3} className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">
              열람 권한 (선택한 아이디에게만 공개, 아무도 선택하지 않으면 전체 공개)
            </p>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border border-slate-200 rounded-md p-3">
              {profiles.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 cursor-pointer">
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
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }} className="text-sm text-slate-500 px-4 py-2">
              취소
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && banners.length === 0 && <p className="text-center text-slate-400 py-6">등록된 배너가 없습니다.</p>}

      {!loading && banners.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">제목</th>
                <th className="text-left px-3 py-2">기간</th>
                <th className="text-left px-3 py-2">공개 대상</th>
                {isHq && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {banners.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{b.title}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {b.start_date || '-'} ~ {b.end_date || '-'}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{targetLabel(b)}</td>
                  {isHq && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => startEdit(b)} className="text-xs text-slate-500 hover:underline mr-2">수정</button>
                      <button onClick={() => remove(b.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start justify-between pt-2">
        <div>
          <h2 className="font-semibold text-slate-800">교육 일정</h2>
          <p className="text-sm text-slate-500 mt-1">대시보드에 노출되는 교육 일정을 관리합니다.</p>
        </div>
        {isHq && (
          <button onClick={startEduCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
            + 일정 등록
          </button>
        )}
      </div>

      {showEduForm && (
        <form onSubmit={handleEduSubmit} className="bg-white rounded-xl shadow p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input required placeholder="제목" value={eduForm.title} onChange={(e) => setEduForm((f) => ({ ...f, title: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-1" />
            <input required type="date" value={eduForm.event_date} onChange={(e) => setEduForm((f) => ({ ...f, event_date: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <input type="time" value={eduForm.event_time} onChange={(e) => setEduForm((f) => ({ ...f, event_time: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
              {editingEduId ? '수정 저장' : '등록'}
            </button>
            <button type="button" onClick={() => { setShowEduForm(false); setEditingEduId(null) }} className="text-sm text-slate-500 px-4 py-2">
              취소
            </button>
          </div>
        </form>
      )}

      {!loading && eduEvents.length === 0 && <p className="text-center text-slate-400 py-6">등록된 교육 일정이 없습니다.</p>}

      {!loading && eduEvents.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">제목</th>
                <th className="text-left px-3 py-2">일시</th>
                {isHq && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {eduEvents.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{e.title}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {e.event_date}{e.event_time && ` ${e.event_time}`}
                  </td>
                  {isHq && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => startEduEdit(e)} className="text-xs text-slate-500 hover:underline mr-2">수정</button>
                      <button onClick={() => removeEdu(e.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isHq && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-sm">포털 항목별 수정권한</h2>
            <p className="text-xs text-slate-500 mt-1">
              담당자(agent)에게 특정 메뉴의 관리자급 수정 권한을 개별로 부여합니다. 본사/지사/지점 관리자는 기본적으로 모든 항목에 접근 가능하므로 대상에서 제외됩니다.
              조직관리·정보관리는 권한 상승 위험이 있어 개별 부여 대상이 아닙니다.
            </p>
          </div>
          {profiles.filter((p) => p.role === 'agent').length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">담당자(agent) 계정이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">이름</th>
                    {MENU_OPTIONS.map((m) => (
                      <th key={m.key} className="text-center px-3 py-2">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profiles.filter((p) => p.role === 'agent').map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{p.name} <span className="text-slate-400 text-xs">({p.email})</span></td>
                      {MENU_OPTIONS.map((m) => (
                        <td key={m.key} className="text-center px-3 py-2">
                          <input
                            type="checkbox"
                            checked={hasGrant(p.id, m.key)}
                            onChange={() => toggleGrant(p.id, m.key)}
                          />
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
