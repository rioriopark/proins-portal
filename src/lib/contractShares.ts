import { supabase } from './supabase'
import type { CoInsurerShare, Contract } from './types'

// 비례공동 수수료 분배(보험사 + 증권번호 단위, supabase/contract-shares.sql).
// 같은 증권번호로 들어오는 모든 확정 계약 행(신규·분급·계속·환수 등)에 비율대로 나눠 적용한다.
export interface ContractShare {
  id: string
  company: string
  policy_no: string
  shares: CoInsurerShare[]
  agent_ids: string[]
  updated_at: string
}

// 보험사는 표기가 달라도(삼성 / 삼성화재) 맞도록 앞 2글자 + 증권번호로 매칭한다.
// 자동확정(auto_confirm_preliminary_contracts)과 같은 기준이다.
export function shareKey(company: string | null | undefined, policyNo: string | null | undefined): string | null {
  const p = policyNo?.trim()
  if (!p) return null
  return `${(company ?? '').trim().slice(0, 2)}|${p}`
}

export type ShareMap = Map<string, ContractShare>

export function buildShareMap(rows: ContractShare[]): ShareMap {
  const map: ShareMap = new Map()
  for (const r of rows) {
    const key = shareKey(r.company, r.policy_no)
    if (key && Array.isArray(r.shares) && r.shares.length > 0) map.set(key, r)
  }
  return map
}

export function findShare(map: ShareMap, c: Pick<Contract, 'company' | 'policy_no'>): ContractShare | undefined {
  const key = shareKey(c.company, c.policy_no)
  return key ? map.get(key) : undefined
}

export async function fetchContractShares(): Promise<ContractShare[]> {
  const { data, error } = await supabase.from('contract_shares').select('*')
  if (error) {
    // 테이블이 아직 없으면(SQL 미적용) 분배 없이 기존처럼 동작한다.
    console.warn('비례공동 분배 조회 실패:', error.message)
    return []
  }
  return (data as ContractShare[]) ?? []
}

export async function saveContractShare(company: string, policyNo: string, shares: CoInsurerShare[]) {
  return supabase
    .from('contract_shares')
    .upsert({ company: company.trim(), policy_no: policyNo.trim(), shares }, { onConflict: 'company,policy_no' })
}

export async function deleteContractShare(id: string) {
  return supabase.from('contract_shares').delete().eq('id', id)
}

// 분배가 적용된 계약 행. share_ratio는 이 담당자 몫(0~1), original은 분배 전 원본 행.
export type SharedContract = Contract & { share_ratio?: number; original?: Contract }

function scale(c: Contract, agentId: string, ratio: number): SharedContract {
  const r = ratio / 100
  return {
    ...c,
    agent_id: agentId,
    premium: c.premium * r,
    commission: c.commission * r,
    performance_commission: c.performance_commission * r,
    count: c.count * r,
    share_ratio: r,
    original: c,
  }
}

// 분배가 걸린 계약을 담당자별 몫으로 나눈다(합계는 원본과 같다). 분배가 없는 계약은 그대로 둔다.
// 예비계약·변경 이력은 나누지 않는다.
export function expandShares(contracts: Contract[], map: ShareMap): SharedContract[] {
  if (map.size === 0) return contracts
  const out: SharedContract[] = []
  for (const c of contracts) {
    const share = !c.is_preliminary && c.type !== '변경' ? findShare(map, c) : undefined
    if (!share) {
      out.push(c)
      continue
    }
    for (const s of share.shares) out.push(scale(c, s.agent_id, Number(s.ratio) || 0))
  }
  return out
}
