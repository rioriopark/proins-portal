import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Banner, Contract, Incentive, Profile } from '../lib/types'
import BarChart from '../components/BarChart'

// 별도 만기일 필드가 없어 영수일 + 1년을 계약 만기(갱신 예정일)로 추정한다.
function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0, 10)
}
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [invites, setInvites] = useState<{ email: string; name: string }[]>([])
  const [incentives, setIncentives] = useState<Incentive[]>([])

  useEffect(() => {
    supabase.from('contracts').select('*').then(({ data }) => setContracts(data ?? []))
    supabase.from('banners').select('*').order('sort_order').then(({ data }) => setBanners(data ?? []))
    supabase.from('profiles').select('*').then(({ data }) => setAgents(data ?? []))
    supabase.from('pending_invites').select('email, name').then(({ data }) => setInvites(data ?? []))
    supabase.from('incentives').select('*').then(({ data }) => setIncentives(data ?? []))
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const activeBanners = banners.filter(
    (b) => (!b.start_date || b.start_date <= today) && (!b.end_date || b.end_date >= today)
  )

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

  const renewalWindowEnd = addMonths(today, 1)
  const renewals = useMemo(
    () =>
      contracts
        .filter((c) => (c.category === '일반' || c.category === '자동차') && c.receipt_date)
        .map((c) => ({ c, expiry: addYears(c.receipt_date!, 1) }))
        .filter(({ expiry }) => expiry >= today && expiry <= renewalWindowEnd)
        .sort((a, b) => a.expiry.localeCompare(b.expiry)),
    [contracts, today, renewalWindowEnd]
  )

  const byMonth = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contracts) map.set(c.month, (map.get(c.month) ?? 0) + c.premium)
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([label, value]) => ({ label, value }))
  }, [contracts])

  const byType = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contracts) map.set(c.type, (map.get(c.type) ?? 0) + c.count)
    return [...map.entries()].map(([label, value]) => ({ label, value }))
  }, [contracts])

  const thisYear = String(new Date().getFullYear())
  const yearContracts = useMemo(() => contracts.filter((c) => c.month?.startsWith(thisYear)), [contracts, thisYear])
  const totalPremium = yearContracts.reduce((s, c) => s + c.premium, 0)
  const totalCount = yearContracts.reduce((s, c) => s + c.count, 0)
  const totalCommission = yearContracts.reduce((s, c) => s + c.commission, 0)

  const thisMonth = today.slice(0, 7)
  const monthIncentives = useMemo(() => incentives.filter((i) => i.month === thisMonth), [incentives, thisMonth])

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">대시보드</h1>
      <p className="text-sm text-slate-500 -mt-4">{profile?.name}님이 조회 가능한 범위의 실적입니다.</p>

      {activeBanners.length > 0 && (
        <div className="space-y-2">
          {activeBanners.map((b) => (
            <div key={b.id} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-900">{b.title}</p>
              {b.content && <p className="text-sm text-amber-800 mt-1 whitespace-pre-wrap">{b.content}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-xs text-slate-500">{thisYear}년 누적 보험료</p>
          <p className="text-2xl font-bold mt-1">{totalPremium.toLocaleString('ko-KR')}원</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-xs text-slate-500">{thisYear}년 누적 건수</p>
          <p className="text-2xl font-bold mt-1">{totalCount.toLocaleString('ko-KR')}건</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-xs text-slate-500">{thisYear}년 누적 수수료</p>
          <p className="text-2xl font-bold mt-1">{totalCommission.toLocaleString('ko-KR')}원</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">당월 시상안 ({thisMonth})</p>
          <Link to="/incentives" className="text-xs text-slate-500 hover:underline">전체보기</Link>
        </div>
        {monthIncentives.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">이번 달 등록된 시상안이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {monthIncentives.map((i) => (
              <div key={i.id} className="border border-slate-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">{i.company}</span>
                </div>
                <p className="font-semibold text-sm text-slate-800">{i.title}</p>
                <p className="text-xs text-slate-500 mt-1">{i.period}{i.period && i.target && ' · '}{i.target}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold">만기 예정 계약 (1개월 이내)</p>
            <p className="text-xs text-slate-400 mt-0.5">일반·자동차 계약 중 영수일 기준 1년 만기가 1개월 이내로 도래하는 건입니다.</p>
          </div>
          <span className="text-xs text-slate-400">{renewals.length}건</span>
        </div>
        {renewals.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">1개월 이내 만기 예정인 계약이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-xs border-b border-slate-100">
                <tr>
                  <th className="text-left px-2 py-2">고객명</th>
                  <th className="text-left px-2 py-2">종목</th>
                  <th className="text-left px-2 py-2">보험사/상품</th>
                  <th className="text-left px-2 py-2">담당자</th>
                  <th className="text-left px-2 py-2">영수일</th>
                  <th className="text-left px-2 py-2">만기예정일</th>
                  <th className="text-right px-2 py-2">D-day</th>
                </tr>
              </thead>
              <tbody>
                {renewals.map(({ c, expiry }) => {
                  const dday = Math.round((new Date(expiry).getTime() - new Date(today).getTime()) / 86400000)
                  return (
                    <tr key={c.id} className="border-t border-slate-50">
                      <td className="px-2 py-2">{c.customer_name || '-'}</td>
                      <td className="px-2 py-2">{c.category}</td>
                      <td className="px-2 py-2">{c.company}{c.product_name ? ` / ${c.product_name}` : ''}</td>
                      <td className="px-2 py-2">{agentName(c)}</td>
                      <td className="px-2 py-2">{c.receipt_date}</td>
                      <td className="px-2 py-2">{expiry}</td>
                      <td className="px-2 py-2 text-right text-amber-600 font-medium">D-{dday}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-sm font-semibold mb-3">월별 보험료 추이</p>
          <BarChart data={byMonth} color="#334155" />
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <p className="text-sm font-semibold mb-3">계약 구분별 건수</p>
          <BarChart data={byType} color="#b45309" />
        </div>
      </div>
    </div>
  )
}
