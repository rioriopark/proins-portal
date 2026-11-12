import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { safeStorageFileName } from '../lib/id'
import type { BoardAttachment, BoardPost } from '../lib/types'

const emptyForm = { title: '', content: '' }

// 첨부파일은 비공개 버킷(board-files)에 "<올린 사람 id>/<임의 파일명>" 경로로 저장하고,
// 원본 파일명은 게시글의 attachments 컬럼에 남긴다. (DB/버킷 준비: supabase/board-attachments.sql)
const BUCKET = 'board-files'
const MAX_FILE_SIZE = 50 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

async function openAttachment(a: BoardAttachment) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 600, { download: a.name })
  if (error || !data) return alert('파일 열기 실패: ' + (error?.message ?? ''))
  window.open(data.signedUrl, '_blank')
}

// 빈 줄로 구분된 문단마다 첫 줄이 짧은 이름표(예: 보험사명)로 보이면, 보험사별 전산 주소처럼
// 항목을 골라 볼 수 있는 선택형 게시글로 판단한다. 그렇지 않은 일반 글은 그대로 보여준다.
function parsePostSections(content: string): { label: string; body: string }[] | null {
  const blocks = content
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
  if (blocks.length < 2) return null
  const sections = blocks.map((b) => {
    const [first, ...rest] = b.split('\n')
    return { label: first.trim(), body: rest.join('\n').trim() }
  })
  if (sections.some((s) => !s.label || s.label.length > 20)) return null
  return sections
}

export default function Board() {
  const { profile } = useAuth()
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [openId, setOpenId] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<Record<string, string>>({})
  // 수정 중인 글에 남겨 둘 기존 첨부파일 / 새로 고른 파일
  const [keptFiles, setKeptFiles] = useState<BoardAttachment[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)

  // 게시글 작성은 로그인한 직원 누구나 가능하다. 수정/삭제는 작성자 본인 또는
  // 본사(프로인스컴퍼니) 소속이면 직급과 무관하게 다른 사람 글도 할 수 있다.
  const isHqOrg = profile?.org_id === 'hq'

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('board_posts').select('*').order('created_at', { ascending: false })
    setPosts(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function startCreate() {
    setForm(emptyForm)
    setKeptFiles([])
    setNewFiles([])
    setEditingId(null)
    setShowCreateForm(true)
  }

  function startEdit(p: BoardPost) {
    setForm({ title: p.title, content: p.content })
    setKeptFiles(p.attachments ?? [])
    setNewFiles([])
    setEditingId(p.id)
    setShowCreateForm(false)
    setOpenId(p.id)
  }

  function canEdit(p: BoardPost) {
    return isHqOrg || p.author_id === profile?.id
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    const picked = Array.from(list)
    const tooBig = picked.filter((f) => f.size > MAX_FILE_SIZE)
    if (tooBig.length) alert(`50MB를 넘는 파일은 올릴 수 없습니다: ${tooBig.map((f) => f.name).join(', ')}`)
    setNewFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_FILE_SIZE)])
  }

  async function uploadNewFiles(): Promise<BoardAttachment[] | null> {
    const uploaded: BoardAttachment[] = []
    for (const file of newFiles) {
      const path = `${profile?.id}/${safeStorageFileName(file.name)}`
      let { error } = await supabase.storage.from(BUCKET).upload(path, file)
      if (error) {
        // "Failed to fetch" 같은 일시적 네트워크 오류가 있어 한 번만 다시 시도한다.
        await new Promise((r) => setTimeout(r, 1000))
        ;({ error } = await supabase.storage.from(BUCKET).upload(path, file))
      }
      if (error) {
        if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded.map((a) => a.path))
        alert(`파일 업로드 실패 (${file.name}): ${error.message}`)
        return null
      }
      uploaded.push({ path, name: file.name, size: file.size })
    }
    return uploaded
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setSaving(true)
    const uploaded = await uploadNewFiles()
    if (!uploaded) return setSaving(false)
    const attachments = [...keptFiles, ...uploaded]

    if (editingId) {
      const before = posts.find((p) => p.id === editingId)?.attachments ?? []
      const { error } = await supabase
        .from('board_posts')
        .update({ title: form.title, content: form.content, attachments, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) {
        if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded.map((a) => a.path))
        setSaving(false)
        return alert('수정 실패: ' + error.message)
      }
      const removed = before.filter((b) => !keptFiles.some((k) => k.path === b.path))
      if (removed.length) await supabase.storage.from(BUCKET).remove(removed.map((a) => a.path))
    } else {
      const { error } = await supabase.from('board_posts').insert({
        title: form.title,
        content: form.content,
        attachments,
        author_id: profile.id,
        author_name: profile.name ?? '',
      })
      if (error) {
        if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded.map((a) => a.path))
        setSaving(false)
        return alert('등록 실패: ' + error.message)
      }
    }
    setSaving(false)
    setNewFiles([])
    setKeptFiles([])
    setShowCreateForm(false)
    setEditingId(null)
    load()
  }

  async function remove(p: BoardPost) {
    if (!confirm('이 게시글을 삭제할까요?')) return
    const { error } = await supabase.from('board_posts').delete().eq('id', p.id)
    if (error) return alert('삭제 실패: ' + error.message)
    const paths = (p.attachments ?? []).map((a) => a.path)
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    load()
  }

  const formFields = (
    <>
      <input
        required
        placeholder="제목"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
      />
      <textarea
        placeholder="내용"
        value={form.content}
        onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
        rows={10}
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
      />
      <AttachmentPicker
        kept={keptFiles}
        added={newFiles}
        onAdd={addFiles}
        onRemoveKept={(path) => setKeptFiles((prev) => prev.filter((a) => a.path !== path))}
        onRemoveAdded={(i) => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />
    </>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">게시판</h1>
          <p className="text-sm text-slate-500 mt-1">업무 매뉴얼, 노하우 등 업무 내용을 자유롭게 공유하는 게시판입니다.</p>
        </div>
        {profile && (
          <button onClick={startCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium shrink-0">
            + 글쓰기
          </button>
        )}
      </div>

      {showCreateForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 space-y-3">
          {formFields}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? '등록 중…' : '등록'}
            </button>
            <button type="button" onClick={() => setShowCreateForm(false)} className="text-sm text-slate-500 px-4 py-2">
              취소
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && posts.length === 0 && <p className="text-center text-slate-400 py-6">등록된 게시글이 없습니다.</p>}

      <div className="space-y-3">
        {posts.map((p) => {
          const open = openId === p.id
          return (
            <div key={p.id} className="bg-white rounded-xl shadow p-5">
              <button type="button" onClick={() => setOpenId(open ? null : p.id)} className="w-full text-left">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-800">
                    {p.title}
                    {(p.attachments?.length ?? 0) > 0 && (
                      <span className="ml-2 text-xs font-normal text-slate-400">📎 {p.attachments!.length}</span>
                    )}
                  </p>
                  <span className="text-xs text-slate-400 shrink-0">
                    {p.author_name} · {p.created_at.slice(0, 10)}
                  </span>
                </div>
              </button>
              {open && editingId !== p.id && (
                <PostContent
                  post={p}
                  selected={selectedSection[p.id] ?? '전체'}
                  onSelect={(label) => setSelectedSection((prev) => ({ ...prev, [p.id]: label }))}
                />
              )}
              {open && editingId !== p.id && (p.attachments?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-1">
                  {p.attachments!.map((a) => (
                    <li key={a.path}>
                      <button
                        type="button"
                        onClick={() => openAttachment(a)}
                        className="text-sm text-blue-600 hover:underline text-left break-all"
                      >
                        📎 {a.name}
                      </button>
                      <span className="ml-2 text-xs text-slate-400">{formatSize(a.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {open && canEdit(p) && editingId !== p.id && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-600"
                  >
                    수정
                  </button>
                  <button onClick={() => remove(p)} className="text-xs border border-red-200 rounded px-3 py-1.5 text-red-500">
                    삭제
                  </button>
                </div>
              )}
              {editingId === p.id && (
                <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  {formFields}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      {saving ? '저장 중…' : '수정 저장'}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-sm text-slate-500 px-4 py-2">
                      취소
                    </button>
                  </div>
                </form>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PostContent({ post, selected, onSelect }: { post: BoardPost; selected: string; onSelect: (label: string) => void }) {
  if (!post.content.trim()) return null
  const sections = parsePostSections(post.content)
  if (!sections) {
    return <p className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100 whitespace-pre-wrap">{post.content}</p>
  }
  const shown = selected === '전체' ? sections : sections.filter((s) => s.label === selected)
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {['전체', ...sections.map((s) => s.label)].map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(label)}
            className={`px-2.5 py-1 rounded text-xs font-medium ${
              selected === label ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {shown.map((s) => (
          <div key={s.label} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-slate-700 mb-1">{s.label}</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function AttachmentPicker({
  kept,
  added,
  onAdd,
  onRemoveKept,
  onRemoveAdded,
}: {
  kept: BoardAttachment[]
  added: File[]
  onAdd: (files: FileList | null) => void
  onRemoveKept: (path: string) => void
  onRemoveAdded: (index: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="border border-dashed border-slate-300 rounded-md p-3 space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-600 bg-white"
        >
          파일 첨부
        </button>
        <span className="text-xs text-slate-400">여러 개 선택 가능 · 파일당 최대 50MB</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            onAdd(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {(kept.length > 0 || added.length > 0) && (
        <ul className="space-y-1">
          {kept.map((a) => (
            <li key={a.path} className="flex items-center gap-2 text-sm text-slate-600">
              <span className="break-all">📎 {a.name}</span>
              <span className="text-xs text-slate-400 shrink-0">{formatSize(a.size)}</span>
              <button type="button" onClick={() => onRemoveKept(a.path)} className="text-xs text-red-500 shrink-0">
                삭제
              </button>
            </li>
          ))}
          {added.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm text-slate-600">
              <span className="break-all">📎 {f.name}</span>
              <span className="text-xs text-slate-400 shrink-0">{formatSize(f.size)} · 새 파일</span>
              <button type="button" onClick={() => onRemoveAdded(i)} className="text-xs text-red-500 shrink-0">
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
