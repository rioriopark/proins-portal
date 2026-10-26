-- 보험사 엑셀 열 매핑 기억 — 운영 DB와 체험판 DB 모두 SQL Editor에서 한 번 실행한다.
--
-- 계약 일괄등록(보험사 포털 엑셀 업로드)에서 한 번 확인하고 등록한 열 매핑을 보험사·종목별로
-- 저장해 두었다가, 다음 달 같은 보험사 파일을 올리면 확인 없이 그대로 적용한다.
-- 열 순서가 바뀌어도 맞도록 열 위치가 아니라 열 이름(헤더)으로 저장한다.
create table if not exists insurer_column_mappings (
  insurer text not null,
  file_category text not null default '', -- 파일명에서 인식한 종목('장기'|'일반'|'자동차'), 모르면 ''
  mapping jsonb not null default '{}',     -- { 항목키: 열 이름 | null(사용 안 함) }
  updated_by uuid references profiles(id),
  updated_at timestamptz default now(),
  primary key (insurer, file_category)
);

-- 일괄등록 화면과 같은 범위: 본사 소속(org_id='hq') 직원만 조회/관리
alter table insurer_column_mappings enable row level security;
drop policy if exists "insurer_column_mappings_hq_org_only" on insurer_column_mappings;
create policy "insurer_column_mappings_hq_org_only" on insurer_column_mappings
  for all using (my_org() = 'hq') with check (my_org() = 'hq');
