import { useMemo, useState, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { toAuthEmail } from '../lib/id'
import type { CompanyCode, Profile } from '../lib/types'

const HEADER_HINT = '담당자아이디\t지급월\t종목\t구분\t보험사\t건수\t보험료\t수수료'
const EXAMPLE = 'shinminhye\t2026-07\t장기\t신규\tDB손해보험\t4\t2428500\t339988'

const INSURERS = ['삼성화재', 'DB손보', '현대해상', 'KB손보', '메리츠화재', '롯데손해보험', '라이나손보', '한화손해보험', 'AIG손해보험']

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

// ---- 보험사 엑셀 업로드 모드 ----

type FieldKey =
  | 'agentCode' | 'agentName' | 'month' | 'category' | 'type' | 'count' | 'premium' | 'commission'
  | 'productName' | 'customerName' | 'receiptDate' | 'expiryDate' | 'collectionStatus'

const FIELD_META: { key: FieldKey; label: string; required: boolean; keywords: string[] }[] = [
  { key: 'agentCode', label: '설계사코드/사번', required: false, keywords: [] },
  { key: 'agentName', label: '담당자명', required: false, keywords: [] },
  { key: 'month', label: '지급월', required: false, keywords: ['지급월', '정산월', '귀속월', '기준월', '수수료월', '지급년월', '업적월'] },
  { key: 'category', label: '종목', required: false, keywords: ['종목', '상품군', '보험종목'] },
  { key: 'type', label: '구분', required: false, keywords: ['계약구분', '가입구분', '청약구분', '신계약구분', '유형'] },
  { key: 'count', label: '건수', required: false, keywords: ['건수', '계약건수'] },
  { key: 'premium', label: '보험료', required: true, keywords: ['보험료', '납입보험료', '월보험료', '초회보험료'] },
  { key: 'commission', label: '수수료', required: true, keywords: ['수수료', '지급수수료', '수수료액', '커미션'] },
  { key: 'productName', label: '상품명', required: false, keywords: ['상품명', '상품'] },
  { key: 'customerName', label: '고객명', required: false, keywords: ['계약자명', '고객명', '계약자', '피보험자명'] },
  { key: 'receiptDate', label: '영수일', required: false, keywords: ['영수일', '접수일', '청약일', '응당일'] },
  { key: 'expiryDate', label: '만기일(보험종기)', required: false, keywords: ['보험종기', '보험만기일자', '만기일자', '만기일', '증권만기일', '만료일', '종기'] },
  { key: 'collectionStatus', label: '수금상태', required: false, keywords: ['정상집금여부', '집금상태', '수금상태', '수납상태', '미납여부', '수금여부', '입금상태'] },
]

const HEADER_DETECT_KEYWORDS = [
  '계약번호', '상품명', '계약자', '피보험자', '보험료', '수수료', '커미션', '설계사', '사용인', '모집인', '모집자',
  '지사', '종목', '구분', '건수', '월납', '청약일', '계약상태', '증권', '고객명',
]

function normalizeHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/\s/g, '')
}

// 보험사 다운로드 파일은 제목/필터조건 등 안내행이 여러 줄 앞에 붙는 경우가 많아, 보험 업무 용어가 가장 많이 등장하는 행을 실제 헤더 행으로 추정한다.
function findHeaderRowIndex(grid: (string | number)[][]): number {
  let bestIdx = 0
  let bestScore = -1
  const limit = Math.min(grid.length, 20)
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? []
    let score = 0
    for (const cell of row) {
      const c = normalizeHeader(String(cell ?? ''))
      if (!c) continue
      if (HEADER_DETECT_KEYWORDS.some((k) => c.includes(k))) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return bestScore >= 2 ? bestIdx : 0
}

// 파일 상단(헤더 행 이전)의 안내행에서 "2025-09" 같은 지급월 값을 찾아 파일 공통값으로 제안한다.
function guessFileMonth(grid: (string | number)[][], headerIdx: number): string {
  for (let i = 0; i < headerIdx; i++) {
    for (const cell of grid[i] ?? []) {
      const m = String(cell ?? '').match(/(20\d{2})[.\-/](\d{1,2})(?!\d)/)
      if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
    }
  }
  return ''
}

const PERSON_TOKENS = ['사용인', '설계사', '모집인', '모집자', '판매인', '컨설턴트', 'fc', '대리점', '에이전트']
const CODE_TOKENS = ['코드', '번호', '사번', 'id']
const NAME_TOKENS = ['명', '이름', '성명']

// 같은 후보 열이 여러 개면(예: 개인 설계사코드 vs 소속 지사/대표코드), 값이 행마다 달라지는(=개인 식별자인) 열을 우선한다.
function pickBestColumn(headers: string[], body: string[][], predicate: (h: string) => boolean): number {
  const candidates = headers.map((_, i) => i).filter((i) => predicate(normalizeHeader(headers[i])))
  if (candidates.length === 0) return -1
  if (candidates.length === 1) return candidates[0]
  let best = candidates[0]
  let bestCardinality = -1
  for (const idx of candidates) {
    const values = new Set<string>()
    for (const row of body) {
      const v = (row[idx] ?? '').trim()
      if (v) values.add(v)
    }
    if (values.size > bestCardinality) {
      bestCardinality = values.size
      best = idx
    }
  }
  return best
}

function emptyMapping(): Record<FieldKey, number> {
  return {
    agentCode: -1, agentName: -1, month: -1, category: -1, type: -1, count: -1, premium: -1, commission: -1,
    productName: -1, customerName: -1, receiptDate: -1, expiryDate: -1, collectionStatus: -1,
  }
}

function guessMapping(headers: string[], body: string[][]): Record<FieldKey, number> {
  const used = new Set<number>()
  const result = emptyMapping()

  const agentCode = pickBestColumn(headers, body, (h) => PERSON_TOKENS.some((p) => h.includes(p)) && CODE_TOKENS.some((c) => h.includes(c)))
  if (agentCode >= 0) { result.agentCode = agentCode; used.add(agentCode) }

  const agentName = pickBestColumn(
    headers, body,
    (h) => PERSON_TOKENS.some((p) => h.includes(p)) && NAME_TOKENS.some((n) => h.includes(n)) && !CODE_TOKENS.some((c) => h.includes(c)),
  )
  if (agentName >= 0 && !used.has(agentName)) { result.agentName = agentName; used.add(agentName) }

  for (const f of FIELD_META) {
    if (f.key === 'agentCode' || f.key === 'agentName') continue
    let found = -1
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue
      const h = normalizeHeader(headers[i])
      if (f.keywords.some((k) => h.includes(normalizeHeader(k)))) {
        found = i
        break
      }
    }
    if (found >= 0) used.add(found)
    result[f.key] = found
  }
  return result
}

// 삼성화재 다운로드 파일은 종목/구분을 별도 열로 주지 않고 다른 열의 값 유무로만 구분되므로, 해당 열을 찾아 유추한다.
function inferSamsungCategory(headers: string[], row: string[]): string {
  const longIdx = headers.findIndex((h) => normalizeHeader(h).includes('장기상품'))
  const autoIdx = headers.findIndex((h) => normalizeHeader(h).includes('자동차'))
  if (longIdx >= 0 && (row[longIdx] ?? '').trim()) return '장기'
  if (autoIdx >= 0 && (row[autoIdx] ?? '').trim()) return '자동차'
  return '일반'
}

function inferSamsungType(headers: string[], row: string[]): string {
  const idx = headers.findIndex((h) => normalizeHeader(h).includes('계약상태'))
  if (idx < 0) return ''
  const v = (row[idx] ?? '').trim()
  if (v.includes('계속')) return '계속'
  return v || '신규'
}

function inferCategoryFallback(insurer: string, headers: string[], row: string[]): string {
  if (insurer === '삼성화재') return inferSamsungCategory(headers, row)
  return ''
}

function inferTypeFallback(insurer: string, headers: string[], row: string[]): string {
  if (insurer === '삼성화재') return inferSamsungType(headers, row)
  return ''
}

function normalizeMonth(raw: string): string {
  const s = (raw ?? '').trim()
  const m = s.match(/(\d{4})\D{0,2}(\d{1,2})/)
  if (!m) return s
  return `${m[1]}-${m[2].padStart(2, '0')}`
}

function normalizeDate(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return s
}

function normalizeCategory(raw: string): string {
  const s = (raw ?? '').trim()
  if (s.includes('자동차')) return '자동차'
  if (s.includes('일반')) return '일반'
  if (s.includes('장기')) return '장기'
  return s
}

function toNumber(v: string): number {
  const n = Number(String(v ?? '').replace(/[,\s원]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// 보험사 다운로드 파일은 한 행이 계약 1건이므로, 합산하지 않고 건별(개별 계약)로 저장해 고객명·상품명·만기일을 보존한다.
interface FileRow {
  key: string
  agentKey: string
  agentLabel: string
  profile?: Profile
  month: string
  category: string
  type: string
  productName: string
  customerName: string
  receiptDate: string
  expiryDate: string
  collectionStatus: string
  count: number
  premium: number
  commission: number
  error?: string
}

export default function BulkImport() {
  const [mode, setMode] = useState<'paste' | 'file'>('paste')

  // 공통: 담당자/설계사코드 매핑용 데이터
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [agentProfiles, setAgentProfiles] = useState<{ profile_id: string; company_codes: CompanyCode[] }[]>([])
  const [loadedProfiles, setLoadedProfiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ inserted: number; failed: number; errorMessage?: string } | null>(null)

  async function ensureProfiles() {
    if (loadedProfiles) return
    const [{ data: profs }, { data: aps }] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('agent_profiles').select('profile_id, company_codes'),
    ])
    setProfiles(profs ?? [])
    setAgentProfiles(aps ?? [])
    setLoadedProfiles(true)
  }

  // ---- 붙여넣기 모드 ----
  const [text, setText] = useState('')

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
    let errorMessage: string | undefined
    const chunkSize = 200
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize)
      const { error, data } = await supabase.from('contracts').insert(chunk).select('id')
      if (error) {
        failed += chunk.length
        if (!errorMessage) errorMessage = error.message
        console.error('계약 일괄 등록 실패:', error)
      } else {
        inserted += data?.length ?? 0
      }
    }
    setBusy(false)
    setResult({ inserted, failed, errorMessage })
    if (failed === 0) setText('')
  }

  // ---- 파일 업로드 모드 ----
  const [insurer, setInsurer] = useState('')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<FieldKey, number>>(emptyMapping())
  const [fileMonth, setFileMonth] = useState('')
  const [manualAssign, setManualAssign] = useState<Record<string, string>>({})
  const [fileBusy, setFileBusy] = useState(false)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    await ensureProfiles()
    setFileBusy(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as (string | number)[][]
      if (!grid.length) return
      const headerIdx = findHeaderRowIndex(grid)
      const hdrs = grid[headerIdx].map((c) => String(c ?? '').trim())
      const body = grid.slice(headerIdx + 1).map((r) => hdrs.map((_, i) => String(r[i] ?? '').trim()))
      setFileName(f.name)
      setHeaders(hdrs)
      setDataRows(body)
      setMapping(guessMapping(hdrs, body))
      setFileMonth(guessFileMonth(grid, headerIdx))
      setManualAssign({})
      setResult(null)
    } finally {
      setFileBusy(false)
    }
  }

  const codeMap = useMemo(() => {
    const m = new Map<string, Profile>()
    for (const ap of agentProfiles) {
      const p = profiles.find((pp) => pp.id === ap.profile_id)
      if (!p) continue
      for (const cc of ap.company_codes ?? []) {
        const company = (cc.company ?? '').trim()
        const code = (cc.code ?? '').trim()
        if (company && code) m.set(`${company}|${code}`, p)
      }
    }
    return m
  }, [agentProfiles, profiles])

  const fileRows = useMemo<FileRow[]>(() => {
    if (!dataRows.length) return []
    const get = (row: string[], key: FieldKey) => {
      const idx = mapping[key]
      return idx >= 0 && idx < row.length ? (row[idx] ?? '').trim() : ''
    }
    return dataRows
      .filter((row) => row.some((cell) => cell))
      .map((row, i) => {
        const agentCode = get(row, 'agentCode')
        const agentName = get(row, 'agentName')
        const rawCategory = get(row, 'category')
        const rawType = get(row, 'type')
        const rawMonth = get(row, 'month')
        const month = rawMonth ? normalizeMonth(rawMonth) : fileMonth
        const category = rawCategory ? normalizeCategory(rawCategory) : inferCategoryFallback(insurer, headers, row)
        const type = rawType || inferTypeFallback(insurer, headers, row)
        const premium = toNumber(get(row, 'premium'))
        const commission = toNumber(get(row, 'commission'))

        const codeKey = agentCode ? `${insurer}|${agentCode}` : ''
        const autoProfile = codeKey ? codeMap.get(codeKey) : undefined
        const nameProfile = !autoProfile && agentName ? profiles.find((p) => p.name.trim() === agentName) : undefined
        const matchedAuto = autoProfile ?? nameProfile
        const agentKey = matchedAuto ? `p:${matchedAuto.id}` : agentCode ? `c:${agentCode}` : agentName ? `n:${agentName}` : 'unknown'
        const manualId = manualAssign[agentKey]
        const profile = matchedAuto ?? (manualId ? profiles.find((p) => p.id === manualId) : undefined)
        const agentLabel = matchedAuto ? matchedAuto.name : agentCode || agentName || '(식별불가)'

        let error: string | undefined
        if (!month || !/^\d{4}-\d{2}$/.test(month)) error = '지급월 형식 오류'
        else if (!['장기', '일반', '자동차'].includes(category)) error = '종목 값 오류'
        else if (!profile) error = '담당자 미매칭'

        return {
          key: `r${i}`, agentKey, agentLabel, profile, month, category, type,
          productName: get(row, 'productName'),
          customerName: get(row, 'customerName'),
          receiptDate: normalizeDate(get(row, 'receiptDate')),
          expiryDate: normalizeDate(get(row, 'expiryDate')),
          collectionStatus: get(row, 'collectionStatus'),
          count: mapping.count >= 0 ? toNumber(get(row, 'count')) || 1 : 1,
          premium, commission, error,
        }
      })
  }, [dataRows, mapping, fileMonth, insurer, headers, codeMap, profiles, manualAssign])

  const unresolvedAgents = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of fileRows) if (!r.profile) map.set(r.agentKey, r.agentLabel)
    return Array.from(map.entries())
  }, [fileRows])

  const groupedByAgent = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, FileRow[]>()
    for (const r of fileRows) {
      if (!map.has(r.agentKey)) {
        order.push(r.agentKey)
        map.set(r.agentKey, [])
      }
      map.get(r.agentKey)!.push(r)
    }
    return order
      .map((k) => {
        const grp = map.get(k)!.sort((a, b) => (a.expiryDate || a.receiptDate).localeCompare(b.expiryDate || b.receiptDate))
        return {
          agentKey: k,
          label: grp[0].agentLabel,
          profile: grp[0].profile,
          rows: grp,
          subtotal: {
            count: sum(grp, (g) => g.count),
            premium: sum(grp, (g) => g.premium),
            commission: sum(grp, (g) => g.commission),
          },
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  }, [fileRows])

  const fileValidCount = fileRows.filter((r) => !r.error).length
  const identifierMissing = mapping.agentCode < 0 && mapping.agentName < 0
  const missingRequired = FIELD_META.filter((f) => f.required && mapping[f.key] < 0)

  async function handleFileImport() {
    setBusy(true)
    const payload = fileRows
      .filter((r) => !r.error && r.profile)
      .map((r) => ({
        agent_email: r.profile!.email,
        agent_id: r.profile!.id,
        month: r.month,
        category: r.category,
        type: r.type,
        company: insurer,
        product_name: r.productName,
        customer_name: r.customerName,
        receipt_date: r.receiptDate || null,
        expiry_date: r.expiryDate || null,
        collection_status: r.collectionStatus || null,
        count: r.count,
        premium: r.premium,
        commission: r.commission,
      }))
    let inserted = 0
    let failed = 0
    let errorMessage: string | undefined
    const chunkSize = 200
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize)
      const { error, data } = await supabase.from('contracts').insert(chunk).select('id')
      if (error) {
        failed += chunk.length
        if (!errorMessage) errorMessage = error.message
        console.error('계약 일괄 등록 실패:', error)
      } else {
        inserted += data?.length ?? 0
      }
    }
    setBusy(false)
    setResult({ inserted, failed, errorMessage })
    if (failed === 0) {
      setFileName('')
      setHeaders([])
      setDataRows([])
      setMapping(emptyMapping())
      setFileMonth('')
      setManualAssign({})
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">계약 일괄 등록</h1>

      <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
        <button
          onClick={() => setMode('paste')}
          className={`px-4 py-2 ${mode === 'paste' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
        >
          엑셀 붙여넣기
        </button>
        <button
          onClick={() => { setMode('file'); ensureProfiles() }}
          className={`px-4 py-2 border-l border-slate-300 ${mode === 'file' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
        >
          보험사 포털 엑셀 업로드
        </button>
      </div>

      {mode === 'paste' && (
        <>
          <p className="text-sm text-slate-500">
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
        </>
      )}

      {mode === 'file' && (
        <>
          <p className="text-sm text-slate-500">
            보험사 업무포털에서 계약내용을 엑셀(xlsx/xls/csv)로 내려받아 그대로 업로드하세요.
            보험사마다 열 이름이 달라 자동으로 추정한 뒤 확인할 수 있고, 담당자는 마이스페이스에 등록된 보험사별 설계사코드로 자동 매칭됩니다.
            매칭되지 않으면 아래에서 직접 담당자를 지정하면 되고, 계약은 합산하지 않고 건별로 저장되어(고객명·상품명·만기일 보존) 담당자별로 정리됩니다.
          </p>

          <div className="bg-white rounded-xl shadow p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-500 mb-1">보험사</span>
                <select
                  value={insurer}
                  onChange={(e) => setInsurer(e.target.value)}
                  className="border border-slate-300 rounded-md px-3 py-2 text-sm min-w-40"
                >
                  <option value="">선택하세요</option>
                  {INSURERS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-500 mb-1">엑셀 파일</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={!insurer || fileBusy}
                  onChange={handleFile}
                  className="text-sm disabled:opacity-40"
                />
              </label>
              {fileName && <span className="text-xs text-slate-500">{fileName} · {dataRows.length}행 읽음</span>}
            </div>

            {headers.length > 0 && (
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <p className="text-xs font-semibold text-slate-500">열 매핑 확인 (자동 추정됨 · 필요시 변경)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {FIELD_META.map((f) => (
                    <label key={f.key} className="text-xs">
                      <span className="block text-slate-500 mb-1">
                        {f.label}{f.required && <span className="text-red-500"> *</span>}
                      </span>
                      <select
                        value={mapping[f.key]}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5"
                      >
                        <option value={-1}>(사용 안 함)</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>{h || `${i + 1}번째 열`}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {(identifierMissing || missingRequired.length > 0) && (
                  <p className="text-xs text-red-600">
                    {identifierMissing && '설계사코드/사번 또는 담당자명 중 하나는 반드시 매핑해야 합니다. '}
                    {missingRequired.length > 0 && `필수 항목 미지정: ${missingRequired.map((f) => f.label).join(', ')}`}
                  </p>
                )}
                {mapping.month < 0 && (
                  <label className="block text-xs pt-1">
                    <span className="block text-slate-500 mb-1">
                      지급월 (파일에 열이 없어 값 하나를 전체 행에 적용합니다 · 안내문에서 자동 인식 시도함)
                    </span>
                    <input
                      type="month"
                      value={fileMonth}
                      onChange={(e) => setFileMonth(e.target.value)}
                      className="border border-slate-300 rounded-md px-2 py-1.5"
                    />
                  </label>
                )}
                {mapping.category < 0 && insurer !== '삼성화재' && (
                  <p className="text-xs text-amber-600">
                    이 파일에서 종목(장기/일반/자동차) 열을 찾지 못했습니다. 열 매핑에서 직접 지정해주세요.
                  </p>
                )}
              </div>
            )}

            {unresolvedAgents.length > 0 && (
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <p className="text-xs font-semibold text-amber-600">담당자 미매칭 ({unresolvedAgents.length}건) · 직접 지정하세요</p>
                <div className="space-y-1.5">
                  {unresolvedAgents.map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <span className="w-40 text-slate-600 truncate" title={label}>{label}</span>
                      <select
                        value={manualAssign[key] ?? ''}
                        onChange={(e) => setManualAssign((m) => ({ ...m, [key]: e.target.value }))}
                        className="border border-slate-300 rounded-md px-2 py-1 text-sm flex-1 max-w-xs"
                      >
                        <option value="">담당자 선택…</option>
                        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fileRows.length > 0 && (
              <div className="text-sm text-slate-600 border-t border-slate-100 pt-3">
                담당자 {groupedByAgent.length}명 · 총 {fileRows.length}건 · 유효 {fileValidCount}건
              </div>
            )}
          </div>

          {groupedByAgent.length > 0 && (
            <div className="bg-white rounded-xl shadow overflow-x-auto divide-y divide-slate-100">
              {groupedByAgent.map((g) => (
                <div key={g.agentKey} className="p-3">
                  <div className="flex items-center justify-between px-1 pb-2">
                    <span className="text-sm font-semibold text-slate-700">
                      {g.label}{!g.profile && <span className="text-amber-600 font-normal"> (미매칭)</span>}
                    </span>
                    <span className="text-xs text-slate-400">
                      건수 {g.subtotal.count} · 보험료 {g.subtotal.premium.toLocaleString('ko-KR')} · 수수료 {g.subtotal.commission.toLocaleString('ko-KR')}
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-1.5">고객명</th>
                        <th className="text-left px-3 py-1.5">상품명</th>
                        <th className="text-left px-3 py-1.5">종목/구분</th>
                        <th className="text-left px-3 py-1.5">영수일</th>
                        <th className="text-left px-3 py-1.5">만기일</th>
                        <th className="text-left px-3 py-1.5">수금상태</th>
                        <th className="text-right px-3 py-1.5">보험료</th>
                        <th className="text-right px-3 py-1.5">수수료</th>
                        <th className="text-left px-3 py-1.5">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.key} className={`border-t border-slate-100 ${r.error ? 'bg-red-50' : ''}`}>
                          <td className="px-3 py-1.5">{r.customerName}</td>
                          <td className="px-3 py-1.5 max-w-52 truncate" title={r.productName}>{r.productName}</td>
                          <td className="px-3 py-1.5">{r.category}/{r.type}</td>
                          <td className="px-3 py-1.5">{r.receiptDate}</td>
                          <td className="px-3 py-1.5">{r.expiryDate}</td>
                          <td className="px-3 py-1.5">{r.collectionStatus}</td>
                          <td className="px-3 py-1.5 text-right">{r.premium.toLocaleString('ko-KR')}</td>
                          <td className="px-3 py-1.5 text-right">{r.commission.toLocaleString('ko-KR')}</td>
                          <td className="px-3 py-1.5 text-red-600">{r.error ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          <button
            disabled={busy || fileValidCount === 0}
            onClick={handleFileImport}
            className="bg-slate-800 text-white rounded-md px-5 py-2.5 text-sm font-medium disabled:opacity-40"
          >
            {busy ? '등록 중…' : `${fileValidCount}건 일괄 등록`}
          </button>
        </>
      )}

      {result && (
        <div className="text-sm">
          <p>
            완료: <span className="text-emerald-600 font-medium">{result.inserted}건 성공</span>
            {result.failed > 0 && <span className="text-red-600 font-medium"> · {result.failed}건 실패</span>}
          </p>
          {result.errorMessage && (
            <p className="text-red-600 text-xs mt-1">실패 사유: {result.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  )
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0)
}
