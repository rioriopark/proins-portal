import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { GENERAL_PERFORMANCE_VIEW_KEY, type Contract, type ContractCategory, type ContractType, type Profile } from '../lib/types'

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 수수료명세서의 지급월은 전월 실적을 기준으로 지급된다. 예: 26년 9월 지급월 명세서는
// 계약관리의 26년 8월(전월)분 신규계약 실적을 적용해 업적현황을 보여준다.
function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 'YYYY-MM' 두 값 사이의 개월 수 차이 (to가 from보다 몇 개월 뒤인지).
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

const ZERO_STMT = {
  recruit_first: 0,
  recruit_installment: 0,
  maintain: 0,
  clawback_revive: 0,
  general: 0,
  auto: 0,
  mgmt_fee: 0,
  collection_fee: 0,
  personal_incentive: 0,
  corporate_incentive: 0,
  general_performance: 0,
  other_incentive: 0,
  taxable_income: 0,
  industrial_accident_ins: 0,
  employment_ins: 0,
  employment_ins_support: 0,
  income_tax: 0,
  resident_tax: 0,
  incentive_offset: 0,
  other_deduction: 0,
  hq_support_offset: 0,
  workplace_cost: 0,
  unit_cost: 0,
  risk_reserve: 0,
  loan: 0,
}
type StmtFields = typeof ZERO_STMT

const INCOME_FIELDS: [keyof StmtFields, string][] = [
  ['recruit_first', '모집초회수수료'],
  ['recruit_installment', '모집분급수수료'],
  ['maintain', '유지'],
  ['clawback_revive', '환수/부활'],
  ['general', '일반'],
  ['auto', '자동차'],
]
const MGMT_FIELDS: [keyof StmtFields, string][] = [
  ['mgmt_fee', '관리수수료'],
  ['collection_fee', '수금수수료'],
]
const INCENTIVE_FIELDS: [keyof StmtFields, string][] = [
  ['personal_incentive', '개인시책'],
  ['corporate_incentive', '법인시책'],
  ['general_performance', '일반성과'],
  ['other_incentive', '기타시상'],
]
const TAX_FIELDS: [keyof StmtFields, string][] = [
  ['taxable_income', '과세소득합계'],
  ['industrial_accident_ins', '산재보험'],
  ['employment_ins', '고용보험'],
  ['employment_ins_support', '고용보험지원금'],
  ['income_tax', '소득세'],
  ['resident_tax', '주민세'],
]
const OTHER_DEDUCTION_FIELDS: [keyof StmtFields, string][] = [
  ['incentive_offset', '시상대체'],
  ['other_deduction', '기타공제'],
  ['hq_support_offset', '본사지원품대체'],
  ['workplace_cost', '사업장운영비'],
  ['unit_cost', '사업단운영비'],
]

const CATEGORY_ORDER: ContractCategory[] = ['장기', '일반', '자동차']

const DEDUCTION_SUM_FIELDS: (keyof StmtFields)[] = [
  'industrial_accident_ins',
  'employment_ins',
  'employment_ins_support',
  'income_tax',
  'resident_tax',
  'incentive_offset',
  'other_deduction',
  'hq_support_offset',
  'workplace_cost',
  'unit_cost',
  'risk_reserve',
  'loan',
]
const INCOME_SUM_FIELDS: (keyof StmtFields)[] = [
  'recruit_first',
  'recruit_installment',
  'maintain',
  'clawback_revive',
  'general',
  'auto',
  'mgmt_fee',
  'collection_fee',
  'personal_incentive',
  'corporate_incentive',
  'general_performance',
  'other_incentive',
]

export default function Statement() {
  const { profile, can } = useAuth()
  const [month, setMonth] = useState(thisMonth())
  const [agentId, setAgentId] = useState(profile?.id ?? '')
  const [agents, setAgents] = useState<Profile[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [target, setTarget] = useState<Profile | null>(profile)
  const [stmt, setStmt] = useState<StmtFields>(ZERO_STMT)
  const [saving, setSaving] = useState(false)
  const [contractListOpen, setContractListOpen] = useState(false)

  const canEdit = can('statement')
  // 위촉직 설계사(본사 소속이 아닌 agent)는 직급/관리 조직에 속하지 않아 직급수수료(관리수수료·수금수수료)와
  // 법인 단위 시상(법인시책) 대상이 아니므로 명세서에서 아예 보이지 않게 한다. "일반성과"도 기본적으로는
  // 같은 이유로 숨기지만, 조직관리 화면에서 개별로 예외(view_general_performance)를 부여받은 설계사는 볼 수 있다.
  const isFieldAgent = target?.role === 'agent' && target?.org_id !== 'hq'
  const [targetGrants, setTargetGrants] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!target) {
      setTargetGrants(new Set())
      return
    }
    supabase
      .from('menu_permissions')
      .select('menu_key')
      .eq('profile_id', target.id)
      .then(({ data }) => setTargetGrants(new Set((data ?? []).map((g) => g.menu_key))))
  }, [target])
  const canSeeGeneralPerformance = !isFieldAgent || targetGrants.has(GENERAL_PERFORMANCE_VIEW_KEY)
  const visibleIncentiveFields = INCENTIVE_FIELDS.filter(([k]) => {
    if (k === 'corporate_incentive' && isFieldAgent) return false
    if (k === 'general_performance' && !canSeeGeneralPerformance) return false
    return true
  })

  useEffect(() => {
    if (!profile) return
    if (canEdit) {
      supabase
        .from('profiles')
        .select('*')
        .order('name')
        .then(({ data }) => setAgents(data ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  useEffect(() => {
    setAgentId(profile?.id ?? '')
  }, [profile])

  useEffect(() => {
    if (!agentId) return
    // 계약관리 화면과 동일하게 지급월(month)이 아니라 실제 계약월(receipt_date)로 범위를 맞추기
    // 위해, 지급월로 서버에서 미리 좁히지 않고 이 담당자의 계약 전체를 가져와 아래
    // scopedContracts에서 클라이언트에서 걸러낸다.
    supabase
      .from('contracts')
      .select('*')
      .eq('agent_id', agentId)
      .then(({ data }) => setContracts(data ?? []))
    supabase
      .from('statements')
      .select('*')
      .eq('agent_id', agentId)
      .eq('month', month)
      .maybeSingle()
      .then(({ data }) => setStmt(data ? { ...ZERO_STMT, ...data } : ZERO_STMT))
    if (agentId === profile?.id) setTarget(profile)
    else setTarget(agents.find((a) => a.id === agentId) ?? null)
  }, [agentId, month, agents, profile])

  // 계약관리 화면과 동일하게 "월"은 지급월(month)이 아니라 실제 계약월(보험시기/receipt_date)
  // 기준이다 — 수수료가 익월 지급되는 보험사 파일은 지급월을 계약 다음 달로 적어 넣기 때문에,
  // 지급월로 걸러내면 계약관리에서 보이는 것과 건수·금액이 어긋난다. receipt_date가 없는
  // (옛 데이터 등) 행만 지급월로 대체한다.
  const contractMonthOf = (c: Contract) => c.receipt_date?.slice(0, 7) || c.month
  const contractMonth = useMemo(() => prevMonth(month), [month])
  const scopedContracts = useMemo(
    () => contracts.filter((c) => contractMonthOf(c) === contractMonth),
    [contracts, contractMonth],
  )

  // "적용된 계약 내역": 담당자가 본인 수수료명세서에 어떤 계약이 반영됐는지 직접 확인할 수 있게,
  // 업적현황과 동일한 기준(수수료 0원 트래킹용 행 제외)으로 개별 계약을 나열한다.
  const contractListRows = useMemo(
    () =>
      scopedContracts
        .filter((c) => c.commission !== 0)
        .slice()
        .sort((a, b) => {
          const byCategory = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
          if (byCategory !== 0) return byCategory
          return (b.receipt_date ?? '').localeCompare(a.receipt_date ?? '')
        }),
    [scopedContracts],
  )

  // 수수료 0원 건(계속 확정 전 등, 아직 실적으로 잡히지 않는 트래킹용 행)은 계약관리 화면과
  // 동일하게 업적현황 집계에서도 제외한다.
  function group(categories: ContractCategory[]) {
    const byKey = new Map<string, { category: ContractCategory; type: ContractType; count: number; premium: number }>()
    for (const c of scopedContracts.filter((c) => categories.includes(c.category) && c.commission !== 0)) {
      const key = `${c.category}__${c.type}`
      const cur = byKey.get(key) ?? { category: c.category, type: c.type, count: 0, premium: 0 }
      cur.count += c.count
      cur.premium += c.premium
      byKey.set(key, cur)
    }
    return [...byKey.values()]
  }

  const longRows = useMemo(() => group(['장기']), [scopedContracts])
  const generalAutoRows = useMemo(() => group(['일반', '자동차']), [scopedContracts])
  const longTotal = longRows.reduce((s, r) => s + r.premium, 0)
  const longCount = longRows.reduce((s, r) => s + r.count, 0)
  const gaTotal = generalAutoRows.reduce((s, r) => s + r.premium, 0)
  const gaCount = generalAutoRows.reduce((s, r) => s + r.count, 0)

  // 지급률 자동계산: 건별수수료(contracts.commission) × 담당자 지급률(장기/일반)을 계약 유형별로 나눠 합산한다.
  // - 모집초회수수료: 장기·신규(비례공동 포함) 중 지급월이 계약월 기준 1개월 이내
  // - 모집분급수수료: 장기·신규(비례공동 포함) 중 지급월이 계약월 기준 2개월 이후 (24개월 초과분도 계속 지급 중인
  //   것으로 보고 여기 포함 — 계약관리 화면의 수수료 합계와 어긋나지 않도록, 알 수 없는 값은 버리지 않는다)
  // - 유지: 장기 중 신규/비례공동이 아닌 나머지 전부(계속·부활 등 그 외 값 포함)
  // - 환수/부활: 종목 무관, 환수·부활 (해당 건의 종목에 맞는 지급률 적용)
  // - 일반/자동차: 환수·부활을 제외한 나머지 전부 (계약관리 화면과 동일하게 유형 값을 가리지 않고 합산)
  // 관리수수료·수금수수료는 직급/관리자 여부에 따른 별도 기준이 필요해 자동계산 대상에서 제외한다.
  // 일반성과는 종목='일반' 계약의 성과수수료(contracts.performance_commission — 계약관리 보험사
  // 확정 파일 업로드 시 함께 들어오는 값, 건별수수료와 별개) 합 × 개별 성과비율
  // (target.general_performance_rate, 조직관리에서 대상자만 0보다 크게 설정)로 계산한다.
  const autoCalc = useMemo(() => {
    if (!target) return null
    let recruitFirst = 0
    let recruitInstallment = 0
    let maintainAmt = 0
    let clawbackRevive = 0
    let generalAmt = 0
    let autoAmt = 0
    let generalPerformanceCommission = 0
    for (const c of scopedContracts) {
      const rate = c.category === '장기' ? target.rate_long : target.rate_general
      const amount = c.commission * rate
      if (c.category === '일반') generalPerformanceCommission += c.performance_commission
      if (c.type === '환수' || c.type === '부활') {
        clawbackRevive += amount
      } else if (c.category === '장기') {
        const offset = c.receipt_date ? monthsBetween(c.receipt_date.slice(0, 7), c.month) : NaN
        if ((c.type === '신규' || c.type === '비례공동') && !Number.isNaN(offset) && offset <= 1) {
          recruitFirst += amount
        } else if ((c.type === '신규' || c.type === '비례공동') && !Number.isNaN(offset) && offset >= 2) {
          recruitInstallment += amount
        } else {
          maintainAmt += amount
        }
      } else if (c.category === '일반') {
        generalAmt += amount
      } else if (c.category === '자동차') {
        autoAmt += amount
      }
    }
    return {
      recruit_first: Math.round(recruitFirst),
      recruit_installment: Math.round(recruitInstallment),
      maintain: Math.round(maintainAmt),
      clawback_revive: Math.round(clawbackRevive),
      general: Math.round(generalAmt),
      auto: Math.round(autoAmt),
      general_performance: Math.round(generalPerformanceCommission * (target.general_performance_rate || 0)),
    }
  }, [scopedContracts, target])

  function applyAutoCalc() {
    if (!autoCalc) return
    setStmt((s) => ({ ...s, ...autoCalc }))
  }

  const totalIncome = INCOME_SUM_FIELDS.reduce((s, k) => s + Number(stmt[k] || 0), 0)
  const totalDeduction = DEDUCTION_SUM_FIELDS.reduce((s, k) => s + Number(stmt[k] || 0), 0)
  const netPay = totalIncome - totalDeduction

  function setField(key: keyof StmtFields, value: number) {
    setStmt((s) => ({ ...s, [key]: value }))
  }

  async function save() {
    if (!target) return
    setSaving(true)
    const { error } = await supabase
      .from('statements')
      .upsert(
        { agent_id: target.id, agent_email: target.email, month, ...stmt, updated_at: new Date().toISOString() },
        { onConflict: 'agent_email,month' },
      )
    setSaving(false)
    if (error) alert('저장 실패: ' + error.message)
  }

  function NumberField({ k, label }: { k: keyof StmtFields; label: string }) {
    return (
      <div className="flex items-center justify-between text-sm py-1">
        <span className="text-slate-500">{label}</span>
        {canEdit ? (
          <input
            type="number"
            value={stmt[k]}
            onChange={(e) => setField(k, Number(e.target.value))}
            className="w-32 border border-slate-200 rounded px-2 py-1 text-right text-sm"
          />
        ) : (
          <span>{Number(stmt[k] || 0).toLocaleString('ko-KR')}</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">수수료명세서</h1>
          <p className="text-sm text-slate-500 mt-1">
            {canEdit ? '관리자 권한으로 명세를 조회·수정할 수 있습니다.' : '본인 명세서만 조회할 수 있습니다.'}
          </p>
        </div>
        <div className="flex gap-2 items-end">
          {canEdit && (
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {target && (
        <div className="bg-white rounded-xl shadow p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="bg-rose-600 text-white text-[10px] font-bold rounded px-2 py-1 leading-tight">
                PRO
                <br />
                INS
              </span>
              <span className="font-bold text-slate-800">프로인스컴퍼니</span>
            </div>
            <span className="text-sm font-semibold text-slate-500">수수료명세서</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-y border-slate-100 py-4">
            <div>
              <p className="text-xs text-slate-400">지급월</p>
              <p className="font-medium">{month}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">성명</p>
              <p className="font-medium">{target.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">소속</p>
              <p className="font-medium">-</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">직급</p>
              <p className="font-medium">{target.title}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">은행</p>
              <p className="font-medium">{target.bank || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">계좌번호</p>
              <p className="font-medium">{target.account || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">장기/일반 지급률</p>
              <p className="font-medium">
                {Math.round(target.rate_long * 100)}% / {Math.round(target.rate_general * 100)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">자동차 지급률</p>
              <p className="font-medium">{Math.round(target.rate_general * 100)}%</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">합산소득</p>
              <p className="font-bold text-lg">{totalIncome.toLocaleString('ko-KR')} 원</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">공제계</p>
              <p className="font-bold text-lg">{totalDeduction.toLocaleString('ko-KR')} 원</p>
            </div>
            <div className="bg-rose-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">실지급액</p>
              <p className="font-bold text-lg text-rose-600">{netPay.toLocaleString('ko-KR')} 원</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-t-md flex items-center justify-between">
                <span>업적현황 (장기)</span>
                <span className="font-normal text-slate-300">{contractMonth} 실적 기준</span>
              </p>
              <table className="w-full text-sm border border-t-0 border-slate-100 rounded-b-md overflow-hidden">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">구분</th>
                    <th className="text-right px-3 py-1.5">건수</th>
                    <th className="text-right px-3 py-1.5">보험료</th>
                  </tr>
                </thead>
                <tbody>
                  {(['신규', '계속', '환수', '부활'] as ContractType[]).map((t) => {
                    const r = longRows.find((x) => x.type === t)
                    return (
                      <tr key={t} className="border-t border-slate-50">
                        <td className="px-3 py-1.5">{t}</td>
                        <td className="px-3 py-1.5 text-right">{r?.count ?? 0}</td>
                        <td className="px-3 py-1.5 text-right">{(r?.premium ?? 0).toLocaleString('ko-KR')}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="px-3 py-1.5">합계</td>
                    <td className="px-3 py-1.5 text-right">{longCount}</td>
                    <td className="px-3 py-1.5 text-right">{longTotal.toLocaleString('ko-KR')}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <p className="bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-t-md flex items-center justify-between">
                <span>자동차 / 일반 실적</span>
                <span className="font-normal text-slate-300">{contractMonth} 실적 기준</span>
              </p>
              <table className="w-full text-sm border border-t-0 border-slate-100 rounded-b-md overflow-hidden">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">종류</th>
                    <th className="text-left px-3 py-1.5">구분</th>
                    <th className="text-right px-3 py-1.5">건수</th>
                    <th className="text-right px-3 py-1.5">보험료</th>
                  </tr>
                </thead>
                <tbody>
                  {generalAutoRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-center text-slate-400">
                        실적 없음
                      </td>
                    </tr>
                  )}
                  {generalAutoRows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="px-3 py-1.5">{r.category}</td>
                      <td className="px-3 py-1.5">{r.type}</td>
                      <td className="px-3 py-1.5 text-right">{r.count}</td>
                      <td className="px-3 py-1.5 text-right">{r.premium.toLocaleString('ko-KR')}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="px-3 py-1.5" colSpan={2}>
                      합계
                    </td>
                    <td className="px-3 py-1.5 text-right">{gaCount}</td>
                    <td className="px-3 py-1.5 text-right">{gaTotal.toLocaleString('ko-KR')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setContractListOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 bg-slate-100 px-3 py-2 text-left hover:bg-slate-200 rounded-t-md"
            >
              <span className="inline-block w-3 text-slate-400">{contractListOpen ? '▾' : '▸'}</span>
              <span className="font-semibold text-sm text-slate-700">적용된 계약 내역</span>
              <span className="text-xs text-slate-400">
                ({contractListRows.length}건, {contractMonth} 계약월 기준)
              </span>
            </button>
            {contractListOpen && (
              <div className="overflow-x-auto border border-t-0 border-slate-100 rounded-b-md">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">보험사</th>
                      <th className="text-left px-3 py-1.5">증권번호</th>
                      <th className="text-left px-3 py-1.5">상품명</th>
                      <th className="text-left px-3 py-1.5">계약자명</th>
                      <th className="text-left px-3 py-1.5">종목</th>
                      <th className="text-left px-3 py-1.5">구분</th>
                      <th className="text-left px-3 py-1.5">보험시기</th>
                      <th className="text-right px-3 py-1.5">보험료</th>
                      <th className="text-right px-3 py-1.5">수수료(지급률 적용)</th>
                      {canSeeGeneralPerformance && <th className="text-right px-3 py-1.5">성과수수료</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {contractListRows.length === 0 && (
                      <tr>
                        <td colSpan={canSeeGeneralPerformance ? 10 : 9} className="px-3 py-3 text-center text-slate-400">
                          반영된 계약이 없습니다.
                        </td>
                      </tr>
                    )}
                    {contractListRows.map((c) => (
                      <tr key={c.id} className="border-t border-slate-50">
                        <td className="px-3 py-1.5">{c.company}</td>
                        <td className="px-3 py-1.5">{c.policy_no ?? '-'}</td>
                        <td className="px-3 py-1.5">{c.product_name || '-'}</td>
                        <td className="px-3 py-1.5">{c.customer_name}</td>
                        <td className="px-3 py-1.5">{c.category}</td>
                        <td className="px-3 py-1.5">{c.type}</td>
                        <td className="px-3 py-1.5">{c.receipt_date ?? '-'}</td>
                        <td className="px-3 py-1.5 text-right">{c.premium.toLocaleString('ko-KR')}</td>
                        <td className="px-3 py-1.5 text-right">
                          {Math.round(
                            c.commission * (c.category === '장기' ? target.rate_long : target.rate_general),
                          ).toLocaleString('ko-KR')}
                        </td>
                        {canSeeGeneralPerformance && (
                          <td className="px-3 py-1.5 text-right">
                            {Math.round(c.performance_commission).toLocaleString('ko-KR')}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-t-md">급여명세</p>
              <div className="border border-t-0 border-slate-100 rounded-b-md p-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-400">업적수수료</p>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={applyAutoCalc}
                        disabled={!autoCalc}
                        title="건별수수료 × 지급률로 모집초회/모집분급/유지/환수·부활/일반/자동차를 자동 계산해 채웁니다. 일반성과는 일반 계약의 성과수수료 합 × 개별 성과비율로 함께 계산됩니다. 관리수수료·수금수수료는 대상이 아닙니다."
                        className="text-[11px] text-indigo-600 hover:underline disabled:opacity-40 disabled:no-underline"
                      >
                        지급률 자동계산
                      </button>
                    )}
                  </div>
                  {INCOME_FIELDS.map(([k, label]) => (
                    <NumberField key={k} k={k} label={label} />
                  ))}
                </div>
                {!isFieldAgent && (
                  <div>
                    <p className="text-xs font-semibold text-slate-400 mb-1">직급수수료</p>
                    {MGMT_FIELDS.map(([k, label]) => (
                      <NumberField key={k} k={k} label={label} />
                    ))}
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">시상내역</p>
                  {visibleIncentiveFields.map(([k, label]) => (
                    <NumberField key={k} k={k} label={label} />
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold">
                  <span>① 합계</span>
                  <span>{totalIncome.toLocaleString('ko-KR')} 원</span>
                </div>
              </div>
            </div>

            <div>
              <p className="bg-rose-600 text-white text-xs font-semibold px-3 py-1.5 rounded-t-md">공제명세</p>
              <div className="border border-t-0 border-slate-100 rounded-b-md p-3 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">세금</p>
                  {TAX_FIELDS.map(([k, label]) => (
                    <NumberField key={k} k={k} label={label} />
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">기타공제</p>
                  {OTHER_DEDUCTION_FIELDS.map(([k, label]) => (
                    <NumberField key={k} k={k} label={label} />
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">위험적립금</p>
                  <NumberField k="risk_reserve" label="적립" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">기타</p>
                  <NumberField k="loan" label="대여금" />
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold">
                  <span>② 공제 합계</span>
                  <span className="text-rose-600">{totalDeduction.toLocaleString('ko-KR')} 원</span>
                </div>
              </div>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button
                onClick={save}
                disabled={saving}
                className="bg-slate-800 text-white rounded-md px-5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          )}

          <div className="bg-amber-50 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="font-semibold text-slate-700">③ 실지급액 (① - ②)</span>
            <span className="font-bold text-xl text-amber-700">{netPay.toLocaleString('ko-KR')} 원</span>
          </div>

          <p className="text-center text-xs text-slate-400 pt-2">
            귀하의 노고에 진심으로 감사드립니다.
            <br />
            (주)프로인스컴퍼니
          </p>
        </div>
      )}
    </div>
  )
}
