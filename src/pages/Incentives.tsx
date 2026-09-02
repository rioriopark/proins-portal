import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Incentive } from '../lib/types'

const BADGE_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-cyan-100 text-cyan-700',
]

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const emptyForm = { company: '', month: thisMonth(), title: '', period: '', target: '', content: '' }
const BULK_HEADER_HINT = '보험사\t지급월\t제목\t기간\t대상\t내용'
const BULK_EXAMPLE = '삼성화재\t2026-07\t인보험 시상 (월간 누계 100%)\t2026.07.01 ~ 07.31\t인보험\t월간 누계 실적 × 100% 시상.'

interface BulkRow {
  company: string
  month: string
  title: string
  period: string
  target: string
  content: string
  error?: string
}

function parseBulk(text: string): BulkRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const [company, month, title, period, target, content] = line.split('\t').map((c) => c?.trim() ?? '')
      let error: string | undefined
      if (!company) error = '보험사 없음'
      else if (!month || !/^\d{4}-\d{2}$/.test(month)) error = '지급월 형식 오류 (YYYY-MM)'
      else if (!title) error = '제목 없음'
      return { company, month, title, period: period ?? '', target: target ?? '', content: content ?? '', error }
    })
}

export default function Incentives() {
  const { profile } = useAuth()
  const [items, setItems] = useState<Incentive[]>([])
  const [loading, setLoading] = useState(true)
  const [companyFilter, setCompanyFilter] = useState('전체')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const canWrite = !!profile && profile.role !== 'agent'

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('incentives').select('*').order('company').order('created_at', { ascending: false })
    setItems(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const companies = useMemo(() => [...new Set(items.map((i) => i.company))].sort((a, b) => a.localeCompare(b, 'ko')), [items])
  const companyColor = useMemo(() => {
    const map = new Map<string, string>()
    companies.forEach((c, i) => map.set(c, BADGE_COLORS[i % BADGE_COLORS.length]))
    return map
  }, [companies])

  const filtered = companyFilter === '전체' ? items : items.filter((i) => i.company === companyFilter)

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
    setShowBulk(false)
  }

  function startEdit(i: Incentive) {
    setForm({ company: i.company, month: i.month, title: i.title, period: i.period, target: i.target, content: i.content })
    setEditingId(i.id)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (editingId) {
      const { error } = await supabase.from('incentives').update({ ...form, updated_at: new Date().toISOString() }).eq('id', editingId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('incentives').insert({ ...form, created_by: profile?.id })
      if (error) return alert('등록 실패: ' + error.message)
    }
    setShowForm(false)
    setEditingId(null)
    load()
  }

  const bulkRows = useMemo(() => (bulkText.trim() ? parseBulk(bulkText) : []), [bulkText])
  const bulkValidCount = bulkRows.filter((r) => !r.error).length

  async function handleBulkImport() {
    setBulkBusy(true)
    const payload = bulkRows.filter((r) => !r.error).map(({ error: _error, ...r }) => ({ ...r, created_by: profile?.id }))
    const { error } = await supabase.from('incentives').insert(payload)
    setBulkBusy(false)
    if (error) {
      alert('일괄 등록 실패: ' + error.message)
      return
    }
    setBulkText('')
    setShowBulk(false)
    load()
  }

  async function remove(id: string) {
    if (!confirm('이 시상안을 삭제할까요?')) return
    const { error } = await supabase.from('incentives').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">보험사 시상안</h1>
          <p className="text-sm text-slate-500 mt-1">보험사별 월별 시상안(프로모션) 게시판입니다.</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <button
              onClick={() => { setShowBulk((v) => !v); setShowForm(false) }}
              className="border border-slate-300 text-slate-600 rounded-md px-4 py-2 text-sm font-medium bg-white"
            >
              엑셀 일괄등록
            </button>
            <button onClick={startCreate} className="bg-rose-600 text-white rounded-md px-4 py-2 text-sm font-medium">
              + 시상안 등록
            </button>
          </div>
        )}
      </div>

      {showBulk && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <p className="text-xs font-mono text-slate-500 whitespace-pre-wrap break-all">
            열 순서: {BULK_HEADER_HINT}
            {'\n'}예시: {BULK_EXAMPLE}
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={8}
            placeholder="엑셀에서 복사한 내용을 여기에 붙여넣으세요"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
          />
          {bulkRows.length > 0 && (
            <>
              <p className="text-sm text-slate-600">총 {bulkRows.length}행 · 유효 {bulkValidCount}행</p>
              <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-100 rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">보험사</th>
                      <th className="text-left px-3 py-1.5">지급월</th>
                      <th className="text-left px-3 py-1.5">제목</th>
                      <th className="text-left px-3 py-1.5">기간</th>
                      <th className="text-left px-3 py-1.5">대상</th>
                      <th className="text-left px-3 py-1.5">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((r, i) => (
                      <tr key={i} className={`border-t border-slate-100 ${r.error ? 'bg-red-50' : ''}`}>
                        <td className="px-3 py-1.5">{r.company}</td>
                        <td className="px-3 py-1.5">{r.month}</td>
                        <td className="px-3 py-1.5">{r.title}</td>
                        <td className="px-3 py-1.5">{r.period}</td>
                        <td className="px-3 py-1.5">{r.target}</td>
                        <td className="px-3 py-1.5 text-red-600">{r.error ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button
              disabled={bulkBusy || bulkValidCount === 0}
              onClick={handleBulkImport}
              className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {bulkBusy ? '등록 중…' : `${bulkValidCount}건 일괄 등록`}
            </button>
            <button onClick={() => { setShowBulk(false); setBulkText('') }} className="text-sm text-slate-500 px-4 py-2">
              취소
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
          <input required placeholder="보험사" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input type="month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input required placeholder="제목" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm col-span-2 md:col-span-1" />
          <input placeholder="기간 (예: 2026.07.01 ~ 07.31)" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <input placeholder="대상 상품/조건" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <textarea placeholder="내용" value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={3} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm col-span-2 md:col-span-3" />
          <div className="flex gap-2 col-span-2 md:col-span-3">
            <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
              {editingId ? '수정 저장' : '등록'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }} className="text-sm text-slate-500 px-4 py-2">
              취소
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCompanyFilter('전체')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${companyFilter === '전체' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
        >
          전체
        </button>
        {companies.map((c) => (
          <button
            key={c}
            onClick={() => setCompanyFilter(c)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${companyFilter === c ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && filtered.length === 0 && <p className="text-center text-slate-400 py-6">등록된 시상안이 없습니다.</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((i) => (
          <div key={i.id} className="bg-white rounded-xl shadow p-5">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded ${companyColor.get(i.company) ?? 'bg-slate-100 text-slate-600'}`}>
                {i.company}
              </span>
              <span className="text-xs text-slate-400">{i.month}</span>
            </div>
            <p className="font-semibold text-slate-800">{i.title}</p>
            <p className="text-xs text-slate-500 mt-1">{i.period}{i.period && i.target && ' · '}{i.target}</p>
            <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{i.content}</p>
            {canWrite && (
              <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                <button onClick={() => startEdit(i)} className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-600">수정</button>
                <button onClick={() => remove(i.id)} className="text-xs border border-red-200 rounded px-3 py-1.5 text-red-500">삭제</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
