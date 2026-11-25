// 급여 프로그램에서 내려받는 임금명세서 PDF(번호_이름_기간.pdf)의 텍스트를 읽어 wage_statements 한 행으로
// 바꾼다. PDF 글자는 한 글자씩 흩어져 나오므로 같은 줄(y)끼리 묶고, 붙어 있는 글자(x 간격이 좁은 것)를
// 한 토큰으로 합친 뒤 "항목명 → 바로 오른쪽 숫자" 순서로 값을 찾는다. pdfjs 의존성이 없는 순수 함수라
// node에서도 그대로 테스트할 수 있다.

export interface PdfTextItem {
  str: string
  x: number
  y: number
  width: number
}

export type WageAmountKey =
  | 'base_salary'
  | 'position_allowance'
  | 'meal_allowance'
  | 'bonus'
  | 'car_allowance'
  | 'national_pension'
  | 'health_insurance'
  | 'longterm_care_insurance'
  | 'employment_insurance'
  | 'health_insurance_settlement'
  | 'care_insurance_settlement'
  | 'advance_payment'
  | 'durunuri_pension'
  | 'durunuri_employment'
  | 'income_tax'
  | 'local_income_tax'
  | 'agri_tax'

export const PAY_KEYS: WageAmountKey[] = ['base_salary', 'position_allowance', 'meal_allowance', 'bonus', 'car_allowance']
export const DEDUCTION_KEYS: WageAmountKey[] = [
  'national_pension',
  'health_insurance',
  'longterm_care_insurance',
  'employment_insurance',
  'health_insurance_settlement',
  'care_insurance_settlement',
  'advance_payment',
  'durunuri_pension',
  'durunuri_employment',
  'income_tax',
  'local_income_tax',
  'agri_tax',
]

// PDF에 찍히는 항목명(공백 제거 후) → 컬럼
const LABELS: Record<string, WageAmountKey> = {
  기본급: 'base_salary',
  직책수당: 'position_allowance',
  식대: 'meal_allowance',
  상여: 'bonus',
  자가운전보조금: 'car_allowance',
  국민연금: 'national_pension',
  건강보험: 'health_insurance',
  장기요양보험: 'longterm_care_insurance',
  고용보험: 'employment_insurance',
  건강보험정산: 'health_insurance_settlement',
  요양보험정산: 'care_insurance_settlement',
  기지급액: 'advance_payment',
  '두루누리정산(연금)': 'durunuri_pension',
  '두루누리정산(고용)': 'durunuri_employment',
  소득세: 'income_tax',
  지방소득세: 'local_income_tax',
  농특세: 'agri_tax',
}

export interface ParsedWage {
  month: string | null // YYYY-MM
  pay_date: string | null
  name: string
  emp_no: string
  department: string
  hire_date: string | null
  amounts: Record<WageAmountKey, number>
  calc_notes: { category: string; method: string; amount: string }[]
  // PDF에 적힌 합계(검증용). 읽지 못하면 null.
  pdfPayTotal: number | null
  pdfDeductionTotal: number | null
  pdfNetPay: number | null
}

const NUM_RE = /^-?[\d,]+$/

function toNum(s: string): number {
  return Number(s.replace(/,/g, '')) || 0
}

function squash(s: string) {
  return s.replace(/\s+/g, '')
}

type Line = { y: number; tokens: { text: string; x: number }[] }

export function groupLines(items: PdfTextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; items: PdfTextItem[] }[] = []
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < 2)
    if (line) line.items.push(it)
    else lines.push({ y: it.y, items: [it] })
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const its = l.items.sort((a, b) => a.x - b.x)
      const tokens: { text: string; x: number; end: number }[] = []
      for (const it of its) {
        const last = tokens[tokens.length - 1]
        // 글자 단위로 쪼개진 숫자·한글은 글자 폭이 넉넉하게 잡혀 서로 겹친다(간격이 음수). 칸이 바뀌면
        // 간격이 벌어진다. 금액 바로 옆 칸 항목명("2,372,568" + "국민연금")은 간격이 3pt 남짓이라
        // 숫자 → 한글로 바뀌는 지점은 간격과 상관없이 끊는다.
        const digitToHangul = last && /[\d,]$/.test(last.text) && /^[가-힣]/.test(it.str)
        if (last && !digitToHangul && it.x - last.end < 1) {
          last.text += it.str
          last.end = Math.max(last.end, it.x + it.width)
        } else {
          tokens.push({ text: it.str, x: it.x, end: it.x + it.width })
        }
      }
      return { y: l.y, tokens: tokens.map((t) => ({ text: t.text.trim(), x: t.x })) }
    })
}

function normalizeDate(s: string): string | null {
  const m = s.replace(/\s+/g, '').match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

export function parseWageItems(items: PdfTextItem[]): ParsedWage {
  const lines = groupLines(items)
  const amounts = Object.fromEntries(Object.values(LABELS).map((k) => [k, 0])) as Record<WageAmountKey, number>
  const result: ParsedWage = {
    month: null,
    pay_date: null,
    name: '',
    emp_no: '',
    department: '',
    hire_date: null,
    amounts,
    calc_notes: [],
    pdfPayTotal: null,
    pdfDeductionTotal: null,
    pdfNetPay: null,
  }

  const fullText = lines.map((l) => l.tokens.map((t) => t.text).join(' ')).join('\n')
  const ym = fullText.match(/기준년월\s*:?\s*(\d{4})\s*년\s*(\d{1,2})\s*월/)
  if (ym) result.month = `${ym[1]}-${ym[2].padStart(2, '0')}`
  const pd = fullText.match(/지급일\s*:?\s*(\d{4}-\d{1,2}-\d{1,2})/) ?? fullText.match(/(\d{4}-\d{2}-\d{2})\s*지급일/)
  if (pd) result.pay_date = normalizeDate(pd[1])

  let calcHeaderY: number | null = null
  let footerY: number | null = null

  for (const line of lines) {
    const toks = line.tokens
    for (let i = 0; i < toks.length; i++) {
      const label = squash(toks[i].text)
      const next = toks[i + 1]?.text ?? ''
      const nextIsLabel = next !== '' && (squash(next) in LABELS || /^(직위|부서|사번|입사일|성명)$/.test(squash(next)))

      if (label === '성명' && next && !nextIsLabel) result.name = squash(next)
      else if (label === '사번' && next && !nextIsLabel) result.emp_no = squash(next)
      else if (label === '부서' && next && !nextIsLabel) result.department = next
      else if (label === '입사일' && next) result.hire_date = normalizeDate(next)
      else if (label in LABELS && NUM_RE.test(squash(next))) amounts[LABELS[label]] = toNum(squash(next))
      else if (label === '지급액계' && NUM_RE.test(squash(next))) result.pdfPayTotal = toNum(squash(next))
      else if (label === '공제액계' && NUM_RE.test(squash(next))) result.pdfDeductionTotal = toNum(squash(next))
      else if (label.startsWith('실수령액') && NUM_RE.test(squash(next))) result.pdfNetPay = toNum(squash(next))
    }
    const joined = squash(toks.map((t) => t.text).join(''))
    if (joined.includes('산출식또는산출방법')) calcHeaderY = line.y
    if (joined.startsWith('귀하의노고')) footerY = line.y
  }

  // 계산방법 표: "구분 / 산출식 또는 산출방법 / 지급액(원)" 헤더 아래부터 맺음말 위까지의 줄
  if (calcHeaderY !== null) {
    for (const line of lines) {
      if (line.y >= calcHeaderY) continue
      if (footerY !== null && line.y <= footerY) continue
      const texts = line.tokens.map((t) => t.text).filter(Boolean)
      if (texts.length === 0) continue
      const last = texts[texts.length - 1]
      const hasAmount = NUM_RE.test(squash(last))
      const body = hasAmount ? texts.slice(0, -1) : texts
      result.calc_notes.push({
        category: body[0] ?? '',
        method: body.slice(1).join(' '),
        amount: hasAmount ? squash(last) : '',
      })
    }
  }

  return result
}

// 파일명 "7_이예은_20261120261130.pdf" → { empNo: '7', name: '이예은' }
export function parseWageFileName(fileName: string): { empNo: string; name: string } {
  const base = fileName.replace(/\.pdf$/i, '')
  const parts = base.split('_')
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) return { empNo: parts[0], name: parts[1].trim() }
  return { empNo: '', name: '' }
}
