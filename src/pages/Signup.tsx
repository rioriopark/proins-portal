import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toAuthEmail } from '../lib/id'

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signUp({ email: toAuthEmail(email), password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setDone(true)
    setTimeout(() => navigate('/login'), 2500)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-xl shadow p-8 space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-lg font-bold text-slate-800">회원가입</h1>
          <p className="text-sm text-slate-500">관리자가 등록한 아이디로만 가입할 수 있습니다.</p>
        </div>
        {done ? (
          <p className="text-sm text-emerald-600 text-center">
            가입 완료! 초대장이 확인되면 자동으로 권한이 부여됩니다. 로그인 화면으로 이동합니다…
          </p>
        ) : (
          <>
            <input
              type="text"
              required
              placeholder="초대받은 아이디"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? '처리 중…' : '가입하기'}
            </button>
          </>
        )}
        <p className="text-center text-xs text-slate-400">
          이미 계정이 있으신가요? <Link to="/login" className="text-slate-700 underline">로그인</Link>
        </p>
      </form>
    </div>
  )
}
