export type Role = 'hq_admin' | 'branch_admin' | 'store_manager' | 'agent'

export const ROLE_LABEL: Record<Role, string> = {
  hq_admin: '본사관리자',
  branch_admin: '지사/센터관리자',
  store_manager: '지점관리자',
  agent: '담당자',
}

export const ROLE_RANK: Record<Role, number> = {
  hq_admin: 0,
  branch_admin: 1,
  store_manager: 2,
  agent: 3,
}

export type OrgType = 'HQ' | 'REGION' | 'CENTER' | 'STORE'

export interface Organization {
  id: string
  name: string
  type: OrgType
  parent_id: string | null
}

export interface Profile {
  id: string
  email: string
  name: string
  role: Role
  org_id: string
  title: string
  rate_long: number
  rate_general: number
  bank: string
  account: string
}

export type ContractCategory = '장기' | '일반' | '자동차'
export type ContractType = '신규' | '계속' | '환수' | '부활' | '비례공동'

export interface Contract {
  id: string
  agent_id: string | null
  agent_email: string | null
  month: string
  category: ContractCategory
  type: ContractType
  company: string
  product_name: string
  customer_name: string
  receipt_date: string | null
  count: number
  premium: number
  commission: number
  created_at: string
}

export interface Incentive {
  id: string
  company: string
  month: string
  title: string
  period: string
  target: string
  content: string
  created_at: string
  updated_at: string
}
