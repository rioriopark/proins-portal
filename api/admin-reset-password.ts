import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// 대상자의 로그인 아이디(이메일의 '@proins.local' 앞부분, 실제 이메일이면 이메일 전체)를
// 그대로 새 비밀번호로 사용한다.
function idFromEmail(email: string): string {
  return email.endsWith('@proins.local') ? email.slice(0, -'@proins.local'.length) : email
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const { targetProfileId } = req.body ?? {}
  if (!token || !targetProfileId) {
    return res.status(400).json({ error: '잘못된 요청입니다.' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return res.status(500).json({ error: '서버 환경변수(SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.' })
  }

  // 요청자 신원 및 권한 확인 (요청자 본인 토큰으로 조회 — RLS가 본인 행 조회는 항상 허용)
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser(token)
  if (userError || !userData?.user) {
    return res.status(401).json({ error: '인증에 실패했습니다.' })
  }
  const { data: callerProfile } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (callerProfile?.role !== 'hq_admin') {
    return res.status(403).json({ error: '본사관리자만 사용할 수 있습니다.' })
  }

  // service role 클라이언트로 대상자 조회 및 비밀번호 초기화
  const adminClient = createClient(url, serviceKey)
  const { data: targetProfile, error: targetError } = await adminClient
    .from('profiles')
    .select('id, email')
    .eq('id', targetProfileId)
    .maybeSingle()
  if (targetError || !targetProfile) {
    return res.status(404).json({ error: '대상자를 찾을 수 없습니다.' })
  }

  const newPassword = idFromEmail(targetProfile.email)
  if (newPassword.length < 6) {
    return res.status(400).json({ error: '아이디가 6자 미만이라 비밀번호로 사용할 수 없습니다.' })
  }

  const { error: resetError } = await adminClient.auth.admin.updateUserById(targetProfile.id, {
    password: newPassword,
  })
  if (resetError) {
    return res.status(500).json({ error: resetError.message })
  }

  return res.status(200).json({ ok: true })
}
