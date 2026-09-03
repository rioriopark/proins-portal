import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contact } from '../lib/types'

const emptyForm = {
  category: '임직원', company: '', name: '', title: '', business: '',
  office_phone: '', fax: '', phone: '', email: '', note: '',
}

// 콤마로 구분된 값이든 줄바꿈 없는 긴 문장이든, 실제 렌더링 후 2줄을 넘는지 측정해서
// 넘칠 때만 더보기/접기 버튼을 보여준다 (기타처럼 콤마가 없는 항목도 동일하게 적용됨)
function ExpandableCell({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const parts = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [value])

  if (parts.length === 0) return null

  return (
    <div>
      <div
        ref={ref}
        style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && <br />}
          </span>
        ))}
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-blue-500 hover:underline mt-0.5"
        >
          {expanded ? '접기 ▲' : '더보기 ▼'}
        </button>
      )}
    </div>
  )
}

export default function Contacts() {
  const { can } = useAuth()
  const [items, setItems] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<'전체' | '보험사담당자' | '임직원' | '업무지원'>('전체')
  const [companyFilter, setCompanyFilter] = useState('전체')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const canWrite = can('work_contacts')

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
        const hay = `${i.name} ${i.company} ${i.title} ${i.business} ${i.email} ${i.phone} ${i.note}`.toLowerCase()
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
      category: c.category, company: c.company, name: c.name, title: c.title, business: c.business,
      office_phone: c.office_phone, fax: c.fax, phone: c.phone, email: c.email, note: c.note ?? '',
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

  async function handleDrop(sourceIdx: number, targetIdx: number) {
    setDragIndex(null)
    setOverIndex(null)
    if (Number.isNaN(sourceIdx) || sourceIdx === targetIdx) return
    const reordered = [...filtered]
    const [moved] = reordered.splice(sourceIdx, 1)
    reordered.splice(targetIdx, 0, moved)
    const updates = reordered
      .map((c, i) => ({ c, sort_order: i }))
      .filter(({ c, sort_order }) => c.sort_order !== sort_order)
    if (updates.length === 0) return
    const results = await Promise.all(
      updates.map(({ c, sort_order }) => supabase.from('contacts').update({ sort_order }).eq('id', c.id))
    )
    const err = results.find((r) => r.error)?.error
    if (err) alert('순서 변경 실패: ' + err.message)
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
            <option value="보험사담당자">보험사담당자</option>
            <option value="임직원">임직원</option>
            <option value="업무지원">업무지원</option>
          </select>
          <input placeholder="회사" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input required placeholder="이름" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="직급/부서" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="담당업무" value={form.business} onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="전화번호" value={form.office_phone} onChange={(e) => setForm((f) => ({ ...f, office_phone: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="팩스번호" value={form.fax} onChange={(e) => setForm((f) => ({ ...f, fax: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="휴대폰번호" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="이메일주소" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="기타" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
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
        {(['전체', '보험사담당자', '임직원', '업무지원'] as const).map((c) => (
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
          <table className="w-full text-sm table-fixed">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                {canWrite && <th className="px-2 py-2 w-[2em] box-content"></th>}
                <th className="text-center px-3 py-2 w-[5em] box-content break-words">회사</th>
                <th className="text-center px-3 py-2 w-[5em] box-content break-words">이름</th>
                <th className="text-center px-3 py-2 w-[5em] box-content break-words">직급/부서</th>
                <th className="text-center px-3 py-2 w-[10em] box-content break-words">담당업무</th>
                <th className="text-center px-3 py-2 w-[12em] box-content break-words">전화번호</th>
                <th className="text-center px-3 py-2 w-[13em] box-content break-words">팩스번호</th>
                <th className="text-center px-3 py-2 w-[13em] box-content break-words">휴대폰번호</th>
                <th className="text-center px-3 py-2 w-[20em] box-content break-words">이메일주소</th>
                <th className="text-center px-3 py-2">기타</th>
                {canWrite && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => (
                <tr key={c.id}
                  onDragOver={canWrite ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverIndex(idx) } : undefined}
                  onDragLeave={canWrite ? () => setOverIndex((o) => (o === idx ? null : o)) : undefined}
                  onDrop={canWrite ? (e) => { e.preventDefault(); handleDrop(Number(e.dataTransfer.getData('text/plain')), idx) } : undefined}
                  className={`border-t border-slate-100 ${dragIndex === idx ? 'opacity-40' : ''} ${overIndex === idx && dragIndex !== idx ? 'bg-slate-50 border-t-2 border-t-slate-400' : ''}`}>
                  {canWrite && (
                    <td className="px-2 py-2 text-center text-slate-400 select-none cursor-grab"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); setDragIndex(idx) }}
                      onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}>⠿</td>
                  )}
                  <td className="text-center px-3 py-2 text-slate-500 break-words"><ExpandableCell value={c.company} /></td>
                  <td className="text-center px-3 py-2 font-medium break-words"><ExpandableCell value={c.name} /></td>
                  <td className="text-center px-3 py-2 break-words"><ExpandableCell value={c.title} /></td>
                  <td className="text-center px-3 py-2 break-words"><ExpandableCell value={c.business} /></td>
                  <td className="text-center px-3 py-2 break-words"><ExpandableCell value={c.office_phone} /></td>
                  <td className="text-center px-3 py-2 break-words"><ExpandableCell value={c.fax} /></td>
                  <td className="text-center px-3 py-2 break-words"><ExpandableCell value={c.phone} /></td>
                  <td className="text-center px-3 py-2 text-slate-500 break-words"><ExpandableCell value={c.email} /></td>
                  <td className="text-center px-3 py-2 text-slate-500 break-words"><ExpandableCell value={c.note} /></td>
                  {canWrite && (
                    <td className="text-center px-3 py-2 whitespace-nowrap">
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
