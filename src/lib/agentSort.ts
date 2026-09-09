import type { OrgType, Organization } from './types'

// 담당자 목록 노출 우선순위: 조직(본사>직영>지점) > 직급 > 사번.
// 조직관리(Orgs.tsx)의 직급 추천 목록과 같은 순서를 그대로 우선순위로 쓴다.
export const AGENT_GRADES = [
  '지사장', '본부장', '지점장', '지점장(직영, 인큐)', '지점장(직영, 선임)',
  '본부장(직영사업단)', '직영대표', 'FC_마스터', 'FC_엘리트', 'FC_프로', 'FC',
]

export const ORG_TYPE_PRIORITY: Record<OrgType, number> = { HQ: 0, REGION: 1, CENTER: 2, STORE: 3 }

export function orgPriority(orgId: string, orgsById: Map<string, Organization>): number {
  const type = orgsById.get(orgId)?.type
  return type ? ORG_TYPE_PRIORITY[type] : 99
}

export function titleRank(title: string): number {
  const idx = AGENT_GRADES.indexOf(title)
  if (idx >= 0) return idx
  const found = AGENT_GRADES.findIndex((g) => title && title.includes(g))
  return found >= 0 ? found : AGENT_GRADES.length
}

// 담당자 이메일이 "{사번}@proins.local" 형식이면 사번(숫자)을 뽑아 정렬 기준으로 쓴다.
export function agentCode(email: string): string {
  const m = email.match(/^(\d+)@/)
  return m ? m[1] : email
}

export function compareAgentCode(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== '') return na - nb
  return a.localeCompare(b)
}

export interface AgentSortInfo {
  org_id: string
  title: string
  email: string
}

// 조직 > 직급 > 사번 순으로 비교한다. 같은 소속(org_id)끼리는 붙어서 표시되도록 org_id도 함께 비교한다.
export function compareByOrgGradeCode(a: AgentSortInfo, b: AgentSortInfo, orgsById: Map<string, Organization>): number {
  const pa = orgPriority(a.org_id, orgsById)
  const pb = orgPriority(b.org_id, orgsById)
  if (pa !== pb) return pa - pb
  if (a.org_id !== b.org_id) return a.org_id.localeCompare(b.org_id)
  const ra = titleRank(a.title)
  const rb = titleRank(b.title)
  if (ra !== rb) return ra - rb
  return compareAgentCode(agentCode(a.email), agentCode(b.email))
}
