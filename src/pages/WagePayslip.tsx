import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Profile, WageCalcNote, WageStatement } from '../lib/types'

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const ZERO: Omit<WageStatement, 'id' | 'profile_id' | 'month' | 'updated_at'> = {
  pay_date: null, emp_no: '', department: '', hire_date: null,
  base_salary: 0, position_allowance: 0, meal_allowance: 0, bonus: 0, car_allowance: 0,
  national_pension: 0, health_insurance: 0, longterm_care_insurance: 0, employment_insurance: 0,
  health_insurance_settlement: 0, care_insurance_settlement: 0, advance_payment: 0,
  durunuri_pension: 0, durunuri_employment: 0, income_tax: 0, local_income_tax: 0, agri_tax: 0,
  calc_notes: [],
}
type Fields = typeof ZERO

const PAY_FIELDS: [keyof Fields, string][] = [
  ['base_salary', '기본급'],
  ['position_allowance', '직책수당'],
  ['meal_allowance', '식대'],
]
const PAY_IRREGULAR_FIELDS: [keyof Fields, string][] = [
  ['bonus', '상여'],
  ['car_allowance', '자가운전보조금'],
]
const DEDUCTION_FIELDS: [keyof Fields, string][] = [
  ['national_pension', '국민연금'],
  ['health_insurance', '건강보험'],
  ['longterm_care_insurance', '장기요양보험'],
  ['employment_insurance', '고용보험'],
  ['health_insurance_settlement', '건강보험정산'],
  ['care_insurance_settlement', '요양보험정산'],
  ['advance_payment', '기지급액'],
  ['durunuri_pension', '두루누리정산(연금)'],
  ['durunuri_employment', '두루누리정산(고용)'],
  ['income_tax', '소득세'],
  ['local_income_tax', '지방소득세'],
  ['agri_tax', '농특세'],
]

const PAY_SUM_FIELDS: (keyof Fields)[] = [...PAY_FIELDS, ...PAY_IRREGULAR_FIELDS].map(([k]) => k)
const DEDUCTION_SUM_FIELDS: (keyof Fields)[] = DEDUCTION_FIELDS.map(([k]) => k)

export default function WagePayslip() {
  const { profile, can } = useAuth()
  const [month, setMonth] = useState(thisMonth())
  const [targetId, setTargetId] = useState(profile?.id ?? '')
  const [staff, setStaff] = useState<Profile[]>([])
  const [target, setTarget] = useState<Profile | null>(profile)
  const [form, setForm] = useState<Fields>(ZERO)
  const [saving, setSaving] = useState(false)

  const canEdit = can('wage_statement')

  useEffect(() => {
    if (!profile || !canEdit) return
    supabase.from('profiles').select('*').eq('org_id', 'hq').order('name').then(({ data }) => setStaff(data ?? []))
  }, [profile, canEdit])

  useEffect(() => {
    setTargetId(profile?.id ?? '')
  }, [profile])

  useEffect(() => {
    if (!targetId) return
    supabase.from('wage_statements').select('*').eq('profile_id', targetId).eq('month', month).maybeSingle()
      .then(({ data }) => setForm(data ? { ...ZERO, ...data } : ZERO))
    if (targetId === profile?.id) setTarget(profile)
    else setTarget(staff.find((a) => a.id === targetId) ?? null)
  }, [targetId, month, staff, profile])

  const payTotal = PAY_SUM_FIELDS.reduce((s, k) => s + Number(form[k] || 0), 0)
  const deductionTotal = DEDUCTION_SUM_FIELDS.reduce((s, k) => s + Number(form[k] || 0), 0)
  const netPay = payTotal - deductionTotal

  function setNum(key: keyof Fields, value: number) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  function setText(key: 'emp_no' | 'department', value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  function setDate(key: 'pay_date' | 'hire_date', value: string) {
    setForm((f) => ({ ...f, [key]: value || null }))
  }
  function updateNotes(rows: WageCalcNote[]) {
    setForm((f) => ({ ...f, calc_notes: rows }))
  }

  async function save() {
    if (!target) return
    setSaving(true)
    const { error } = await supabase
      .from('wage_statements')
      .upsert({ profile_id: target.id, month, ...form, updated_at: new Date().toISOString() }, { onConflict: 'profile_id,month' })
    setSaving(false)
    if (error) alert('저장 실패: ' + error.message)
  }

  function NumberField({ k, label }: { k: keyof Fields; label: string }) {
    return (
      <div className="flex items-center justify-between text-sm py-1">
        <span className="text-slate-500">{label}</span>
        {canEdit ? (
          <input
            type="number"
            value={form[k] as number}
            onChange={(e) => setNum(k, Number(e.target.value))}
            className="w-32 border border-slate-200 rounded px-2 py-1 text-right text-sm"
          />
        ) : (
          <span>{Number(form[k] || 0).toLocaleString('ko-KR')}</span>
        )}
      </div>
    )
  }

  function addNote() {
    updateNotes([...form.calc_notes, { category: '', method: '', amount: '' }])
  }
  function updateNote(i: number, key: keyof WageCalcNote, value: string) {
    updateNotes(form.calc_notes.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)))
  }
  function removeNote(i: number) {
    updateNotes(form.calc_notes.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">임금명세서</h1>
          <p className="text-sm text-slate-500 mt-1">
            {canEdit ? '관리자 권한으로 명세를 조회·수정할 수 있습니다.' : '본인 명세서만 조회할 수 있습니다.'}
          </p>
        </div>
        <div className="flex gap-2 items-end">
          {canEdit && (
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
              {staff.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
      </div>

      {target && (
        <div className="bg-white rounded-xl shadow p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="bg-rose-600 text-white text-[10px] font-bold rounded px-2 py-1 leading-tight">PRO<br />INS</span>
              <span className="font-bold text-slate-800">프로인스컴퍼니</span>
            </div>
            <span className="text-sm font-semibold text-slate-500">임금명세서</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-y border-slate-100 py-4">
            <div><p className="text-xs text-slate-400">기준년월</p><p className="font-medium">{month}</p></div>
            <div><p className="text-xs text-slate-400">성명</p><p className="font-medium">{target.name}</p></div>
            <div><p className="text-xs text-slate-400">직위</p><p className="font-medium">{target.title || '-'}</p></div>
            <div>
              <p className="text-xs text-slate-400">사번</p>
              {canEdit ? (
                <input value={form.emp_no} onChange={(e) => setText('emp_no', e.target.value)}
                  className="w-full border border-slate-200 rounded px-2 py-1 text-sm" />
              ) : <p className="font-medium">{form.emp_no || '-'}</p>}
            </div>
            <div>
              <p className="text-xs text-slate-400">부서</p>
              {canEdit ? (
                <input value={form.department} onChange={(e) => setText('department', e.target.value)}
                  className="w-full border border-slate-200 rounded px-2 py-1 text-sm" />
              ) : <p className="font-medium">{form.department || '-'}</p>}
            </div>
            <div>
              <p className="text-xs text-slate-400">입사일</p>
              {canEdit ? (
                <input type="date" value={form.hire_date ?? ''} onChange={(e) => setDate('hire_date', e.target.value)}
                  className="w-full border border-slate-200 rounded px-2 py-1 text-sm" />
              ) : <p className="font-medium">{form.hire_date || '-'}</p>}
            </div>
            <div>
              <p className="text-xs text-slate-400">지급일</p>
              {canEdit ? (
                <input type="date" value={form.pay_date ?? ''} onChange={(e) => setDate('pay_date', e.target.value)}
                  className="w-full border border-slate-200 rounded px-2 py-1 text-sm" />
              ) : <p className="font-medium">{form.pay_date || '-'}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">지급액 계</p>
              <p className="font-bold text-lg">{payTotal.toLocaleString('ko-KR')} 원</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">공제액 계</p>
              <p className="font-bold text-lg">{deductionTotal.toLocaleString('ko-KR')} 원</p>
            </div>
            <div className="bg-rose-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">실수령액</p>
              <p className="font-bold text-lg text-rose-600">{netPay.toLocaleString('ko-KR')} 원</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-t-md">지급</p>
              <div className="border border-t-0 border-slate-100 rounded-b-md p-3 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">매월지급</p>
                  {PAY_FIELDS.map(([k, label]) => <NumberField key={k} k={k} label={label} />)}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-1">부정기지급</p>
                  {PAY_IRREGULAR_FIELDS.map(([k, label]) => <NumberField key={k} k={k} label={label} />)}
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold">
                  <span>지급액 계</span>
                  <span>{payTotal.toLocaleString('ko-KR')} 원</span>
                </div>
              </div>
            </div>

            <div>
              <p className="bg-rose-600 text-white text-xs font-semibold px-3 py-1.5 rounded-t-md">공제</p>
              <div className="border border-t-0 border-slate-100 rounded-b-md p-3 space-y-3">
                {DEDUCTION_FIELDS.map(([k, label]) => <NumberField key={k} k={k} label={label} />)}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold">
                  <span>공제액 계</span>
                  <span className="text-rose-600">{deductionTotal.toLocaleString('ko-KR')} 원</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 mb-2">계산방법</p>
              {canEdit && (
                <button type="button" onClick={addNote} className="text-xs text-slate-500 hover:underline mb-2">+ 항목 추가</button>
              )}
            </div>
            {form.calc_notes.length === 0 && <p className="text-xs text-slate-400">등록된 계산방법이 없습니다.</p>}
            <div className="space-y-2">
              {form.calc_notes.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input placeholder="구분" disabled={!canEdit} value={row.category}
                    onChange={(e) => updateNote(i, 'category', e.target.value)}
                    className="w-32 border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50" />
                  <input placeholder="산출식 또는 산출방법" disabled={!canEdit} value={row.method}
                    onChange={(e) => updateNote(i, 'method', e.target.value)}
                    className="flex-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50" />
                  <input placeholder="지급액(원)" disabled={!canEdit} value={row.amount}
                    onChange={(e) => updateNote(i, 'amount', e.target.value)}
                    className="w-32 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right disabled:bg-slate-50" />
                  {canEdit && (
                    <button type="button" onClick={() => removeNote(i)} className="text-slate-400 hover:text-red-500 text-sm px-1">✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className="bg-slate-800 text-white rounded-md px-5 py-2 text-sm font-medium disabled:opacity-50">
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          )}

          <div className="bg-amber-50 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="font-semibold text-slate-700">실수령액</span>
            <span className="font-bold text-xl text-amber-700">{netPay.toLocaleString('ko-KR')} 원</span>
          </div>

          <p className="text-center text-xs text-slate-400 pt-2">
            귀하의 노고에 감사드립니다.<br />(주)프로인스컴퍼니
          </p>
        </div>
      )}
    </div>
  )
}
