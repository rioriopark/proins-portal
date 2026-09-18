import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// 조직관리 > 회원 삭제(X 버튼)가 profiles 행을 클라이언트에서 직접 지우려 했는데, RLS가
// 본인 소유가 아닌 다른 사람의 profiles 행 삭제를 막고 있어 실제로는 지워지지 않던 문제를
// 고친다. 서비스 권한으로 대신 삭제한다. fullDelete가 true면(테스트 계정 정리용) 로그인
// 계정(auth) 자체도 함께 지운다 — 기본값은 기존 기능 의도대로 로그인 계정은 남기고 포털
// 접근(profiles)만 제거한다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const { targetProfileId, fullDelete } = req.body ?? {}
  if (!token || !targetProfileId) {
    return res.status(400).json({ error: '잘못된 요청입니다.' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return res.status(500).json({ error: '서버 환경변수(SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.' })
  }

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser(token)
  if (userError || !userData?.user) {
    return res.status(401).json({ error: '인증에 실패했습니다.' })
  }
  const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (callerProfile?.role !== 'hq_admin') {
    return res.status(403).json({ error: '본사관리자만 사용할 수 있습니다.' })
  }

  const adminClient = createClient(url, serviceKey)
  const { error: deleteProfileError } = await adminClient.from('profiles').delete().eq('id', targetProfileId)
  if (deleteProfileError) {
    return res.status(500).json({ error: deleteProfileError.message })
  }

  if (fullDelete) {
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(targetProfileId)
    if (deleteUserError) {
      return res.status(500).json({ error: deleteUserError.message })
    }
  }

  return res.status(200).json({ ok: true })
}
