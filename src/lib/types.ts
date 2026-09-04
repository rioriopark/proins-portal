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
  file_url: string | null
  file_name: string | null
  created_at: string
  updated_at: string
}

// 포털 항목별 수정권한 부여 대상 메뉴 (조직관리/정보관리는 권한 상승 위험으로 제외, hq_admin 전용 유지)
export const MENU_OPTIONS: { key: string; label: string }[] = [
  { key: 'contracts', label: '계약관리(관리자기능)' },
  { key: 'bulk_import', label: '계약 일괄등록' },
  { key: 'statement', label: '수수료명세서' },
  { key: 'incentives', label: '보험사 시상안' },
  { key: 'work_contacts', label: '업무 연락처' },
  { key: 'wage_statement', label: '임금명세서' },
]

export interface CompanyCode { company: string; code: string }
export interface LicenseInfo { name: string; valid_until: string }
export interface EducationRecord { course: string; completed_date: string }
export interface TerminationRecord { date: string; reason: string }

export interface AgentProfile {
  profile_id: string
  phone: string
  address: string
  email: string
  company_codes: CompanyCode[]
  registration_no: string
  licenses: LicenseInfo[]
  education_records: EducationRecord[]
  updated_at: string
}

export interface AgentContract {
  profile_id: string
  appointment_date: string | null
  contract_file_path: string | null
  contract_file_name: string | null
  termination_history: TerminationRecord[]
  updated_at: string
}

export interface Banner {
  id: string
  title: string
  content: string
  start_date: string | null
  end_date: string | null
  target_profile_ids: string[]
  sort_order: number
  created_at: string
  updated_at: string
}

export interface InsurerAccount {
  id: string
  company: string
  login_id: string
  password: string
  memo: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface EducationEvent {
  id: string
  title: string
  event_date: string
  event_time: string
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  category: string
  company: string
  name: string
  title: string
  phone: string
  office_phone: string
  fax: string
  business: string
  email: string
  note: string
  sort_order: number
  // '임직원' 행이 나의공간(agent_profiles)과 자동 연동된 경우에만 값이 있음
  profile_id?: string | null
}

export interface WageCalcNote {
  category: string
  method: string
  amount: string
}

export interface WageStatement {
  id: string
  profile_id: string | null
  month: string
  pay_date: string | null
  emp_no: string
  department: string
  hire_date: string | null
  base_salary: number
  position_allowance: number
  meal_allowance: number
  bonus: number
  car_allowance: number
  national_pension: number
  health_insurance: number
  longterm_care_insurance: number
  employment_insurance: number
  health_insurance_settlement: number
  care_insurance_settlement: number
  advance_payment: number
  durunuri_pension: number
  durunuri_employment: number
  income_tax: number
  local_income_tax: number
  agri_tax: number
  calc_notes: WageCalcNote[]
  updated_at: string
}

export interface Statement {
  id: string
  agent_id: string | null
  agent_email: string
  month: string
  recruit_first: number
  recruit_installment: number
  maintain: number
  clawback_revive: number
  general: number
  auto: number
  mgmt_fee: number
  collection_fee: number
  personal_incentive: number
  corporate_incentive: number
  general_performance: number
  other_incentive: number
  taxable_income: number
  industrial_accident_ins: number
  employment_ins: number
  employment_ins_support: number
  income_tax: number
  resident_tax: number
  incentive_offset: number
  other_deduction: number
  hq_support_offset: number
  workplace_cost: number
  unit_cost: number
  risk_reserve: number
  loan: number
  updated_at: string
}
