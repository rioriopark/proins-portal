import type { VercelRequest, VercelResponse } from '@vercel/node'

// Supabase 무료 플랜은 7일 동안 요청이 없으면 프로젝트를 일시정지하고, 그러면 체험판의
// "게스트로 체험하기"가 로그인 오류로 막힌다. Vercel Cron이 매일 이 함수를 불러 데모 DB에
// 가벼운 요청을 하나 보내 멈추지 않게 한다. 운영 배포(DEMO_MODE 아님)에서는 아무것도 하지 않는다.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (process.env.DEMO_MODE !== 'true') {
    return res.status(204).end()
  }

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return res.status(500).json({ error: '서버 환경변수(VITE_SUPABASE_URL)가 설정되지 않았습니다.' })
  }

  const r = await fetch(`${url}/rest/v1/banners?select=id&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  return res.status(r.ok ? 200 : 502).json({ supabase: r.status })
}
