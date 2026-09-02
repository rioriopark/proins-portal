import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toAuthEmail } from '../lib/id'
import type { Profile } from '../lib/types'

const HEADER_HINT = '담당자아이디\t지급월\t종목\t구분\t보험사\t건수\t보험료\t수수료'
const EXAMPLE = 'shinminhye\t2026-07\t장기\t신규\tDB손해보험\t4\t2428500\t339988'

interface ParsedRow {
  raw: string[]
  agent_email: string
  month: string
  category: string
  type: string
  company: string
  count: number
  premium: number
  commission: number
  matched?: Profile
  error?: string
}

function parseSheet(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0)
  return lines.map((line) => {
    const cols = line.split(/\t|,/).map((c) => c.trim())
    const [agentId, month, category, type, company, count, premium, commission] = cols
    return {
      raw: cols,
      agent_email: agentId ? toAuthEmail(agentId) : '',
      month: month ?? '',
      category: category ?? '',
      type: type ?? '',
      company: company ?? '',
      count: Number(count ?? 0),
      premium: Number(premium ?? 0),
      commission: Number(commission ?? 0),
    }
  })
}

export default function BulkImport() {
  const [text, setText] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loadedProfiles, setLoadedProfiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ inserted: number; failed: number } | null>(null)

  async function ensureProfiles() {
    if (loadedProfiles) return
    const { data } = await supabase.from('profiles').select('*')
    setProfiles(data ?? [])
    setLoadedProfiles(true)
  }

  const rows = useMemo<ParsedRow[]>(() => {
    if (!text.trim()) return []
    return parseSheet(text).map((r) => {
      const matched = profiles.find((p) => p.email.toLowerCase() === r.agent_email.toLowerCase())
      let error: string | undefined
      if (!r.agent_email) error = '아이디 없음'
      else if (!r.month || !/^\d{4}-\d{2}$/.test(r.month)) error = '지급월 형식 오류 (YYYY-MM)'
      else if (!['장기', '일반', '자동차'].includes(r.category)) error = '종목 값 오류'
      return { ...r, matched, error }
    })
  }, [text, profiles])

  const validCount = rows.filter((r) => !r.error).length
  const matchedCount = rows.filter((r) => r.matched).length

  async function handleImport() {
    setBusy(true)
    const payload = rows
      .filter((r) => !r.error)
      .map((r) => ({
        agent_email: r.agent_email,
        agent_id: r.matched?.id ?? null,
        month: r.month,
        category: r.category,
        type: r.type,
        company: r.company,
        count: r.count,
        premium: r.premium,
        commission: r.commission,
      }))
    let inserted = 0
    let failed = 0
    const chunkSize = 200
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize)
      const { error, data } = await supabase.from('contracts').insert(chunk).select('id')
      if (error) failed += chunk.length
      else inserted += data?.length ?? 0
    }
    setBusy(false)
    setResult({ inserted, failed })
    if (failed === 0) setText('')
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">계약 일괄 등록 (엑셀 붙여넣기)</h1>
      <p className="text-sm text-slate-500 -mt-4">
        엑셀에서 아래 순서대로 열을 만들어 셀을 드래그 선택 후 복사(Ctrl+C)한 다음, 아래 칸에 붙여넣기(Ctrl+V)하세요.
        담당자가 아직 가입 전이어도 아이디만 맞으면 나중에 가입 시 자동으로 연결됩니다.
      </p>

      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <p className="text-xs font-mono text-slate-500 whitespace-pre-wrap break-all">
          열 순서: {HEADER_HINT}
          {'\n'}예시: {EXAMPLE}
        </p>
        <textarea
          value={text}
          onFocus={ensureProfiles}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="여기에 엑셀 데이터를 붙여넣으세요"
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
        />
        {rows.length > 0 && (
          <div className="text-sm text-slate-600">
            총 {rows.length}행 · 유효 {validCount}행 · 담당자 매칭됨 {matchedCount}행
            {matchedCount < validCount && (
              <span className="text-amber-600"> (미매칭 {validCount - matchedCount}행은 담당자 가입 후 자동 연결됩니다)</span>
            )}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">아이디</th>
                <th className="text-left px-3 py-2">담당자매칭</th>
                <th className="text-left px-3 py-2">지급월</th>
                <th className="text-left px-3 py-2">종목</th>
                <th className="text-left px-3 py-2">구분</th>
                <th className="text-left px-3 py-2">보험사</th>
                <th className="text-right px-3 py-2">건수</th>
                <th className="text-right px-3 py-2">보험료</th>
                <th className="text-right px-3 py-2">수수료</th>
                <th className="text-left px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r, i) => (
                <tr key={i} className={`border-t border-slate-100 ${r.error ? 'bg-red-50' : ''}`}>
                  <td className="px-3 py-1.5">{r.agent_email}</td>
                  <td className="px-3 py-1.5">{r.matched ? r.matched.name : '(미가입)'}</td>
                  <td className="px-3 py-1.5">{r.month}</td>
                  <td className="px-3 py-1.5">{r.category}</td>
                  <td className="px-3 py-1.5">{r.type}</td>
                  <td className="px-3 py-1.5">{r.company}</td>
                  <td className="px-3 py-1.5 text-right">{r.count}</td>
                  <td className="px-3 py-1.5 text-right">{r.premium.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-1.5 text-right">{r.commission.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-1.5 text-red-600">{r.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && <p className="text-xs text-slate-400 p-2">…외 {rows.length - 50}행</p>}
        </div>
      )}

      <button
        disabled={busy || validCount === 0}
        onClick={handleImport}
        className="bg-slate-800 text-white rounded-md px-5 py-2.5 text-sm font-medium disabled:opacity-40"
      >
        {busy ? '등록 중…' : `${validCount}건 일괄 등록`}
      </button>

      {result && (
        <p className="text-sm">
          완료: <span className="text-emerald-600 font-medium">{result.inserted}건 성공</span>
          {result.failed > 0 && <span className="text-red-600 font-medium"> · {result.failed}건 실패</span>}
        </p>
      )}
    </div>
  )
}
