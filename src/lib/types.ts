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

// 본사(hq) 소속이 아닌 일반 담당자(agent)는 위촉 계약을 맺은 설계사이므로 "위촉직 설계사"로 구분해 보여준다.
export function roleDisplayLabel(role: Role, orgId: string): string {
  if (role === 'agent' && orgId !== 'hq') return '위촉직 설계사'
  return ROLE_LABEL[role]
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
export type ContractType = '신규' | '계속' | '환수' | '부활' | '비례공동' | '변경'

export interface Contract {
  id: string
  agent_id: string | null
  agent_email: string | null
  month: string
  category: ContractCategory
  type: ContractType
  company: string
  policy_no: string | null
  product_name: string
  customer_name: string
  insured_name: string | null
  receipt_date: string | null
  expiry_date: string | null
  collection_status: string | null
  count: number
  premium: number
  commission: number
  performance_commission: number
  renewal_status: string | null
  memo: string | null
  is_preliminary: boolean
  created_at: string
  co_insurers: CoInsurerShare[] | null
  duration_type: string | null
  change_reason: string | null
  prior_contract_id: string | null
}

// 비례공동 계약: 수수료를 나눠 가질 담당자와 비율(%, 합계 100)
export interface CoInsurerShare {
  agent_id: string
  name: string
  ratio: number
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

// 포털 항목별 수정권한 부여 대상 메뉴 (조직관리는 권한 상승 위험으로 제외, hq_admin 전용 유지)
export const MENU_OPTIONS: { key: string; label: string }[] = [
  { key: 'contracts', label: '계약관리(관리자기능)' },
  { key: 'bulk_import', label: '계약 일괄등록' },
  { key: 'statement', label: '수수료명세서' },
  { key: 'incentives', label: '보험사 시상안' },
  { key: 'work_contacts', label: '업무 연락처' },
  { key: 'wage_statement', label: '임금명세서' },
]

// 보험사 마스터 목록: 본사(org_id='hq')만 이름/순서를 등록·수정할 수 있다.
export interface Insurer {
  id: string
  name: string
  sort_order: number
  // 대리점이 해당 보험사와 유지하는 영업보증·선지급이행보증 보험의 만료일(YYYY-MM-DD). 미가입/미입력 시 null.
  business_guarantee_expiry: string | null
  advance_guarantee_expiry: string | null
  created_at: string
}
// 담당자 개인의 보험사별 코드(사번/비밀번호). insurer_id로 insurers를 참조한다.
export interface AgentInsurerCode {
  id: string
  profile_id: string
  insurer_id: string
  code: string
  code_auth: string
  created_at: string
  updated_at: string
}
export interface LicenseInfo {
  name: string
  valid_until: string
}
export interface EducationRecord {
  course: string
  completed_date: string
}
export interface TerminationRecord {
  date: string
  reason: string
}
export interface AgentProfile {
  profile_id: string
  phone: string
  address: string
  email: string
  registration_no: string
  licenses: LicenseInfo[]
  education_records: EducationRecord[]
  updated_at: string
}

// 사이트 아이디정보: 개인 프로필이 아니라 본사(org_id='hq') 전체가 공유하는 자료라 별도 테이블로 둔다.
export interface SharedSiteAccount {
  id: string
  site: string
  login_id: string
  password: string
  updated_by: string | null
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

// 보험사 대표사번/비밀번호(대표관리자·본사담당자 전체 공유). insurer_id로 insurers를 참조한다.
export interface InsurerAccount {
  id: string
  insurer_id: string
  login_id: string
  password: string
  memo: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface SiteAccount {
  id: string
  site_name: string
  login_id: string
  password: string
  sort_order: number
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

export interface BoardPost {
  id: string
  title: string
  content: string
  author_id: string | null
  author_name: string
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
