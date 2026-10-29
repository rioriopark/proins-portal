-- 체험판(데모) DB 전용: 손보사 대표상품 수정률 참고표 + 직급 지급비율 가상 샘플
-- 운영 DB에는 실행하지 말 것. 모든 수치와 상품명은 화면 체험용으로 지어낸 값이며 실제 수수료 규정과 무관하다.
-- 데모 Supabase SQL Editor에서 한 번 통째로 실행한다. 다시 실행해도 중복되지 않는다.

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

-- 수수료 규정이라 위촉설계사(agent)는 조회 불가, 관리자급만 조회. 등록·수정은 본사 소속만.
alter table insurer_base_rates enable row level security;
alter table payout_grades enable row level security;
alter table representative_products enable row level security;
drop policy if exists "insurer_base_rates_select_admin" on insurer_base_rates;
create policy "insurer_base_rates_select_admin" on insurer_base_rates for select using (my_role() <> 'agent');
drop policy if exists "insurer_base_rates_write_hq" on insurer_base_rates;
create policy "insurer_base_rates_write_hq" on insurer_base_rates
  for all using (my_org() = 'hq') with check (my_org() = 'hq');
drop policy if exists "payout_grades_select_admin" on payout_grades;
create policy "payout_grades_select_admin" on payout_grades for select using (my_role() <> 'agent');
drop policy if exists "payout_grades_write_hq" on payout_grades;
create policy "payout_grades_write_hq" on payout_grades
  for all using (my_org() = 'hq') with check (my_org() = 'hq');
drop policy if exists "representative_products_select_admin" on representative_products;
create policy "representative_products_select_admin" on representative_products for select using (my_role() <> 'agent');
drop policy if exists "representative_products_write_hq" on representative_products;
create policy "representative_products_write_hq" on representative_products
  for all using (my_org() = 'hq') with check (my_org() = 'hq');

insert into insurer_base_rates (insurer, first_rate, renewal_rate, effective_month) values
  ('삼성화재',2.0,1.5,'2026-01'),
  ('현대해상',2.1,1.4,'2026-01'),
  ('DB손보',1.9,1.6,'2026-01'),
  ('KB손보',2.2,1.3,'2026-01')
on conflict (insurer, effective_month) do update set first_rate = excluded.first_rate, renewal_rate = excluded.renewal_rate, updated_at = now();

insert into payout_grades (name, ratio, sort_order) values
  ('본부장',0.9,1),
  ('지점장',0.85,2),
  ('팀장',0.8,3),
  ('설계사',0.7,4)
on conflict (name) do update set ratio = excluded.ratio, sort_order = excluded.sort_order, updated_at = now();

insert into representative_products (insurer, category, basis, product, kind, mod_rate, sort_order, effective_month) values
  ('삼성화재','건강보험','20년납기준','체험용 건강보험 A','보장',2.0,1,'2026-01'),
  ('현대해상','건강보험','20년납기준','체험용 건강보험 B','보장',1.9,2,'2026-01'),
  ('DB손보','건강보험','20년납기준','체험용 건강보험 C','보장',2.1,3,'2026-01'),
  ('KB손보','건강보험','20년납기준','체험용 건강보험 D','보장',1.8,4,'2026-01'),
  ('삼성화재','어린이보험','20년납기준','체험용 어린이보험 A','보장',1.7,5,'2026-01'),
  ('현대해상','어린이보험','20년납기준','체험용 어린이보험 B','보장',1.8,6,'2026-01'),
  ('DB손보','어린이보험','20년납기준','체험용 어린이보험 C','보장',1.6,7,'2026-01'),
  ('KB손보','어린이보험','20년납기준','체험용 어린이보험 D','보장',1.9,8,'2026-01'),
  ('삼성화재','운전자보험','20년납기준','체험용 운전자보험 A','보장',1.2,9,'2026-01'),
  ('현대해상','운전자보험','20년납기준','체험용 운전자보험 B','보장',1.1,10,'2026-01'),
  ('DB손보','운전자보험','20년납기준','체험용 운전자보험 C','보장',1.3,11,'2026-01'),
  ('KB손보','운전자보험','20년납기준','체험용 운전자보험 D','보장',1.0,12,'2026-01')
on conflict (insurer, category, effective_month) do update set basis = excluded.basis, product = excluded.product, kind = excluded.kind,
  mod_rate = excluded.mod_rate, sort_order = excluded.sort_order, updated_at = now();
