import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  // 로그인 계정은 있으나 관리자가 아직 초대장(pending_invites)을 만들지 않은 경우
  noProfile: boolean
  signOut: () => Promise<void>
  // 포털 항목별로 개별 부여된 관리자급 쓰기 권한 (menu_key 목록)
  permissions: Set<string>
  // profile.role !== 'agent' 이거나 해당 menu_key 로 개별 권한을 부여받았으면 true
  can: (menuKey: string) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [noProfile, setNoProfile] = useState(false)
  const [permissions, setPermissions] = useState<Set<string>>(new Set())

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data)
    setNoProfile(!data)
    if (data) {
      const { data: perms } = await supabase.from('menu_permissions').select('menu_key').eq('profile_id', userId)
      setPermissions(new Set((perms ?? []).map((p) => p.menu_key)))
    } else {
      setPermissions(new Set())
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) loadProfile(newSession.user.id)
      else {
        setProfile(null)
        setNoProfile(false)
        setPermissions(new Set())
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  function can(menuKey: string) {
    return !!profile && (profile.role !== 'agent' || permissions.has(menuKey))
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, noProfile, signOut, permissions, can }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
