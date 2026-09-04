-- PRO INS COMPANY 계약관리 포털 — Supabase 스키마
-- Supabase 프로젝트 생성 후 SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.

create extension if not exists pgcrypto;

-- ── 조직 (본사 / 지사 / 지점) ─────────────────────────────
create table organizations (
  id text primary key,
  name text not null,
  type text not null check (type in ('HQ','REGION','CENTER','STORE')),
  parent_id text references organizations(id)
);

-- ── 직원 프로필 (auth.users 1:1) ──────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null check (role in ('hq_admin','branch_admin','store_manager','agent')),
  org_id text not null references organizations(id),
  title text default '',
  rate_long numeric default 1.0,   -- 장기 지급률 (0~1)
  rate_general numeric default 1.0, -- 일반 지급률 (0~1)
  bank text default '',
  account text default '',
  created_at timestamptz default now()
);

-- ── 계약 ──────────────────────────────────────────────────
create table contracts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references profiles(id) on delete cascade, -- 담당자가 가입 전이면 null
  agent_email text,                  -- 가입 전 담당자를 이메일로 임시 식별 (가입 시 자동으로 agent_id 채워짐)
  month text not null,               -- 'YYYY-MM'
  category text not null,            -- '장기' | '일반' | '자동차'
  type text not null,                -- '신규' | '계속' | '환수' | '부활' | '비례공동'
  company text default '',
  product_name text default '',
  customer_name text default '',
  receipt_date date,                 -- 영수일 (건별 상세 데이터가 없으면 null)
  count int not null default 0,
  premium numeric not null default 0,
  commission numeric not null default 0, -- 지급률 적용 전 원 수수료
  created_at timestamptz default now(),
  constraint contracts_has_owner check (agent_id is not null or agent_email is not null)
);

-- ── 가입 초대장 (이메일 화이트리스트) ─────────────────────
-- hq_admin/branch_admin/store_manager 가 새 직원을 추가하면 여기 한 줄이 생기고,
-- 그 이메일로 실제 회원가입(Signup)을 하면 트리거가 profiles 를 자동 생성합니다.
create table pending_invites (
  email text primary key,
  name text not null,
  role text not null check (role in ('hq_admin','branch_admin','store_manager','agent')),
  org_id text not null references organizations(id),
  title text default '',
  rate_long numeric default 1.0,
  rate_general numeric default 1.0,
  bank text default '',
  account text default '',
  invited_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ── 보험사 시상안 게시판 ────────────────────────────────────
-- ── 업무 연락처(임직원 / 업무지원 / 보험사담당자) ────────────
create table contacts (
  id uuid primary key default gen_random_uuid(),
  category text not null,        -- '임직원' | '업무지원' | '보험사담당자'
  company text default '',
  name text default '',
  title text default '',
  phone text default '',
  office_phone text default '',
  fax text default '',
  business text default '',
  email text default '',
  note text default '',
  sort_order int default 0,
  profile_id uuid references profiles(id) on delete set null, -- 나의공간 개인정보와 자동 연동되는 임직원 행 식별용
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index contacts_profile_id_unique on contacts (profile_id) where profile_id is not null;

-- ── 포털 항목별 수정권한 (아이디별로 특정 메뉴에 관리자급 쓰기 권한을 개별 부여) ─
-- menu_key: 'contracts' | 'bulk_import' | 'statement' | 'incentives' | 'work_contacts'
-- 조직관리/정보관리는 권한 상승 위험 때문에 개별 부여 대상에서 제외하고 hq_admin 전용으로 유지
create table menu_permissions (
  profile_id uuid not null references profiles(id) on delete cascade,
  menu_key text not null,
  created_at timestamptz default now(),
  primary key (profile_id, menu_key)
);

alter table menu_permissions enable row level security;
create policy "menu_permissions_select_scope" on menu_permissions
  for select using (profile_id = auth.uid() or my_role() = 'hq_admin');
create policy "menu_permissions_write_hq" on menu_permissions
  for all using (my_role() = 'hq_admin') with check (my_role() = 'hq_admin');

create or replace function has_menu_permission(key text) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists(select 1 from menu_permissions where profile_id = auth.uid() and menu_key = key) $$;

-- ── 나의공간: 설계사 개인정보 (본인 또는 관리자가 작성/수정) ────
create table agent_profiles (
  profile_id uuid primary key references profiles(id) on delete cascade,
  phone text default '',
  address text default '',
  email text default '',
  company_codes jsonb not null default '[]',     -- [{ company, code }]
  registration_no text default '',
  licenses jsonb not null default '[]',          -- [{ name, valid_until }]
  education_records jsonb not null default '[]', -- [{ course, completed_date }]
  updated_at timestamptz default now()
);

alter table agent_profiles enable row level security;
create policy "agent_profiles_select_scope" on agent_profiles
  for select using (profile_id = auth.uid() or my_role() <> 'agent');
create policy "agent_profiles_write_scope" on agent_profiles
  for all using (profile_id = auth.uid() or my_role() <> 'agent')
  with check (profile_id = auth.uid() or my_role() <> 'agent');

-- ── 나의공간: 위촉계약 정보 (본인은 조회만, 작성/수정은 관리자만) ─
create table agent_contracts (
  profile_id uuid primary key references profiles(id) on delete cascade,
  appointment_date date,
  contract_file_path text,
  contract_file_name text,
  termination_history jsonb not null default '[]', -- [{ date, reason }]
  updated_at timestamptz default now()
);

alter table agent_contracts enable row level security;
create policy "agent_contracts_select_scope" on agent_contracts
  for select using (profile_id = auth.uid() or my_role() <> 'agent');
create policy "agent_contracts_write_admin" on agent_contracts
  for all using (my_role() <> 'agent') with check (my_role() <> 'agent');

-- 나의공간(agent_profiles) 저장 시 업무연락처(contacts, 임직원)에 자동 반영
-- security definer 라서 work_contacts 권한이 없는 담당자가 본인 나의공간을 저장해도 동기화됨
create or replace function sync_contact_from_agent_profile() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  p profiles%rowtype;
begin
  select * into p from profiles where id = new.profile_id;
  if not found then
    return new;
  end if;
  insert into contacts (category, profile_id, name, title, phone, email, sort_order)
  values ('임직원', new.profile_id, p.name, p.title, new.phone, new.email,
    (select coalesce(max(sort_order), 0) + 1 from contacts))
  on conflict (profile_id) where profile_id is not null do update
    set name = excluded.name,
        title = excluded.title,
        phone = excluded.phone,
        email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_agent_profile_upsert on agent_profiles;
create trigger on_agent_profile_upsert
  after insert or update on agent_profiles
  for each row execute function sync_contact_from_agent_profile();

-- 위촉계약서 원본 파일 — 개인정보라 비공개 버킷, 본인 폴더(profile_id) 또는 관리자만 열람
insert into storage.buckets (id, name, public) values ('agent-contracts', 'agent-contracts', false)
  on conflict (id) do nothing;
create policy "agent_contracts_files_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'agent-contracts' and (my_role() <> 'agent' or (storage.foldername(name))[1] = auth.uid()::text));
create policy "agent_contracts_files_insert_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'agent-contracts' and my_role() <> 'agent');
create policy "agent_contracts_files_update_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'agent-contracts' and my_role() <> 'agent');
create policy "agent_contracts_files_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'agent-contracts' and my_role() <> 'agent');

-- ── 정보관리 배너 (공지 배너 — target_profile_ids 가 비어있으면 전체 공개) ─
create table banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text default '',
  start_date date,
  end_date date,
  target_profile_ids uuid[] not null default '{}',
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 교육 일정 (메인화면 노출용 — 본사관리자가 등록) ──────────
create table education_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  event_time text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table incentives (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  month text not null,               -- 'YYYY-MM'
  title text not null,
  period text default '',
  target text default '',
  content text default '',
  file_url text,
  file_name text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 시상안 첨부파일(PDF/이미지) 저장용 버킷 — 마케팅성 자료라 공개 버킷으로 둠
insert into storage.buckets (id, name, public) values ('incentive-files', 'incentive-files', true)
  on conflict (id) do nothing;
create policy "incentive_files_select_all" on storage.objects
  for select to authenticated
  using (bucket_id = 'incentive-files');
create policy "incentive_files_insert_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'incentive-files' and (my_role() <> 'agent' or has_menu_permission('incentives')));
create policy "incentive_files_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'incentive-files' and (my_role() <> 'agent' or has_menu_permission('incentives')));

-- ── 수수료명세서 (급여/공제 상세 — 관리자가 월별로 직접 입력) ─
create table statements (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references profiles(id) on delete cascade,
  agent_email text not null,
  month text not null,
  recruit_first numeric default 0,        -- 모집초회수수료
  recruit_installment numeric default 0,  -- 모집분급수수료
  maintain numeric default 0,             -- 유지
  clawback_revive numeric default 0,      -- 환수/부활
  general numeric default 0,              -- 일반
  auto numeric default 0,                 -- 자동차
  mgmt_fee numeric default 0,             -- 관리수수료
  collection_fee numeric default 0,       -- 수금수수료
  personal_incentive numeric default 0,   -- 개인시책
  corporate_incentive numeric default 0,  -- 법인시책
  general_performance numeric default 0,  -- 일반성과
  other_incentive numeric default 0,      -- 기타시상
  taxable_income numeric default 0,       -- 과세소득합계
  industrial_accident_ins numeric default 0, -- 산재보험
  employment_ins numeric default 0,       -- 고용보험
  employment_ins_support numeric default 0, -- 고용보험지원금
  income_tax numeric default 0,           -- 소득세
  resident_tax numeric default 0,         -- 주민세
  incentive_offset numeric default 0,     -- 시상대체
  other_deduction numeric default 0,      -- 기타공제
  hq_support_offset numeric default 0,    -- 본사지원품대체
  workplace_cost numeric default 0,       -- 사업장운영비
  unit_cost numeric default 0,            -- 사업단운영비
  risk_reserve numeric default 0,         -- 위험적립금
  loan numeric default 0,                 -- 대여금
  updated_at timestamptz default now(),
  unique (agent_email, month)
);

alter table statements enable row level security;
create policy "statements_select_scope" on statements
  for select using (agent_id = auth.uid() or my_role() <> 'agent');
create policy "statements_write_admin" on statements
  for all using (my_role() <> 'agent' or has_menu_permission('statement'))
  with check (my_role() <> 'agent' or has_menu_permission('statement'));

-- ── 임금명세서 (정직원 급여/공제 상세 — 관리자가 월별로 직접 입력) ─
create table wage_statements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  month text not null,
  pay_date date,           -- 지급일
  emp_no text default '',  -- 사번
  department text default '', -- 부서
  hire_date date,          -- 입사일
  base_salary numeric default 0,       -- 기본급
  position_allowance numeric default 0, -- 직책수당
  meal_allowance numeric default 0,    -- 식대
  bonus numeric default 0,             -- 상여
  car_allowance numeric default 0,     -- 자가운전보조금
  national_pension numeric default 0,  -- 국민연금
  health_insurance numeric default 0,  -- 건강보험
  longterm_care_insurance numeric default 0, -- 장기요양보험
  employment_insurance numeric default 0,    -- 고용보험
  health_insurance_settlement numeric default 0, -- 건강보험정산
  care_insurance_settlement numeric default 0,   -- 요양보험정산
  advance_payment numeric default 0,   -- 기지급액
  durunuri_pension numeric default 0,  -- 두루누리정산(연금)
  durunuri_employment numeric default 0, -- 두루누리정산(고용)
  income_tax numeric default 0,        -- 소득세
  local_income_tax numeric default 0,  -- 지방소득세
  agri_tax numeric default 0,          -- 농특세
  calc_notes jsonb not null default '[]', -- 계산방법: [{category, method, amount}]
  updated_at timestamptz default now(),
  unique (profile_id, month)
);

alter table wage_statements enable row level security;
create policy "wage_statements_select_scope" on wage_statements
  for select using (profile_id = auth.uid() or my_role() <> 'agent');
create policy "wage_statements_write_admin" on wage_statements
  for all using (my_role() <> 'agent' or has_menu_permission('wage_statement'))
  with check (my_role() <> 'agent' or has_menu_permission('wage_statement'));

alter table contacts enable row level security;
create policy "contacts_select_all" on contacts
  for select using (auth.role() = 'authenticated');
create policy "contacts_write_admin" on contacts
  for all using (my_role() <> 'agent' or has_menu_permission('work_contacts'))
  with check (my_role() <> 'agent' or has_menu_permission('work_contacts'));

-- banners: target_profile_ids 가 비어있으면 전체 공개, 아니면 대상자 + 본사관리자만 조회. 작성/수정/삭제는 본사관리자만.
alter table banners enable row level security;
create policy "banners_select_scope" on banners
  for select using (
    my_role() = 'hq_admin'
    or target_profile_ids = '{}'
    or auth.uid() = any(target_profile_ids)
  );
create policy "banners_write_admin" on banners
  for all using (my_role() = 'hq_admin') with check (my_role() = 'hq_admin');

-- education_events: 로그인한 사람 전체 조회 가능, 작성/수정/삭제는 본사관리자만
alter table education_events enable row level security;
create policy "education_events_select_all" on education_events
  for select using (auth.role() = 'authenticated');
create policy "education_events_write_admin" on education_events
  for all using (my_role() = 'hq_admin') with check (my_role() = 'hq_admin');

-- ── 조직 하위트리 판별 함수 (root_id 가 node_id 의 조상 또는 자기 자신인가) ──
create or replace function is_org_descendant(root_id text, node_id text)
returns boolean language sql stable as $$
  with recursive chain as (
    select id, parent_id from organizations where id = node_id
    union all
    select o.id, o.parent_id from organizations o join chain c on o.id = c.parent_id
  )
  select exists(select 1 from chain where id = root_id);
$$;

-- ── 내 프로필 조회 헬퍼 (RLS 정책에서 재사용) ─────────────
-- security definer 필수: profiles 자신의 RLS 정책 안에서 profiles 를 다시 조회하므로,
-- 일반 함수로 두면 "infinite recursion detected in policy for relation profiles" 에러가 남.
create or replace function my_role() returns text
  language sql stable security definer set search_path = public
  as $$ select role from profiles where id = auth.uid() $$;
create or replace function my_org() returns text
  language sql stable security definer set search_path = public
  as $$ select org_id from profiles where id = auth.uid() $$;

-- ── 신규 가입 시 초대장을 profiles 로 전환하는 트리거 ─────
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv pending_invites%rowtype;
begin
  select * into inv from pending_invites where email = new.email;
  if found then
    insert into profiles (id, email, name, role, org_id, title, rate_long, rate_general, bank, account)
    values (new.id, new.email, inv.name, inv.role, inv.org_id, inv.title, inv.rate_long, inv.rate_general, inv.bank, inv.account);
    delete from pending_invites where email = new.email;
    -- 가입 전에 이메일로 미리 등록해둔 계약/명세서를 이 계정으로 연결
    update contracts set agent_id = new.id where agent_email = new.email and agent_id is null;
    update statements set agent_id = new.id where agent_email = new.email and agent_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── RLS 활성화 ─────────────────────────────────────────────
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table contracts enable row level security;
alter table pending_invites enable row level security;
alter table incentives enable row level security;

-- organizations: 로그인한 사람은 전체 조직도를 볼 수 있음(트리 UI 표시용), 쓰기는 hq_admin만
create policy "orgs_select_all_authenticated" on organizations
  for select using (auth.role() = 'authenticated');
create policy "orgs_write_hq_admin" on organizations
  for all using (my_role() = 'hq_admin') with check (my_role() = 'hq_admin');

-- profiles: 본인 + 본인 조직 하위 트리는 조회 가능, 쓰기는 본인 것만(계좌 등 본인 정보 수정)
create policy "profiles_select_scope" on profiles
  for select using (
    id = auth.uid()
    or my_role() = 'hq_admin'
    or (my_role() in ('branch_admin','store_manager') and is_org_descendant(my_org(), org_id))
  );
create policy "profiles_update_scope" on profiles
  for update using (
    id = auth.uid()
    or my_role() = 'hq_admin'
    or (my_role() in ('branch_admin','store_manager') and is_org_descendant(my_org(), org_id))
  );

-- contracts: 본인 계약 + 관리 범위 내 하위 조직 계약 조회, 입력은 담당자 본인 또는 관리자
-- agent_id 가 null(담당자 미가입, 이메일로만 임시 등록된 계약)인 행은 본사관리자만 조회/관리 가능
create policy "contracts_select_scope" on contracts
  for select using (
    agent_id = auth.uid()
    or my_role() = 'hq_admin'
    or (
      agent_id is not null
      and my_role() in ('branch_admin','store_manager')
      and exists (select 1 from profiles p where p.id = contracts.agent_id and is_org_descendant(my_org(), p.org_id))
    )
  );
create policy "contracts_insert_scope" on contracts
  for insert with check (
    agent_id = auth.uid()
    or my_role() = 'hq_admin'
    or has_menu_permission('contracts')
    or has_menu_permission('bulk_import')
    or (
      agent_id is not null
      and my_role() in ('branch_admin','store_manager')
      and exists (select 1 from profiles p where p.id = contracts.agent_id and is_org_descendant(my_org(), p.org_id))
    )
  );
create policy "contracts_update_scope" on contracts
  for update using (
    my_role() = 'hq_admin'
    or has_menu_permission('contracts')
    or has_menu_permission('bulk_import')
    or (
      agent_id is not null
      and my_role() in ('branch_admin','store_manager')
      and exists (select 1 from profiles p where p.id = contracts.agent_id and is_org_descendant(my_org(), p.org_id))
    )
  );

-- pending_invites: hq_admin 은 전체, branch_admin/store_manager 는 자기 하위 조직만 초대 가능. 본인 이메일 초대장은 회원가입 전 자기 자신도 조회 가능(가입 화면 안내용은 생략, service 단에서만 사용)
create policy "invites_manage_scope" on pending_invites
  for all using (
    my_role() = 'hq_admin'
    or (my_role() in ('branch_admin','store_manager') and is_org_descendant(my_org(), org_id))
  )
  with check (
    my_role() = 'hq_admin'
    or (my_role() in ('branch_admin','store_manager') and is_org_descendant(my_org(), org_id))
  );

-- incentives: 로그인한 사람은 전체 열람, 작성/수정/삭제는 담당자(agent) 이외만
create policy "incentives_select_all" on incentives
  for select using (auth.role() = 'authenticated');
create policy "incentives_write_admin" on incentives
  for all using (my_role() <> 'agent') with check (my_role() <> 'agent');

-- ── 조직 시드 데이터 (원본 포털의 조직 구조) ───────────────
insert into organizations (id, name, type, parent_id) values
  ('hq', '프로인스컴퍼니 본사', 'HQ', null),
  ('br-direct', '본사직영', 'CENTER', 'hq'),
  ('st-direct-1', '본사직영 1지점', 'STORE', 'br-direct'),
  ('br-seoul', '서울비즈니스센터', 'CENTER', 'hq'),
  ('br-incubating', '인큐베이팅지점', 'CENTER', 'hq');

-- ── 최초 관리자 초대장 ───────────────────────────────────────
-- 아래 이메일을 본인이 로그인에 사용할 실제 이메일로 바꾼 뒤 실행하세요.
-- 이 초대장으로 /signup 에서 회원가입하면 자동으로 본사관리자(hq_admin) 권한이 부여됩니다.
insert into pending_invites (email, name, role, org_id, title, rate_long, rate_general) values
  ('rioriopark@gmail.com', '박대표', 'hq_admin', 'hq', '대표관리자', 1.0, 1.0);
