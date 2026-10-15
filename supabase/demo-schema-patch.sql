-- 체험판(데모) DB용 보충 스키마 — supabase/schema.sql 실행 직후에 실행한다 (docs/DEMO.md 참고).
--
-- schema.sql 이후 운영 DB에만 추가된 테이블·컬럼·함수를 앱 코드(src/lib/types.ts, src/pages/*)가
-- 쓰는 모양대로 다시 만든 것이다. 운영 DB에서 그대로 덤프한 것이 아니므로 운영 DB에는 실행하지 말 것.

-- ── 기존 테이블에 추가된 컬럼 ─────────────────────────────
alter table profiles add column if not exists general_performance_rate numeric not null default 0; -- 일반성과 시상 지급률 (0~1)
alter table pending_invites add column if not exists general_performance_rate numeric not null default 0;

alter table contracts add column if not exists co_insurers jsonb;           -- 비례공동: [{ agent_id, name, ratio }]
alter table contracts add column if not exists duration_type text;          -- 기간구분
alter table contracts add column if not exists change_reason text;          -- 계약변경 사유
alter table contracts add column if not exists prior_contract_id uuid references contracts(id); -- 계약변경의 원 계약

alter table wage_statements add column if not exists custom_deductions jsonb not null default '[]'; -- [{ label, amount }]

-- ── 보험사 목록 (보증보험 만료일 포함) ─────────────────────
create table if not exists insurers (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  sort_order int not null default 0,
  business_guarantee_expiry date,
  advance_guarantee_expiry date,
  created_at timestamptz default now()
);
alter table insurers enable row level security;
create policy "insurers_select_all" on insurers
  for select using (auth.role() = 'authenticated');
create policy "insurers_write_hq_admin" on insurers
  for all using (my_role() = 'hq_admin') with check (my_role() = 'hq_admin');

-- 보험사 대표코드는 보험사명(company) 대신 insurers.id 로 연결한다
alter table insurer_accounts add column if not exists insurer_id uuid references insurers(id) on delete cascade;
alter table insurer_accounts alter column company drop not null;

-- ── 담당자 개인의 보험사별 코드 ────────────────────────────
create table if not exists agent_insurer_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  insurer_id uuid not null references insurers(id) on delete cascade,
  code text not null default '',
  code_auth text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (profile_id, insurer_id)
);
alter table agent_insurer_codes enable row level security;
create policy "agent_insurer_codes_scope" on agent_insurer_codes
  for all using (profile_id = auth.uid() or my_role() <> 'agent')
  with check (profile_id = auth.uid() or my_role() <> 'agent');

-- ── 공용 사이트 아이디 정보 (본사 소속만) ───────────────────
create table if not exists shared_site_accounts (
  id uuid primary key default gen_random_uuid(),
  site text not null default '',
  login_id text not null default '',
  password text not null default '',
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz default now()
);
alter table shared_site_accounts enable row level security;
create policy "shared_site_accounts_hq_org_only" on shared_site_accounts
  for all using (my_org() = 'hq') with check (my_org() = 'hq');

-- ── 게시판 ─────────────────────────────────────────────────
create table if not exists board_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  author_id uuid references profiles(id) on delete set null,
  author_name text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table board_posts enable row level security;
create policy "board_posts_select_all" on board_posts
  for select using (auth.role() = 'authenticated');
create policy "board_posts_insert_self" on board_posts
  for insert with check (author_id = auth.uid());
create policy "board_posts_update_author_or_hq" on board_posts
  for update using (author_id = auth.uid() or my_org() = 'hq');
create policy "board_posts_delete_author_or_hq" on board_posts
  for delete using (author_id = auth.uid() or my_org() = 'hq');

-- ── 예비계약 자동확정 ──────────────────────────────────────
-- 같은 증권번호 + 보험료(+보험사명 앞 2글자)로 확정 계약이 이미 들어와 있는 예비계약을 지우고 지운 건수를 돌려준다.
-- 계약관리 화면(Contracts.tsx)의 매칭 기준과 같다.
create or replace function auto_confirm_preliminary_contracts() returns int
  language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if my_role() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  delete from contracts p
  where p.is_preliminary
    and coalesce(trim(p.policy_no), '') <> ''
    and exists (
      select 1 from contracts c
      where not c.is_preliminary
        and trim(c.policy_no) = trim(p.policy_no)
        and c.premium = p.premium
        and left(c.company, 2) = left(p.company, 2)
    );
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function auto_confirm_preliminary_contracts() to authenticated;
