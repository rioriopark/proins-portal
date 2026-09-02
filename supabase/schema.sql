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
create table incentives (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  month text not null,               -- 'YYYY-MM'
  title text not null,
  period text default '',
  target text default '',
  content text default '',
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

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
    -- 가입 전에 이메일로 미리 등록해둔 계약들을 이 계정으로 연결
    update contracts set agent_id = new.id where agent_email = new.email and agent_id is null;
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
    or (
      agent_id is not null
      and my_role() in ('branch_admin','store_manager')
      and exists (select 1 from profiles p where p.id = contracts.agent_id and is_org_descendant(my_org(), p.org_id))
    )
  );
create policy "contracts_update_scope" on contracts
  for update using (
    my_role() = 'hq_admin'
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
