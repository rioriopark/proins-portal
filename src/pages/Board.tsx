import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { BoardPost } from '../lib/types'

const emptyForm = { title: '', content: '' }

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

  // 게시글 작성은 본사(프로인스컴퍼니) 소속만 가능하고, 본사 소속이면 직급과 무관하게
  // 다른 사람 글도 수정/삭제할 수 있다.
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
    setEditingId(null)
    setShowCreateForm(true)
  }

  function startEdit(p: BoardPost) {
    setForm({ title: p.title, content: p.content })
    setEditingId(p.id)
    setShowCreateForm(false)
    setOpenId(p.id)
  }

  function canEdit(p: BoardPost) {
    return isHqOrg || p.author_id === profile?.id
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (editingId) {
      const { error } = await supabase
        .from('board_posts')
        .update({ title: form.title, content: form.content, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) return alert('수정 실패: ' + error.message)
    } else {
      const { error } = await supabase.from('board_posts').insert({
        title: form.title,
        content: form.content,
        author_id: profile?.id,
        author_name: profile?.name ?? '',
      })
      if (error) return alert('등록 실패: ' + error.message)
    }
    setShowCreateForm(false)
    setEditingId(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('이 게시글을 삭제할까요?')) return
    const { error } = await supabase.from('board_posts').delete().eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">게시판</h1>
          <p className="text-sm text-slate-500 mt-1">업무 매뉴얼, 노하우 등 업무 내용을 자유롭게 공유하는 게시판입니다.</p>
        </div>
        {isHqOrg && (
          <button onClick={startCreate} className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
            + 글쓰기
          </button>
        )}
      </div>

      {showCreateForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 space-y-3">
          <input
            required
            placeholder="제목"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
          />
          <textarea
            required
            placeholder="내용"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={10}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
          />
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
              등록
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
                  <p className="font-semibold text-slate-800">{p.title}</p>
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
              {open && canEdit(p) && editingId !== p.id && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-600"
                  >
                    수정
                  </button>
                  <button onClick={() => remove(p.id)} className="text-xs border border-red-200 rounded px-3 py-1.5 text-red-500">
                    삭제
                  </button>
                </div>
              )}
              {editingId === p.id && (
                <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  <input
                    required
                    placeholder="제목"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  />
                  <textarea
                    required
                    placeholder="내용"
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    rows={10}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
                  />
                  <div className="flex gap-2">
                    <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium">
                      수정 저장
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
