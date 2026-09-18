import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Banner, Contract, EducationEvent, Incentive, Insurer, Organization, Profile } from '../lib/types'
import { topLevelOrgId } from '../lib/agentSort'
import dbLogo from '../assets/insurer-logos/db.png'
import hyundaiLogo from '../assets/insurer-logos/hyundai.svg'
import kbLogo from '../assets/insurer-logos/kb.png'
import meritzLogo from '../assets/insurer-logos/meritz.svg'
import lotteLogo from '../assets/insurer-logos/lotte.svg'
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

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0)
}

function changeRate(curr: number, prev: number): { pct: number; up: boolean } | null {
  if (!prev) return null
  const pct = ((curr - prev) / Math.abs(prev)) * 100
  return { pct: Math.abs(pct), up: curr >= prev }
}

const ICON_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

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
  label: ReactNode
  value: string
  rate: { pct: number; up: boolean } | null
  color: keyof typeof STAT_COLORS
  icon: ReactNode
}
function StatCard({ label, value, rate, color, icon }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center mb-3 ${STAT_COLORS[color].bg} ${STAT_COLORS[color].text}`}
      >
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
  {
    name: '삼성화재보험',
    portal: '드림포탈',
    url: 'https://login.samsungfire.com/nl/p/login/ui/SPGENLP00000',
    badge: '삼성',
    color: 'bg-blue-600',
    logo: samsungLogo,
  },
  { name: 'DB손해보험', portal: '영업포탈', url: 'https://www.mdbins.com', badge: 'DB', color: 'bg-sky-600', logo: dbLogo },
  {
    name: '현대해상보험',
    portal: '영업포탈',
    url: 'https://sp.hi.co.kr',
    badge: '현대',
    color: 'bg-orange-500',
    logo: hyundaiLogo,
  },
  {
    name: 'KB손해보험',
    portal: '전용포탈',
    url: 'https://sales.kbinsure.co.kr',
    badge: 'KB',
    color: 'bg-amber-500',
    logo: kbLogo,
  },
  {
    name: '메리츠화재보험',
    portal: '영업포탈',
    url: 'https://sales.meritzfire.com',
    badge: '메리츠',
    color: 'bg-teal-600',
    logo: meritzLogo,
  },
  {
    name: '롯데손해보험',
    portal: '영업포탈',
    url: 'http://lottero.lotteins.co.kr',
    badge: '롯데',
    color: 'bg-red-600',
    logo: lotteLogo,
  },
  {
    name: '한화손해보험',
    portal: '스마트포탈',
    url: 'https://portal.hwgeneralins.com/',
    badge: '한화',
    color: 'bg-rose-600',
    logo: hanwhaLogo,
  },
  {
    name: '흥국화재보험',
    portal: '영업포탈',
    url: 'https://sales.heungkukfire.co.kr/',
    badge: '흥국',
    color: 'bg-pink-600',
    logo: heungkukLogo,
  },
  {
    name: '라이나손해보험',
    portal: '영업포탈',
    url: 'file:///C:/Program Files/ACE Insurance/iAgencyApp_SSL/TFApp.exe',
    badge: '라이나',
    color: 'bg-indigo-600',
    logo: linaLogo,
  },
  {
    name: 'AIG손해보험',
    portal: '',
    url: 'https://sso.aig.co.kr/gaLogin/gaLogin.jsp',
    badge: 'AIG',
    color: 'bg-slate-700',
    forceEdge: true,
    logo: aigLogo,
  },
]

// Windows의 microsoft-edge: URI 프로토콜을 이용해 항상 Edge로 열리도록 강제한다.
function portalHref(p: { url: string; forceEdge?: boolean }) {
  return p.forceEdge ? `microsoft-edge:${p.url}` : p.url
}

function PortalLinksBar() {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-xs font-semibold text-slate-700 mb-2">보험사 업무포털 바로가기</p>
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-10 gap-2">
        {PORTAL_LINKS.map((p) => (
          <a
            key={p.name}
            href={portalHref(p)}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2 text-center shadow-sm group-hover:opacity-90 hover:shadow-md transition-shadow"
            title={`${p.name} ${p.portal}`.trim()}
          >
            {p.logo ? (
              <img src={p.logo} alt={p.name} className="h-9 max-w-full object-contain" />
            ) : (
              <div className={`h-9 w-14 rounded-xl ${p.color} text-white flex items-center justify-center text-xs font-bold`}>
                {p.badge}
              </div>
            )}
            <span className="text-xs text-slate-800 font-semibold leading-tight">{p.name}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

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
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [invites, setInvites] = useState<{ email: string; name: string; org_id: string }[]>([])
  const [eduEvents, setEduEvents] = useState<EducationEvent[]>([])
  const [incentives, setIncentives] = useState<Incentive[]>([])
  const [insurers, setInsurers] = useState<Insurer[]>([])
  const [showAllNotices, setShowAllNotices] = useState(false)
  const [showAllEdu, setShowAllEdu] = useState(false)
  // 예비계약(확정 전)은 누적보험료 등 다른 집계에서는 제외하지만, 이번 달 신규보험료·갱신보험료와
  // TOP5 실적에는 "계약관리 > 예비계약 확인"에 올라온 당월 등록분(대기중·확정매칭 모두)을 그대로 포함시킨다.
  const [prelimNewRows, setPrelimNewRows] = useState<
    { category: string; premium: number; agent_id: string | null; agent_email: string | null }[]
  >([])
  const [prelimRenewRows, setPrelimRenewRows] = useState<
    { premium: number; agent_id: string | null; agent_email: string | null }[]
  >([])

  useEffect(() => {
    // 예비계약(확정 전, is_preliminary)은 아직 실제 계약이 아니므로 대시보드 집계에서 제외한다.
    fetchAllRows<Contract>((from, to) => supabase.from('contracts').select('*').eq('is_preliminary', false).range(from, to)).then(
      setContracts,
    )
    supabase
      .from('banners')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setBanners(data ?? []))
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => setAgents(data ?? []))
    supabase
      .from('organizations')
      .select('*')
      .then(({ data }) => setOrgs(data ?? []))
    supabase
      .from('pending_invites')
      .select('email, name, org_id')
      .then(({ data }) => setInvites(data ?? []))
    supabase
      .from('incentives')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setIncentives(data ?? []))
    supabase
      .from('education_events')
      .select('*')
      .order('event_date')
      .then(({ data }) => setEduEvents(data ?? []))
    supabase
      .from('insurers')
      .select('*')
      .then(({ data }) => setInsurers(data ?? []))
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
    supabase
      .from('contracts')
      .select('premium, agent_id, agent_email')
      .eq('is_preliminary', true)
      .eq('type', '계속')
      .eq('month', thisMonth)
      .then(({ data }) => setPrelimRenewRows(data ?? []))
  }, [thisMonth])

  const activeBanners = useMemo(() => {
    return showAllNotices ? banners : banners.slice(0, 3)
  }, [banners, showAllNotices])
  const recentIncentives = useMemo(() => incentives.slice(0, 3), [incentives])

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

  // 본사담당자는 RLS상 본사관리자와 동일하게 회사 전체 계약을 조회할 수 있지만, 메인화면
  // (대시보드) 전체는 본사 소속(org_id='hq') 담당자의 계약으로 한정해 보여준다.
  // (본사관리자는 그대로 회사 전체를 유지한다)
  const hqOrgAgentIds = useMemo(() => new Set(agents.filter((a) => a.org_id === 'hq').map((a) => a.id)), [agents])
  const hqOrgAgentEmails = useMemo(() => new Set(invites.filter((i) => i.org_id === 'hq').map((i) => i.email)), [invites])
  const belongsToHqOrg = useCallback(
    (c: { agent_id: string | null; agent_email: string | null }) =>
      c.agent_id ? hqOrgAgentIds.has(c.agent_id) : c.agent_email ? hqOrgAgentEmails.has(c.agent_email) : false,
    [hqOrgAgentIds, hqOrgAgentEmails]
  )
  const scopedContracts = useMemo(() => {
    if (!isHqStaff) return contracts
    return contracts.filter(belongsToHqOrg)
  }, [contracts, isHqStaff, belongsToHqOrg])
  const scopedPrelimNewRows = useMemo(
    () => (isHqStaff ? prelimNewRows.filter(belongsToHqOrg) : prelimNewRows),
    [prelimNewRows, isHqStaff, belongsToHqOrg]
  )
  const scopedPrelimRenewRows = useMemo(
    () => (isHqStaff ? prelimRenewRows.filter(belongsToHqOrg) : prelimRenewRows),
    [prelimRenewRows, isHqStaff, belongsToHqOrg]
  )

  // 위촉설계사·본사담당자·본사관리자·지사/지점 관리자(RLS로 이미 본인 하부조직만 조회됨) 모두
  // "누적" 카드는 당해년 계약만 합산한다.
  const thisYearContracts = useMemo(() => scopedContracts.filter((c) => c.month?.startsWith(thisYear)), [scopedContracts, thisYear])
  const totalPremiumThisYear = useMemo(() => sum(thisYearContracts, (c) => c.premium), [thisYearContracts])
  const totalCountThisYear = useMemo(() => sum(thisYearContracts, (c) => c.count), [thisYearContracts])
  const totalCommissionThisYear = useMemo(() => sum(thisYearContracts, (c) => c.commission), [thisYearContracts])

  // 전년 대비 증감률 계산용: 올해 vs 작년 동기간(1월~이번달) 누계
  const ytd = useMemo(() => {
    const inRange = (yr: string) => (c: Contract) => c.month?.startsWith(yr) && c.month.slice(5, 7) <= thisMonthNum
    const thisYearRows = scopedContracts.filter(inRange(thisYear))
    const lastYearRows = scopedContracts.filter(inRange(lastYear))
    return {
      premium: changeRate(
        sum(thisYearRows, (c) => c.premium),
        sum(lastYearRows, (c) => c.premium),
      ),
      count: changeRate(
        sum(thisYearRows, (c) => c.count),
        sum(lastYearRows, (c) => c.count),
      ),
      commission: changeRate(
        sum(thisYearRows, (c) => c.commission),
        sum(lastYearRows, (c) => c.commission),
      ),
    }
  }, [scopedContracts, thisYear, lastYear, thisMonthNum])

  const newPremiumThisMonth = useMemo(
    () =>
      sum(scopedContracts.filter((c) => c.month === thisMonth && c.type === '신규'), (c) => c.premium) +
      sum(scopedPrelimNewRows, (r) => r.premium),
    [scopedContracts, thisMonth, scopedPrelimNewRows],
  )
  const newPremiumLastYear = useMemo(
    () => sum(scopedContracts.filter((c) => c.month === lastYearMonth && c.type === '신규'), (c) => c.premium),
    [scopedContracts, lastYearMonth],
  )
  // 확정(보험사 업로드 완료)된 계속계약은 그 확정 보험료로, 아직 확정 전인 갱신은 갱신완료 시
  // 입력받은 예비 보험료로 잡는다 — "계약관리 > 예비계약 확인"에 뜨는 값과 항상 일치시킨다.
  const renewPremiumThisMonth = useMemo(
    () =>
      sum(scopedContracts.filter((c) => c.month === thisMonth && c.type === '계속'), (c) => c.premium) +
      sum(scopedPrelimRenewRows, (r) => r.premium),
    [scopedContracts, thisMonth, scopedPrelimRenewRows],
  )
  const renewPremiumLastYear = useMemo(
    () => sum(scopedContracts.filter((c) => c.month === lastYearMonth && c.type === '계속'), (c) => c.premium),
    [scopedContracts, lastYearMonth],
  )
  // 위촉설계사 화면의 신규보험료 카드는 장기/일반 종목별로 나눠서 보여준다.
  const newPremiumThisMonthByCategory = useMemo(() => {
    const rows = scopedContracts.filter((c) => c.month === thisMonth && c.type === '신규')
    return {
      장기:
        sum(
          rows.filter((c) => c.category === '장기'),
          (c) => c.premium,
        ) +
        sum(
          scopedPrelimNewRows.filter((r) => r.category === '장기'),
          (r) => r.premium,
        ),
      일반:
        sum(
          rows.filter((c) => c.category === '일반'),
          (c) => c.premium,
        ) +
        sum(
          scopedPrelimNewRows.filter((r) => r.category === '일반'),
          (r) => r.premium,
        ),
    }
  }, [scopedContracts, thisMonth, scopedPrelimNewRows])
  const newPremiumRate = changeRate(newPremiumThisMonth, newPremiumLastYear)

  // 위촉설계사는 RLS로 이미 본인 계약만 조회되므로, 라벨도 "나의 ~"로 구분해준다.
  const scopeLabel = isFieldAgent ? '나의 ' : ''
  // 갱신센터는 항상, 수수료 현황은 본사담당자만 제외, TOP5는 위촉설계사만 제외 — 보이는 카드 수에 맞춰 그리드 열 수를 정한다.
  const middleCardCount = 1 + (isHqStaff ? 0 : 1) + (isFieldAgent ? 0 : 1)

  const baseStatCards = [
    {
      label: `${scopeLabel}누적 보험료`,
      value: `${totalPremiumThisYear.toLocaleString('ko-KR')}원`,
      rate: ytd.premium,
      color: 'blue' as const,
      icon: <IconWon />,
    },
    {
      label: `${scopeLabel}누적 계약 건수`,
      value: `${totalCountThisYear.toLocaleString('ko-KR')}건`,
      rate: ytd.count,
      color: 'emerald' as const,
      icon: <IconDocCheck />,
    },
    // 본사담당자는 커미션이 아닌 임금 기반이라 누적 수수료 카드도 제외한다.
    ...(isHqStaff
      ? []
      : [
          {
            label: `${scopeLabel}누적 수수료`,
            value: `${totalCommissionThisYear.toLocaleString('ko-KR')}원`,
            rate: ytd.commission,
            color: 'violet' as const,
            icon: <IconWallet />,
          },
        ]),
  ]
  const topCardCount = isHqStaff ? 4 : 5
  const renewPremiumCard = {
    label: (
      <>
        갱신보험료({Number(thisMonthNum)}월)
        <br />
        계약완료건
      </>
    ),
    value: `${renewPremiumThisMonth.toLocaleString('ko-KR')}원`,
    rate: changeRate(renewPremiumThisMonth, renewPremiumLastYear),
    color: 'teal' as const,
    icon: <IconRefresh />,
  }

  // 갱신센터: 갱신관리(Renewals) 화면과 동일한 기준으로 만기예정일을 계산해 기간별로 집계한다.
  // (실제 만기일 우선 사용, 갱신여부가 이미 정해진 건 제외, 1년 미만 단기계약 제외, 증권번호당 최신 1건만)
  const renewalRows = useMemo(() => {
    const rows = scopedContracts
      .filter((c) => {
        if (c.category !== '일반' && c.category !== '자동차') return false
        if (c.renewal_status) return false
        if (!(c.expiry_date || c.receipt_date)) return false
        if (c.expiry_date && c.receipt_date && c.expiry_date < addYears(c.receipt_date, 1)) return false
        return true
      })
      .map((c) => ({ c, expiry: c.expiry_date ?? addYears(c.receipt_date!, 1) }))

    const latestByPolicy = new Map<string, (typeof rows)[number]>()
    const noPolicyNo: typeof rows = []
    for (const r of rows) {
      if (!r.c.policy_no) {
        noPolicyNo.push(r)
        continue
      }
      const existing = latestByPolicy.get(r.c.policy_no)
      if (!existing || (r.c.receipt_date ?? '') > (existing.c.receipt_date ?? '')) {
        latestByPolicy.set(r.c.policy_no, r)
      }
    }
    return [...latestByPolicy.values(), ...noPolicyNo]
  }, [scopedContracts])
  const renewalBuckets = useMemo(() => {
    const thisMonthStr = today.slice(0, 7)
    const nextMonthDate = new Date(today + 'T00:00:00Z')
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1)
    const nextMonthStr = nextMonthDate.toISOString().slice(0, 7)
    const yearStr = today.slice(0, 4)
    const buckets = [
      {
        key: 'this_month',
        label: `당월 만기계약(${Number(thisMonthStr.slice(5, 7))}월)`,
        color: 'bg-blue-500',
        match: (expiry: string) => expiry.slice(0, 7) === thisMonthStr,
      },
      {
        key: 'next_month',
        label: `익월 만기계약(${Number(nextMonthStr.slice(5, 7))}월)`,
        color: 'bg-emerald-500',
        match: (expiry: string) => expiry.slice(0, 7) === nextMonthStr,
      },
      {
        key: 'all_year',
        label: `전체 만기계약(${yearStr}년)`,
        color: 'bg-amber-500',
        match: (expiry: string) => expiry.slice(0, 4) === yearStr,
      },
    ]
    return buckets.map(({ key, label, color, match }) => {
      const rows = renewalRows.filter(({ expiry }) => match(expiry))
      return { key, label, color, count: rows.length, premium: sum(rows, ({ c }) => c.premium) }
    })
  }, [renewalRows, today])
  const maxBucketCount = Math.max(1, ...renewalBuckets.map((b) => b.count))

  // 보험사 영업보증·선지급이행보증 만료 알림: 만료 한 달 전부터(이미 지난 것도 계속) 갱신센터 하단에 표시.
  const guaranteeAlerts = useMemo(() => {
    const cutoffDate = new Date(today + 'T00:00:00Z')
    cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() + 1)
    const cutoff = cutoffDate.toISOString().slice(0, 10)
    const rows: { insurer: string; label: string; expiry: string }[] = []
    for (const i of insurers) {
      if (i.business_guarantee_expiry && i.business_guarantee_expiry <= cutoff) {
        rows.push({ insurer: i.name, label: '영업보증', expiry: i.business_guarantee_expiry })
      }
      if (i.advance_guarantee_expiry && i.advance_guarantee_expiry <= cutoff) {
        rows.push({ insurer: i.name, label: '선지급이행보증', expiry: i.advance_guarantee_expiry })
      }
    }
    return rows.sort((a, b) => a.expiry.localeCompare(b.expiry))
  }, [insurers, today])

  // 수수료 현황: 본인 명세서(확정 소득/실지급) + 이번달 계약 기준 예상치.
  // 단, 본사관리자는 본인 명의 계약이 없는 게 정상이라 회사 전체(전 담당자) 당월 실적 기준으로 보여준다.
  const isHqAdmin = profile?.role === 'hq_admin'
  const myContractsThisMonth = useMemo(
    () => contracts.filter((c) => c.month === thisMonth && (isHqAdmin || c.agent_id === profile?.id)),
    [contracts, thisMonth, profile, isHqAdmin],
  )
  // 예상수수료: 아직 보험사 확정 전이라 수수료가 0원인 이번 달 예비계약(신규)에 대해, 같은 종목의 기존
  // 확정계약(신규) 전체에서 나온 "수수료/보험료" 평균 비율을 참고해 예상치를 계산한다.
  const commissionRateByCategory = useMemo(() => {
    const totals = new Map<string, { premium: number; commission: number }>()
    for (const c of contracts) {
      if (c.type !== '신규' || c.premium <= 0) continue
      const cur = totals.get(c.category) ?? { premium: 0, commission: 0 }
      cur.premium += c.premium
      cur.commission += c.commission
      totals.set(c.category, cur)
    }
    const rates = new Map<string, number>()
    for (const [category, t] of totals) {
      if (t.premium > 0) rates.set(category, t.commission / t.premium)
    }
    return rates
  }, [contracts])
  const myPrelimNewRowsThisMonth = useMemo(
    () =>
      isHqAdmin
        ? prelimNewRows
        : prelimNewRows.filter((r) => (r.agent_id ? r.agent_id === profile?.id : r.agent_email === profile?.email)),
    [prelimNewRows, profile, isHqAdmin],
  )

  // 본사관리자는 "수수료 현황"을 회사 전체 / 프로인스컴퍼니 본사(hq 소속) / 조직별로 나눠 볼 수 있다.
  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const agentTopOrgId = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of agents) map.set(a.id, a.org_id ? topLevelOrgId(a.org_id, orgsById) : '')
    return map
  }, [agents, orgsById])
  const [commissionScope, setCommissionScope] = useState<'all' | 'hq' | 'byOrg'>('all')
  const scopedContractsThisMonth = useMemo(() => {
    if (!isHqAdmin || commissionScope !== 'hq') return myContractsThisMonth
    return myContractsThisMonth.filter((c) => c.agent_id && agentTopOrgId.get(c.agent_id) === 'hq')
  }, [isHqAdmin, commissionScope, myContractsThisMonth, agentTopOrgId])
  const scopedPrelimRows = useMemo(() => {
    if (!isHqAdmin || commissionScope !== 'hq') return myPrelimNewRowsThisMonth
    return myPrelimNewRowsThisMonth.filter((r) => r.agent_id && agentTopOrgId.get(r.agent_id) === 'hq')
  }, [isHqAdmin, commissionScope, myPrelimNewRowsThisMonth, agentTopOrgId])
  const estimatedCommission = Math.round(
    sum(scopedPrelimRows, (r) => r.premium * (commissionRateByCategory.get(r.category) ?? 0)),
  )
  const scopedPrelimCount = scopedPrelimRows.length
  const scopedPrelimPremium = sum(scopedPrelimRows, (r) => r.premium)
  const expectedClawback = sum(
    scopedContractsThisMonth.filter((c) => c.type === '환수'),
    (c) => Math.abs(c.commission),
  )
  const newCommissionThisMonth = sum(
    scopedContractsThisMonth.filter((c) => c.type === '신규'),
    (c) => c.commission,
  )
  const renewCommissionThisMonth = sum(
    scopedContractsThisMonth.filter((c) => c.type === '계속'),
    (c) => c.commission,
  )
  // 조직별 현황: 관리조직(본사직영, 각 지점 등)별로 신규/예상/갱신/환수를 한눈에 비교한다.
  interface OrgCommissionRow {
    orgId: string
    orgName: string
    newCommission: number
    estimated: number
    renewCommission: number
    clawback: number
    prelimCount: number
    prelimPremium: number
  }
  const commissionByOrg = useMemo<OrgCommissionRow[]>(() => {
    if (!isHqAdmin) return []
    const map = new Map<string, OrgCommissionRow>()
    const rowFor = (orgId: string) => {
      const cur = map.get(orgId)
      if (cur) return cur
      const created: OrgCommissionRow = {
        orgId,
        orgName: orgsById.get(orgId)?.name ?? '미배정',
        newCommission: 0,
        estimated: 0,
        renewCommission: 0,
        clawback: 0,
        prelimCount: 0,
        prelimPremium: 0,
      }
      map.set(orgId, created)
      return created
    }
    for (const c of myContractsThisMonth) {
      if (!c.agent_id) continue
      const row = rowFor(agentTopOrgId.get(c.agent_id) ?? '')
      if (c.type === '신규') row.newCommission += c.commission
      else if (c.type === '계속') row.renewCommission += c.commission
      else if (c.type === '환수') row.clawback += Math.abs(c.commission)
    }
    for (const r of myPrelimNewRowsThisMonth) {
      if (!r.agent_id) continue
      const row = rowFor(agentTopOrgId.get(r.agent_id) ?? '')
      row.estimated += r.premium * (commissionRateByCategory.get(r.category) ?? 0)
      row.prelimCount += 1
      row.prelimPremium += r.premium
    }
    return [...map.values()]
      .map((row) => ({ ...row, estimated: Math.round(row.estimated) }))
      .sort((a, b) => b.newCommission + b.estimated - (a.newCommission + a.estimated))
  }, [isHqAdmin, myContractsThisMonth, myPrelimNewRowsThisMonth, agentTopOrgId, orgsById, commissionRateByCategory])

  // 설계사 실적 TOP5 (이번달, 조회 가능한 범위 내)
  // 계약관리 목록과 동일한 기준으로, 수수료 0원 건(매핑 실패 등으로 아직 확정 안 된 트래킹용 행)은 실적에서 제외한다.
  const topAgents = useMemo(() => {
    const byAgent = new Map<string, { key: string; premium: number; count: number; sample: Contract }>()
    for (const c of contracts.filter((c) => c.month === thisMonth && c.commission !== 0)) {
      const key = c.agent_id ?? c.agent_email ?? 'unknown'
      const cur = byAgent.get(key) ?? { key, premium: 0, count: 0, sample: c }
      cur.premium += c.premium
      cur.count += c.count
      byAgent.set(key, cur)
    }
    // 당월 신규보험료와 동일하게, "예비계약 확인"의 당월 신규 등록분(대기중·확정매칭 모두)도 담당자별로 합산한다.
    // 예비계약 한 행 = 계약 한 건이므로 건수도 함께 1씩 더해야 보험료와 계약건수가 어긋나지 않는다.
    for (const r of prelimNewRows) {
      const key = r.agent_id ?? r.agent_email ?? 'unknown'
      const cur = byAgent.get(key)
      if (cur) {
        cur.premium += r.premium
        cur.count += 1
      } else {
        byAgent.set(key, {
          key,
          premium: r.premium,
          count: 1,
          sample: { agent_id: r.agent_id, agent_email: r.agent_email } as Contract,
        })
      }
    }
    return [...byAgent.values()].sort((a, b) => b.premium - a.premium).slice(0, 5)
  }, [contracts, thisMonth, prelimNewRows])

  const displayedEdu = showAllEdu ? eduEvents : eduEvents.filter((e) => e.event_date >= today).slice(0, 3)

  return (
    <div className="space-y-4">
      <PortalLinksBar />

      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-slate-700 text-white flex items-center justify-center text-sm font-semibold">
              {profile?.name?.slice(0, 1) ?? '?'}
            </div>
            <div className="text-sm leading-tight">
              <p className="font-semibold text-slate-800">
                {profile?.name}
                {profile?.title ? ` ${profile.title}님` : ''}
              </p>
              <p className="text-xs text-slate-400">프로인스포탈</p>
            </div>
          </div>
          <div className="relative text-slate-400">
            <IconBell />
            {activeBanners.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-rose-500 text-white text-[9px] leading-[14px] text-center">
                {activeBanners.length}
              </span>
            )}
          </div>
          <span className="text-xs text-slate-400">{todayLabel} 기준</span>
        </div>
        <div className="text-left">
          <h1 className="text-xl font-bold text-slate-800">안녕하세요, {profile?.title || profile?.name}님!</h1>
          <p className="text-sm text-slate-500 mt-1">오늘도 프로인스포탈과의 성장을 응원합니다.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">최근 공지사항</p>
            {banners.length > 3 && (
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

        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">교육 일정</p>
            {eduEvents.length > 3 && (
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

        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">시상안</p>
            <Link to="/incentives" className="text-xs text-slate-400 hover:underline">
              업무지원 &gt; 시상안 바로가기 ›
            </Link>
          </div>
          {recentIncentives.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">등록된 시상안이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {recentIncentives.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-600">
                    {i.company}
                  </span>
                  <span className="flex-1 text-sm text-slate-700 truncate">{i.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{i.month}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${topCardCount === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
        {baseStatCards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
        <div className="bg-white rounded-xl shadow p-4">
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

      <div className={`grid grid-cols-1 gap-3 ${middleCardCount === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <div className="bg-white rounded-xl shadow p-4 flex flex-col">
          <p className="text-sm font-semibold mb-3">갱신센터</p>
          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            {renewalBuckets.map((b) => (
              <div key={b.key}>
                <p className="text-xs text-slate-400">{b.label}</p>
                <p className="text-lg font-bold text-slate-800 mt-1">{b.count}건</p>
                <p className="text-sm text-slate-500 font-medium mt-0.5">{b.premium.toLocaleString('ko-KR')}원</p>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-1.5 h-10 mb-5">
            {renewalBuckets.map((b) => (
              <div key={b.key} className="flex-1 flex items-end">
                <div
                  className={`w-full rounded-t ${b.color}`}
                  style={{ height: `${Math.max(6, (b.count / maxBucketCount) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          {profile?.org_id === 'hq' && guaranteeAlerts.length > 0 && (
            <div className="mb-3 pt-3 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-1.5">보증보험 만료 임박</p>
              <div className="space-y-1">
                {guaranteeAlerts.map((a, idx) => {
                  const overdue = a.expiry < today
                  return (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">
                        {a.insurer} · {a.label}
                      </span>
                      <span className={overdue ? 'text-red-600 font-medium' : 'text-amber-600 font-medium'}>
                        {a.expiry}
                        {overdue ? ' (만료)' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <Link
            to="/renewals"
            className="mt-auto text-center text-sm font-medium text-white bg-slate-800 rounded-md py-2 hover:bg-slate-700"
          >
            갱신관리 바로가기
          </Link>
        </div>

        {!isHqStaff && (
          <div className="bg-white rounded-xl shadow p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">수수료 현황</p>
              {isHqAdmin && (
                <div className="flex gap-1 text-xs">
                  {(
                    [
                      ['all', '회사 전체'],
                      ['hq', '프로인스컴퍼니 본사'],
                      ['byOrg', '조직별 현황'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCommissionScope(key)}
                      className={`px-2 py-1 rounded-md font-medium ${
                        commissionScope === key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isHqAdmin && commissionScope === 'byOrg' ? (
              <div className="overflow-x-auto mb-5">
                <table className="w-full text-xs">
                  <thead className="text-slate-500 border-b border-slate-100">
                    <tr>
                      <th className="text-left py-1.5 font-medium">조직</th>
                      <th className="text-right py-1.5 font-medium">신규계약</th>
                      <th className="text-right py-1.5 font-medium">예상수수료</th>
                      <th className="text-right py-1.5 font-medium">갱신계약</th>
                      <th className="text-right py-1.5 font-medium">환수예정</th>
                      <th className="text-right py-1.5 font-medium">예비계약(대기중)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionByOrg.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-slate-400 py-4">
                          이번 달 데이터가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      commissionByOrg.map((row) => (
                        <tr key={row.orgId} className="border-t border-slate-50">
                          <td className="py-1.5 text-slate-700">{row.orgName}</td>
                          <td className="py-1.5 text-right text-emerald-600 font-medium">
                            {row.newCommission.toLocaleString('ko-KR')}
                          </td>
                          <td className="py-1.5 text-right text-amber-600 font-medium">
                            {row.estimated.toLocaleString('ko-KR')}
                          </td>
                          <td className="py-1.5 text-right text-blue-600 font-medium">
                            {row.renewCommission.toLocaleString('ko-KR')}
                          </td>
                          <td className="py-1.5 text-right text-rose-600 font-medium">{row.clawback.toLocaleString('ko-KR')}</td>
                          <td className="py-1.5 text-right text-slate-500">
                            {row.prelimCount}건 · {row.prelimPremium.toLocaleString('ko-KR')}원
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <div className="bg-violet-50 rounded-lg px-3 py-2 mb-3 flex items-center justify-between text-xs">
                  <span className="text-violet-600 font-medium">예비계약(대기중, 보험사 미확정)</span>
                  <span className="text-violet-700 font-semibold">
                    {scopedPrelimCount}건 · 보험료 {scopedPrelimPremium.toLocaleString('ko-KR')}원
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">신규계약</p>
                    <p className="font-bold text-emerald-600 mt-1">{newCommissionThisMonth.toLocaleString('ko-KR')}원</p>
                  </div>
                  <div
                    className="bg-slate-50 rounded-lg p-3"
                    title="같은 종목의 기존 확정계약(신규) 수수료/보험료 평균 비율을 이번 달 예비계약 보험료에 적용한 예상치입니다."
                  >
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
              </>
            )}
            <Link
              to="/statement"
              className="mt-auto text-center text-sm font-medium text-white bg-slate-800 rounded-md py-2 hover:bg-slate-700"
            >
              수수료명세서 보기
            </Link>
          </div>
        )}

        {!isFieldAgent && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <IconTrophy />
              <p className="text-sm font-semibold">
                계약실적 TOP 5 ({thisYear}년 {Number(thisMonthNum)}월)
              </p>
            </div>
            {topAgents.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">이번달 등록된 실적이 없습니다.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-400 text-xs">
                  <tr>
                    <th className="text-left py-1.5 font-medium w-8">순위</th>
                    <th className="text-left py-1.5 font-medium">담당자</th>
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
                            i === 0
                              ? 'bg-amber-400'
                              : i === 1
                                ? 'bg-slate-400'
                                : i === 2
                                  ? 'bg-amber-700'
                                  : 'bg-slate-200 text-slate-500'
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
    </div>
  )
}
