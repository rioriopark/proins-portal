import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contact } from '../lib/types'

const emptyForm = {
  category: '내부직원', company: '', name: '', title: '', phone: '', office_phone: '', fax: '', business: '', email: '',
}

export default function Contacts() {
  const { profile } = useAuth()
  const [items, setItems] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<'전체' | '내부직원' | '보험사담당자'>('전체')
  const [companyFilter, setCompanyFilter] = useState('전체')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  const canWrite = !!profile && profile.role !== 'agent'

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('contacts').select('*').order('category').order('sort_order')
    setItems(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const companies = useMemo(
    () => [...new Set(items.filter((i) => i.category === '보험사담당자').map((i) => i.company))].filter(Boolean),
    [items]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (categoryFilter !== '전체' && i.category !== categoryFilter) return false
      if (categoryFilter === '보험사담당자' && companyFilter !== '전체' && i.company !== companyFilter) return false
      if (q) {
        const hay = `${i.name} ${i.company} ${i.title} ${i.business} ${i.email} ${i.phone}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, categoryFilter, companyFilter, search])

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(c: Contact) {
    setForm({
      category: c.category, company: c.company, name: c.name, title: c.title,
      phone: c.phone, office_phone: c.office_phone, fax: c.fax, business: c.business, email: c.email,
    })
    setEditingId(c.id)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (editingId) {
      const { error } = await supabase.from('contacts').update({ ...form, updated_at: new Date().toISOString() }).eq('id', editingId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('contacts').insert({ ...form, sort_order: items.length })
      if (error) return alert('등록 실패: ' + error.message)
    }
    setShowForm(false)
    setEditingId(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('이 연락처를 삭제할까요?')) return
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">업무 연락처</h1>
          <p className="text-sm text-slate-500 mt-1">내부 직원과 보험사 담당자 연락처입니다.</p>
        </div>
        {canWrite && (
          <button onClick={startCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
            + 연락처 등록
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="내부직원">내부직원</option>
            <option value="보험사담당자">보험사담당자</option>
          </select>
          <input placeholder="회사(보험사)" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input required placeholder="이름" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="직급/부서" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="휴대전화" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="사무실/내선" value={form.office_phone} onChange={(e) => setForm((f) => ({ ...f, office_phone: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="팩스" value={form.fax} onChange={(e) => setForm((f) => ({ ...f, fax: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="담당업무" value={form.business} onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="이메일" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm col-span-2" />
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

      <div className="flex flex-wrap gap-2 items-center">
        {(['전체', '내부직원', '보험사담당자'] as const).map((c) => (
          <button key={c} onClick={() => { setCategoryFilter(c); setCompanyFilter('전체') }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${categoryFilter === c ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
            {c}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름/회사/업무로 검색"
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm ml-auto w-56"
        />
      </div>

      {categoryFilter === '보험사담당자' && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCompanyFilter('전체')}
            className={`px-2.5 py-1 rounded text-xs font-medium ${companyFilter === '전체' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
            전체
          </button>
          {companies.map((c) => (
            <button key={c} onClick={() => setCompanyFilter(c)}
              className={`px-2.5 py-1 rounded text-xs font-medium ${companyFilter === c ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {c}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && filtered.length === 0 && <p className="text-center text-slate-400 py-6">연락처가 없습니다.</p>}

      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">회사</th>
                <th className="text-left px-3 py-2">이름</th>
                <th className="text-left px-3 py-2">직급/부서</th>
                <th className="text-left px-3 py-2">휴대전화</th>
                <th className="text-left px-3 py-2">사무실/내선</th>
                <th className="text-left px-3 py-2">담당업무</th>
                <th className="text-left px-3 py-2">이메일</th>
                {canWrite && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{c.company}</td>
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">{c.title}</td>
                  <td className="px-3 py-2">{c.phone}</td>
                  <td className="px-3 py-2">{c.office_phone}</td>
                  <td className="px-3 py-2">{c.business}</td>
                  <td className="px-3 py-2 text-slate-500">{c.email}</td>
                  {canWrite && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => startEdit(c)} className="text-xs text-slate-500 hover:underline mr-2">수정</button>
                      <button onClick={() => remove(c.id)} className="text-xs text-red-500 hover:underline">삭제</button>
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
