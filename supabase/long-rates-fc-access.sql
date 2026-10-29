-- FC(위촉설계사)도 장기 지급률표를 볼 수 있도록 조회 권한을 넓힌다 — 운영 DB와 체험판 DB 모두 SQL Editor에서 한 번 실행.
-- 화면에서는 FC에게 조직관리에 등록된 본인 장기 지급률(profiles.rate_long)을 곱한 값만 보여준다.
-- 대표상품 수정률·직급 지급비율(insurer_base_rates, payout_grades, representative_products)과
-- 상품별 수정률(modification_rates)은 계속 관리자급만 조회한다.
drop policy if exists "long_commission_rates_select_admin" on long_commission_rates;
drop policy if exists "long_commission_rates_select_member" on long_commission_rates;
create policy "long_commission_rates_select_member" on long_commission_rates
  for select using (my_role() is not null);
