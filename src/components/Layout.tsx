import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/types'

const NAV = [
  { to: '/', label: '대시보드', end: true },
  { to: '/contracts', label: '계약관리' },
  { to: '/bulk-import', label: '계약 일괄등록', adminOnly: true },
  { to: '/statement', label: '수수료명세서' },
  { to: '/orgs', label: '조직관리', adminOnly: true },
]

export default function Layout() {
  const { profile, signOut } = useAuth()
  if (!profile) return null

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col text-white bg-slate-800">
        <div className="px-5 py-6 border-b border-white/10">
          <p className="font-bold text-sm tracking-wide">PRO INS COMPANY</p>
          <p className="text-xs text-white/60 mt-1">계약관리 포털</p>
        </div>
        <nav className="flex-1 py-4">
          {NAV.filter((n) => !n.adminOnly || profile.role !== 'agent').map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `block px-5 py-3 text-sm ${isActive ? 'bg-white/10 font-semibold' : 'text-white/80 hover:bg-white/5'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-white/10 text-xs text-white/70">
          <p className="font-medium text-white">{profile.name}</p>
          <p>{ROLE_LABEL[profile.role]}</p>
          <button onClick={signOut} className="mt-3 text-white/60 hover:text-white underline">
            로그아웃
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 bg-slate-50 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
