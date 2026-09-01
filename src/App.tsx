import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Contracts from './pages/Contracts'
import Statement from './pages/Statement'
import Orgs from './pages/Orgs'

function Gate({ children }: { children: ReactNode }) {
  const { session, profile, loading, noProfile, signOut } = useAuth()

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">불러오는 중…</div>
  if (!session) return <Navigate to="/login" replace />
  if (noProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-slate-700 font-medium">아직 관리자가 권한을 부여하지 않았습니다.</p>
          <p className="text-sm text-slate-500">담당 관리자에게 초대장 발급을 요청해주세요.</p>
          <button onClick={signOut} className="text-sm underline text-slate-500">로그아웃</button>
        </div>
      </div>
    )
  }
  if (!profile) return null
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        path="/"
        element={
          <Gate>
            <Layout />
          </Gate>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="statement" element={<Statement />} />
        <Route path="orgs" element={<Orgs />} />
      </Route>
    </Routes>
  )
}
