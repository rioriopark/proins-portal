import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toAuthEmail } from '../lib/id'
import { DEMO_GUEST_ID, DEMO_GUEST_PASSWORD, DEMO_MODE } from '../lib/demo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function signIn(id: string, pw: string) {
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: toAuthEmail(id), password: pw })
    setBusy(false)
    if (error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      return
    }
    navigate('/')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    signIn(email, password)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-xl shadow p-8 space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-lg font-bold text-slate-800">PRO INS COMPANY</h1>
          <p className="text-sm text-slate-500">계약관리 포털 로그인</p>
        </div>
        <input
          type="text"
          required
          placeholder="아이디 (또는 이메일)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          placeholder="비밀번호"
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
          {busy ? '로그인 중…' : '로그인'}
        </button>
        {DEMO_MODE && DEMO_GUEST_ID && (
          <button
            type="button"
            disabled={busy}
            onClick={() => signIn(DEMO_GUEST_ID, DEMO_GUEST_PASSWORD)}
            className="w-full border border-red-600 text-red-600 rounded-md py-2 text-sm font-medium disabled:opacity-50"
          >
            게스트로 체험하기
          </button>
        )}
        <p className="text-center text-xs text-slate-400">
          초대받은 아이디이신가요? <Link to="/signup" className="text-slate-700 underline">회원가입</Link>
        </p>
      </form>
    </div>
  )
}
