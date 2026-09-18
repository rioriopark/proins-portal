import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { EducationEvent } from '../lib/types'

const emptyForm = { title: '', event_date: '', event_time: '' }

export default function EducationSchedule() {
  const { profile } = useAuth()
  const isHqOrg = profile?.org_id === 'hq'
  const [events, setEvents] = useState<EducationEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('education_events').select('*').order('event_date')
    setEvents(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(e: EducationEvent) {
    setForm({ title: e.title, event_date: e.event_date, event_time: e.event_time })
    setEditingId(e.id)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = { title: form.title, event_date: form.event_date, event_time: form.event_time }
    if (editingId) {
      const { error } = await supabase
        .from('education_events')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('education_events').insert(payload)
      if (error) return alert('등록 실패: ' + error.message)
    }
    setShowForm(false)
    setEditingId(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('이 교육 일정을 삭제할까요?')) return
    const { error } = await supabase.from('education_events').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">교육일정</h1>
          <p className="text-sm text-slate-500 mt-1">본사에서 등록한 교육 일정입니다.</p>
        </div>
        {isHqOrg && (
          <button onClick={startCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
            + 일정 등록
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              required
              placeholder="제목"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-1"
            />
            <input
              required
              type="date"
              value={form.event_date}
              onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
            <input
              type="time"
              value={form.event_time}
              onChange={(e) => setForm((f) => ({ ...f, event_time: e.target.value }))}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
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
      {!loading && events.length === 0 && <p className="text-center text-slate-400 py-6">등록된 교육 일정이 없습니다.</p>}

      {!loading && events.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">제목</th>
                <th className="text-left px-3 py-2">일시</th>
                {isHqOrg && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{e.title}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {e.event_date}
                    {e.event_time && ` ${e.event_time}`}
                  </td>
                  {isHqOrg && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => startEdit(e)} className="text-xs text-slate-500 hover:underline mr-2">
                        수정
                      </button>
                      <button onClick={() => remove(e.id)} className="text-xs text-red-500 hover:underline">
                        삭제
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
