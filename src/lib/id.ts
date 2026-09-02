// 직원 로그인 아이디를 이메일 형식으로 변환합니다.
// 이미 이메일이면 그대로, 아이디만 입력했으면 내부용 도메인을 붙입니다.
export function toAuthEmail(idOrEmail: string): string {
  const v = idOrEmail.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@proins.local`
}
