import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// 직원 초대 시 pending_invites만 만들고 본인이 직접 회원가입(비밀번호 설정)해야 하던 방식 대신,
// 관리자가 초대장을 발급하는 즉시 아이디/비밀번호를 모두 사번으로 하는 실제 계정을 만들어서
// 바로 로그인할 수 있게 한다.
function toAuthEmail(idOrEmail: string): string {
  const v = idOrEmail.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@proins.local`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const { id, name, role, org_id, title, rate_long, rate_general, bank, account } = req.body ?? {}
  if (!token || !id || !name || !role || !org_id) {
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

  const password = String(id).trim().toLowerCase()
  if (password.length < 6) {
    return res.status(400).json({ error: '아이디가 6자 미만이라 비밀번호로 사용할 수 없습니다.' })
  }
  const email = toAuthEmail(id)

  const adminClient = createClient(url, serviceKey)
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !created?.user) {
    return res.status(400).json({ error: createError?.message ?? '계정 생성에 실패했습니다.' })
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: created.user.id,
    email,
    name,
    role,
    org_id,
    title: title ?? '',
    rate_long: rate_long ?? 1,
    rate_general: rate_general ?? 1,
    bank: bank ?? '',
    account: account ?? '',
  })
  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id)
    return res.status(500).json({ error: '프로필 생성 실패: ' + profileError.message })
  }

  return res.status(200).json({ ok: true })
}
