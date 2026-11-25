-- 비례공동 수수료 분배 (증권번호 단위)
-- 예비계약(co_insurers)에만 분배를 저장하면, 보험사 파일이 올라와 예비계약이 자동확정(삭제)될 때 분배가
-- 같이 사라지고, 매월 새 지급월 행이 들어올 때도 반영되지 않는다. 분배를 "보험사 + 증권번호" 단위로
-- 따로 저장해 두고, 수수료명세서 자동계산·업적현황·대시보드가 같은 증권번호의 모든 행(신규·분급·환수 등)에
-- 비율대로 나눠 반영한다.
-- Supabase SQL Editor에서 통째로 한 번 실행하면 된다(여러 번 실행해도 안전).

create table if not exists contract_shares (
  id uuid primary key default gen_random_uuid(),
  company text not null,             -- 보험사(매칭은 앞 2글자로 한다 — 예: 삼성 / 삼성화재)
  policy_no text not null,           -- 증권번호(앞뒤 공백 제거한 값)
  shares jsonb not null,             -- [{ agent_id, name, ratio }], ratio 합계 100
  agent_ids uuid[] not null default '{}', -- shares의 agent_id 목록(조회 권한 판단용, 트리거가 채움)
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint contract_shares_policy unique (company, policy_no)
);

create or replace function contract_shares_fill_agent_ids() returns trigger
  language plpgsql as $$
begin
  new.policy_no := trim(new.policy_no);
  new.agent_ids := coalesce(
    (select array_agg((s ->> 'agent_id')::uuid) from jsonb_array_elements(new.shares) s where s ? 'agent_id'),
    '{}'
  );
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists contract_shares_fill_agent_ids on contract_shares;
create trigger contract_shares_fill_agent_ids
  before insert or update on contract_shares
  for each row execute function contract_shares_fill_agent_ids();

create index if not exists contract_shares_policy_no_idx on contract_shares (policy_no);
create index if not exists contract_shares_agent_ids_idx on contract_shares using gin (agent_ids);

alter table contract_shares enable row level security;
drop policy if exists "contract_shares_select_all" on contract_shares;
create policy "contract_shares_select_all" on contract_shares
  for select to authenticated using (true);
-- 분배 설정은 비례공동 등록과 같은 범위(본사관리자, 계약관리 권한자, 지사장/본부장/지점장)만 할 수 있다.
drop policy if exists "contract_shares_write_admin" on contract_shares;
create policy "contract_shares_write_admin" on contract_shares
  for all using (
    my_role() in ('hq_admin', 'branch_admin', 'store_manager') or has_menu_permission('contracts')
  ) with check (
    my_role() in ('hq_admin', 'branch_admin', 'store_manager') or has_menu_permission('contracts')
  );

-- 분배를 받는 담당자는 원 모집자 명의 계약이라도 자기 몫이 있는 계약을 조회할 수 있어야
-- 본인 수수료명세서·대시보드에 자기 몫이 잡힌다. 기존 조회 정책에 조건 하나를 더한다.
drop policy if exists "contracts_select_scope" on contracts;
create policy "contracts_select_scope" on contracts
  for select using (
    agent_id = auth.uid()
    or my_org() = 'hq'
    or (
      agent_id is not null
      and my_role() in ('branch_admin','store_manager')
      and exists (select 1 from profiles p where p.id = contracts.agent_id and is_org_descendant(my_org(), p.org_id))
    )
    or exists (
      select 1 from contract_shares s
      where s.policy_no = trim(contracts.policy_no)
        and left(s.company, 2) = left(contracts.company, 2)
        and auth.uid() = any (s.agent_ids)
    )
  );

-- 이미 예비계약(비례공동)으로 등록해 둔 분배를 옮겨 둔다(자동확정으로 지워지기 전의 건만 남아 있다).
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'co_insurers') then
    insert into contract_shares (company, policy_no, shares)
    select distinct on (c.company, trim(c.policy_no)) c.company, trim(c.policy_no), c.co_insurers
    from contracts c
    where c.type = '비례공동'
      and c.co_insurers is not null
      and jsonb_array_length(c.co_insurers) > 0
      and coalesce(trim(c.policy_no), '') <> ''
    order by c.company, trim(c.policy_no), c.created_at desc
    on conflict (company, policy_no) do nothing;
  end if;
end;
$$;
