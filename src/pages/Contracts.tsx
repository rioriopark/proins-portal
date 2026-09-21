import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, ContractCategory, ContractType, CoInsurerShare, Organization, Profile } from '../lib/types'
import { agentCode, compareAgentCode, compareByOrgGradeCode, ORG_TYPE_PRIORITY, topLevelOrgId } from '../lib/agentSort'

const CATEGORIES: ContractCategory[] = ['장기', '일반', '자동차']
const TYPES: ContractType[] = ['신규', '계속', '환수', '부활', '비례공동', '변경']
// 신규계약 폼의 "구분"에서 직접 고를 수 있는 값. "변경"은 [계약변경] 창에서 기계약을 불러와야만 만들어진다.
const MANUAL_TYPES = TYPES.filter((t) => t !== '변경')
// 예비계약(비관리자 셀프 등록) 폼의 "구분": 비례공동(수수료 분배)과 변경은 관리자 전용 절차라서 제외한다.
const SELF_REPORT_TYPES = MANUAL_TYPES.filter((t) => t !== '비례공동')
// 계약변경 사유. 기간변경/보험료변동은 증감액을, 임의해지는 원 계약을 상쇄하는 마이너스 금액을 입력한다.
const CHANGE_REASONS = ['계약기간변경', '임의해지', '보험료변동', '기타'] as const

// 종목별로 선택 가능한 기간구분(납입/보험기간).
const DURATION_OPTIONS: Record<ContractCategory, string[]> = {
  장기: ['3년', '5년', '10년', '15년', '20년', '25년', '30년', '세만기'],
  일반: ['년간', '기간'],
  자동차: ['년간', '기간'],
}

interface Invite {
  email: string
  name: string
  org_id: string
  title: string
  rate_long: number
  rate_general: number
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// 신규계약은 등록 시점 기준 이번 달 안에서만 영수일을 입력할 수 있도록 범위를 제한한다.
function monthStart() {
  return `${today().slice(0, 7)}-01`
}
function monthEnd() {
  const [y, m] = today().slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
// 신규계약은 보험사에서 계약월 익월에 비례수수료를 확정 지급하므로, 월말에 접수된 계약은
// 담당자가 다음 달이 돼서야 입력하는 경우가 흔하다. 그런 건도 놓치지 않고 수수료명세에서
// 보험사 확정 계약과 비교할 수 있도록 전월 영수일까지는 입력을 허용한다.
function prevMonthStart() {
  const [y, m] = today().slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
}

export default function Contracts() {
  const { profile, permissions } = useAuth()
  // 관리자 직급(지사장/본부장/지점장 등 직함)은 본사관리자와 동일하게 관리자급 계약 기능을 쓴다.
  const MANAGER_TITLE_KEYWORDS = ['지사장', '본부장', '지점장']
  const isManagerTitle = MANAGER_TITLE_KEYWORDS.some((k) => (profile?.title ?? '').includes(k))
  // 계약 등록(신규계약)은 기본적으로 본사관리자·본사담당자(소속이 본사인 담당자)·관리자 직급만 할 수
  // 있고, 그 외 개별적으로 "계약관리" 권한을 부여받은 사람(조직관리에서 지정)도 예외적으로 가능하다.
  const canManage =
    profile?.role === 'hq_admin' ||
    (profile?.role === 'agent' && profile.org_id === 'hq') ||
    isManagerTitle ||
    permissions.has('contracts')
  // 관리자(canManage)가 아닌 모든 임직원(위촉직 설계사, 개별 권한 없는 지사/지점 관리자 등)은
  // 수수료를 직접 입력할 수 없는 대신, 본인 앞으로 "예비계약"을 셀프 등록할 수 있다.
  const canSelfReport = !!profile && !canManage
  // 본사담당자(소속이 본사인 일반 담당자, 본사관리자는 제외)는 임금 기반이라 건별수수료를 보지 않는다.
  const isHqStaff = profile?.role === 'agent' && profile.org_id === 'hq'
  // 예비계약 확인 목록의 기본 펼침 상태 구분용: 본사관리자/개별 계약관리 권한 부여자는 "관리자"로 보고
  // 조직 단위 그룹까지만 펼쳐서 보여주고(담당자별 세부내역은 접어둠), 그 외(본사담당자·위촉직 설계사)는
  // 본인 계약이 속한 담당자 그룹만 펼쳐서 보여준다.
  const isAdminViewer = profile?.role === 'hq_admin' || permissions.has('contracts')
  // 성과수수료는 관리자 직급(본사관리자, 지사장/본부장/지점장 등 직함)에게만 보여준다.
  const canSeePerformanceCommission = profile?.role === 'hq_admin' || isManagerTitle
  // 비례공동 계약 등록은 관리자(본사관리자, 지사장/본부장/지점장 등 직함)만 할 수 있다.
  const canUseCoInsurance = canSeePerformanceCommission
  // 신규계약 입력창의 "담당자" 지정 칸은 본사 담당자·본사관리자·지사장·본부장·지점장만 보고 바꿀 수
  // 있고, 그 외(개별 계약관리 권한만 받은 사람 등)는 이 칸 없이 나머지 항목만 보며 본인 명의로 등록한다.
  const canPickAgent = profile?.org_id === 'hq' || isManagerTitle
  const formTypes = canUseCoInsurance ? MANUAL_TYPES : MANUAL_TYPES.filter((t) => t !== '비례공동')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<'전체' | ContractCategory>('전체')
  const [typeFilter, setTypeFilter] = useState<'전체' | ContractType>('전체')
  const [monthFilter, setMonthFilter] = useState<string>('전체')
  const [search, setSearch] = useState('')
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set())
  const [openCompanies, setOpenCompanies] = useState<Set<string>>(new Set())
  const [newContractOpen, setNewContractOpen] = useState(false)
  const [form, setForm] = useState({
    agent_id: profile?.id ?? '',
    receipt_date: today(),
    category: '일반' as ContractCategory,
    type: '신규' as ContractType,
    duration_type: '',
    company: '',
    policy_no: '',
    customer_name: '',
    insured_name: '',
    premium: 0,
  })
  // 종목(장기/일반/자동차) 선택 시, 그에 맞는 기간구분(3년/5년/... 또는 년간/기간)을 고르는 창.
  // 관리자용 신규계약 폼('manager')과 셀프등록 폼('self') 중 어느 쪽에서 열렸는지 구분해서 처리한다.
  const [durationModalOpen, setDurationModalOpen] = useState<'manager' | 'self' | null>(null)
  // 비례공동(구분) 계약: 수수료를 나눠 가질 담당자·비율을 고르는 창.
  // coInsurers는 확정 저장된 분배안, shareDraft는 창 안에서 편집 중인 임시본.
  const [coInsurers, setCoInsurers] = useState<CoInsurerShare[]>([])
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareDraft, setShareDraft] = useState<CoInsurerShare[]>([])
  const shareTotal = shareDraft.reduce((s, r) => s + (Number(r.ratio) || 0), 0)
  function openShareModal() {
    setShareDraft(
      coInsurers.length > 0
        ? coInsurers
        : [
            {
              agent_id: form.agent_id,
              name: agents.find((a) => a.id === form.agent_id)?.name ?? '',
              ratio: 100,
            },
          ],
    )
    setShareModalOpen(true)
  }
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<{
    inserted: number
    failed: number
    errorMessage?: string
  } | null>(null)
  const [selfReportOpen, setSelfReportOpen] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [autoConfirmBusy, setAutoConfirmBusy] = useState(false)
  const [autoConfirmMsg, setAutoConfirmMsg] = useState<string | null>(null)
  const [openPrelimGroups, setOpenPrelimGroups] = useState<Set<string>>(new Set())
  const [editingPrelimId, setEditingPrelimId] = useState<string | null>(null)
  const [prelimEditForm, setPrelimEditForm] = useState({
    policy_no: '',
    customer_name: '',
    premium: 0,
  })
  const [selfForm, setSelfForm] = useState({
    receipt_date: today(),
    category: '장기' as ContractCategory,
    type: '신규' as ContractType,
    duration_type: '',
    company: '',
    policy_no: '',
    customer_name: '',
    insured_name: '',
    premium: 0,
  })

  // 계약변경(배서): 이미 등록된 확정 계약을 증권번호로 불러와 계약기간변경·임의해지·보험료변동 등의
  // 변경 내역을 "변경증권" 이력 행으로 저장한다. 원 계약 행은 건드리지 않고, 증감액만 새 행에 남긴다.
  const [changeOpen, setChangeOpen] = useState(false)
  const [policyLookup, setPolicyLookup] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupResults, setLookupResults] = useState<Contract[]>([])
  const [lookupError, setLookupError] = useState('')
  const [selectedOriginal, setSelectedOriginal] = useState<Contract | null>(null)
  const [changeForm, setChangeForm] = useState({
    reason: CHANGE_REASONS[0] as (typeof CHANGE_REASONS)[number],
    receipt_date: today(),
    premium_delta: 0,
    commission_delta: 0,
    duration_type: '',
    expiry_date: '',
    memo: '',
  })

  async function lookupPolicy() {
    const policyNo = policyLookup.trim()
    if (!policyNo) return
    setLookupBusy(true)
    setLookupError('')
    setLookupResults([])
    setSelectedOriginal(null)
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('policy_no', policyNo)
      .eq('is_preliminary', false)
      .order('receipt_date', { ascending: false })
    setLookupBusy(false)
    if (error) {
      setLookupError('조회 실패: ' + error.message)
      return
    }
    if (!data || data.length === 0) {
      setLookupError('해당 증권번호의 확정 계약을 찾을 수 없습니다.')
      return
    }
    setLookupResults(data)
  }

  function selectOriginal(c: Contract) {
    setSelectedOriginal(c)
    setChangeForm({
      reason: CHANGE_REASONS[0],
      receipt_date: today(),
      premium_delta: 0,
      commission_delta: 0,
      duration_type: c.duration_type ?? '',
      expiry_date: c.expiry_date ?? '',
      memo: '',
    })
  }

  async function handleChangeSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedOriginal) return
    if (changeForm.receipt_date < prevMonthStart() || changeForm.receipt_date > monthEnd()) {
      alert('계약변경은 지난달 또는 이번 달 처리일로만 등록할 수 있습니다.')
      return
    }
    const { error } = await supabase.from('contracts').insert({
      agent_id: selectedOriginal.agent_id,
      agent_email: selectedOriginal.agent_email,
      month: changeForm.receipt_date.slice(0, 7),
      receipt_date: changeForm.receipt_date,
      category: selectedOriginal.category,
      type: '변경',
      change_reason: changeForm.reason,
      prior_contract_id: selectedOriginal.id,
      company: selectedOriginal.company,
      policy_no: selectedOriginal.policy_no,
      product_name: selectedOriginal.product_name,
      customer_name: selectedOriginal.customer_name,
      insured_name: selectedOriginal.insured_name,
      duration_type: changeForm.duration_type || selectedOriginal.duration_type,
      expiry_date: changeForm.expiry_date || selectedOriginal.expiry_date,
      // 변경 이력은 신규 계약 건수로 잡히지 않도록 건수는 0으로 둔다.
      count: 0,
      premium: changeForm.premium_delta,
      commission: changeForm.commission_delta,
      memo: changeForm.memo || null,
      is_preliminary: false,
    })
    if (!error) {
      setPolicyLookup('')
      setLookupResults([])
      setSelectedOriginal(null)
      load()
    } else {
      alert('저장 실패: ' + error.message)
    }
  }

  async function load() {
    setLoading(true)
    const c = await fetchAllRows<Contract>((from, to) =>
      supabase
        .from('contracts')
        .select('*')
        .order('receipt_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to),
    )
    setContracts(c)
    // 담당자 이름 표시(agentInfo)에 필요해서 canManage 여부와 무관하게 항상 가져온다.
    // RLS가 실제 조회 범위를 이미 제한한다(본사는 전체, 지사/지점 관리자는 하위 조직, 일반 담당자는 본인만).
    const { data: p } = await supabase.from('profiles').select('*').order('name')
    setAgents(p ?? [])
    const { data: i } = await supabase.from('pending_invites').select('email, name, org_id, title, rate_long, rate_general')
    setInvites(i ?? [])
    const { data: o } = await supabase.from('organizations').select('*')
    setOrgs(o ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, canManage])

  // 예비계약 자동확정: 같은 보험사+증권번호로 이미 확정 계약이 들어와 있는 예비계약을 사람 개입
  // 없이 정리한다. 예비계약이 새로 등록될 때(아래 세 함수)와 보험사 확정 파일을 올릴 때(BulkImport.tsx)
  // 양쪽에서 호출해서 "확정 계약이 먼저 들어온 경우"와 "예비계약이 먼저 들어온 경우"를 모두 커버한다.
  async function runAutoConfirm(): Promise<number> {
    const { data, error } = await supabase.rpc('auto_confirm_preliminary_contracts')
    if (error) {
      console.error('예비계약 자동확정 실패:', error)
      return 0
    }
    return (data as number) ?? 0
  }

  async function handleAutoConfirmClick() {
    setAutoConfirmBusy(true)
    const count = await runAutoConfirm()
    setAutoConfirmBusy(false)
    setAutoConfirmMsg(count > 0 ? `${count}건 자동 확정 처리했습니다.` : '자동 확정할 예비계약이 없습니다.')
    if (count > 0) load()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.company.trim() || !form.policy_no.trim() || !form.customer_name.trim()) {
      alert('보험사, 증권번호, 계약자명은 반드시 입력해야 합니다.')
      return
    }
    if (form.premium <= 0) {
      alert('보험료를 입력해주세요.')
      return
    }
    if (form.receipt_date < prevMonthStart() || form.receipt_date > monthEnd()) {
      alert('신규계약은 지난달 또는 이번 달 영수일로만 등록할 수 있습니다.')
      return
    }
    if (!form.duration_type) {
      alert('종목에 맞는 기간구분을 먼저 선택해야 합니다.')
      setDurationModalOpen('manager')
      return
    }
    if (form.type === '비례공동' && !canUseCoInsurance) {
      alert('비례공동 계약은 관리자만 등록할 수 있습니다.')
      return
    }
    if (form.type === '비례공동' && coInsurers.length === 0) {
      alert('비례공동 계약은 수수료 분배(담당자·비율)를 먼저 설정해야 합니다.')
      openShareModal()
      return
    }
    const { error } = await supabase.from('contracts').insert({
      agent_id: form.agent_id || profile?.id,
      month: form.receipt_date.slice(0, 7),
      receipt_date: form.receipt_date,
      category: form.category,
      type: form.type,
      duration_type: form.duration_type,
      company: form.company,
      policy_no: form.policy_no || null,
      customer_name: form.customer_name,
      insured_name: form.insured_name || null,
      count: 1,
      premium: form.premium,
      // 수수료는 보험사 확정 전까지 알 수 없어 항상 0으로 두고, 이후 [계약 일괄등록]/[계약변경]으로 확정 반영한다.
      commission: 0,
      // 신규 건(비례공동으로 여러 담당자와 나눠 받는 신규 건 포함)은 보험사 확정 계약이
      // [계약 일괄등록]으로 들어와 매칭되기 전까지 예비계약으로 남긴다.
      is_preliminary: form.type === '신규' || form.type === '비례공동',
      co_insurers: form.type === '비례공동' ? coInsurers : null,
    })
    if (!error) {
      setForm((f) => ({
        ...f,
        company: '',
        policy_no: '',
        customer_name: '',
        insured_name: '',
        premium: 0,
        commission: 0,
      }))
      setCoInsurers([])
      if (form.type === '신규') await runAutoConfirm()
      load()
    } else if (error.code === '23505') {
      alert('이미 등록된 증권번호입니다.')
    } else {
      alert('등록 실패: ' + error.message)
    }
  }

  // 신규계약 옆 "엑셀 일괄등록": 담당자명·보험사·계약번호·계약자명·피보험자명·종목·영수일·보험료를 붙여넣어 한 번에 여러 건 등록.
  // 단일 등록 폼과 동일하게 전부 지난달·이번 달 영수일 + 증권번호 필수 + 신규(예비계약)로 들어간다.
  interface BulkRow {
    raw: string[]
    agentName: string
    matched?: Profile
    company: string
    policyNo: string
    customerName: string
    insuredName: string
    category: string
    receiptDate: string
    month: string
    premium: number
    error?: string
  }
  const bulkRows = useMemo<BulkRow[]>(() => {
    if (!bulkText.trim()) return []
    return bulkText
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((line) => {
        // 콤마도 구분자로 취급하면 "1,409,200"처럼 천단위 콤마가 든 보험료 값이 잘려버리므로 탭만 구분자로 쓴다.
        const cols = line.split('\t').map((c) => c.trim())
        const [agentName, company, policyNo, customerName, insuredName, category, receiptDateRaw, premiumRaw] = cols
        // "2026-9-2"처럼 월/일이 한 자리면 문자열로 monthStart()/monthEnd()와 비교할 때
        // 자릿수가 달라 항상 범위 밖으로 잘못 판정되므로(예: "9" > "09") 반드시 0을 채워야 한다.
        const receiptDateNormalized = (receiptDateRaw ?? '').replace(/[./]/g, '-')
        const receiptDateMatch = receiptDateNormalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
        const receiptDate = receiptDateMatch
          ? `${receiptDateMatch[1]}-${receiptDateMatch[2].padStart(2, '0')}-${receiptDateMatch[3].padStart(2, '0')}`
          : receiptDateNormalized
        const month = /^\d{4}-\d{2}/.test(receiptDate) ? receiptDate.slice(0, 7) : ''
        const matched = agents.find((a) => a.name.trim() === (agentName ?? '').trim())
        const premium = Number(String(premiumRaw ?? '').replace(/[,\s원]/g, '')) || 0
        let error: string | undefined
        if (!matched) error = '담당자 매칭 안 됨'
        else if (!company?.trim()) error = '보험사 누락'
        else if (!policyNo?.trim()) error = '증권번호 누락'
        else if (!customerName?.trim()) error = '계약자명 누락'
        else if (!receiptDate || receiptDate < prevMonthStart() || receiptDate > monthEnd()) error = '영수일은 지난달·이번 달만 가능'
        else if (!['장기', '일반', '자동차'].includes(category ?? '')) error = '종목 값 오류'
        else if (premium <= 0) error = '보험료 값 오류'
        return {
          raw: cols,
          agentName: agentName ?? '',
          matched,
          company: company ?? '',
          policyNo: policyNo ?? '',
          customerName: customerName ?? '',
          insuredName: insuredName ?? '',
          category: category ?? '',
          receiptDate,
          month,
          premium,
          error,
        }
      })
  }, [bulkText, agents])
  const bulkValidCount = bulkRows.filter((r) => !r.error).length

  async function handleBulkImport() {
    setBulkBusy(true)
    const payload = bulkRows
      .filter((r) => !r.error)
      .map((r) => ({
        agent_id: r.matched!.id,
        month: r.month,
        receipt_date: r.receiptDate,
        category: r.category,
        type: '신규',
        company: r.company,
        policy_no: r.policyNo || null,
        customer_name: r.customerName,
        insured_name: r.insuredName || null,
        count: 1,
        premium: r.premium,
        commission: 0,
        is_preliminary: true,
      }))
    let inserted = 0
    let failed = 0
    let errorMessage: string | undefined
    const { error, data } = await supabase.from('contracts').insert(payload).select('id')
    if (error) {
      failed = payload.length
      errorMessage =
        error.code === '23505'
          ? '이미 등록된 계약이 포함되어 있습니다 (같은 보험사·증권번호·지급월·구분). 증권번호를 확인해주세요.'
          : error.message
      console.error('신규계약 일괄등록 실패:', error)
    } else {
      inserted = data?.length ?? 0
    }
    setBulkBusy(false)
    setBulkResult({ inserted, failed, errorMessage })
    if (!error) {
      setBulkText('')
      await runAutoConfirm()
      load()
    }
  }

  async function handleDownloadSample() {
    const XLSX = await import('xlsx')
    const header = ['담당자명', '보험사', '계약번호', '계약자명', '피보험자명', '종목', '영수일', '보험료']
    const note = '<= 예시 입니다. 각 행에 맞게 입력후 입력한 부분만 복사/붙여넣기 해주세요.'
    const example = ['김은지', '삼성화재', '52616634160000', '홍길동', '심청이', '일반', monthStart(), '2428500']
    const ws = XLSX.utils.aoa_to_sheet([[...header, note], example])
    ws['!cols'] = [...header.map(() => ({ wch: 16 })), { wch: 50 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '신규계약')
    XLSX.writeFile(wb, '신규계약_샘플.xlsx')
  }

  // 관리자가 아닌 임직원이 보험사 확정 전 직접 등록하는 예비계약: 본인 앞으로, 지난달·이번 달만.
  // 수수료는 아직 몰라 0으로 두고, 익월 본사에서 보험사 확정 계약을 업로드하면 매칭 후 이 예비계약은 삭제된다.
  async function handleSelfReportSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selfForm.company.trim() || !selfForm.policy_no.trim() || !selfForm.customer_name.trim()) {
      alert('보험사, 증권번호, 계약자명은 반드시 입력해야 합니다.')
      return
    }
    if (selfForm.premium <= 0) {
      alert('보험료를 입력해주세요.')
      return
    }
    if (selfForm.receipt_date < prevMonthStart() || selfForm.receipt_date > monthEnd()) {
      alert('신규계약은 지난달 또는 이번 달 계약일로만 등록할 수 있습니다.')
      return
    }
    if (!selfForm.duration_type) {
      alert('종목에 맞는 기간구분을 먼저 선택해야 합니다.')
      setDurationModalOpen('self')
      return
    }
    const { error } = await supabase.from('contracts').insert({
      agent_id: profile?.id,
      month: selfForm.receipt_date.slice(0, 7),
      receipt_date: selfForm.receipt_date,
      category: selfForm.category,
      type: selfForm.type,
      duration_type: selfForm.duration_type,
      company: selfForm.company,
      policy_no: selfForm.policy_no.trim() || null,
      customer_name: selfForm.customer_name,
      insured_name: selfForm.insured_name.trim() || null,
      count: 1,
      premium: selfForm.premium,
      commission: 0,
      is_preliminary: true,
    })
    if (!error) {
      setSelfForm((f) => ({
        ...f,
        duration_type: '',
        company: '',
        policy_no: '',
        customer_name: '',
        insured_name: '',
        premium: 0,
      }))
      await runAutoConfirm()
      load()
    } else if (error.code === '23505') {
      alert('이미 등록된 계약입니다 (같은 보험사·증권번호·지급월·구분의 계약이 존재합니다). 증권번호를 확인해주세요.')
    } else {
      alert('등록 실패: ' + error.message)
    }
  }

  // agent_id/agent_email 로 이름과 지급률을 함께 찾는다
  const agentInfo = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]))
    const byEmail = new Map(invites.map((i) => [i.email, i]))
    return (c: Contract) => {
      if (c.agent_id === profile?.id) {
        return {
          name: profile.name,
          org_id: profile.org_id,
          title: profile.title,
          email: profile.email,
          rate_long: profile.rate_long,
          rate_general: profile.rate_general,
          pending: false,
        }
      }
      if (c.agent_id && byId.has(c.agent_id)) {
        const p = byId.get(c.agent_id)!
        return {
          name: p.name,
          org_id: p.org_id,
          title: p.title,
          email: p.email,
          rate_long: p.rate_long,
          rate_general: p.rate_general,
          pending: false,
        }
      }
      if (c.agent_email && byEmail.has(c.agent_email)) {
        const i = byEmail.get(c.agent_email)!
        return {
          name: i.name,
          org_id: i.org_id,
          title: i.title,
          email: i.email,
          rate_long: i.rate_long,
          rate_general: i.rate_general,
          pending: true,
        }
      }
      return {
        name: c.agent_email ?? c.agent_id ?? '-',
        org_id: '',
        title: '',
        email: c.agent_email ?? '',
        rate_long: 1,
        rate_general: 1,
        pending: true,
      }
    }
  }, [agents, invites, profile])

  const rateFor = (c: Contract, info: { rate_long: number; rate_general: number }) =>
    c.category === '장기' ? info.rate_long : info.rate_general

  // 계약관리 화면의 "월" 검색은 지급월(month, 수수료가 들어오는 달)이 아니라 실제 계약월(보험시기)
  // 기준으로 조회한다 — 예: 8월에 접수된 계약이 수수료는 9월에 지급돼 month='2026-09'로 등록돼도,
  // 계약관리에서는 2026년 08월로 찾아져야 한다. 보험시기가 없는 옛 데이터는 지급월로 대체한다.
  const contractMonth = (c: Contract) => c.receipt_date?.slice(0, 7) || c.month

  const months = useMemo(
    () => [...new Set(contracts.map((c) => contractMonth(c)).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [contracts],
  )

  const keyword = search.trim().toLowerCase()

  const filtered = useMemo(
    () =>
      contracts.filter((c) => {
        // 예비계약(확정 전)은 계약 리스트에 안 보이고 "예비계약 확인"에서만 관리한다.
        if (c.is_preliminary) return false
        // 수수료 0원 건(계속 상태 등, 수수료가 아직 발생하지 않은 트래킹용 행)은 목록에서 숨긴다.
        if (c.commission === 0) return false
        // 장기 신규건은 당월(지급월 기준) 계약만 보여준다. 일반/자동차는 단발성 계약이라 월 제한 없이 전부 보여준다.
        if (c.category === '장기' && c.type === '신규' && c.month !== today().slice(0, 7)) return false
        if (categoryFilter !== '전체' && c.category !== categoryFilter) return false
        if (typeFilter !== '전체' && c.type !== typeFilter) return false
        if (monthFilter !== '전체' && contractMonth(c) !== monthFilter) return false
        if (keyword) {
          const agentName = agentInfo(c).name
          const haystack = [c.customer_name, c.product_name, c.company, c.policy_no, agentName].join(' ').toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      }),
    [contracts, categoryFilter, typeFilter, monthFilter, keyword, agentInfo],
  )

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])

  const groups = useMemo(() => {
    interface CompanyGroup {
      company: string
      rows: Contract[]
      premium: number
      commission: number
      performanceCommission: number
    }
    interface AgentGroup {
      key: string
      name: string
      org_id: string
      title: string
      email: string
      pending: boolean
      premium: number
      commission: number
      companies: Map<string, CompanyGroup>
    }
    const map = new Map<string, AgentGroup>()
    for (const c of filtered) {
      const key = c.agent_id ?? c.agent_email ?? 'unknown'
      const info = agentInfo(c)
      const rate = rateFor(c, info)
      const g = map.get(key) ?? {
        key,
        name: info.name,
        org_id: info.org_id,
        title: info.title,
        email: info.email,
        pending: info.pending,
        premium: 0,
        commission: 0,
        companies: new Map<string, CompanyGroup>(),
      }
      g.premium += c.premium
      g.commission += c.commission * rate
      const cg = g.companies.get(c.company) ?? {
        company: c.company,
        rows: [],
        premium: 0,
        commission: 0,
        performanceCommission: 0,
      }
      cg.rows.push(c)
      cg.premium += c.premium
      cg.commission += c.commission * rate
      cg.performanceCommission += c.performance_commission
      g.companies.set(c.company, cg)
      map.set(key, g)
    }
    return (
      [...map.values()]
        .map((g) => ({
          ...g,
          companies: [...g.companies.values()]
            .map((cg) => ({
              ...cg,
              rows: [...cg.rows].sort((a, b) => {
                const byCategory = CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category)
                if (byCategory !== 0) return byCategory
                return (b.receipt_date ?? '').localeCompare(a.receipt_date ?? '')
              }),
            }))
            .sort((a, b) => b.premium - a.premium),
        }))
        // 노출 우선순위: 조직(본사>직영>지점) > 직급 > 사번
        .sort((a, b) => compareByOrgGradeCode(a, b, orgsById))
    )
  }, [filtered, agentInfo, orgsById])

  useEffect(() => {
    if (!keyword) return
    setOpenAgents((prev) => {
      const next = new Set(prev)
      groups.forEach((g) => next.add(g.key))
      return next
    })
    setOpenCompanies((prev) => {
      const next = new Set(prev)
      groups.forEach((g) => g.companies.forEach((cg) => next.add(`${g.key}|${cg.company}`)))
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, groups])

  function toggleAgent(key: string) {
    setOpenAgents((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  function toggleCompany(key: string) {
    setOpenCompanies((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // 셀프 등록한 예비계약을 전부 보여주되(매칭 대기 중인 것 포함), 보험사 확정 계약(예비 아님)이
  // 이미 들어와 있으면 같이 찾아서 관리자가 확인 후 예비계약을 정리할 수 있게 한다.
  // 증권번호가 이제 예비계약에도 필수라 우선 증권번호로 정확히 매칭하고,
  // (옛날 데이터 등) 증권번호가 없는 예비계약만 담당자·보험사·고객명으로 대신 매칭한다.
  // 본사담당자는 RLS상 본사관리자와 동일하게 회사 전체 예비계약을 조회할 수 있지만,
  // 예비계약 확인 목록만큼은 본사 소속(org_id='hq') 담당자의 계약으로 한정해 보여준다.
  // (본사관리자는 그대로 회사 전체를 유지한다)
  const hqOrgAgentIds = useMemo(() => new Set(agents.filter((a) => a.org_id === 'hq').map((a) => a.id)), [agents])
  const hqOrgAgentEmails = useMemo(() => new Set(invites.filter((i) => i.org_id === 'hq').map((i) => i.email)), [invites])
  const preliminaryMatches = useMemo(() => {
    const officialByPolicyNo = new Map<string, Contract[]>()
    const officialByNameKey = new Map<string, Contract[]>()
    for (const c of contracts) {
      if (c.is_preliminary) continue
      if (c.policy_no?.trim()) {
        const key = c.policy_no.trim()
        if (!officialByPolicyNo.has(key)) officialByPolicyNo.set(key, [])
        officialByPolicyNo.get(key)!.push(c)
      }
      const nameKey = `${c.agent_id ?? c.agent_email ?? ''}|${c.company.trim()}|${c.customer_name.trim()}`
      if (!officialByNameKey.has(nameKey)) officialByNameKey.set(nameKey, [])
      officialByNameKey.get(nameKey)!.push(c)
    }
    return contracts
      .filter((c) => c.is_preliminary)
      .filter((c) => {
        if (!isHqStaff) return true
        return c.agent_id ? hqOrgAgentIds.has(c.agent_id) : c.agent_email ? hqOrgAgentEmails.has(c.agent_email) : false
      })
      .filter((c) => {
        if (monthFilter !== '전체' && contractMonth(c) !== monthFilter) return false
        if (categoryFilter !== '전체' && c.category !== categoryFilter) return false
        if (typeFilter !== '전체' && c.type !== typeFilter) return false
        if (keyword) {
          const agentName = agentInfo(c).name
          const haystack = [c.customer_name, c.product_name, c.company, c.policy_no, agentName].join(' ').toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      })
      .map((prelim) => {
        const byPolicyNo = prelim.policy_no?.trim() ? officialByPolicyNo.get(prelim.policy_no.trim()) : undefined
        if (byPolicyNo?.length) return { prelim, matches: byPolicyNo }
        // 갱신은 항상 새 증권번호를 입력받으므로 증권번호로만 매칭한다. 이름(담당자+보험사+계약자명) 대체
        // 매칭은 신규(증권번호가 비어있을 수 있음)에만 쓴다 — 갱신 고객은 매년 이름이 같아 작년 확정계약과
        // 항상 잘못 매칭돼버리기 때문.
        if (prelim.type !== '신규') return { prelim, matches: [] }
        const nameKey = `${prelim.agent_id ?? prelim.agent_email ?? ''}|${prelim.company.trim()}|${prelim.customer_name.trim()}`
        return { prelim, matches: officialByNameKey.get(nameKey) ?? [] }
      })
  }, [
    contracts, canManage, isHqStaff, hqOrgAgentIds, hqOrgAgentEmails,
    monthFilter, categoryFilter, typeFilter, keyword, agentInfo,
  ])

  // 예비계약을 담당자의 관리조직(본사직영, 각 지점 등 최상위 하위 조직)별로, 그 안에서는
  // 담당자별(사번순)로 묶는다.
  const preliminaryGroups = useMemo(() => {
    interface PrelimAgentGroup {
      agentKey: string
      name: string
      email: string
      pending: boolean
      rows: typeof preliminaryMatches
    }
    interface PrelimOrgGroup {
      orgId: string
      orgName: string
      priority: number
      agents: Map<string, PrelimAgentGroup>
    }
    const orgMap = new Map<string, PrelimOrgGroup>()
    for (const row of preliminaryMatches) {
      const info = agentInfo(row.prelim)
      const orgGroupId = info.org_id ? topLevelOrgId(info.org_id, orgsById) : ''
      const org = orgsById.get(orgGroupId)
      const og = orgMap.get(orgGroupId) ?? {
        orgId: orgGroupId,
        orgName: org?.name ?? '미배정',
        priority: org?.type ? ORG_TYPE_PRIORITY[org.type] : 99,
        agents: new Map<string, PrelimAgentGroup>(),
      }
      const agentKey = row.prelim.agent_id ?? row.prelim.agent_email ?? 'unknown'
      const ag = og.agents.get(agentKey) ?? { agentKey, name: info.name, email: info.email, pending: info.pending, rows: [] }
      ag.rows.push(row)
      og.agents.set(agentKey, ag)
      orgMap.set(orgGroupId, og)
    }
    return [...orgMap.values()]
      .map((og) => ({
        ...og,
        agents: [...og.agents.values()].sort((a, b) => compareAgentCode(agentCode(a.email), agentCode(b.email))),
      }))
      .sort((a, b) => a.priority - b.priority || a.orgName.localeCompare(b.orgName, 'ko'))
  }, [preliminaryMatches, agentInfo, orgsById])

  useEffect(() => {
    setOpenPrelimGroups((prev) => {
      const next = new Set(prev)
      preliminaryGroups.forEach((g) => {
        next.add(g.orgId)
        // 관리자는 조직 그룹만 펼치고(담당자 세부는 접어둠), 본사담당자·위촉직 설계사는 본인 계약 그룹을 펼쳐서 보여준다.
        if (!isAdminViewer) {
          g.agents.forEach((ag) => {
            if (ag.agentKey === profile?.id) next.add(`${g.orgId}|${ag.agentKey}`)
          })
        }
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preliminaryGroups.length])

  function togglePrelimGroup(key: string) {
    setOpenPrelimGroups((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const canReassign = profile?.role === 'hq_admin'
  const agentOptions = [
    ...agents.map((a) => ({ value: `p:${a.id}`, label: a.name })),
    ...invites.map((i) => ({
      value: `e:${i.email}`,
      label: `${i.name} (미가입)`,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'ko'))

  function currentAgentValue(c: Contract) {
    if (c.agent_id) return `p:${c.agent_id}`
    if (c.agent_email) return `e:${c.agent_email}`
    return ''
  }

  async function deleteContract(contractId: string) {
    if (!confirm('이 계약을 삭제할까요? 되돌릴 수 없습니다.')) return
    const { error } = await supabase.from('contracts').delete().eq('id', contractId)
    if (error) {
      // 23503 = FK 위반. 이 계약을 원 계약(prior_contract_id)으로 참조하는 "계약변경"
      // 이력이 남아있으면 원 계약을 먼저 지울 수 없다(참조 무결성) — 원인을 그대로 노출하지
      // 않고, 어떻게 해야 하는지 바로 알 수 있게 안내한다.
      if (error.code === '23503') {
        alert(
          '삭제 실패: 이 계약에 연결된 "계약변경" 이력이 있어 원 계약을 먼저 삭제할 수 없습니다.\n' +
            '같은 증권번호로 등록된 변경 건(구분=변경)을 먼저 삭제한 뒤 다시 시도해주세요.',
        )
      } else {
        alert('삭제 실패: ' + error.message)
      }
    } else load()
  }

  function startEditPrelim(prelim: Contract) {
    setEditingPrelimId(prelim.id)
    setPrelimEditForm({
      policy_no: prelim.policy_no ?? '',
      customer_name: prelim.customer_name,
      premium: prelim.premium,
    })
  }

  async function savePrelimEdit(contractId: string) {
    const { error } = await supabase.rpc('update_preliminary_contract', {
      contract_id: contractId,
      new_policy_no: prelimEditForm.policy_no || null,
      new_customer_name: prelimEditForm.customer_name,
      new_premium: prelimEditForm.premium,
    })
    if (error) {
      alert(error.code === '23505' ? '이미 등록된 증권번호입니다.' : '수정 실패: ' + error.message)
      return
    }
    setEditingPrelimId(null)
    load()
  }

  async function updateMemo(contractId: string, memo: string) {
    const { error } = await supabase.rpc('set_contract_memo', {
      contract_id: contractId,
      new_memo: memo || null,
    })
    if (error) alert('메모 저장 실패: ' + error.message)
    else load()
  }

  async function reassignAgent(contractId: string, value: string) {
    const [kind, key] = value.split(/:(.+)/)
    const patch =
      kind === 'p'
        ? {
            agent_id: key,
            agent_email: agents.find((a) => a.id === key)?.email ?? null,
          }
        : { agent_id: null, agent_email: key }
    const { error } = await supabase.from('contracts').update(patch).eq('id', contractId)
    if (error) alert('담당자 변경 실패: ' + error.message)
    else load()
  }

  // 확정 계약 건별 수정(본사관리자 전용): 보험사 파일 업로드 과정에서 잘못 들어온 값을
  // 증권번호·상품명·계약자명 등 개별 항목 단위로 바로잡을 수 있게 한다. 건별수수료는
  // 지급률 적용 전 원본 값을 그대로 수정한다(표시는 지급률이 곱해진 값).
  const [editingContractId, setEditingContractId] = useState<string | null>(null)
  const [contractEditForm, setContractEditForm] = useState({
    policy_no: '',
    product_name: '',
    customer_name: '',
    insured_name: '',
    category: '일반' as ContractCategory,
    duration_type: '',
    receipt_date: '',
    expiry_date: '',
    month: '',
    premium: 0,
    commission: 0,
    performance_commission: 0,
  })

  function startEditContract(c: Contract) {
    setEditingContractId(c.id)
    setContractEditForm({
      policy_no: c.policy_no ?? '',
      product_name: c.product_name ?? '',
      customer_name: c.customer_name,
      insured_name: c.insured_name ?? '',
      category: c.category,
      duration_type: c.duration_type ?? '',
      receipt_date: c.receipt_date ?? '',
      expiry_date: c.expiry_date ?? '',
      month: c.month,
      premium: c.premium,
      commission: c.commission,
      performance_commission: c.performance_commission,
    })
  }

  function cancelEditContract() {
    setEditingContractId(null)
  }

  async function saveContractEdit(contractId: string) {
    if (!/^\d{4}-\d{2}$/.test(contractEditForm.month)) {
      alert('정산년월은 비워둘 수 없습니다.')
      return
    }
    const { error } = await supabase
      .from('contracts')
      .update({
        policy_no: contractEditForm.policy_no.trim() || null,
        product_name: contractEditForm.product_name,
        customer_name: contractEditForm.customer_name,
        insured_name: contractEditForm.insured_name.trim() || null,
        category: contractEditForm.category,
        duration_type: contractEditForm.duration_type || null,
        receipt_date: contractEditForm.receipt_date || null,
        expiry_date: contractEditForm.expiry_date || null,
        month: contractEditForm.month,
        premium: contractEditForm.premium,
        commission: contractEditForm.commission,
        performance_commission: contractEditForm.performance_commission,
      })
      .eq('id', contractId)
    if (error) {
      alert(error.code === '23505' ? '이미 등록된 증권번호입니다.' : '수정 실패: ' + error.message)
      return
    }
    setEditingContractId(null)
    load()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">계약관리</h1>

      {canManage && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <button
            type="button"
            onClick={() => setNewContractOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
          >
            <span className="inline-block w-3 text-slate-400">{newContractOpen ? '▾' : '▸'}</span>
            <span className="font-semibold text-sm text-slate-700">신규계약</span>
          </button>
          {newContractOpen && (
            <>
              <form onSubmit={handleSubmit} className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                {canPickAgent && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">담당자</label>
                    <select
                      value={form.agent_id}
                      onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}
                      className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                    >
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">계약일 (지난달·이번 달만 등록 가능)</label>
                  <input
                    type="date"
                    value={form.receipt_date}
                    min={prevMonthStart()}
                    max={monthEnd()}
                    onChange={(e) => setForm((f) => ({ ...f, receipt_date: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">구분</label>
                  <select
                    value={form.type}
                    onChange={(e) => {
                      const type = e.target.value as ContractType
                      setForm((f) => ({ ...f, type }))
                      if (type === '비례공동') openShareModal()
                      else setCoInsurers([])
                    }}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  >
                    {formTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {form.type === '비례공동' && (
                    <button type="button" onClick={openShareModal} className="mt-1 text-[11px] text-indigo-600 hover:underline">
                      {coInsurers.length > 0
                        ? `분배 설정됨 (${coInsurers.map((s) => `${s.name} ${s.ratio}%`).join(' / ')}) · 수정`
                        : '수수료 분배 설정 필요'}
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">종목</label>
                  <select
                    value={form.category}
                    onChange={(e) => {
                      const category = e.target.value as ContractCategory
                      setForm((f) => ({ ...f, category, duration_type: '' }))
                      setDurationModalOpen('manager')
                    }}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setDurationModalOpen('manager')}
                    className="mt-1 text-[11px] text-indigo-600 hover:underline"
                  >
                    {form.duration_type ? `기간구분: ${form.duration_type} · 수정` : '기간구분 설정 필요'}
                  </button>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">보험사</label>
                  <input
                    required
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">증권번호</label>
                  <input
                    required
                    value={form.policy_no}
                    onChange={(e) => setForm((f) => ({ ...f, policy_no: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">계약자명</label>
                  <input
                    required
                    value={form.customer_name}
                    onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">피보험자</label>
                  <input
                    value={form.insured_name}
                    onChange={(e) => setForm((f) => ({ ...f, insured_name: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">보험료</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={form.premium}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        premium: Number(e.target.value),
                      }))
                    }
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium h-fit">
                    계약 등록
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkOpen((v) => !v)}
                    className="border border-slate-300 text-slate-600 rounded-md px-4 py-2 text-sm font-medium h-fit hover:bg-slate-50"
                  >
                    엑셀 일괄등록
                  </button>
                </div>
              </form>

              {bulkOpen && (
                <div className="p-5 pt-0 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-slate-500 font-mono whitespace-pre-wrap break-all">
                      열 순서: 담당자명{'\t'}보험사{'\t'}계약번호{'\t'}계약자명{'\t'}피보험자명
                      {'\t'}종목{'\t'}영수일{'\t'}보험료
                      {'\n'}예시: 김은지{'\t'}삼성화재{'\t'}52616634160000{'\t'}홍길동{'\t'}
                      심청이{'\t'}일반{'\t'}2026-09-15{'\t'}2428500
                    </p>
                    <button
                      type="button"
                      onClick={handleDownloadSample}
                      className="shrink-0 text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      샘플 엑셀 다운로드
                    </button>
                  </div>
                  <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    rows={6}
                    placeholder="여기에 엑셀 데이터를 붙여넣으세요"
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
                  />
                  {bulkRows.length > 0 && (
                    <div className="text-sm text-slate-600">
                      총 {bulkRows.length}행 · 유효 {bulkValidCount}행
                      {bulkValidCount < bulkRows.length && (
                        <span className="text-red-600">
                          {' '}
                          (오류 {bulkRows.length - bulkValidCount}행: {bulkRows.find((r) => r.error)?.error})
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={bulkBusy || bulkValidCount === 0}
                    onClick={handleBulkImport}
                    className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    {bulkBusy ? '등록 중…' : `${bulkValidCount}건 일괄 등록`}
                  </button>
                  {bulkResult && (
                    <p className="text-sm">
                      완료: <span className="text-emerald-600 font-medium">{bulkResult.inserted}건 성공</span>
                      {bulkResult.failed > 0 && <span className="text-red-600 font-medium"> · {bulkResult.failed}건 실패</span>}
                      {bulkResult.errorMessage && (
                        <span className="block text-xs text-red-600 mt-1">사유: {bulkResult.errorMessage}</span>
                      )}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {canManage && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <button
            type="button"
            onClick={() => setChangeOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
          >
            <span className="inline-block w-3 text-slate-400">{changeOpen ? '▾' : '▸'}</span>
            <span className="font-semibold text-sm text-slate-700">계약변경</span>
          </button>
          {changeOpen && (
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-500">
                이미 등록된 확정 계약을 증권번호로 불러와서 계약기간변경·임의해지·보험료변동 등을 "변경증권" 이력으로 남깁니다. 원
                계약 데이터는 그대로 유지되고, 이 화면에서는 <b>증감액(차액)</b>만 입력합니다.
              </p>
              <div className="flex gap-2 items-end">
                <div className="flex-1 max-w-xs">
                  <label className="block text-xs text-slate-500 mb-1">기계약 증권번호</label>
                  <input
                    value={policyLookup}
                    onChange={(e) => setPolicyLookup(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookupPolicy())}
                    placeholder="증권번호 입력"
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={lookupBusy || !policyLookup.trim()}
                  onClick={lookupPolicy}
                  className="bg-slate-800 text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  {lookupBusy ? '조회 중…' : '조회'}
                </button>
              </div>
              {lookupError && <p className="text-sm text-rose-600">{lookupError}</p>}
              {lookupResults.length > 0 && !selectedOriginal && (
                <table className="w-full text-xs border border-slate-100 rounded-md overflow-hidden">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">담당자</th>
                      <th className="text-left px-3 py-1.5">보험사</th>
                      <th className="text-left px-3 py-1.5">종목</th>
                      <th className="text-left px-3 py-1.5">계약자명</th>
                      <th className="text-left px-3 py-1.5">영수일</th>
                      <th className="text-right px-3 py-1.5">보험료</th>
                      <th className="px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {lookupResults.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">{agentInfo(c).name}</td>
                        <td className="px-3 py-1.5">{c.company}</td>
                        <td className="px-3 py-1.5">
                          {c.category}
                          {c.duration_type && ` · ${c.duration_type}`}
                        </td>
                        <td className="px-3 py-1.5">{c.customer_name}</td>
                        <td className="px-3 py-1.5">{c.receipt_date ?? '-'}</td>
                        <td className="px-3 py-1.5 text-right">{c.premium.toLocaleString('ko-KR')}원</td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => selectOriginal(c)}
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            선택
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {selectedOriginal && (
                <form onSubmit={handleChangeSubmit} className="space-y-3">
                  <div className="bg-slate-50 rounded-md px-3 py-2 text-xs text-slate-600 flex items-center justify-between">
                    <span>
                      기계약: {agentInfo(selectedOriginal).name} · {selectedOriginal.company} · {selectedOriginal.customer_name} ·
                      보험료 {selectedOriginal.premium.toLocaleString('ko-KR')}원 · {selectedOriginal.category}
                      {selectedOriginal.duration_type && ` · ${selectedOriginal.duration_type}`} · 만기{' '}
                      {selectedOriginal.expiry_date ?? '-'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOriginal(null)
                        setLookupResults([])
                      }}
                      className="text-slate-400 hover:underline shrink-0 ml-2"
                    >
                      다시 조회
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">변경사유</label>
                      <select
                        value={changeForm.reason}
                        onChange={(e) =>
                          setChangeForm((f) => ({
                            ...f,
                            reason: e.target.value as (typeof CHANGE_REASONS)[number],
                          }))
                        }
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      >
                        {CHANGE_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">처리일 (지난달·이번 달만 등록 가능)</label>
                      <input
                        type="date"
                        value={changeForm.receipt_date}
                        min={prevMonthStart()}
                        max={monthEnd()}
                        onChange={(e) => setChangeForm((f) => ({ ...f, receipt_date: e.target.value }))}
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">기간구분</label>
                      <select
                        value={changeForm.duration_type}
                        onChange={(e) => setChangeForm((f) => ({ ...f, duration_type: e.target.value }))}
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      >
                        {DURATION_OPTIONS[selectedOriginal.category].map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">만기일</label>
                      <input
                        type="date"
                        value={changeForm.expiry_date}
                        onChange={(e) => setChangeForm((f) => ({ ...f, expiry_date: e.target.value }))}
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">보험료 증감액(원)</label>
                      <input
                        type="number"
                        value={changeForm.premium_delta}
                        onChange={(e) => setChangeForm((f) => ({ ...f, premium_delta: Number(e.target.value) }))}
                        placeholder="예: 임의해지 시 -50000"
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">수수료 증감액(원, 지급률 적용 전)</label>
                      <input
                        type="number"
                        value={changeForm.commission_delta}
                        onChange={(e) => setChangeForm((f) => ({ ...f, commission_delta: Number(e.target.value) }))}
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">메모</label>
                      <input
                        value={changeForm.memo}
                        onChange={(e) => setChangeForm((f) => ({ ...f, memo: e.target.value }))}
                        placeholder="변경 상세 내용(선택)"
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </div>
                    <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium h-fit">
                      변경증권 저장
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {canSelfReport && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <button
            type="button"
            onClick={() => setSelfReportOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
          >
            <span className="inline-block w-3 text-slate-400">{selfReportOpen ? '▾' : '▸'}</span>
            <span className="font-semibold text-sm text-slate-700">신규계약</span>
          </button>
          {selfReportOpen && (
            <form onSubmit={handleSelfReportSubmit} className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <p className="col-span-2 md:col-span-4 text-xs text-slate-500 -mt-1 mb-1">
                지난달·이번 달 계약을 미리 등록해두면, 다음 달 보험사 확정 계약이 올라올 때 매칭되어 정리됩니다.
                보험사·증권번호·계약자명·보험료(
                <span className="text-rose-500">*</span>)는 필수입력이며, 수수료는 확정 후 반영돼요.
              </p>
              <div>
                <label className="block text-xs text-slate-500 mb-1">계약일 (지난달·이번 달만 등록 가능)</label>
                <input
                  type="date"
                  value={selfForm.receipt_date}
                  min={prevMonthStart()}
                  max={monthEnd()}
                  onChange={(e) => setSelfForm((f) => ({ ...f, receipt_date: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">종목</label>
                <select
                  value={selfForm.category}
                  onChange={(e) => {
                    const category = e.target.value as ContractCategory
                    setSelfForm((f) => ({ ...f, category, duration_type: '' }))
                    setDurationModalOpen('self')
                  }}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDurationModalOpen('self')}
                  className="mt-1 text-[11px] text-indigo-600 hover:underline"
                >
                  {selfForm.duration_type ? `기간구분: ${selfForm.duration_type} · 수정` : '기간구분 설정 필요'}
                </button>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">구분</label>
                <select
                  value={selfForm.type}
                  onChange={(e) => setSelfForm((f) => ({ ...f, type: e.target.value as ContractType }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                >
                  {SELF_REPORT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  보험사 <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  value={selfForm.company}
                  onChange={(e) => setSelfForm((f) => ({ ...f, company: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  증권번호 <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  value={selfForm.policy_no}
                  onChange={(e) => setSelfForm((f) => ({ ...f, policy_no: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  계약자명 <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  value={selfForm.customer_name}
                  onChange={(e) =>
                    setSelfForm((f) => ({
                      ...f,
                      customer_name: e.target.value,
                    }))
                  }
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">피보험자</label>
                <input
                  value={selfForm.insured_name}
                  onChange={(e) => setSelfForm((f) => ({ ...f, insured_name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  보험료 <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  value={selfForm.premium}
                  onChange={(e) =>
                    setSelfForm((f) => ({
                      ...f,
                      premium: Number(e.target.value),
                    }))
                  }
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <button type="submit" className="bg-slate-800 text-white rounded-md px-4 py-2 text-sm font-medium h-fit">
                신규계약 등록
              </button>
            </form>
          )}
        </div>
      )}

      {(canManage || canSelfReport) && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="w-full flex items-center gap-1.5 bg-slate-100 px-4 py-2.5">
            <button type="button" onClick={() => setMatchOpen((v) => !v)} className="flex-1 flex items-center gap-1.5 text-left">
              <span className="inline-block w-3 text-slate-400">{matchOpen ? '▾' : '▸'}</span>
              <span className="font-semibold text-sm text-slate-700">
                예비계약 확인
                {preliminaryMatches.length > 0 && ` (${preliminaryMatches.length}건)`}
              </span>
            </button>
            {canManage && (
              <div className="flex items-center gap-2">
                {autoConfirmMsg && <span className="text-xs text-slate-500">{autoConfirmMsg}</span>}
                <button
                  type="button"
                  disabled={autoConfirmBusy}
                  onClick={handleAutoConfirmClick}
                  className="text-xs border border-slate-300 rounded-md px-2.5 py-1 text-slate-600 hover:bg-white disabled:opacity-40"
                  title="증권번호가 확정 계약과 정확히 일치하는 예비계약을 지금 자동으로 정리합니다."
                >
                  {autoConfirmBusy ? '확인 중…' : '지금 자동 확정 실행'}
                </button>
              </div>
            )}
          </div>
          {matchOpen &&
            (preliminaryMatches.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">등록된 예비계약이 없습니다.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {preliminaryGroups.map((g) => {
                  const groupOpen = openPrelimGroups.has(g.orgId)
                  const orgRowCount = g.agents.reduce((s, ag) => s + ag.rows.length, 0)
                  return (
                    <div key={g.orgId}>
                      <button
                        type="button"
                        onClick={() => togglePrelimGroup(g.orgId)}
                        className="w-full flex items-center gap-1.5 px-4 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="inline-block w-3 text-slate-400">{groupOpen ? '▾' : '▸'}</span>
                        <span className="font-semibold text-sm text-slate-700">{g.orgName}</span>
                        <span className="text-xs text-slate-400">({orgRowCount}건)</span>
                      </button>
                      {groupOpen && (
                        <table className="w-full text-sm">
                          <thead className="text-slate-500 text-xs border-b border-slate-100">
                            <tr>
                              <th className="text-left px-4 py-2">보험사</th>
                              <th className="text-left px-4 py-2">신규/갱신</th>
                              <th className="text-left px-4 py-2">증권번호</th>
                              <th className="text-left px-4 py-2">종목</th>
                              <th className="text-left px-4 py-2">계약자명</th>
                              <th className="text-left px-4 py-2">보험계약일</th>
                              <th className="text-right px-4 py-2">예비 보험료</th>
                              <th className="text-left px-4 py-2">상태</th>
                              <th className="text-right px-4 py-2">확정 보험료</th>
                              <th className="text-left px-4 py-2">확정 지급월</th>
                              <th className="px-4 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {g.agents.map((ag) => {
                              const agentSubKey = `${g.orgId}|${ag.agentKey}`
                              const agentSubOpen = openPrelimGroups.has(agentSubKey)
                              return (
                                <Fragment key={agentSubKey}>
                                  <tr className="border-t border-slate-100 bg-slate-50/60">
                                    <td colSpan={11} className="p-0">
                                      <button
                                        type="button"
                                        onClick={() => togglePrelimGroup(agentSubKey)}
                                        className="w-full flex items-center gap-1.5 px-4 py-1.5 text-left hover:bg-slate-100"
                                      >
                                        <span className="inline-block w-3 text-slate-400">{agentSubOpen ? '▾' : '▸'}</span>
                                        <span className="text-sm font-medium text-slate-600">{ag.name}</span>
                                        {ag.pending && <span className="text-amber-600 font-normal text-xs"> (미가입)</span>}
                                        <span className="text-xs text-slate-400">({ag.rows.length}건)</span>
                                      </button>
                                    </td>
                                  </tr>
                                  {agentSubOpen &&
                                    ag.rows.map(({ prelim, matches }) => {
                                      const editing = matches.length === 0 && editingPrelimId === prelim.id
                                      return (
                                        <tr key={prelim.id} className="border-t border-slate-50">
                                          <td className="px-4 py-2">{prelim.company}</td>
                                          <td className="px-4 py-2">
                                            <span
                                              className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                                                prelim.type === '신규' || prelim.type === '비례공동'
                                                  ? 'text-sky-600 bg-sky-50'
                                                  : 'text-purple-600 bg-purple-50'
                                              }`}
                                            >
                                              {prelim.type === '신규'
                                                ? '신규'
                                                : prelim.type === '비례공동'
                                                  ? '신규/비례공동'
                                                  : '갱신'}
                                            </span>
                                          </td>
                                          <td className="px-4 py-2">
                                            {editing ? (
                                              <input
                                                type="text"
                                                value={prelimEditForm.policy_no}
                                                onChange={(e) =>
                                                  setPrelimEditForm((f) => ({
                                                    ...f,
                                                    policy_no: e.target.value,
                                                  }))
                                                }
                                                placeholder="증권번호"
                                                className="border border-slate-300 rounded px-1.5 py-1 text-xs w-32"
                                              />
                                            ) : (
                                              (prelim.policy_no ?? '-')
                                            )}
                                          </td>
                                          <td className="px-4 py-2">{prelim.category}</td>
                                          <td className="px-4 py-2">
                                            {editing ? (
                                              <input
                                                type="text"
                                                value={prelimEditForm.customer_name}
                                                onChange={(e) =>
                                                  setPrelimEditForm((f) => ({
                                                    ...f,
                                                    customer_name: e.target.value,
                                                  }))
                                                }
                                                placeholder="계약자명"
                                                className="border border-slate-300 rounded px-1.5 py-1 text-xs w-32"
                                              />
                                            ) : (
                                              prelim.customer_name
                                            )}
                                          </td>
                                          <td className="px-4 py-2">{prelim.receipt_date ?? '-'}</td>
                                          <td className="px-4 py-2 text-right">
                                            {editing ? (
                                              <input
                                                type="number"
                                                value={prelimEditForm.premium}
                                                onChange={(e) =>
                                                  setPrelimEditForm((f) => ({
                                                    ...f,
                                                    premium: Number(e.target.value),
                                                  }))
                                                }
                                                className="border border-slate-300 rounded px-1.5 py-1 text-xs w-28 text-right"
                                              />
                                            ) : (
                                              `${prelim.premium.toLocaleString('ko-KR')}원`
                                            )}
                                          </td>
                                          {matches.length > 0 ? (
                                            <>
                                              <td className="px-4 py-2">
                                                <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                                  확정 계약 매칭됨
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-right">
                                                {matches[0].premium.toLocaleString('ko-KR')}원
                                                {matches.length > 1 && (
                                                  <span className="text-xs text-slate-400"> 외 {matches.length - 1}건</span>
                                                )}
                                              </td>
                                              <td className="px-4 py-2">{matches[0].month}</td>
                                              <td className="px-4 py-2 text-right">
                                                {canManage ? (
                                                  <button
                                                    onClick={() => deleteContract(prelim.id)}
                                                    className="text-xs text-white bg-slate-800 rounded-md px-3 py-1.5 hover:bg-slate-700"
                                                  >
                                                    확정 처리(예비 삭제)
                                                  </button>
                                                ) : (
                                                  <span className="text-xs text-slate-400">본사 확인 대기</span>
                                                )}
                                              </td>
                                            </>
                                          ) : (
                                            <>
                                              <td className="px-4 py-2">
                                                <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                                  대기중
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-right text-slate-300">-</td>
                                              <td className="px-4 py-2 text-slate-300">-</td>
                                              <td className="px-4 py-2 text-right space-x-2">
                                                {editing ? (
                                                  <>
                                                    <button
                                                      onClick={() => savePrelimEdit(prelim.id)}
                                                      className="text-xs text-white bg-slate-800 rounded-md px-2.5 py-1 hover:bg-slate-700"
                                                    >
                                                      저장
                                                    </button>
                                                    <button
                                                      onClick={() => setEditingPrelimId(null)}
                                                      className="text-xs text-slate-500 hover:underline"
                                                    >
                                                      취소
                                                    </button>
                                                  </>
                                                ) : (
                                                  <>
                                                    <button
                                                      onClick={() => startEditPrelim(prelim)}
                                                      className="text-xs text-indigo-600 hover:underline"
                                                    >
                                                      수정
                                                    </button>
                                                    <button
                                                      onClick={() => deleteContract(prelim.id)}
                                                      className="text-xs text-rose-600 hover:underline"
                                                    >
                                                      삭제
                                                    </button>
                                                  </>
                                                )}
                                              </td>
                                            </>
                                          )}
                                        </tr>
                                      )
                                    })}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="계약찾기: 고객명, 상품명, 보험사, 계약번호, 담당자"
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white w-64"
        />
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
        >
          <option value="전체">전체 기간</option>
          {months.map((m) => {
            const [y, mo] = m.split('-')
            return (
              <option key={m} value={m}>
                {y}년 {mo}월
              </option>
            )
          })}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
        >
          <option value="전체">전체 종목</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
        >
          <option value="전체">전체 구분</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}
      {!loading && groups.length === 0 && <p className="text-center text-slate-400 py-6">등록된 계약이 없습니다.</p>}

      <div className="space-y-3">
        {groups.map((g) => {
          const agentOpen = openAgents.has(g.key)
          const totalCount = g.companies.reduce((s, cg) => s + cg.rows.length, 0)
          return (
            <div key={g.key} className="bg-white rounded-xl shadow overflow-hidden">
              <button
                onClick={() => toggleAgent(g.key)}
                className="w-full flex items-center justify-between bg-slate-100 px-4 py-2.5 text-left hover:bg-slate-200"
              >
                <p className="font-semibold text-sm text-slate-700 flex items-center gap-1.5">
                  <span className="inline-block w-3 text-slate-400">{agentOpen ? '▾' : '▸'}</span>
                  {g.name}
                  {g.pending && <span className="text-amber-600 font-normal"> (미가입)</span>}
                  <span className="text-xs text-slate-400 font-normal">({g.companies.length}개 보험사)</span>
                </p>
                <p className="text-xs text-slate-500">
                  {totalCount}건 · 보험료 {g.premium.toLocaleString('ko-KR')}원 · 수수료(지급률 적용){' '}
                  {Math.round(g.commission).toLocaleString('ko-KR')}원
                </p>
              </button>

              {agentOpen && (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs border-b border-slate-100">
                    <tr>
                      <th colSpan={4} className="p-0 font-normal">
                        <div className="flex items-center justify-between px-4 py-2">
                          <span>보험사/상품</span>
                          <span className="flex gap-6">
                            <span className="w-12 text-right">건수</span>
                            <span className="w-24 text-right">보험료</span>
                            <span className="w-28 text-right">수수료(지급률 적용)</span>
                          </span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.companies.map((cg) => {
                      const companyKey = `${g.key}|${cg.company}`
                      const companyOpen = openCompanies.has(companyKey)
                      return (
                        <Fragment key={companyKey}>
                          <tr className="border-t border-slate-50">
                            <td colSpan={4} className="p-0">
                              <button
                                onClick={() => toggleCompany(companyKey)}
                                className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-slate-50"
                              >
                                <span className="flex items-center gap-1.5">
                                  <span className="inline-block w-3 text-slate-400">{companyOpen ? '▾' : '▸'}</span>
                                  {cg.company || '(보험사 미입력)'}
                                </span>
                                <span className="flex gap-6 text-slate-600">
                                  <span className="w-12 text-right">{cg.rows.length}</span>
                                  <span className="w-24 text-right">{cg.premium.toLocaleString('ko-KR')}</span>
                                  <span className="w-28 text-right">{Math.round(cg.commission).toLocaleString('ko-KR')}</span>
                                </span>
                              </button>
                            </td>
                          </tr>
                          {companyOpen && (
                            <tr>
                              <td colSpan={4} className="px-4 pb-3">
                                <table className="w-full text-xs border border-slate-100 rounded-md overflow-hidden">
                                  <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                      <th className="text-left px-3 py-1.5">계약번호</th>
                                      <th className="text-left px-3 py-1.5">상품명</th>
                                      <th className="text-left px-3 py-1.5">계약자명</th>
                                      <th className="text-left px-3 py-1.5">피보험자명</th>
                                      <th className="text-left px-3 py-1.5">보험종목</th>
                                      <th className="text-left px-3 py-1.5">보험시기</th>
                                      <th className="text-left px-3 py-1.5">보험종기</th>
                                      <th className="text-left px-3 py-1.5">정산년월</th>
                                      <th className="text-right px-3 py-1.5">보험료</th>
                                      {!isHqStaff && (
                                        <th className="text-right px-3 py-1.5">
                                          건별수수료(지급률 {Math.round(rateFor(cg.rows[0], agentInfo(cg.rows[0])) * 100)}% 적용)
                                        </th>
                                      )}
                                      {canSeePerformanceCommission && <th className="text-right px-3 py-1.5">성과수수료</th>}
                                      {canReassign && <th className="text-left px-3 py-1.5">담당자</th>}
                                      {canReassign && <th className="px-3 py-1.5" />}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {cg.rows.map((c) => {
                                      const rate = rateFor(c, agentInfo(c))
                                      const isEditing = canReassign && editingContractId === c.id
                                      return (
                                        <tr key={c.id} className="border-t border-slate-100">
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <input
                                                value={contractEditForm.policy_no}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, policy_no: e.target.value }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1 w-28"
                                              />
                                            ) : (
                                              (c.policy_no ?? '-')
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <input
                                                value={contractEditForm.product_name}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, product_name: e.target.value }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1 w-28"
                                              />
                                            ) : (
                                              c.product_name
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <input
                                                value={contractEditForm.customer_name}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, customer_name: e.target.value }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1 w-28"
                                              />
                                            ) : (
                                              <>
                                                {c.customer_name}
                                                {c.type === '비례공동' && c.co_insurers && c.co_insurers.length > 0 && (
                                                  <span
                                                    className="ml-1 inline-block text-[10px] font-semibold text-purple-600 bg-purple-50 px-1 py-0.5 rounded cursor-help"
                                                    title={c.co_insurers.map((s) => `${s.name} ${s.ratio}%`).join(' / ')}
                                                  >
                                                    분배 {c.co_insurers.length}
                                                  </span>
                                                )}
                                                {c.type === '변경' && (
                                                  <span className="ml-1 inline-block text-[10px] font-semibold text-amber-600 bg-amber-50 px-1 py-0.5 rounded">
                                                    변경{c.change_reason ? ` · ${c.change_reason}` : ''}
                                                  </span>
                                                )}
                                              </>
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <input
                                                value={contractEditForm.insured_name}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, insured_name: e.target.value }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1 w-24"
                                              />
                                            ) : (
                                              (c.insured_name ?? '-')
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <div className="flex items-center gap-1">
                                                <select
                                                  value={contractEditForm.category}
                                                  onChange={(e) =>
                                                    setContractEditForm((f) => ({
                                                      ...f,
                                                      category: e.target.value as ContractCategory,
                                                    }))
                                                  }
                                                  className="border border-slate-200 rounded px-1 py-1 bg-white"
                                                >
                                                  {CATEGORIES.map((cat) => (
                                                    <option key={cat} value={cat}>
                                                      {cat}
                                                    </option>
                                                  ))}
                                                </select>
                                                <input
                                                  value={contractEditForm.duration_type}
                                                  onChange={(e) =>
                                                    setContractEditForm((f) => ({ ...f, duration_type: e.target.value }))
                                                  }
                                                  placeholder="기간구분"
                                                  className="border border-slate-200 rounded px-1.5 py-1 w-16"
                                                />
                                              </div>
                                            ) : (
                                              <>
                                                {c.category}
                                                {c.duration_type && (
                                                  <span className="text-slate-400"> · {c.duration_type}</span>
                                                )}
                                              </>
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <input
                                                type="date"
                                                value={contractEditForm.receipt_date}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, receipt_date: e.target.value }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1"
                                              />
                                            ) : (
                                              <div className="flex items-center gap-1">
                                                <span>{c.receipt_date ?? '-'}</span>
                                                <details className="relative">
                                                  <summary
                                                    className="relative list-none cursor-pointer leading-none text-slate-300"
                                                    title={c.memo || '메모 추가'}
                                                  >
                                                    📝
                                                    {c.memo && (
                                                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-rose-500" />
                                                    )}
                                                  </summary>
                                                  <div className="absolute left-full top-0 ml-1 z-10 bg-white border border-slate-200 rounded shadow-md p-1.5 space-y-1">
                                                    <textarea
                                                      autoFocus
                                                      defaultValue={c.memo ?? ''}
                                                      onBlur={(e) => {
                                                        if (e.target.value !== (c.memo ?? '')) updateMemo(c.id, e.target.value)
                                                      }}
                                                      placeholder="메모"
                                                      rows={3}
                                                      className="border border-slate-200 rounded px-1.5 py-1 text-xs w-40 text-left resize overflow-auto block"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        updateMemo(c.id, '')
                                                        e.currentTarget.closest('details')?.removeAttribute('open')
                                                      }}
                                                      className="text-[10px] text-rose-500 hover:underline"
                                                    >
                                                      메모 삭제
                                                    </button>
                                                  </div>
                                                </details>
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <input
                                                type="date"
                                                value={contractEditForm.expiry_date}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, expiry_date: e.target.value }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1"
                                              />
                                            ) : (
                                              (c.expiry_date ?? '-')
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {isEditing ? (
                                              <input
                                                type="month"
                                                value={contractEditForm.month}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, month: e.target.value }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1"
                                              />
                                            ) : (
                                              c.month
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5 text-right">
                                            {isEditing ? (
                                              <input
                                                type="number"
                                                value={contractEditForm.premium}
                                                onChange={(e) =>
                                                  setContractEditForm((f) => ({ ...f, premium: Number(e.target.value) }))
                                                }
                                                className="border border-slate-200 rounded px-1.5 py-1 w-24 text-right"
                                              />
                                            ) : (
                                              c.premium.toLocaleString('ko-KR')
                                            )}
                                          </td>
                                          {!isHqStaff && (
                                            <td className="px-3 py-1.5 text-right">
                                              {isEditing ? (
                                                <div>
                                                  <input
                                                    type="number"
                                                    title="지급률 적용 전 원본 건별수수료"
                                                    value={contractEditForm.commission}
                                                    onChange={(e) =>
                                                      setContractEditForm((f) => ({
                                                        ...f,
                                                        commission: Number(e.target.value),
                                                      }))
                                                    }
                                                    className="border border-slate-200 rounded px-1.5 py-1 w-24 text-right"
                                                  />
                                                  <div className="text-[9px] text-slate-400 text-right">지급률 적용 전</div>
                                                </div>
                                              ) : (
                                                Math.round(c.commission * rate).toLocaleString('ko-KR')
                                              )}
                                            </td>
                                          )}
                                          {canSeePerformanceCommission && (
                                            <td className="px-3 py-1.5 text-right">
                                              {isEditing ? (
                                                <input
                                                  type="number"
                                                  value={contractEditForm.performance_commission}
                                                  onChange={(e) =>
                                                    setContractEditForm((f) => ({
                                                      ...f,
                                                      performance_commission: Number(e.target.value),
                                                    }))
                                                  }
                                                  className="border border-slate-200 rounded px-1.5 py-1 w-24 text-right"
                                                />
                                              ) : (
                                                Math.round(c.performance_commission).toLocaleString('ko-KR')
                                              )}
                                            </td>
                                          )}
                                          {canReassign && (
                                            <td className="px-3 py-1.5">
                                              <select
                                                value={currentAgentValue(c)}
                                                onChange={(e) => reassignAgent(c.id, e.target.value)}
                                                disabled={isEditing}
                                                className="border border-slate-200 rounded px-1.5 py-1 text-xs bg-white disabled:bg-slate-50 disabled:text-slate-400"
                                              >
                                                {agentOptions.map((o) => (
                                                  <option key={o.value} value={o.value}>
                                                    {o.label}
                                                  </option>
                                                ))}
                                              </select>
                                            </td>
                                          )}
                                          {canReassign && (
                                            <td className="px-3 py-1.5 whitespace-nowrap">
                                              {isEditing ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    onClick={() => saveContractEdit(c.id)}
                                                    className="text-emerald-600 hover:underline"
                                                  >
                                                    저장
                                                  </button>
                                                  <span className="text-slate-300 mx-1">/</span>
                                                  <button
                                                    type="button"
                                                    onClick={cancelEditContract}
                                                    className="text-slate-400 hover:underline"
                                                  >
                                                    취소
                                                  </button>
                                                </>
                                              ) : (
                                                <>
                                                  <button
                                                    type="button"
                                                    onClick={() => startEditContract(c)}
                                                    className="text-indigo-600 hover:underline"
                                                  >
                                                    수정
                                                  </button>
                                                  <span className="text-slate-300 mx-1">/</span>
                                                  <button
                                                    type="button"
                                                    onClick={() => deleteContract(c.id)}
                                                    className="text-rose-500 hover:underline"
                                                  >
                                                    삭제
                                                  </button>
                                                </>
                                              )}
                                            </td>
                                          )}
                                        </tr>
                                      )
                                    })}
                                    <tr className="border-t border-slate-200 font-semibold">
                                      <td className="px-3 py-1.5" colSpan={8}>
                                        합계
                                      </td>
                                      <td className="px-3 py-1.5 text-right">{cg.premium.toLocaleString('ko-KR')}</td>
                                      {!isHqStaff && (
                                        <td className="px-3 py-1.5 text-right">
                                          {Math.round(cg.commission).toLocaleString('ko-KR')}
                                        </td>
                                      )}
                                      {canSeePerformanceCommission && (
                                        <td className="px-3 py-1.5 text-right">
                                          {Math.round(cg.performanceCommission).toLocaleString('ko-KR')}
                                        </td>
                                      )}
                                      {canReassign && <td />}
                                      {canReassign && <td />}
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>

      {durationModalOpen &&
        (() => {
          const isManager = durationModalOpen === 'manager'
          const target = isManager ? form : selfForm
          function selectDuration(opt: string) {
            if (isManager) setForm((f) => ({ ...f, duration_type: opt }))
            else setSelfForm((f) => ({ ...f, duration_type: opt }))
            setDurationModalOpen(null)
          }
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
                <div>
                  <h3 className="font-semibold text-slate-800">기간구분 선택</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    종목 &quot;{target.category}&quot;에 해당하는 기간구분을 선택하세요.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {DURATION_OPTIONS[target.category].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => selectDuration(opt)}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        target.duration_type === opt
                          ? 'border-slate-800 bg-slate-800 text-white font-medium'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setDurationModalOpen(null)}
                    className="border border-slate-300 text-slate-600 rounded-md px-3 py-1.5 text-sm hover:bg-slate-50"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {shareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-slate-800">비례공동 수수료 분배</h3>
              <p className="text-xs text-slate-500 mt-1">
                이 계약의 수수료를 나눠 가질 담당자와 비율(%)을 설정하세요. 비율 합계는 100%여야 합니다.
              </p>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {shareDraft.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={row.agent_id}
                    onChange={(e) => {
                      const a = agents.find((x) => x.id === e.target.value)
                      setShareDraft((d) =>
                        d.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                agent_id: e.target.value,
                                name: a?.name ?? '',
                              }
                            : r,
                        ),
                      )
                    }}
                    className="flex-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">담당자 선택</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id} disabled={shareDraft.some((r, i) => i !== idx && r.agent_id === a.id)}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={row.ratio}
                    onChange={(e) =>
                      setShareDraft((d) => d.map((r, i) => (i === idx ? { ...r, ratio: Number(e.target.value) } : r)))
                    }
                    className="w-20 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right"
                  />
                  <span className="text-xs text-slate-400 shrink-0">%</span>
                  <button
                    type="button"
                    onClick={() => setShareDraft((d) => d.filter((_, i) => i !== idx))}
                    className="text-rose-500 text-xs hover:underline shrink-0"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShareDraft((d) => [...d, { agent_id: '', name: '', ratio: 0 }])}
              className="text-xs text-indigo-600 hover:underline"
            >
              + 담당자 추가
            </button>
            <div className="flex items-center justify-between text-sm border-t border-slate-100 pt-3">
              <span className={shareTotal === 100 ? 'text-slate-500' : 'text-rose-600 font-medium'}>
                합계: {shareTotal}%{shareTotal !== 100 && ' (100%가 되어야 합니다)'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShareModalOpen(false)
                    if (coInsurers.length === 0) setForm((f) => ({ ...f, type: '신규' }))
                  }}
                  className="border border-slate-300 text-slate-600 rounded-md px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={shareTotal !== 100 || shareDraft.length === 0 || shareDraft.some((r) => !r.agent_id)}
                  onClick={() => {
                    setCoInsurers(shareDraft)
                    setShareModalOpen(false)
                  }}
                  className="bg-slate-800 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
