// 직원 로그인 아이디를 이메일 형식으로 변환합니다.
// 이미 이메일이면 그대로, 아이디만 입력했으면 내부용 도메인을 붙입니다.
export function toAuthEmail(idOrEmail: string): string {
  const v = idOrEmail.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@proins.local`
}

// Supabase Storage 객체 키는 한글·공백이 섞이면 "Invalid key" 오류가 나므로, 원본 파일명은
// 별도 컬럼(file_name 등)에 그대로 남기고 저장 경로(key)는 확장자만 살려서 안전하게 만든다.
export function safeStorageFileName(name: string): string {
  const match = name.match(/\.[a-zA-Z0-9]{1,8}$/)
  const ext = match ? match[0] : ''
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
}
