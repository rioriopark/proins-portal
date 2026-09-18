import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, ContractCategory, ContractType, Profile } from '../lib/types'

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

  const canEdit = can('statement')

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
    supabase
      .from('contracts')
      .select('*')
      .eq('agent_id', agentId)
      .eq('month', prevMonth(month))
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

  function group(categories: ContractCategory[]) {
    const byKey = new Map<string, { category: ContractCategory; type: ContractType; count: number; premium: number }>()
    for (const c of contracts.filter((c) => categories.includes(c.category))) {
      const key = `${c.category}__${c.type}`
      const cur = byKey.get(key) ?? { category: c.category, type: c.type, count: 0, premium: 0 }
      cur.count += c.count
      cur.premium += c.premium
      byKey.set(key, cur)
    }
    return [...byKey.values()]
  }

  const contractMonth = useMemo(() => prevMonth(month), [month])
  const longRows = useMemo(() => group(['장기']), [contracts])
  const generalAutoRows = useMemo(() => group(['일반', '자동차']), [contracts])
  const longTotal = longRows.reduce((s, r) => s + r.premium, 0)
  const longCount = longRows.reduce((s, r) => s + r.count, 0)
  const gaTotal = generalAutoRows.reduce((s, r) => s + r.premium, 0)
  const gaCount = generalAutoRows.reduce((s, r) => s + r.count, 0)

  // 지급률 자동계산: 건별수수료(contracts.commission) × 담당자 지급률(장기/일반)을 계약 유형별로 나눠 합산한다.
  // - 모집초회수수료: 장기·신규(비례공동 포함) 중 지급월이 계약월 기준 1개월 이내
  // - 모집분급수수료: 장기·신규(비례공동 포함) 중 지급월이 계약월 기준 2~24개월
  // - 유지: 장기·계속
  // - 환수/부활: 종목 무관, 환수·부활 (해당 건의 종목에 맞는 지급률 적용)
  // - 일반/자동차: 각 종목의 신규·계속·비례공동 (환수/부활은 위에서 이미 반영해 중복 집계하지 않음)
  // 관리수수료·수금수수료는 직급/관리자 여부에 따른 별도 기준이 필요해 자동계산 대상에서 제외한다.
  const autoCalc = useMemo(() => {
    if (!target) return null
    let recruitFirst = 0
    let recruitInstallment = 0
    let maintainAmt = 0
    let clawbackRevive = 0
    let generalAmt = 0
    let autoAmt = 0
    for (const c of contracts) {
      const rate = c.category === '장기' ? target.rate_long : target.rate_general
      const amount = c.commission * rate
      if (c.type === '환수' || c.type === '부활') {
        clawbackRevive += amount
      } else if (c.category === '장기') {
        if (c.type === '신규' || c.type === '비례공동') {
          if (!c.receipt_date) continue
          const offset = monthsBetween(c.receipt_date.slice(0, 7), c.month)
          if (offset <= 1) recruitFirst += amount
          else if (offset <= 24) recruitInstallment += amount
        } else if (c.type === '계속') {
          maintainAmt += amount
        }
      } else if (c.category === '일반') {
        if (c.type === '신규' || c.type === '계속' || c.type === '비례공동') generalAmt += amount
      } else if (c.category === '자동차') {
        if (c.type === '신규' || c.type === '계속' || c.type === '비례공동') autoAmt += amount
      }
    }
    return {
      recruit_first: Math.round(recruitFirst),
      recruit_installment: Math.round(recruitInstallment),
      maintain: Math.round(maintainAmt),
      clawback_revive: Math.round(clawbackRevive),
      general: Math.round(generalAmt),
      auto: Math.round(autoAmt),
    }
  }, [contracts, target])

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
                        title="건별수수료 × 지급률로 모집초회/모집분급/유지/환수·부활/일반/자동차를 자동 계산해 채웁니다. 관리수수료·수금수수료는 대상이 아닙니다."
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
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">직급수수료</p>
                  {MGMT_FIELDS.map(([k, label]) => (
                    <NumberField key={k} k={k} label={label} />
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">시상내역</p>
                  {INCENTIVE_FIELDS.map(([k, label]) => (
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
