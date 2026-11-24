import type { Contract } from './types'

// 보험사 파일의 원본 "구분" 값은 포털 표준값(신규/계속/환수/부활/비례공동/변경)과 표기가 다른 경우가
// 있다(예: 삼성화재 계약상태 "신계약"). 같은 뜻의 다른 표기를 표준값으로 맞춘다.
const TYPE_ALIASES: Record<string, string> = {
  신계약: '신규',
  신규계약: '신규',
  계속계약: '계속',
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

// 집계(업적현황·수수료 자동계산)용 계약 구분. DB의 원본 값은 바꾸지 않고 읽을 때만 해석한다
// — 일괄등록 upsert 중복 판정 키에 type이 들어 있어, 저장값을 바꾸면 같은 파일 재업로드 시
// 기존 행과 겹치지 않고 중복으로 들어갈 수 있기 때문이다.
//
// 장기 계약인데 구분이 비어 있으면(예: KB손보 파일엔 구분 열이 없다) 금액과 날짜로 판단한다.
// - 건별수수료가 음수면 환수
// - 지급월이 계약월(보험시기) 기준 1개월 이내면 신규(모집초회 지급 시점 = 신계약)
// - 그 외(2개월 이후 지급분)는 계속
// 보험시기가 없어 판단할 수 없으면 빈 값 그대로 둔다.
export function effectiveContractType(
  c: Pick<Contract, 'category' | 'type' | 'commission' | 'receipt_date' | 'month'>,
): string {
  const raw = (c.type ?? '').trim()
  if (raw) return TYPE_ALIASES[raw] ?? raw
  if (c.category !== '장기') return raw
  if (c.commission < 0) return '환수'
  if (!c.receipt_date || !c.month) return raw
  const offset = monthsBetween(c.receipt_date.slice(0, 7), c.month)
  if (Number.isNaN(offset)) return raw
  return offset <= 1 ? '신규' : '계속'
}
