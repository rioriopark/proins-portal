import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL, type Profile } from '../lib/types'

interface NavItem {
  to: string
  label: string
  end?: boolean
  menuKey?: string
  adminOnly?: boolean
  // adminOnly/menuKey 로 표현할 수 없는 항목별 커스텀 노출 조건 (예: 소속에 따른 분기)
  visible?: (profile: Profile) => boolean
}

interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

type NavEntry = ({ standalone: true } & NavItem) | ({ standalone: false } & NavGroup)

const NAV: NavEntry[] = [
  { standalone: true, to: '/', label: '메인화면', end: true },
  {
    standalone: false,
    key: 'contracts',
    label: '계약업무',
    items: [
      { to: '/contracts', label: '계약관리' },
      { to: '/bulk-import', label: '계약 일괄등록', menuKey: 'bulk_import' },
      { to: '/statement', label: '수수료명세서', visible: (p) => p.role !== 'agent' || p.org_id !== 'hq' },
      { to: '/wage-statement', label: '임금명세서', visible: (p) => p.role !== 'agent' || p.org_id === 'hq' },
    ],
  },
  {
    standalone: false,
    key: 'info',
    label: '업무지원',
    items: [
      { to: '/contacts', label: '업무 연락처' },
      { to: '/incentives', label: '보험사 시상안' },
    ],
  },
  {
    standalone: false,
    key: 'admin',
    label: '관리자',
    items: [
      { to: '/orgs', label: '조직관리', adminOnly: true },
      { to: '/info', label: '정보관리', adminOnly: true },
    ],
  },
  { standalone: true, to: '/my-space', label: '나의공간' },
]

function findGroupKey(pathname: string): string | null {
  for (const entry of NAV) {
    if (!entry.standalone && entry.items.some((i) => pathname === i.to || pathname.startsWith(i.to + '/'))) {
      return entry.key
    }
  }
  return null
}

export default function Layout() {
  const { profile, signOut, can } = useAuth()
  const location = useLocation()
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const key = findGroupKey(location.pathname)
    return new Set(key ? [key] : [])
  })

  useEffect(() => {
    const key = findGroupKey(location.pathname)
    if (key) setOpenGroups((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [location.pathname])

  if (!profile) return null

  function isVisible(item: NavItem) {
    if (item.visible) return item.visible(profile!)
    return item.adminOnly ? profile!.role !== 'agent' : !item.menuKey || can(item.menuKey)
  }

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col text-white bg-slate-800">
        <div className="px-5 py-6 border-b border-white/10">
          <p className="font-bold text-sm tracking-wide">PRO INS COMPANY</p>
          <p className="text-xs text-white/60 mt-1">계약관리 포털</p>
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV.map((entry) => {
            if (entry.standalone) {
              if (!isVisible(entry)) return null
              return (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  end={entry.end}
                  className={({ isActive }) =>
                    `block px-5 py-3 text-sm ${isActive ? 'bg-white/10 font-semibold' : 'text-white/80 hover:bg-white/5'}`
                  }
                >
                  {entry.label}
                </NavLink>
              )
            }

            const items = entry.items.filter(isVisible)
            if (items.length === 0) return null
            const open = openGroups.has(entry.key)

            return (
              <div key={entry.key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(entry.key)}
                  className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold text-white/50 uppercase tracking-wide hover:bg-white/5"
                >
                  <span>{entry.label}</span>
                  <span className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>›</span>
                </button>
                {open && (
                  <div>
                    {items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          `block pl-8 pr-5 py-2.5 text-sm ${isActive ? 'bg-white/10 font-semibold' : 'text-white/80 hover:bg-white/5'}`
                        }
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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
