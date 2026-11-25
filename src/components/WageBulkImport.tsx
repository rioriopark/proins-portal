import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { readWagePdf } from '../lib/wagePdf'
import { DEDUCTION_KEYS, PAY_KEYS, parseWageFileName, type ParsedWage } from '../lib/wagePdfParse'

// 급여 프로그램에서 받은 임금명세서 PDF(번호_이름_기간.pdf) 여러 개를 한 번에 올리면, 파일마다 내용을 읽어
// 직원(본사 프로필)과 이름으로 매칭하고 해당 기준월 명세서로 한꺼번에 저장한다. PDF에 적힌 지급액 계·
// 공제액 계·실수령액과 읽어 낸 항목 합계가 다르면 잘못 읽은 것이므로 기본으로 제외한다.

interface Row {
  key: string
  fileName: string
  parsing: boolean
  error?: string
  parsed?: ParsedWage
  profileId: string
  include: boolean
  exists?: boolean
}

function won(n: number | null | undefined) {
  return n == null ? '-' : n.toLocaleString('ko-KR')
}

function totals(p: ParsedWage) {
  const pay = PAY_KEYS.reduce((s, k) => s + p.amounts[k], 0)
  const deduction = DEDUCTION_KEYS.reduce((s, k) => s + p.amounts[k], 0)
  return { pay, deduction, net: pay - deduction }
}

function totalsMatch(p: ParsedWage) {
  const t = totals(p)
  return t.pay === p.pdfPayTotal && t.deduction === p.pdfDeductionTotal && t.net === p.pdfNetPay
}

function matchProfile(staff: Profile[], name: string): string {
  const hits = staff.filter((s) => s.name.replace(/\s+/g, '') === name)
  return hits.length === 1 ? hits[0].id : ''
}

export default function WageBulkImport({
  staff,
  onClose,
  onSaved,
}: {
  staff: Profile[]
  onClose: () => void
  onSaved: (month: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  function patch(key: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)))
  }

  async function markExisting(list: Row[]) {
    const ready = list.filter((r) => r.parsed?.month && r.profileId)
    if (ready.length === 0) return
    const { data } = await supabase
      .from('wage_statements')
      .select('profile_id, month')
      .in('profile_id', [...new Set(ready.map((r) => r.profileId))])
      .in('month', [...new Set(ready.map((r) => r.parsed!.month!))])
    const have = new Set((data ?? []).map((d) => `${d.profile_id}|${d.month}`))
    setRows((prev) =>
      prev.map((r) => (r.parsed?.month && r.profileId ? { ...r, exists: have.has(`${r.profileId}|${r.parsed.month}`) } : r)),
    )
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setMessage('')
    const added: Row[] = Array.from(files).map((f) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: f.name,
      parsing: true,
      profileId: '',
      include: false,
    }))
    setRows((prev) => [...prev, ...added])

    const done = await Promise.all(
      Array.from(files).map(async (file, i): Promise<Row> => {
        const base = added[i]
        try {
          const parsed = await readWagePdf(file)
          const fromFile = parseWageFileName(file.name)
          if (!parsed.name) parsed.name = fromFile.name
          if (!parsed.emp_no) parsed.emp_no = fromFile.empNo
          if (!parsed.month) throw new Error('기준년월을 찾지 못했습니다. 임금명세서 PDF가 맞는지 확인해 주세요.')
          const profileId = matchProfile(staff, parsed.name)
          return { ...base, parsing: false, parsed, profileId, include: !!profileId && totalsMatch(parsed) }
        } catch (err) {
          return { ...base, parsing: false, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    )
    setRows((prev) => prev.map((r) => done.find((d) => d.key === r.key) ?? r))
    await markExisting(done)
  }

  function changeProfile(row: Row, profileId: string) {
    const next = { ...row, profileId, include: !!profileId && !!row.parsed && totalsMatch(row.parsed) }
    patch(row.key, next)
    void markExisting([next])
  }

  const selected = rows.filter((r) => r.include && r.parsed && r.profileId)
  const dupProfiles = new Set(
    selected
      .map((r) => `${r.profileId}|${r.parsed!.month}`)
      .filter((k, i, arr) => arr.indexOf(k) !== i),
  )

  async function save() {
    if (selected.length === 0) return
    if (dupProfiles.size > 0) {
      alert('같은 직원·같은 월의 파일이 두 개 이상 선택되어 있습니다. 하나만 남겨 주세요.')
      return
    }
    const overwrite = selected.filter((r) => r.exists).length
    if (overwrite > 0 && !confirm(`이미 등록된 명세서 ${overwrite}건은 PDF 내용으로 덮어씁니다. 계속할까요?`)) return

    setSaving(true)
    const now = new Date().toISOString()
    const payload = selected.map((r) => {
      const p = r.parsed!
      return {
        profile_id: r.profileId,
        month: p.month,
        pay_date: p.pay_date,
        emp_no: p.emp_no,
        // PDF에 부서가 비어 있으면 기존에 입력해 둔 부서를 지우지 않는다.
        ...(p.department ? { department: p.department } : {}),
        hire_date: p.hire_date,
        ...p.amounts,
        calc_notes: p.calc_notes,
        // PDF 합계가 표준 항목 합과 일치하는 것을 확인했으므로 추가 공제는 비운다(남겨 두면 실수령액이 틀어짐).
        custom_deductions: [],
        updated_at: now,
      }
    })
    const { error } = await supabase.from('wage_statements').upsert(payload, { onConflict: 'profile_id,month' })
    setSaving(false)
    if (error) {
      alert('일괄 등록 실패: ' + error.message)
      return
    }
    const savedKeys = new Set(selected.map((r) => r.key))
    setRows((prev) => prev.filter((r) => !savedKeys.has(r.key)))
    setMessage(`${selected.length}건을 등록했습니다.`)
    onSaved(selected[0].parsed!.month!)
  }

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-bold text-slate-800">임금명세서 일괄 등록</h2>
          <p className="text-sm text-slate-500 mt-1">
            급여 프로그램에서 받은 임금명세서 PDF를 여러 개 한 번에 선택하세요. 파일마다 기준년월·항목을 읽고 이름으로
            직원을 찾아 줍니다. PDF의 합계와 읽은 금액이 맞는 행만 자동으로 선택됩니다.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">
          닫기
        </button>
      </div>

      <input
        type="file"
        multiple
        accept="application/pdf,.pdf"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
        className="block text-sm"
      />

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 px-2 text-left w-8"></th>
                <th className="py-2 px-2 text-left">파일</th>
                <th className="py-2 px-2 text-left">직원</th>
                <th className="py-2 px-2 text-left">기준월</th>
                <th className="py-2 px-2 text-left">지급일</th>
                <th className="py-2 px-2 text-right">지급액 계</th>
                <th className="py-2 px-2 text-right">공제액 계</th>
                <th className="py-2 px-2 text-right">실수령액</th>
                <th className="py-2 px-2 text-left">상태</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.parsed
                const t = p ? totals(p) : null
                const ok = p ? totalsMatch(p) : false
                const dup = p && r.include && dupProfiles.has(`${r.profileId}|${p.month}`)
                return (
                  <tr key={r.key} className="border-b border-slate-100 align-top">
                    <td className="py-2 px-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        disabled={!p || !r.profileId}
                        onChange={(e) => patch(r.key, { include: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 px-2 text-slate-600 break-all max-w-[200px]">{r.fileName}</td>
                    {r.parsing ? (
                      <td colSpan={7} className="py-2 px-2 text-slate-400">
                        읽는 중…
                      </td>
                    ) : r.error || !p || !t ? (
                      <td colSpan={7} className="py-2 px-2 text-red-600">
                        {r.error ?? '읽지 못했습니다.'}
                      </td>
                    ) : (
                      <>
                        <td className="py-2 px-2">
                          <select
                            value={r.profileId}
                            onChange={(e) => changeProfile(r, e.target.value)}
                            className={`border rounded px-1.5 py-1 text-sm bg-white ${r.profileId ? 'border-slate-200' : 'border-red-400'}`}
                          >
                            <option value="">— {p.name || '직원'} 선택 —</option>
                            {staff.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          {p.emp_no && <p className="text-xs text-slate-400 mt-0.5">사번 {p.emp_no}</p>}
                        </td>
                        <td className="py-2 px-2">{p.month}</td>
                        <td className="py-2 px-2">{p.pay_date ?? '-'}</td>
                        <td className="py-2 px-2 text-right">{won(t.pay)}</td>
                        <td className="py-2 px-2 text-right">{won(t.deduction)}</td>
                        <td className="py-2 px-2 text-right font-semibold">{won(t.net)}</td>
                        <td className="py-2 px-2 text-xs">
                          {!r.profileId && <p className="text-red-600">직원을 선택해 주세요</p>}
                          {!ok && (
                            <p className="text-red-600">
                              PDF 합계와 다름 (PDF: 지급 {won(p.pdfPayTotal)} / 공제 {won(p.pdfDeductionTotal)} / 실수령{' '}
                              {won(p.pdfNetPay)})
                            </p>
                          )}
                          {dup && <p className="text-red-600">같은 직원·월 중복</p>}
                          {r.exists && <p className="text-amber-600">기존 명세서 덮어씀</p>}
                          {r.profileId && ok && !r.exists && !dup && <p className="text-emerald-600">신규 등록</p>}
                        </td>
                      </>
                    )}
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                        className="text-slate-400 hover:text-red-500 text-sm px-1"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {message && <span className="text-sm text-emerald-600">{message}</span>}
        <button
          type="button"
          onClick={save}
          disabled={saving || selected.length === 0 || rows.some((r) => r.parsing)}
          className="bg-slate-800 text-white rounded-md px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? '등록 중…' : `선택한 ${selected.length}건 일괄 등록`}
        </button>
      </div>
    </div>
  )
}
