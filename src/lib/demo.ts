// 외부인 체험용 데모 배포에서만 켜는 플래그. 운영 배포(Vercel 운영 프로젝트)에는 절대 설정하지 말 것.
// 데모 배포는 운영과 분리된 별도 Supabase 프로젝트(가상 데이터)에 연결되어야 한다 — docs/DEMO.md 참고.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

// 로그인 화면의 "게스트로 체험하기" 버튼이 쓰는 데모 DB의 게스트 계정
export const DEMO_GUEST_ID = import.meta.env.VITE_DEMO_GUEST_ID ?? ''
export const DEMO_GUEST_PASSWORD = import.meta.env.VITE_DEMO_GUEST_PASSWORD ?? ''

export const DEMO_BLOCKED_MESSAGE = '체험판에서는 사용할 수 없는 기능입니다.'
