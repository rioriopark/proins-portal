import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Banner, Contract, EducationEvent, Profile } from '../lib/types'
import dbLogo from '../assets/insurer-logos/db.png'
import hyundaiLogo from '../assets/insurer-logos/hyundai.svg'
import kbLogo from '../assets/insurer-logos/kb.png'
import meritzLogo from '../assets/insurer-logos/meritz.svg'
import lotteLogo from '../assets/insurer-logos/lotte.jpg'
import aigLogo from '../assets/insurer-logos/aig.svg'
import samsungLogo from '../assets/insurer-logos/samsung.svg'
import linaLogo from '../assets/insurer-logos/lina.png'
import hanwhaLogo from '../assets/insurer-logos/hanwha.svg'
import heungkukLogo from '../assets/insurer-logos/heungkuk.png'

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

interface StatCardProps {
  label: string
  value: string
  rate: { pct: number; up: boolean } | null
  color: keyof typeof STAT_COLORS
  icon: ReactNode
}
function StatCard({ label, value, rate, color, icon }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-3 ${STAT_COLORS[color].bg} ${STAT_COLORS[color].text}`}>
        {icon}
      </div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-bold mt-1 text-slate-800">{value}</p>
      {rate && (
        <p className={`text-xs mt-1 font-medium ${rate.up ? 'text-emerald-600' : 'text-rose-600'}`}>
          전년 대비 {rate.pct.toFixed(1)}% {rate.up ? '↑' : '↓'}
        </p>
      )}
    </div>
  )
}

// 각 보험사가 자체 운영하는 GA/설계사용 업무포털 바로가기 (프로인스포탈 내부 페이지가 아님)
const PORTAL_LINKS = [
  { name: '삼성화재보험', portal: '드림포탈', url: 'https://login.samsungfire.com/nl/p/login/ui/SPGENLP00000', badge: '삼성', color: 'bg-blue-600', logo: samsungLogo },
  { name: 'DB손해보험', portal: '영업포탈', url: 'https://www.mdbins.com', badge: 'DB', color: 'bg-sky-600', logo: dbLogo },
  { name: '현대해상보험', portal: '영업포탈', url: 'https://sp.hi.co.kr', badge: '현대', color: 'bg-orange-500', logo: hyundaiLogo },
  { name: 'KB손해보험', portal: '전용포탈', url: 'https://sales.kbinsure.co.kr', badge: 'KB', color: 'bg-amber-500', logo: kbLogo },
  { name: '메리츠화재보험', portal: '영업포탈', url: 'https://sales.meritzfire.com', badge: '메리츠', color: 'bg-teal-600', logo: meritzLogo },
  { name: '롯데손해보험', portal: '영업포탈', url: 'http://lottero.lotteins.co.kr', badge: '롯데', color: 'bg-red-600', logo: lotteLogo },
  { name: '라이나손해보험', portal: '영업포탈', url: 'https://ga.linagi.com/', badge: '라이나', color: 'bg-indigo-600', logo: linaLogo },
  { name: '한화손해보험', portal: '스마트포탈', url: 'https://portal.hwgeneralins.com/', badge: '한화', color: 'bg-rose-600', logo: hanwhaLogo },
  { name: '흥국화재보험', portal: '영업포탈', url: 'https://sales.heungkukfire.co.kr/', badge: '흥국', color: 'bg-pink-600', logo: heungkukLogo },
  { name: 'AIG손해보험', portal: '', url: 'https://sso.aig.co.kr/gaLogin/gaLogin.jsp', badge: 'AIG', color: 'bg-slate-700', forceEdge: true, logo: aigLogo },
]

// Windows의 microsoft-edge: URI 프로토콜을 이용해 항상 Edge로 열리도록 강제한다.
function portalHref(p: { url: string; forceEdge?: boolean }) {
  return p.forceEdge ? `microsoft-edge:${p.url}` : p.url
}

function PortalLinksBar() {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-xs font-semibold text-slate-500 mb-3">보험사 업무포털 바로가기</p>
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-10 gap-x-2 gap-y-4">
        {PORTAL_LINKS.map((p) => (
          <a
            key={p.name}
            href={portalHref(p)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center text-center group"
            title={`${p.name} ${p.portal}`.trim()}
          >
            {p.logo ? (
              <div className="h-12 w-full max-w-[3.25rem] px-1.5 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:opacity-90">
                <img src={p.logo} alt={p.name} className="h-full max-h-8 max-w-full object-contain" />
              </div>
            ) : (
              <div
                className={`h-12 w-full max-w-[3rem] rounded-2xl ${p.color} text-white flex items-center justify-center text-xs font-bold shadow-sm group-hover:opacity-90`}
              >
                {p.badge}
              </div>
            )}
            <span className="text-[11px] text-slate-600 mt-1.5 leading-tight">{p.name}</span>
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

export default function Dashboard() {
  const { profile } = useAuth()
  // 본사관리자(및 지사/지점 관리자)와 본사담당자(소속이 본사인 담당자)는 동일한 구성을 보되,
  // 본사담당자는 커미션이 아닌 임금 기반이라 "수수료 현황"만 제외한다.
  // 위촉설계사(소속이 본사가 아닌 담당자)는 다른 설계사 실적(TOP5)을 볼 권한이 없어 그것만 제외한다.
  const isFieldAgent = profile?.role === 'agent' && profile.org_id !== 'hq'
  const isHqStaff = profile?.role === 'agent' && profile.org_id === 'hq'
  const [contracts, setContracts] = useState<Contract[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<{ email: string; name: string }[]>([])
  const [eduEvents, setEduEvents] = useState<EducationEvent[]>([])
  const [showAllNotices, setShowAllNotices] = useState(false)
  const [showAllEdu, setShowAllEdu] = useState(false)
  // 예비계약(확정 전)은 누적보험료 등 다른 집계에서는 제외하지만, 이번 달 신규보험료와
  // TOP5 실적에는 "계약관리 > 예비계약 확인"에 올라온 당월 신규 등록분(대기중·확정매칭 모두)을 그대로 포함시킨다.
  const [prelimNewRows, setPrelimNewRows] = useState<
    { category: string; premium: number; agent_id: string | null; agent_email: string | null }[]
  >([])

  useEffect(() => {
    // 예비계약(확정 전, is_preliminary)은 아직 실제 계약이 아니므로 대시보드 집계에서 제외한다.
    fetchAllRows<Contract>((from, to) =>
      supabase.from('contracts').select('*').eq('is_preliminary', false).range(from, to)
    ).then(setContracts)
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
    supabase
      .from('contracts')
      .select('category, premium, agent_id, agent_email')
      .eq('is_preliminary', true)
      .eq('type', '신규')
      .eq('month', thisMonth)
      .then(({ data }) => setPrelimNewRows(data ?? []))
  }, [thisMonth])

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
    () =>
      sum(contracts.filter((c) => c.month === thisMonth && c.type === '신규'), (c) => c.premium) +
      sum(prelimNewRows, (r) => r.premium),
    [contracts, thisMonth, prelimNewRows]
  )
  const newPremiumLastYear = useMemo(
    () => sum(contracts.filter((c) => c.month === lastYearMonth && c.type === '신규'), (c) => c.premium),
    [contracts, lastYearMonth]
  )
  // 갱신관리에서 "갱신완료" 처리한 건 중, 만기예정일(=보험종기, 없으면 영수일+1년 추정)이
  // 해당 월에 속하는 계약의 보험료 합계를 갱신보험료로 잡는다.
  const expiryOf = (c: Contract) => c.expiry_date ?? (c.receipt_date ? addYears(c.receipt_date, 1) : null)
  const renewPremiumThisMonth = useMemo(
    () =>
      sum(
        contracts.filter((c) => c.renewal_status === '갱신완료' && expiryOf(c)?.slice(0, 7) === thisMonth),
        (c) => c.premium
      ),
    [contracts, thisMonth]
  )
  const renewPremiumLastYear = useMemo(
    () =>
      sum(
        contracts.filter((c) => c.renewal_status === '갱신완료' && expiryOf(c)?.slice(0, 7) === lastYearMonth),
        (c) => c.premium
      ),
    [contracts, lastYearMonth]
  )
  // 위촉설계사 화면의 신규보험료 카드는 장기/일반 종목별로 나눠서 보여준다.
  const newPremiumThisMonthByCategory = useMemo(() => {
    const rows = contracts.filter((c) => c.month === thisMonth && c.type === '신규')
    return {
      장기: sum(rows.filter((c) => c.category === '장기'), (c) => c.premium) +
        sum(prelimNewRows.filter((r) => r.category === '장기'), (r) => r.premium),
      일반: sum(rows.filter((c) => c.category === '일반'), (c) => c.premium) +
        sum(prelimNewRows.filter((r) => r.category === '일반'), (r) => r.premium),
    }
  }, [contracts, thisMonth, prelimNewRows])
  const newPremiumRate = changeRate(newPremiumThisMonth, newPremiumLastYear)

  // 위촉설계사는 RLS로 이미 본인 계약만 조회되므로, 라벨도 "나의 ~"로 구분해준다.
  const scopeLabel = isFieldAgent ? '나의 ' : ''
  // 갱신센터는 항상, 수수료 현황은 본사담당자만 제외, TOP5는 위촉설계사만 제외 — 보이는 카드 수에 맞춰 그리드 열 수를 정한다.
  const middleCardCount = 1 + (isHqStaff ? 0 : 1) + (isFieldAgent ? 0 : 1)

  const baseStatCards = [
    { label: `${scopeLabel}누적 보험료`, value: `${totalPremiumAll.toLocaleString('ko-KR')}원`, rate: ytd.premium, color: 'blue' as const, icon: <IconWon /> },
    { label: `${scopeLabel}누적 계약 건수`, value: `${totalCountAll.toLocaleString('ko-KR')}건`, rate: ytd.count, color: 'emerald' as const, icon: <IconDocCheck /> },
    // 본사담당자는 커미션이 아닌 임금 기반이라 누적 수수료 카드도 제외한다.
    ...(isHqStaff ? [] : [{ label: `${scopeLabel}누적 수수료`, value: `${totalCommissionAll.toLocaleString('ko-KR')}원`, rate: ytd.commission, color: 'violet' as const, icon: <IconWallet /> }]),
  ]
  const topCardCount = isHqStaff ? 4 : 5
  const renewPremiumCard = { label: `갱신보험료(${Number(thisMonthNum)}월)`, value: `${renewPremiumThisMonth.toLocaleString('ko-KR')}원`, rate: changeRate(renewPremiumThisMonth, renewPremiumLastYear), color: 'teal' as const, icon: <IconRefresh /> }

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
  const estimatedCommission = sum(myContractsThisMonth, (c) => c.commission)
  const expectedClawback = sum(myContractsThisMonth.filter((c) => c.type === '환수'), (c) => Math.abs(c.commission))
  const newCommissionThisMonth = sum(myContractsThisMonth.filter((c) => c.type === '신규'), (c) => c.commission)
  const renewCommissionThisMonth = sum(myContractsThisMonth.filter((c) => c.type === '계속'), (c) => c.commission)

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
    // 당월 신규보험료와 동일하게, "예비계약 확인"의 당월 신규 등록분(대기중·확정매칭 모두)도 담당자별로 합산한다.
    for (const r of prelimNewRows) {
      const key = r.agent_id ?? r.agent_email ?? 'unknown'
      const cur = byAgent.get(key)
      if (cur) {
        cur.premium += r.premium
      } else {
        byAgent.set(key, {
          key,
          premium: r.premium,
          count: 0,
          sample: { agent_id: r.agent_id, agent_email: r.agent_email } as Contract,
        })
      }
    }
    return [...byAgent.values()].sort((a, b) => b.premium - a.premium).slice(0, 5)
  }, [contracts, thisMonth, prelimNewRows])

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

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${topCardCount === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
        {baseStatCards.map((s) => <StatCard key={s.label} {...s} />)}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center mb-3 bg-amber-50 text-amber-600">
              <IconTrendUp />
            </div>
            <p className="text-xs text-slate-500 mb-2">신규보험료({Number(thisMonthNum)}월)</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">장기계약</span>
                <span className="font-semibold text-slate-800">{newPremiumThisMonthByCategory.장기.toLocaleString('ko-KR')}원</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">일반계약</span>
                <span className="font-semibold text-slate-800">{newPremiumThisMonthByCategory.일반.toLocaleString('ko-KR')}원</span>
              </div>
            </div>
            {newPremiumRate && (
              <p className={`text-xs mt-2 font-medium ${newPremiumRate.up ? 'text-emerald-600' : 'text-rose-600'}`}>
                전년 대비 {newPremiumRate.pct.toFixed(1)}% {newPremiumRate.up ? '↑' : '↓'}
              </p>
            )}
          </div>
          <StatCard {...renewPremiumCard} />
      </div>

      <div className={`grid grid-cols-1 gap-4 ${middleCardCount === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
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
              to="/renewals"
              className="mt-auto text-center text-sm font-medium text-white bg-slate-800 rounded-md py-2 hover:bg-slate-700"
            >
              갱신관리 바로가기
            </Link>
          </div>

          {!isHqStaff && (
            <div className="bg-white rounded-xl shadow p-5 flex flex-col">
              <p className="text-sm font-semibold mb-4">수수료 현황</p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">신규계약</p>
                  <p className="font-bold text-emerald-600 mt-1">{newCommissionThisMonth.toLocaleString('ko-KR')}원</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">예상수수료</p>
                  <p className="font-bold text-amber-600 mt-1">{estimatedCommission.toLocaleString('ko-KR')}원</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">갱신계약</p>
                  <p className="font-bold text-blue-600 mt-1">{renewCommissionThisMonth.toLocaleString('ko-KR')}원</p>
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
          )}

          {!isFieldAgent && (
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
          )}
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
