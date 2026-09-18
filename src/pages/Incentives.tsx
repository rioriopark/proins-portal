import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { safeStorageFileName } from '../lib/id'
import type { Incentive } from '../lib/types'

const BADGE_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-cyan-100 text-cyan-700',
]

function isImageFile(name: string | null): boolean {
  return !!name && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)
}

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

interface BulkFileRow {
  key: string
  file: File
  previewUrl: string | null
  parsing: boolean
  error?: string
  company: string
  month: string
  title: string
  period: string
  target: string
  content: string
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
  const { profile, can } = useAuth()
  const [items, setItems] = useState<Incentive[]>([])
  const [loading, setLoading] = useState(true)
  const [companyFilter, setCompanyFilter] = useState('전체')
  const [showAllMonths, setShowAllMonths] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [existingFile, setExistingFile] = useState<{ url: string | null; name: string | null }>({ url: null, name: null })
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkFiles, setShowBulkFiles] = useState(false)
  const [bulkFileRows, setBulkFileRows] = useState<BulkFileRow[]>([])
  const [bulkFileBusy, setBulkFileBusy] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canWrite = can('incentives')

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

  const filtered = useMemo(() => {
    let rows = showAllMonths ? items : items.filter((i) => i.month === thisMonth())
    if (companyFilter !== '전체') rows = rows.filter((i) => i.company === companyFilter)
    return rows
  }, [items, companyFilter, showAllMonths])

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setFile(null)
    setExistingFile({ url: null, name: null })
    setShowForm(true)
    setShowBulk(false)
    setShowBulkFiles(false)
  }

  function startEdit(i: Incentive) {
    setForm({ company: i.company, month: i.month, title: i.title, period: i.period, target: i.target, content: i.content })
    setEditingId(i.id)
    setFile(null)
    setExistingFile({ url: i.file_url, name: i.file_name })
    setShowForm(true)
  }

  function readFileAsBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.slice(result.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(f)
    })
  }

  async function getAccessToken(): Promise<string | undefined> {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token
  }

  async function callParseIncentive(token: string | undefined, base64: string, mediaType: string) {
    return fetch('/api/parse-incentive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileData: base64, mediaType }),
    })
  }

  // 세션 토큰이 갱신 시점과 겹쳐 "인증에 실패했습니다"로 실패하는 경우가 있어, 401이면 세션을
  // 한 번 강제로 새로고침한 뒤 같은 요청을 한 번 더 시도한다.
  async function parseIncentiveFile(f: File) {
    const base64 = await readFileAsBase64(f)
    let token = await getAccessToken()
    let res = await callParseIncentive(token, base64, f.type)
    if (res.status === 401) {
      const { data } = await supabase.auth.refreshSession()
      token = data.session?.access_token
      res = await callParseIncentive(token, base64, f.type)
    }
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'AI 분석 실패')
    return result as { company: string; month: string; title: string; period: string; target: string; content: string }
  }

  // 이미지/PDF를 선택하면 첨부만 하는 게 아니라 AI로 내용을 읽어 보험사/지급월/제목/기간/대상/내용을
  // 자동으로 채워준다. 관리자는 채워진 내용을 확인하고 필요하면 고쳐서 저장하면 된다.
  async function handleFileSelected(f: File | null) {
    setFile(f)
    if (!f) return
    setParsing(true)
    try {
      const result = await parseIncentiveFile(f)
      setForm((prev) => ({
        company: result.company || prev.company,
        month: /^\d{4}-\d{2}$/.test(result.month) ? result.month : prev.month,
        title: result.title || prev.title,
        period: result.period || prev.period,
        target: result.target || prev.target,
        content: result.content || prev.content,
      }))
    } catch (err) {
      alert('AI 분석 실패: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setParsing(false)
    }
  }

  // 시상안 이미지/PDF 여러 장을 한 번에 선택하면 파일별로 AI 분석을 동시에 돌려서, 파일마다 한 건씩
  // 예상 등록 내용을 보여준다. 관리자는 각 행을 확인·수정한 뒤 한 번에 일괄 등록한다.
  function handleBulkFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const newRows: BulkFileRow[] = Array.from(fileList).map((f) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: f,
      previewUrl: isImageFile(f.name) ? URL.createObjectURL(f) : null,
      parsing: true,
      company: '',
      month: thisMonth(),
      title: '',
      period: '',
      target: '',
      content: '',
    }))
    setBulkFileRows((prev) => [...prev, ...newRows])

    newRows.forEach((row) => {
      parseIncentiveFile(row.file)
        .then((result) => {
          setBulkFileRows((prev) =>
            prev.map((r) =>
              r.key === row.key
                ? {
                    ...r,
                    parsing: false,
                    company: result.company || '',
                    month: /^\d{4}-\d{2}$/.test(result.month) ? result.month : thisMonth(),
                    title: result.title || '',
                    period: result.period || '',
                    target: result.target || '',
                    content: result.content || '',
                  }
                : r,
            ),
          )
        })
        .catch((err) => {
          setBulkFileRows((prev) =>
            prev.map((r) =>
              r.key === row.key ? { ...r, parsing: false, error: err instanceof Error ? err.message : String(err) } : r,
            ),
          )
        })
    })
  }

  function updateBulkFileRow(key: string, patch: Partial<BulkFileRow>) {
    setBulkFileRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeBulkFileRow(key: string) {
    setBulkFileRows((prev) => {
      const row = prev.find((r) => r.key === key)
      if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl)
      return prev.filter((r) => r.key !== key)
    })
  }

  // AI 분석 실패(row.error)여도 회사/제목을 직접 입력했으면 등록 가능해야 한다.
  const bulkFileReadyCount = bulkFileRows.filter((r) => !r.parsing && r.company.trim() && r.title.trim()).length

  // 스토리지 업로드가 "Failed to fetch" 같은 일시적 네트워크 오류로 실패하는 경우가 있어 한 번
  // 자동으로 재시도한다. 그래도 실패하면 그 행은 지우지 않고 남겨서 다시 버튼을 누르면 파일을
  // 새로 선택하거나 AI 분석을 다시 돌릴 필요 없이 바로 재시도할 수 있게 한다.
  async function uploadWithRetry(path: string, file: File) {
    const first = await supabase.storage.from('incentive-files').upload(path, file)
    if (!first.error) return first
    await new Promise((r) => setTimeout(r, 1000))
    return supabase.storage.from('incentive-files').upload(path, file)
  }

  async function handleBulkFileSubmit() {
    setBulkFileBusy(true)
    const remaining: BulkFileRow[] = []
    let inserted = 0
    const errors: string[] = []
    for (const row of bulkFileRows) {
      if (row.parsing || !row.company.trim() || !row.title.trim()) {
        remaining.push(row)
        continue
      }
      const path = safeStorageFileName(row.file.name)
      const { error: uploadError } = await uploadWithRetry(path, row.file)
      if (uploadError) {
        console.error('시상안 파일 업로드 실패:', row.file.name, uploadError)
        errors.push(`${row.file.name}: 파일 업로드 실패 — ${uploadError.message}`)
        remaining.push(row)
        continue
      }
      const fileUrl = supabase.storage.from('incentive-files').getPublicUrl(path).data.publicUrl
      const { error } = await supabase.from('incentives').insert({
        company: row.company,
        month: row.month,
        title: row.title,
        period: row.period,
        target: row.target,
        content: row.content,
        file_url: fileUrl,
        file_name: row.file.name,
        created_by: profile?.id,
      })
      if (error) {
        console.error('시상안 등록 실패:', row.file.name, error)
        errors.push(`${row.file.name}: 등록 실패 — ${error.message}`)
        remaining.push(row)
      } else {
        inserted++
        if (row.previewUrl) URL.revokeObjectURL(row.previewUrl)
      }
    }
    setBulkFileBusy(false)
    if (errors.length > 0) {
      alert(
        `${inserted}건 등록 완료, ${errors.length}건 실패했습니다. 실패한 건은 목록에 남겨뒀으니 다시 "일괄 등록"을 눌러 재시도해주세요.\n\n${errors.slice(0, 5).join('\n')}`,
      )
    }
    setBulkFileRows(remaining)
    if (remaining.length === 0) setShowBulkFiles(false)
    load()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    let fileUrl = existingFile.url
    let fileName = existingFile.name
    if (file) {
      setUploading(true)
      const path = safeStorageFileName(file.name)
      const { error: uploadError } = await supabase.storage.from('incentive-files').upload(path, file)
      setUploading(false)
      if (uploadError) return alert('파일 업로드 실패: ' + uploadError.message)
      fileUrl = supabase.storage.from('incentive-files').getPublicUrl(path).data.publicUrl
      fileName = file.name
    }
    const payload = { ...form, file_url: fileUrl, file_name: fileName }
    if (editingId) {
      const { error } = await supabase
        .from('incentives')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('incentives').insert({ ...payload, created_by: profile?.id })
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
              onClick={() => {
                setShowBulk((v) => !v)
                setShowForm(false)
                setShowBulkFiles(false)
              }}
              className="border border-slate-300 text-slate-600 rounded-md px-4 py-2 text-sm font-medium bg-white"
            >
              엑셀 일괄등록
            </button>
            <button
              onClick={() => {
                setShowBulkFiles((v) => !v)
                setShowForm(false)
                setShowBulk(false)
              }}
              className="border border-slate-300 text-slate-600 rounded-md px-4 py-2 text-sm font-medium bg-white"
            >
              이미지 일괄등록 (AI)
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
              <p className="text-sm text-slate-600">
                총 {bulkRows.length}행 · 유효 {bulkValidCount}행
              </p>
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
            <button
              onClick={() => {
                setShowBulk(false)
                setBulkText('')
              }}
              className="text-sm text-slate-500 px-4 py-2"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {showBulkFiles && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <p className="text-sm text-slate-500">
            시상안 이미지/PDF를 여러 장 한 번에 선택하면, 파일마다 AI가 동시에 내용을 읽어 등록 내용을 채워줍니다. 파일마다 결과를
            확인·수정한 뒤 한 번에 일괄 등록하세요.
          </p>
          <input
            type="file"
            multiple
            accept="application/pdf,image/*"
            onChange={(e) => {
              handleBulkFilesSelected(e.target.files)
              e.target.value = ''
            }}
            className="w-full text-sm"
          />
          {bulkFileRows.length > 0 && (
            <div className="space-y-3">
              {bulkFileRows.map((row) => (
                <div key={row.key} className="border border-slate-200 rounded-lg p-3 flex gap-3">
                  {row.previewUrl && (
                    <img
                      src={row.previewUrl}
                      alt={row.file.name}
                      className="w-24 h-24 object-cover rounded-md border border-slate-200 shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-xs text-slate-500 truncate">{row.file.name}</p>
                      <button
                        type="button"
                        onClick={() => removeBulkFileRow(row.key)}
                        className="text-xs text-red-500 hover:underline shrink-0"
                      >
                        제외
                      </button>
                    </div>
                    {row.parsing ? (
                      <p className="text-xs text-indigo-600">AI가 내용을 분석하고 있습니다…</p>
                    ) : row.error ? (
                      <p className="text-xs text-red-600">분석 실패: {row.error} (직접 입력해서 등록할 수 있습니다)</p>
                    ) : null}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1.5">
                      <input
                        placeholder="보험사"
                        value={row.company}
                        onChange={(e) => updateBulkFileRow(row.key, { company: e.target.value })}
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs"
                      />
                      <input
                        type="month"
                        value={row.month}
                        onChange={(e) => updateBulkFileRow(row.key, { month: e.target.value })}
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs"
                      />
                      <input
                        placeholder="제목"
                        value={row.title}
                        onChange={(e) => updateBulkFileRow(row.key, { title: e.target.value })}
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs col-span-2 md:col-span-1"
                      />
                      <input
                        placeholder="기간"
                        value={row.period}
                        onChange={(e) => updateBulkFileRow(row.key, { period: e.target.value })}
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs"
                      />
                      <input
                        placeholder="대상"
                        value={row.target}
                        onChange={(e) => updateBulkFileRow(row.key, { target: e.target.value })}
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs"
                      />
                      <textarea
                        placeholder="내용"
                        value={row.content}
                        onChange={(e) => updateBulkFileRow(row.key, { content: e.target.value })}
                        rows={2}
                        className="border border-slate-300 rounded-md px-2 py-1 text-xs col-span-2 md:col-span-3"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              disabled={bulkFileBusy || bulkFileReadyCount === 0}
              onClick={handleBulkFileSubmit}
              className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {bulkFileBusy ? '등록 중…' : `${bulkFileReadyCount}건 일괄 등록`}
            </button>
            <button
              onClick={() => {
                bulkFileRows.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl))
                setShowBulkFiles(false)
                setBulkFileRows([])
              }}
              className="text-sm text-slate-500 px-4 py-2"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
          <input
            required
            placeholder="보험사"
            value={form.company}
            onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            type="month"
            value={form.month}
            onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            required
            placeholder="제목"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm col-span-2 md:col-span-1"
          />
          <input
            placeholder="기간 (예: 2026.07.01 ~ 07.31)"
            value={form.period}
            onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <input
            placeholder="대상 상품/조건"
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <textarea
            placeholder="내용"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={3}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm col-span-2 md:col-span-3"
          />
          <div className="col-span-2 md:col-span-3">
            <label className="block text-xs text-slate-500 mb-1">
              첨부파일 (PDF/이미지, 선택 시 AI가 내용을 읽어 자동으로 채워줍니다)
            </label>
            <input
              type="file"
              accept="application/pdf,image/*"
              disabled={parsing}
              onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
            {parsing && <p className="text-xs text-indigo-600 mt-1">AI가 내용을 분석하고 있습니다…</p>}
            {existingFile.name && !file && (
              <p className="text-xs text-slate-500 mt-1">현재 첨부: {existingFile.name} (새 파일 선택 시 교체됩니다)</p>
            )}
          </div>
          <div className="flex gap-2 col-span-2 md:col-span-3">
            <button
              type="submit"
              disabled={uploading || parsing}
              className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {uploading ? '업로드 중…' : editingId ? '수정 저장' : '등록'}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <button
          type="button"
          onClick={() => setShowAllMonths((v) => !v)}
          className="text-xs text-indigo-600 hover:underline shrink-0"
        >
          {showAllMonths ? '이번 달만 보기' : '지난 시상안 포함 전체 기간 보기'}
        </button>
      </div>

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-center text-slate-400 py-6">
          {showAllMonths ? '등록된 시상안이 없습니다.' : '이번 달 등록된 시상안이 없습니다.'}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((i) => {
          const open = openIds.has(i.id)
          return (
            <div key={i.id} className="bg-white rounded-xl shadow p-5">
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded ${companyColor.get(i.company) ?? 'bg-slate-100 text-slate-600'}`}
                >
                  {i.company}
                </span>
                <span className="text-xs text-slate-400">{i.period || i.month}</span>
              </div>
              <p className="font-semibold text-slate-800">{i.title}</p>
              <button type="button" onClick={() => toggleOpen(i.id)} className="text-xs text-indigo-600 hover:underline mt-2">
                {open ? '세부내용 접기 ▲' : '세부내용 보기 ▼'}
              </button>
              {open && (
                <div className="mt-2 space-y-2">
                  {(i.period || i.target) && (
                    <p className="text-xs text-slate-500">
                      {i.period}
                      {i.period && i.target && ' · '}
                      {i.target}
                    </p>
                  )}
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{i.content}</p>
                  {i.file_url && isImageFile(i.file_name) && (
                    <a href={i.file_url} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={i.file_url}
                        alt={i.file_name ?? '첨부 이미지'}
                        className="max-h-48 rounded-md border border-slate-200 hover:opacity-90"
                      />
                    </a>
                  )}
                  {i.file_url && (
                    <a
                      href={i.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      📎 {i.file_name ?? '첨부파일'}
                    </a>
                  )}
                </div>
              )}
              {canWrite && (
                <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => startEdit(i)}
                    className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-600"
                  >
                    수정
                  </button>
                  <button onClick={() => remove(i.id)} className="text-xs border border-red-200 rounded px-3 py-1.5 text-red-500">
                    삭제
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
