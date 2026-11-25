// 한국 전화번호를 표준 하이픈 형식으로 맞춘다.
// 예) 07046523096, 070-46523096 → 070-4652-3096 / 0212345678 → 02-1234-5678 / 15881234 → 1588-1234
// 숫자·하이픈·공백·점·괄호 외의 글자(내선 표기 등)가 섞였거나 자릿수가 맞지 않으면 원래 값을 그대로 둔다.
function formatOne(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || !/^[\d\s\-.()]+$/.test(trimmed)) return trimmed
  const d = trimmed.replace(/\D/g, '')

  // 서울 02
  if (d.startsWith('02')) {
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`
    return trimmed
  }
  // 대표번호 15xx·16xx·18xx (8자리)
  if (/^1[5-9]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`
  // 0505 등 평생번호 (12자리)
  if (/^050\d/.test(d) && d.length === 12) return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`
  // 지역번호 0xx, 휴대폰 01x, 인터넷전화 070 등
  if (d.startsWith('0')) {
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
    if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
  }
  return trimmed
}

// 콤마로 여러 번호를 적은 경우 각각 포맷한다.
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .split(',')
    .map(formatOne)
    .filter(Boolean)
    .join(', ')
}
