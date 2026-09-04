import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Banner, Contract, EducationEvent, Profile, Statement } from '../lib/types'

// 별도 만기일 필드가 없어 영수일 + 1년을 계약 만기(갱신 예정일)로 추정한다.
function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0, 10)
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0)
}

function changeRate(curr: number, prev: number): { pct: number; up: boolean } | null {
  if (!prev) return null
  const pct = ((curr - prev) / Math.abs(prev)) * 100
  return { pct: Math.abs(pct), up: curr >= prev }
}

const ICON_STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IconWon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}>
      <path d="M4 6h16M2 10h20M6 10l2.5 8L12 12l3.5 6L18 10" />
    </svg>
  )
}
function IconDocCheck() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M9 13.5l2 2 4-4.5" />
    </svg>
  )
}
function IconWallet() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-4a2 2 0 1 0 0 4h5" />
    </svg>
  )
}
function IconTrendUp() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}>
      <path d="M4 16l6-6 4 4 6-7" />
      <path d="M14 7h6v6" />
    </svg>
  )
}
function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
      <path d="M4 4.5v4h4M20 19.5v-4h-4" />
    </svg>
  )
}
function IconBell() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" {...ICON_STROKE}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}
function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...ICON_STROKE}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4v1a4 4 0 0 0 4 4M17 5h3v1a4 4 0 0 1-4 4" />
      <path d="M12 14v3M9 20h6M9.5 20c0-1.7.7-3 2.5-3s2.5 1.3 2.5 3" />
    </svg>
  )
}

const STAT_COLORS = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600' },
} as const

// 각 보험사가 자체 운영하는 GA/설계사용 업무포털 바로가기 (프로인스포탈 내부 페이지가 아님)
const PORTAL_LINKS = [
  { name: '삼성화재', portal: '드림포탈', url: 'https://erp.samsungfire.com/', badge: '삼성', color: 'bg-blue-600' },
  { name: 'DB손보', portal: '영업포탈', url: 'https://www.mdbins.com', badge: 'DB', color: 'bg-sky-600' },
  { name: '현대해상', portal: '영업포탈', url: 'https://sp.hi.co.kr', badge: '현대', color: 'bg-orange-500' },
  { name: 'KB손보', portal: '전용포탈', url: 'https://sales.kbinsure.co.kr', badge: 'KB', color: 'bg-amber-500' },
  { name: '메리츠화재', portal: '영업포탈', url: 'https://sales.meritzfire.com', badge: '메리츠', color: 'bg-teal-600' },
  { name: '롯데손해보험', portal: '영업포탈', url: 'http://lottero.lotteins.co.kr', badge: '롯데', color: 'bg-red-600' },
  { name: '라이나손보', portal: '영업포탈', url: 'https://ga.linagi.com/', badge: '라이나', color: 'bg-indigo-600' },
  { name: '한화손해보험', portal: '스마트포탈', url: 'https://portal.hwgeneralins.com/', badge: '한화', color: 'bg-rose-600' },
  { name: 'AIG손해보험', portal: '', url: 'https://sso.aig.co.kr/gaLogin/gaLogin.jsp', badge: 'AIG', color: 'bg-slate-700' },
]

function PortalLinksBar() {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-xs font-semibold text-slate-500 mb-3">보험사 업무포털 바로가기</p>
      <div className="flex flex-wrap gap-3">
        {PORTAL_LINKS.map((p) => (
          <a
            key={p.name}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center w-20 text-center group"
            title={`${p.name} ${p.portal}`.trim()}
          >
            <div
              className={`w-12 h-12 rounded-2xl ${p.color} text-white flex items-center justify-center text-xs font-bold shadow-sm group-hover:opacity-90`}
            >
              {p.badge}
            </div>
            <span className="text-[11px] text-slate-600 mt-1.5 leading-tight">{p.name}</span>
            {p.portal && <span className="text-[10px] text-slate-400 leading-tight">{p.portal}</span>}
          </a>
        ))}
      </div>
    </div>
  )
}

const RENEWAL_BUCKETS = [
  { days: 90, label: '90일 이내', color: 'bg-blue-500' },
  { days: 60, label: '60일 이내', color: 'bg-emerald-500' },
  { days: 30, label: '30일 이내', color: 'bg-amber-500' },
  { days: 7, label: '7일 이내', color: 'bg-rose-500' },
]

const ZERO_STMT_SUBSET = {
  recruit_first: 0, recruit_installment: 0, maintain: 0, clawback_revive: 0, general: 0, auto: 0,
  mgmt_fee: 0, collection_fee: 0, personal_incentive: 0, corporate_incentive: 0, general_performance: 0, other_incentive: 0,
  industrial_accident_ins: 0, employment_ins: 0, employment_ins_support: 0, income_tax: 0, resident_tax: 0,
  incentive_offset: 0, other_deduction: 0, hq_support_offset: 0, workplace_cost: 0, unit_cost: 0, risk_reserve: 0, loan: 0,
}
const INCOME_SUM_FIELDS: (keyof typeof ZERO_STMT_SUBSET)[] = [
  'recruit_first', 'recruit_installment', 'maintain', 'clawback_revive', 'general', 'auto',
  'mgmt_fee', 'collection_fee', 'personal_incentive', 'corporate_incentive', 'general_performance', 'other_incentive',
]
const DEDUCTION_SUM_FIELDS: (keyof typeof ZERO_STMT_SUBSET)[] = [
  'industrial_accident_ins', 'employment_ins', 'employment_ins_support', 'income_tax', 'resident_tax',
  'incentive_offset', 'other_deduction', 'hq_support_offset', 'workplace_cost', 'unit_cost', 'risk_reserve', 'loan',
]

export default function Dashboard() {
  const { profile } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<{ email: string; name: string }[]>([])
  const [eduEvents, setEduEvents] = useState<EducationEvent[]>([])
  const [myStatement, setMyStatement] = useState<Statement | null>(null)
  const [showAllNotices, setShowAllNotices] = useState(false)
  const [showAllEdu, setShowAllEdu] = useState(false)

  useEffect(() => {
    supabase.from('contracts').select('*').then(({ data }) => setContracts(data ?? []))
    supabase.from('banners').select('*').order('created_at', { ascending: false }).then(({ data }) => setBanners(data ?? []))
    supabase.from('profiles').select('*').then(({ data }) => setAgents(data ?? []))
    supabase.from('pending_invites').select('email, name').then(({ data }) => setInvites(data ?? []))
    supabase.from('education_events').select('*').order('event_date').then(({ data }) => setEduEvents(data ?? []))
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const todayLabel = today.replaceAll('-', '.')
  const thisYear = today.slice(0, 4)
  const lastYear = String(Number(thisYear) - 1)
  const thisMonthNum = today.slice(5, 7)
  const thisMonth = today.slice(0, 7)
  const lastYearMonth = `${lastYear}-${thisMonthNum}`

  useEffect(() => {
    if (!profile) return
    supabase.from('statements').select('*').eq('agent_id', profile.id).eq('month', thisMonth).maybeSingle()
      .then(({ data }) => setMyStatement(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, thisMonth])

  const activeBanners = useMemo(() => {
    return showAllNotices ? banners : banners.slice(0, 4)
  }, [banners, showAllNotices])

  const agentName = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a.name]))
    const byEmail = new Map(invites.map((i) => [i.email, i.name]))
    return (c: Contract) => {
      if (c.agent_id === profile?.id) return profile.name
      if (c.agent_id && byId.has(c.agent_id)) return byId.get(c.agent_id)!
      if (c.agent_email && byEmail.has(c.agent_email)) return byEmail.get(c.agent_email)!
      return c.agent_email ?? c.agent_id ?? '-'
    }
  }, [agents, invites, profile])

  // 누적(전체 기간) 실적
  const totalPremiumAll = useMemo(() => sum(contracts, (c) => c.premium), [contracts])
  const totalCountAll = useMemo(() => sum(contracts, (c) => c.count), [contracts])
  const totalCommissionAll = useMemo(() => sum(contracts, (c) => c.commission), [contracts])

  // 전년 대비 증감률 계산용: 올해 vs 작년 동기간(1월~이번달) 누계
  const ytd = useMemo(() => {
    const inRange = (yr: string) => (c: Contract) => c.month?.startsWith(yr) && c.month.slice(5, 7) <= thisMonthNum
    const thisYearRows = contracts.filter(inRange(thisYear))
    const lastYearRows = contracts.filter(inRange(lastYear))
    return {
      premium: changeRate(sum(thisYearRows, (c) => c.premium), sum(lastYearRows, (c) => c.premium)),
      count: changeRate(sum(thisYearRows, (c) => c.count), sum(lastYearRows, (c) => c.count)),
      commission: changeRate(sum(thisYearRows, (c) => c.commission), sum(lastYearRows, (c) => c.commission)),
    }
  }, [contracts, thisYear, lastYear, thisMonthNum])

  const newPremiumThisMonth = useMemo(
    () => sum(contracts.filter((c) => c.month === thisMonth && c.type === '신규'), (c) => c.premium),
    [contracts, thisMonth]
  )
  const newPremiumLastYear = useMemo(
    () => sum(contracts.filter((c) => c.month === lastYearMonth && c.type === '신규'), (c) => c.premium),
    [contracts, lastYearMonth]
  )
  const renewPremiumThisMonth = useMemo(
    () => sum(contracts.filter((c) => c.month === thisMonth && c.type === '계속'), (c) => c.premium),
    [contracts, thisMonth]
  )
  const renewPremiumLastYear = useMemo(
    () => sum(contracts.filter((c) => c.month === lastYearMonth && c.type === '계속'), (c) => c.premium),
    [contracts, lastYearMonth]
  )

  const statCards = [
    { label: '누적 보험료', value: `${totalPremiumAll.toLocaleString('ko-KR')}원`, rate: ytd.premium, color: 'blue' as const, icon: <IconWon /> },
    { label: '누적 계약 건수', value: `${totalCountAll.toLocaleString('ko-KR')}건`, rate: ytd.count, color: 'emerald' as const, icon: <IconDocCheck /> },
    { label: '누적 수수료', value: `${totalCommissionAll.toLocaleString('ko-KR')}원`, rate: ytd.commission, color: 'violet' as const, icon: <IconWallet /> },
    { label: `신규보험료(${Number(thisMonthNum)}월)`, value: `${newPremiumThisMonth.toLocaleString('ko-KR')}원`, rate: changeRate(newPremiumThisMonth, newPremiumLastYear), color: 'amber' as const, icon: <IconTrendUp /> },
    { label: `갱신보험료(${Number(thisMonthNum)}월)`, value: `${renewPremiumThisMonth.toLocaleString('ko-KR')}원`, rate: changeRate(renewPremiumThisMonth, renewPremiumLastYear), color: 'teal' as const, icon: <IconRefresh /> },
  ]

  // 갱신센터: 일반/자동차 계약의 영수일+1년을 만기 예정일로 보고 기간별로 집계
  const renewalRows = useMemo(
    () =>
      contracts
        .filter((c) => (c.category === '일반' || c.category === '자동차') && c.receipt_date)
        .map((c) => ({ c, expiry: addYears(c.receipt_date!, 1) })),
    [contracts]
  )
  const renewalBuckets = useMemo(
    () =>
      RENEWAL_BUCKETS.map(({ days, label, color }) => {
        const end = addDays(today, days)
        const rows = renewalRows.filter(({ expiry }) => expiry >= today && expiry <= end)
        return { days, label, color, count: rows.length, premium: sum(rows, ({ c }) => c.premium) }
      }),
    [renewalRows, today]
  )
  const maxBucketCount = Math.max(1, ...renewalBuckets.map((b) => b.count))

  // 수수료 현황: 본인 명세서(확정 소득/실지급) + 이번달 계약 기준 예상치
  const myContractsThisMonth = useMemo(
    () => contracts.filter((c) => c.month === thisMonth && (c.agent_id === profile?.id)),
    [contracts, thisMonth, profile]
  )
  const confirmedIncome = myStatement ? INCOME_SUM_FIELDS.reduce((s, k) => s + Number(myStatement[k] ?? 0), 0) : 0
  const confirmedDeduction = myStatement ? DEDUCTION_SUM_FIELDS.reduce((s, k) => s + Number(myStatement[k] ?? 0), 0) : 0
  const expectedPayout = myStatement ? confirmedIncome - confirmedDeduction : 0
  const estimatedCommission = sum(myContractsThisMonth, (c) => c.commission)
  const expectedClawback = sum(myContractsThisMonth.filter((c) => c.type === '환수'), (c) => Math.abs(c.commission))

  // 설계사 실적 TOP5 (이번달, 조회 가능한 범위 내)
  const topAgents = useMemo(() => {
    const byAgent = new Map<string, { key: string; premium: number; count: number; sample: Contract }>()
    for (const c of contracts.filter((c) => c.month === thisMonth)) {
      const key = c.agent_id ?? c.agent_email ?? 'unknown'
      const cur = byAgent.get(key) ?? { key, premium: 0, count: 0, sample: c }
      cur.premium += c.premium
      cur.count += c.count
      byAgent.set(key, cur)
    }
    return [...byAgent.values()].sort((a, b) => b.premium - a.premium).slice(0, 5)
  }, [contracts, thisMonth])

  const displayedEdu = showAllEdu ? eduEvents : eduEvents.filter((e) => e.event_date >= today).slice(0, 4)

  return (
    <div className="space-y-6">
      <PortalLinksBar />

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            안녕하세요, {profile?.title || profile?.name}님!
          </h1>
          <p className="text-sm text-slate-500 mt-1">오늘도 프로인스포탈과의 성장을 응원합니다.</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">{todayLabel} 기준</span>
          <div className="relative text-slate-400">
            <IconBell />
            {activeBanners.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-rose-500 text-white text-[9px] leading-[14px] text-center">
                {activeBanners.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-slate-700 text-white flex items-center justify-center text-sm font-semibold">
              {profile?.name?.slice(0, 1) ?? '?'}
            </div>
            <div className="text-sm leading-tight">
              <p className="font-semibold text-slate-800">{profile?.name}{profile?.title ? ` ${profile.title}님` : ''}</p>
              <p className="text-xs text-slate-400">프로인스포탈</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-xl shadow p-5">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-3 ${STAT_COLORS[s.color].bg} ${STAT_COLORS[s.color].text}`}>
              {s.icon}
            </div>
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-lg font-bold mt-1 text-slate-800">{s.value}</p>
            {s.rate && (
              <p className={`text-xs mt-1 font-medium ${s.rate.up ? 'text-emerald-600' : 'text-rose-600'}`}>
                전년 대비 {s.rate.pct.toFixed(1)}% {s.rate.up ? '↑' : '↓'}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-5 flex flex-col">
          <p className="text-sm font-semibold mb-4">갱신센터</p>
          <div className="grid grid-cols-4 gap-2 text-center mb-3">
            {renewalBuckets.map((b) => (
              <div key={b.days}>
                <p className="text-xs text-slate-400">{b.label}</p>
                <p className="text-lg font-bold text-slate-800 mt-1">{b.count}건</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{b.premium.toLocaleString('ko-KR')}원</p>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-1.5 h-10 mb-5">
            {renewalBuckets.map((b) => (
              <div key={b.days} className="flex-1 flex items-end">
                <div
                  className={`w-full rounded-t ${b.color}`}
                  style={{ height: `${Math.max(6, (b.count / maxBucketCount) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <Link
            to="/contracts"
            className="mt-auto text-center text-sm font-medium text-white bg-slate-800 rounded-md py-2 hover:bg-slate-700"
          >
            갱신관리 바로가기
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow p-5 flex flex-col">
          <p className="text-sm font-semibold mb-4">수수료 현황</p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">이번달 확정</p>
              <p className="font-bold text-emerald-600 mt-1">{confirmedIncome.toLocaleString('ko-KR')}원</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">지급예정</p>
              <p className="font-bold text-blue-600 mt-1">{expectedPayout.toLocaleString('ko-KR')}원</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">예상수수료</p>
              <p className="font-bold text-amber-600 mt-1">{estimatedCommission.toLocaleString('ko-KR')}원</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">환수예정</p>
              <p className="font-bold text-rose-600 mt-1">{expectedClawback.toLocaleString('ko-KR')}원</p>
            </div>
          </div>
          <Link
            to="/statement"
            className="mt-auto text-center text-sm font-medium text-white bg-slate-800 rounded-md py-2 hover:bg-slate-700"
          >
            수수료명세서 보기
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center gap-1.5 mb-4">
            <IconTrophy />
            <p className="text-sm font-semibold">설계사 실적 TOP 5 (이번달)</p>
          </div>
          {topAgents.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">이번달 등록된 실적이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-xs">
                <tr>
                  <th className="text-left py-1.5 font-medium w-8">순위</th>
                  <th className="text-left py-1.5 font-medium">설계사</th>
                  <th className="text-right py-1.5 font-medium">보험료(원)</th>
                  <th className="text-right py-1.5 font-medium">계약건수</th>
                </tr>
              </thead>
              <tbody>
                {topAgents.map((a, i) => (
                  <tr key={a.key} className="border-t border-slate-50">
                    <td className="py-2">
                      <span
                        className={`inline-flex w-5 h-5 rounded-full text-[11px] font-bold items-center justify-center text-white ${
                          i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-2 font-medium text-slate-700">{agentName(a.sample)}</td>
                    <td className="py-2 text-right">{a.premium.toLocaleString('ko-KR')}</td>
                    <td className="py-2 text-right">{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">최근 공지사항</p>
            {banners.length > 4 && (
              <button onClick={() => setShowAllNotices((v) => !v)} className="text-xs text-slate-400 hover:underline">
                {showAllNotices ? '접기' : '더보기 ›'}
              </button>
            )}
          </div>
          {banners.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">등록된 공지사항이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {activeBanners.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-2.5">
                  <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-600">공지</span>
                  <span className="flex-1 text-sm text-slate-700 truncate">{b.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{b.created_at.slice(5, 10).replace('-', '.')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">교육 일정</p>
            {eduEvents.length > 4 && (
              <button onClick={() => setShowAllEdu((v) => !v)} className="text-xs text-slate-400 hover:underline">
                {showAllEdu ? '접기' : '더보기 ›'}
              </button>
            )}
          </div>
          {displayedEdu.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">예정된 교육 일정이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {displayedEdu.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-600">교육</span>
                  <span className="flex-1 text-sm text-slate-700 truncate">{e.title}</span>
                  <span className="shrink-0 flex items-center gap-1 text-xs text-slate-400">
                    {e.event_date.slice(5, 10).replace('-', '.')}
                    {e.event_time && (
                      <>
                        <IconClock />
                        {e.event_time}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
