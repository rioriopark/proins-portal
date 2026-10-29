-- FC(위촉설계사)도 장기 지급률표를 볼 수 있도록 조회 권한을 넓힌다 — 운영 DB와 체험판 DB 모두 SQL Editor에서 한 번 실행.
-- 화면에서는 FC에게 조직관리에 등록된 본인 장기 지급률(profiles.rate_long)을 곱한 값만 보여준다.
-- 상품별 수정률 탭(modification_rates, insurer_base_rates, representative_products)도 FC가 조회할 수 있게 연다.
-- 직급 지급비율(payout_grades)은 계속 관리자급만 조회한다. 다시 실행해도 된다.
drop policy if exists "long_commission_rates_select_admin" on long_commission_rates;
drop policy if exists "long_commission_rates_select_member" on long_commission_rates;
create policy "long_commission_rates_select_member" on long_commission_rates
  for select using (my_role() is not null);

drop policy if exists "modification_rates_select_admin" on modification_rates;
drop policy if exists "modification_rates_select_member" on modification_rates;
create policy "modification_rates_select_member" on modification_rates
  for select using (my_role() is not null);

drop policy if exists "insurer_base_rates_select_admin" on insurer_base_rates;
drop policy if exists "insurer_base_rates_select_member" on insurer_base_rates;
create policy "insurer_base_rates_select_member" on insurer_base_rates for select using (my_role() is not null);

drop policy if exists "representative_products_select_admin" on representative_products;
drop policy if exists "representative_products_select_member" on representative_products;
create policy "representative_products_select_member" on representative_products for select using (my_role() is not null);
