import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

// 보험사 시상안 이미지/PDF를 업로드하면 표에 흩어진 시상 조건을 관리자가 일일이 옮겨 적지 않아도
// 되도록, 이미지를 읽어 등록 폼 항목(보험사/지급월/제목/기간/대상/내용)으로 정리해준다.
const IncentiveFields = z.object({
  company: z.string().describe('보험사명 (예: DB손해보험, 삼성화재)'),
  month: z.string().describe('시상금 지급월. YYYY-MM 형식. 명확하지 않으면 빈 문자열.'),
  title: z.string().describe('시상안 제목 (예: DB손해보험 조기가동 특별시상)'),
  period: z.string().describe('시상 대상 기간 (예: 2026.09.01 ~ 09.06). 여러 항목이면 대표 기간 하나.'),
  target: z.string().describe('대상 상품/조건 요약 (예: 인보험(펫, 단체, 실손 외))'),
  content: z
    .string()
    .describe(
      '이미지/PDF에 있는 모든 시상 항목과 구간별 실적·시상금을 빠짐없이 읽기 쉬운 여러 줄 텍스트로 정리. ' +
        '항목이 여러 개면 각 항목을 줄바꿈으로 구분하고 소제목을 붙일 것. 원본에 있는 숫자·비율·조건을 요약하지 말고 그대로 옮길 것.',
    ),
})

const MAX_BASE64_LENGTH = 28_000_000 // 대략 21MB 원본(base64는 원본의 약 4/3배) 이내로 제한

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const { fileData, mediaType } = req.body ?? {}
  if (!token || !fileData || !mediaType) {
    return res.status(400).json({ error: '잘못된 요청입니다.' })
  }
  if (typeof fileData !== 'string' || fileData.length > MAX_BASE64_LENGTH) {
    return res.status(400).json({ error: '파일이 너무 큽니다.' })
  }
  const isImage = typeof mediaType === 'string' && mediaType.startsWith('image/')
  const isPdf = mediaType === 'application/pdf'
  if (!isImage && !isPdf) {
    return res.status(400).json({ error: '이미지 또는 PDF 파일만 지원합니다.' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!url || !anonKey) {
    return res.status(500).json({ error: '서버 환경변수(Supabase)가 설정되지 않았습니다.' })
  }
  if (!anthropicKey) {
    return res.status(500).json({ error: '서버 환경변수(ANTHROPIC_API_KEY)가 설정되지 않았습니다.' })
  }

  // 요청자 신원 및 권한 확인 (시상안 등록 권한이 있는 사람만 AI 분석을 쓸 수 있게 한다)
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser(token)
  if (userError || !userData?.user) {
    return res.status(401).json({ error: '인증에 실패했습니다.' })
  }
  const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (!callerProfile) {
    return res.status(403).json({ error: '권한이 없습니다.' })
  }
  if (callerProfile.role === 'agent') {
    const { data: grant } = await callerClient
      .from('menu_permissions')
      .select('menu_key')
      .eq('profile_id', userData.user.id)
      .eq('menu_key', 'incentives')
      .maybeSingle()
    if (!grant) {
      return res.status(403).json({ error: '시상안 등록 권한이 없습니다.' })
    }
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey })
  const fileBlock = isPdf
    ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } } as const)
    : ({ type: 'image', source: { type: 'base64', media_type: mediaType, data: fileData } } as const)

  try {
    const response = await anthropic.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            fileBlock,
            {
              type: 'text',
              text: '첨부된 보험사 시상안(프로모션 공지) 이미지/PDF를 읽고 등록 폼에 넣을 내용으로 정리해줘.',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(IncentiveFields) },
    })

    if (!response.parsed_output) {
      return res.status(502).json({ error: 'AI 분석 결과를 해석하지 못했습니다.' })
    }
    return res.status(200).json(response.parsed_output)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    return res.status(502).json({ error: 'AI 분석 실패: ' + message })
  }
}
