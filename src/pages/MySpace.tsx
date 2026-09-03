import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type {
  AgentContract, AgentProfile, CompanyCode, EducationRecord, LicenseInfo, Profile, TerminationRecord,
} from '../lib/types'

const emptyProfile = (profileId: string): AgentProfile => ({
  profile_id: profileId, phone: '', address: '', email: '',
  company_codes: [], registration_no: '', licenses: [], education_records: [], updated_at: '',
})

const emptyContract = (profileId: string): AgentContract => ({
  profile_id: profileId, appointment_date: null, contract_file_path: null, contract_file_name: null,
  termination_history: [], updated_at: '',
})

export default function MySpace() {
  const { profile } = useAuth()
  const isAdmin = profile?.role !== 'agent'
  const [agents, setAgents] = useState<Profile[]>([])
  const [targetId, setTargetId] = useState('')
  const [ap, setAp] = useState<AgentProfile | null>(null)
  const [ac, setAc] = useState<AgentContract | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingContract, setSavingContract] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (profile) setTargetId(profile.id)
  }, [profile])

  useEffect(() => {
    if (isAdmin) supabase.from('profiles').select('*').order('name').then(({ data }) => setAgents(data ?? []))
  }, [isAdmin])

  useEffect(() => {
    if (!targetId) return
    setLoading(true)
    Promise.all([
      supabase.from('agent_profiles').select('*').eq('profile_id', targetId).maybeSingle(),
      supabase.from('agent_contracts').select('*').eq('profile_id', targetId).maybeSingle(),
    ]).then(([{ data: pData }, { data: cData }]) => {
      setAp(pData ?? emptyProfile(targetId))
      setAc(cData ?? emptyContract(targetId))
      setLoading(false)
    })
  }, [targetId])

  const canEditSelf = !!profile && (targetId === profile.id || isAdmin)
  const canEditContract = isAdmin

  async function saveProfile() {
    if (!ap) return
    setSavingProfile(true)
    const { error } = await supabase.from('agent_profiles')
      .upsert({ ...ap, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
    setSavingProfile(false)
    if (error) alert('저장 실패: ' + error.message)
    else alert('저장되었습니다.')
  }

  async function saveContract() {
    if (!ac) return
    setSavingContract(true)
    let filePath = ac.contract_file_path
    let fileName = ac.contract_file_name
    if (file) {
      setUploading(true)
      const path = `${targetId}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('agent-contracts').upload(path, file)
      setUploading(false)
      if (uploadError) { setSavingContract(false); return alert('파일 업로드 실패: ' + uploadError.message) }
      filePath = path
      fileName = file.name
    }
    const { error } = await supabase.from('agent_contracts')
      .upsert({ ...ac, contract_file_path: filePath, contract_file_name: fileName, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
    setSavingContract(false)
    if (error) alert('저장 실패: ' + error.message)
    else { setFile(null); alert('저장되었습니다.') }
  }

  async function viewContractFile() {
    if (!ac?.contract_file_path) return
    const { data, error } = await supabase.storage.from('agent-contracts').createSignedUrl(ac.contract_file_path, 600)
    if (error || !data) return alert('파일 열람 실패: ' + (error?.message ?? ''))
    window.open(data.signedUrl, '_blank')
  }

  function updateCompanyCodes(rows: CompanyCode[]) {
    setAp((s) => (s ? { ...s, company_codes: rows } : s))
  }
  function updateLicenses(rows: LicenseInfo[]) {
    setAp((s) => (s ? { ...s, licenses: rows } : s))
  }
  function updateEducation(rows: EducationRecord[]) {
    setAp((s) => (s ? { ...s, education_records: rows } : s))
  }
  function updateTermination(rows: TerminationRecord[]) {
    setAc((s) => (s ? { ...s, termination_history: rows } : s))
  }

  if (!profile) return null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">나의공간</h1>
        <p className="text-sm text-slate-500 mt-1">개인정보, 자격/등록정보, 위촉계약 현황을 확인하고 관리합니다.</p>
      </div>

      {isAdmin && (
        <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
          <label className="text-sm text-slate-500">대상자</label>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
            ))}
          </select>
        </div>
      )}

      {loading && <p className="text-center text-slate-400 py-6">불러오는 중…</p>}

      {!loading && ap && (
        <div className="bg-white rounded-xl shadow p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">개인정보 / 자격정보</h2>
            {canEditSelf && (
              <button onClick={saveProfile} disabled={savingProfile}
                className="bg-slate-800 text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50">
                {savingProfile ? '저장 중…' : '저장'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="이름"><input disabled value={agents.find((a) => a.id === targetId)?.name ?? profile.name}
              className="w-full border border-slate-200 bg-slate-50 rounded-md px-2 py-1.5 text-sm" /></Field>
            <Field label="연락처">
              <input disabled={!canEditSelf} value={ap.phone} onChange={(e) => setAp({ ...ap, phone: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50" />
            </Field>
            <Field label="주소">
              <input disabled={!canEditSelf} value={ap.address} onChange={(e) => setAp({ ...ap, address: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50" />
            </Field>
            <Field label="이메일주소">
              <input disabled={!canEditSelf} value={ap.email} onChange={(e) => setAp({ ...ap, email: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50" />
            </Field>
            <Field label="설계사 등록번호">
              <input disabled={!canEditSelf} value={ap.registration_no} onChange={(e) => setAp({ ...ap, registration_no: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50" />
            </Field>
          </div>

          <RepeatingTable
            title="보험사별 코드정보"
            editable={canEditSelf}
            columns={['company', 'code']}
            headers={['보험사', '코드']}
            rows={ap.company_codes}
            onChange={updateCompanyCodes}
            makeEmpty={() => ({ company: '', code: '' })}
          />

          <RepeatingTable
            title="자격증 정보"
            editable={canEditSelf}
            columns={['name', 'valid_until']}
            headers={['자격증명', '유효기간']}
            rows={ap.licenses}
            onChange={updateLicenses}
            makeEmpty={() => ({ name: '', valid_until: '' })}
            colTypes={{ valid_until: 'date' }}
          />

          <RepeatingTable
            title="보수교육 이수현황"
            editable={canEditSelf}
            columns={['course', 'completed_date']}
            headers={['과정명', '이수일']}
            rows={ap.education_records}
            onChange={updateEducation}
            makeEmpty={() => ({ course: '', completed_date: '' })}
            colTypes={{ completed_date: 'date' }}
          />
        </div>
      )}

      {!loading && ac && (
        <div className="bg-white rounded-xl shadow p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">위촉계약 정보</h2>
              <p className="text-xs text-slate-400 mt-0.5">본인은 조회만 가능하며, 등록/수정은 관리자만 할 수 있습니다.</p>
            </div>
            {canEditContract && (
              <button onClick={saveContract} disabled={savingContract || uploading}
                className="bg-slate-800 text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50">
                {uploading ? '업로드 중…' : savingContract ? '저장 중…' : '저장'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="위촉일자">
              <input type="date" disabled={!canEditContract} value={ac.appointment_date ?? ''}
                onChange={(e) => setAc({ ...ac, appointment_date: e.target.value || null })}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50" />
            </Field>
            <Field label="위촉계약서">
              <div className="flex items-center gap-2">
                {ac.contract_file_name && (
                  <button type="button" onClick={viewContractFile} className="text-sm text-slate-600 underline">
                    {ac.contract_file_name}
                  </button>
                )}
                {canEditContract && (
                  <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
                )}
                {!ac.contract_file_name && !canEditContract && <span className="text-sm text-slate-400">등록된 파일 없음</span>}
              </div>
            </Field>
          </div>

          <RepeatingTable
            title="해촉이력"
            editable={canEditContract}
            columns={['date', 'reason']}
            headers={['일자', '사유']}
            rows={ac.termination_history}
            onChange={updateTermination}
            makeEmpty={() => ({ date: '', reason: '' })}
            colTypes={{ date: 'date' }}
          />
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function RepeatingTable<T extends Record<string, string>>({
  title, editable, columns, headers, rows, onChange, makeEmpty, colTypes,
}: {
  title: string
  editable: boolean
  columns: (keyof T & string)[]
  headers: string[]
  rows: T[]
  onChange: (rows: T[]) => void
  makeEmpty: () => T
  colTypes?: Partial<Record<keyof T & string, string>>
}) {
  function update(i: number, key: string, value: string) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r))
    onChange(next)
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([...rows, makeEmpty()])
  }

  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-2">{title}</p>
      {rows.length === 0 && <p className="text-xs text-slate-400 mb-2">등록된 정보가 없습니다.</p>}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            {columns.map((c) => (
              <input
                key={String(c)}
                type={colTypes?.[c] ?? 'text'}
                disabled={!editable}
                value={row[c] ?? ''}
                onChange={(e) => update(i, String(c), e.target.value)}
                className="flex-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            ))}
            {editable && (
              <button type="button" onClick={() => remove(i)} className="text-slate-400 hover:text-red-500 text-sm px-1">✕</button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <button type="button" onClick={add} className="mt-2 text-xs text-slate-500 hover:underline">
          + {headers[0]} 추가
        </button>
      )}
    </div>
  )
}
