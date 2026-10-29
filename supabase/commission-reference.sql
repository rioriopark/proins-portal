-- 손보사 대표상품 수정률·지급률 참고표 — 테이블 정의만 둔다.
-- 실제 값(보험사별 기준 지급률, 직급 지급비율, 대표상품 수정률)은 대외비라 저장소에 넣지 않고 별도 SQL로 적재한다.
-- 장기 지급률표 > 상품별 수정률 탭에서 쓴다.
-- 예상 수수료 = 월납 영수P × 수정률(mod_rate) × 보험사 기준 지급률(초회/계속) × 직급 지급비율

-- 보험사별 기준 지급률 (수정P 대비 배수, 예: 2.0 = 200%)
create table if not exists insurer_base_rates (
  insurer text not null,               -- contracts.company 와 같은 표기
  first_rate numeric not null,         -- 초회
  renewal_rate numeric not null,       -- 계속분
  effective_month text not null,       -- 'YYYY-MM'
  updated_at timestamptz default now(),
  primary key (insurer, effective_month)
);

-- 직급별 지급비율 (0~1, 예: 0.5 = 50%)
create table if not exists payout_grades (
  name text primary key,
  ratio numeric not null,
  sort_order int not null default 0,
  updated_at timestamptz default now()
);

-- 보험사·종목별 대표상품과 평균 수정률 (배수, 예: 2.0 = 200%)
create table if not exists representative_products (
  insurer text not null,
  category text not null,              -- 건강보험, 어린이보험, 운전자보험, 연금보험, 간병보험, 암보험, 재물보험, 저축보험
  basis text not null default '',      -- 기준 납기 (예: 20년납기준)
  product text not null,
  kind text not null default '',       -- 보장 / 연금 / 저축
  mod_rate numeric not null,
  sort_order int not null default 0,
  effective_month text not null,
  updated_at timestamptz default now(),
  primary key (insurer, category, effective_month)
);

-- 보험사 기준 지급률·대표상품은 로그인 회원 모두 조회(FC는 화면에서 본인 장기 지급률을 곱해 본다).
-- 직급 지급비율(payout_grades)은 관리자급만 조회. 등록·수정은 본사 소속만.
alter table insurer_base_rates enable row level security;
alter table payout_grades enable row level security;
alter table representative_products enable row level security;
drop policy if exists "insurer_base_rates_select_admin" on insurer_base_rates;
drop policy if exists "insurer_base_rates_select_member" on insurer_base_rates;
create policy "insurer_base_rates_select_member" on insurer_base_rates for select using (my_role() is not null);
drop policy if exists "insurer_base_rates_write_hq" on insurer_base_rates;
create policy "insurer_base_rates_write_hq" on insurer_base_rates
  for all using (my_org() = 'hq') with check (my_org() = 'hq');
drop policy if exists "payout_grades_select_admin" on payout_grades;
create policy "payout_grades_select_admin" on payout_grades for select using (my_role() <> 'agent');
drop policy if exists "payout_grades_write_hq" on payout_grades;
create policy "payout_grades_write_hq" on payout_grades
  for all using (my_org() = 'hq') with check (my_org() = 'hq');
drop policy if exists "representative_products_select_admin" on representative_products;
drop policy if exists "representative_products_select_member" on representative_products;
create policy "representative_products_select_member" on representative_products for select using (my_role() is not null);
drop policy if exists "representative_products_write_hq" on representative_products;
create policy "representative_products_write_hq" on representative_products
  for all using (my_org() = 'hq') with check (my_org() = 'hq');
