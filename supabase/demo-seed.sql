-- 외부인 체험용 데모 DB 가상 데이터 (docs/DEMO.md 참고)
--
-- !! 운영 DB에서 절대 실행하지 말 것 !!
-- 데모 DB의 계약·명세서·연락처 등을 모두 지우고 가상 데이터로 다시 채운다.
-- 실수로 운영 DB에서 실행해도 데모 계정이 아닌 회원이 하나라도 있으면 아무것도 지우지 않고 멈춘다.
--
-- 사용법 (데모 Supabase 프로젝트의 SQL Editor):
--   0) supabase/schema.sql → supabase/demo-schema-patch.sql 을 차례로 먼저 실행해 둔다.
--   1) 이 파일 전체를 한 번 실행해 reset_demo_data 함수를 만든다.
--   2) select reset_demo_data('게스트비밀번호');   -- 처음 채우기 / 수동 초기화
--   3) (선택) 매일 새벽 자동 초기화 — Database > Extensions 에서 pg_cron 을 켠 뒤:
--      select cron.schedule('reset-demo', '0 19 * * *', $$select reset_demo_data('게스트비밀번호')$$);  -- 한국시간 04시
--
-- 게스트 로그인 아이디는 guest (내부 이메일 guest@proins.local), 가상 직원은 demo01~demo08@proins.local.

create extension if not exists pgcrypto;

-- 수수료명세서: 가상 직원의 이번 달 포함 최근 4개월 명세서를 계약 데이터와 직급별 지급률로 계산해 다시 채운다.
-- 수수료명세서 화면의 "지급률 자동계산"과 같은 방식(건별수수료 × 장기/일반 지급률, 사업소득자는 세금·보험 포함)이다.
create or replace function demo_fill_statements()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if exists (
    select 1 from profiles
    where email <> 'guest@proins.local' and email not like 'demo__@proins.local'
  ) then
    raise exception '데모 계정이 아닌 회원이 있습니다. 운영 DB로 보여 중단합니다.';
  end if;

  delete from statements;
  insert into statements (agent_id, agent_email, month, recruit_first, recruit_installment, maintain, general, auto,
    personal_incentive, taxable_income, income_tax, resident_tax, employment_ins, industrial_accident_ins)
  select id, email, month, rf, 0, mt, gn, au, pi,
    case when biz then ti else 0 end,
    case when biz then it else 0 end,
    case when biz then floor(it * 0.1 / 10) * 10 else 0 end,
    case when not biz or ti - trunc(ti * 0.25) < 850000 then 0
      else floor(greatest(ti - trunc(ti * 0.25), 1330000) * 0.018 / 2 / 10) * 10 end,
    case when biz then floor(2401300 * 0.007 / 2 / 10) * 10 else 0 end
  from (
    select *, rf + mt + gn + au + pi as ti,
      case when rf + mt + gn + au + pi <= 33330 then 0 else floor((rf + mt + gn + au + pi) * 0.03 / 10) * 10 end as it
    from (
      select p.id, p.email, mo.month, p.org_id <> 'hq' as biz,
        round(coalesce(sum(c.commission) filter (where c.category = '장기' and c.type = '신규'), 0) * p.rate_long) as rf,
        round(coalesce(sum(c.commission) filter (where c.category = '장기' and c.type <> '신규'), 0) * p.rate_long) as mt,
        round(coalesce(sum(c.commission) filter (where c.category = '일반'), 0) * p.rate_general) as gn,
        round(coalesce(sum(c.commission) filter (where c.category = '자동차'), 0) * p.rate_general) as au,
        (case when right(split_part(p.email, '@', 1), 1)::int % 2 = 0 then 200000 else 0 end)::numeric as pi
      from profiles p
      cross join (
        select to_char(date_trunc('month', current_date) - make_interval(months => n), 'YYYY-MM') as month,
          to_char(date_trunc('month', current_date) - make_interval(months => n + 1), 'YYYY-MM') as prev_month
        from generate_series(0, 3) n
      ) mo
      -- 화면과 같게 장기는 전월 실적(계약월) 기준, 일반·자동차는 해당 정산월 기준으로 모은다
      left join contracts c on c.agent_id = p.id and not c.is_preliminary
        and c.month = case when c.category = '장기' then mo.prev_month else mo.month end
      where p.email like 'demo__@proins.local'
      group by p.id, p.email, p.org_id, p.rate_long, p.rate_general, mo.month
    ) a
  ) b;
end;
$fn$;

create or replace function reset_demo_data(p_guest_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_guest_email constant text := 'guest@proins.local';
  v_guest_id uuid;
  v_names text[] := array['김민준','이서연','박지호','최수아','정도윤','강하은','조예준','윤지우'];
  v_titles text[] := array['팀장','설계사','설계사','설계사','지점장','설계사','설계사','설계사'];
  v_orgs text[] := array['hq','hq','hq','br-direct','br-seoul','br-seoul','st-direct-1','br-incubating'];
  v_roles text[] := array['agent','agent','agent','agent','branch_admin','agent','store_manager','agent'];
  v_companies text[] := array['삼성화재','DB손해보험','현대해상','KB손해보험','메리츠화재','한화손해보험','롯데손해보험','흥국화재'];
  v_long_products text[] := array['무배당 건강보험','무배당 종합보험','어린이보험','암보험','간병인보험','운전자보험'];
  v_customers text[] := array['김OO','이OO','박OO','최OO','정OO','강OO','조OO','윤OO','장OO','임OO','한OO','오OO'];
  v_agent_ids uuid[] := '{}';
  v_id uuid;
  v_month text;
  v_i int;
  v_m int;
  v_n int;
  v_premium numeric;
  v_category text;
  v_receipt date;
  v_j int;
  v_k int;
  v_line_premium numeric;
begin
  if p_guest_password is null or length(p_guest_password) < 6 then
    raise exception '게스트 비밀번호는 6자 이상이어야 합니다.';
  end if;

  -- ── 안전장치: 데모 계정이 아닌 회원이 있으면 운영 DB로 보고 중단 ──
  if exists (
    select 1 from profiles
    where email <> v_guest_email and email not like 'demo__@proins.local'
  ) then
    raise exception '데모 계정이 아닌 회원이 있습니다. 운영 DB로 보여 초기화를 중단합니다.';
  end if;

  -- ── 기존 데모 데이터 비우기 ──
  delete from contracts;
  delete from statements;
  delete from contacts;
  delete from incentives;
  delete from education_events;
  delete from banners;
  delete from pending_invites;
  delete from insurer_accounts;
  delete from site_accounts;
  delete from auth.users where email like 'demo__@proins.local';  -- profiles 등은 cascade로 함께 삭제

  insert into organizations (id, name, type, parent_id) values
    ('hq', '프로인스컴퍼니 본사', 'HQ', null),
    ('br-direct', '본사직영', 'CENTER', 'hq'),
    ('st-direct-1', '본사직영 1지점', 'STORE', 'br-direct'),
    ('br-seoul', '서울비즈니스센터', 'CENTER', 'hq'),
    ('br-incubating', '인큐베이팅지점', 'CENTER', 'hq')
  on conflict (id) do update set name = excluded.name, type = excluded.type, parent_id = excluded.parent_id;

  -- ── 게스트 계정 (본사관리자 권한, 비밀번호는 매번 다시 설정) ──
  select id into v_guest_id from auth.users where email = v_guest_email;
  if v_guest_id is null then
    v_guest_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_guest_id, 'authenticated', 'authenticated', v_guest_email,
      crypt(p_guest_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_guest_id, v_guest_id::text,
      jsonb_build_object('sub', v_guest_id::text, 'email', v_guest_email, 'email_verified', true),
      'email', now(), now(), now());
  else
    update auth.users set encrypted_password = crypt(p_guest_password, gen_salt('bf')), updated_at = now()
    where id = v_guest_id;
  end if;

  insert into profiles (id, email, name, role, org_id, title, rate_long, rate_general, bank, account)
  values (v_guest_id, v_guest_email, '체험 게스트', 'hq_admin', 'hq', '본사관리자(체험)', 1.0, 1.0, '', '')
  on conflict (id) do update set name = excluded.name, role = excluded.role, org_id = excluded.org_id, title = excluded.title;
  delete from menu_permissions where profile_id = v_guest_id;

  -- ── 가상 직원 8명 (로그인 불가: 비밀번호 없음) ──
  for v_i in 1..8 loop
    v_id := gen_random_uuid();
    v_agent_ids := v_agent_ids || v_id;
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      format('demo%s@proins.local', lpad(v_i::text, 2, '0')), '{}', '{}', now(), now(), '', '', '', '');
    insert into profiles (id, email, name, role, org_id, title, rate_long, rate_general, bank, account)
    values (v_id, format('demo%s@proins.local', lpad(v_i::text, 2, '0')), v_names[v_i], v_roles[v_i], v_orgs[v_i],
      -- 직급별 지급률(장기/일반): 설계사 70%/60%, 팀장 80%/65%, 지점장 90%/70%
      v_titles[v_i],
      case v_titles[v_i] when '지점장' then 0.9 when '팀장' then 0.8 else 0.7 end,
      case v_titles[v_i] when '지점장' then 0.7 when '팀장' then 0.65 else 0.6 end,
      '체험은행', '000-0000-' || lpad(v_i::text, 4, '0'));
    insert into agent_profiles (profile_id, phone, address, email, registration_no)
    values (v_id, '010-0000-' || lpad(v_i::text, 4, '0'), '서울시 가상구 체험로 ' || v_i, format('demo%s@example.com', v_i),
      'DEMO-' || lpad(v_i::text, 6, '0'));
  end loop;

  -- ── 계약: 최근 14개월, 담당자별로 매달 몇 건씩 ──
  for v_m in 0..13 loop
    v_month := to_char(date_trunc('month', current_date) - make_interval(months => v_m), 'YYYY-MM');
    for v_i in 1..8 loop
      for v_n in 1..(2 + ((v_i + v_m) % 4)) loop
        v_category := (array['장기','장기','장기','일반','자동차'])[1 + ((v_i * 7 + v_n * 3 + v_m) % 5)];
        v_premium := case v_category
          when '장기' then 30000 + ((v_i * 13 + v_n * 17 + v_m * 7) % 20) * 5000
          -- 일반·자동차는 체험판에서 규모가 잘 보이도록 실제 단가의 10배 수준으로 넣는다
          when '일반' then 1500000 + ((v_i + v_n + v_m) % 10) * 300000
          else 6000000 + ((v_i * 3 + v_n + v_m) % 12) * 500000 end;
        v_receipt := (v_month || '-01')::date + ((v_i * 5 + v_n * 3) % 27);
        -- 일반·자동차는 건당 평균 70만원 정도가 되도록 같은 금액을 여러 건으로 나눈다
        v_k := case when v_category = '장기' then 1 else greatest(1, round(v_premium / 700000))::int end;
        for v_j in 1..v_k loop
          v_line_premium := case when v_k = 1 then v_premium
            else round(v_premium / v_k * (0.85 + ((v_j * 3 + v_i) % 7) * 0.05), -3) end;
          insert into contracts (agent_id, agent_email, month, category, type, company, policy_no, product_name,
            customer_name, insured_name, receipt_date, expiry_date, collection_status, count, premium, commission,
            performance_commission, is_preliminary, duration_type)
          values (
            v_agent_ids[v_i], format('demo%s@proins.local', lpad(v_i::text, 2, '0')), v_month, v_category,
            case when v_m > 0 and v_n = 1 and v_category = '장기' then '계속' else '신규' end,
            v_companies[1 + ((v_i + v_n * 2 + v_m) % 8)],
            format('DEMO-%s-%s-%s', replace(v_month, '-', ''), v_i, v_n) || case when v_k > 1 then '-' || v_j else '' end,
            case v_category when '장기' then v_long_products[1 + ((v_i + v_n + v_m) % 6)]
              when '일반' then '화재보험' else '개인용 자동차보험' end,
            v_customers[1 + ((v_i * 5 + v_n + v_m + v_j - 1) % 12)],
            v_customers[1 + ((v_i * 5 + v_n + v_m + v_j) % 12)],
            v_receipt,
            case when v_category = '장기' then null else v_receipt + interval '1 year' end,
            case when v_category = '장기' then
              (array['정상','정상','정상','정상','정상','정상','유예','실효','해지'])[1 + ((v_i * 11 + v_n * 7 + v_m) % 9)]
            end,
            1, v_line_premium, round(v_line_premium * case v_category when '장기' then 3.2 else 0.12 end),
            round(v_line_premium * case v_category when '장기' then 0.4 else 0 end),
            false,
            case v_category when '장기' then (array['5년','10년','20년','세만기'])[1 + ((v_i + v_n) % 4)] else '년간' end
          );
        end loop;
      end loop;
    end loop;
  end loop;

  -- 이번 달 예비계약(보험사 확정 전 설계사가 직접 등록한 건) 몇 건
  for v_i in 1..4 loop
    insert into contracts (agent_id, agent_email, month, category, type, company, policy_no, product_name,
      customer_name, count, premium, commission, is_preliminary)
    values (v_agent_ids[v_i], format('demo%s@proins.local', lpad(v_i::text, 2, '0')), to_char(current_date, 'YYYY-MM'),
      '장기', '신규', v_companies[v_i], format('PRE-DEMO-%s', v_i), v_long_products[v_i], v_customers[v_i + 4],
      1, 50000 + v_i * 10000, 0, true);
  end loop;

  -- ── 수수료명세서: 이번 달 포함 최근 4개월 (계약 × 직급별 지급률) ──
  perform demo_fill_statements();

  -- ── 업무 연락처 (임직원은 agent_profiles 트리거가 자동으로 채움) ──
  insert into contacts (category, company, name, title, phone, office_phone, email, business, sort_order) values
    ('보험사담당자', '삼성화재', '홍길동', '대리', '010-1111-0001', '02-0000-0001', 'samsung@example.com', '장기 언더라이팅', 101),
    ('보험사담당자', 'DB손해보험', '김철수', '과장', '010-1111-0002', '02-0000-0002', 'db@example.com', '자동차 인수', 102),
    ('보험사담당자', '현대해상', '이영희', '차장', '010-1111-0003', '02-0000-0003', 'hyundai@example.com', '시책 문의', 103),
    ('보험사담당자', 'KB손해보험', '박민수', '대리', '010-1111-0004', '02-0000-0004', 'kb@example.com', '장기 지급', 104),
    ('업무지원', '프로인스컴퍼니', '정지원', '매니저', '010-2222-0001', '02-0000-1001', 'support@example.com', '전산·계약 등록', 201),
    ('업무지원', '프로인스컴퍼니', '한수빈', '매니저', '010-2222-0002', '02-0000-1002', 'edu@example.com', '교육·위촉', 202);

  -- ── 시상안 / 교육일정 / 공지 ──
  insert into incentives (company, month, title, period, target, content, created_by) values
    ('삼성화재', to_char(current_date, 'YYYY-MM'), '삼성화재 이달의 건강보험 특별시상', to_char(current_date, 'YYYY.MM') || '.01 ~ 말일',
      '장기 인보험', E'월납 10만원 이상: 보험료의 100%\n월납 20만원 이상: 보험료의 150%', v_guest_id),
    ('DB손해보험', to_char(current_date, 'YYYY-MM'), 'DB손해보험 조기가동 시상', to_char(current_date, 'YYYY.MM') || '.01 ~ 10',
      '인보험(펫, 단체 제외)', E'10일 이내 3건 이상: 30만원\n5건 이상: 60만원', v_guest_id),
    ('현대해상', to_char(current_date - interval '1 month', 'YYYY-MM'), '현대해상 어린이보험 시상', '전월 1일 ~ 말일',
      '어린이보험', '건당 2만원 추가 지급', v_guest_id);

  insert into education_events (title, event_date, event_time) values
    ('신입 설계사 기본교육', current_date + 3, '10:00'),
    ('장기보험 상품 설명회', current_date + 7, '14:00'),
    ('자동차보험 갱신 실무', current_date + 14, '15:00'),
    ('완전판매 모니터링 교육', current_date - 5, '10:00');

  insert into banners (title, content, start_date, end_date) values
    ('체험판 안내', '이 포털은 체험용입니다. 모든 고객·계약 정보는 가상 데이터입니다.', current_date - 1, current_date + 365),
    ('이달 마감 일정', '이번 달 계약 마감은 말일 18시입니다.', current_date - 1, current_date + 30);

  insert into site_accounts (site_name, login_id, password, sort_order, updated_by) values
    ('보험협회 교육시스템', 'demo-id', 'demo-password', 1, v_guest_id);

  -- ── 보험사 / 대표코드 / 개인코드 / 공용 사이트 계정 / 게시판 (demo-schema-patch.sql 테이블) ──
  delete from agent_insurer_codes;
  delete from shared_site_accounts;
  delete from board_posts;
  delete from insurers;
  insert into insurers (name, sort_order, business_guarantee_expiry, advance_guarantee_expiry)
  select v_companies[i], i, current_date + 30 * i, current_date + 45 * i
  from generate_series(1, array_length(v_companies, 1)) i;

  insert into insurer_accounts (insurer_id, company, login_id, password, memo, updated_by)
  select id, name, 'demo-code-' || lpad(sort_order::text, 3, '0'), 'demo-password', '체험용 가상 계정', v_guest_id
  from insurers where sort_order <= 4;

  insert into agent_insurer_codes (profile_id, insurer_id, code, code_auth)
  select a.id, i.id, 'D' || lpad((a.n * 100 + i.sort_order)::text, 6, '0'), 'demo'
  from unnest(v_agent_ids) with ordinality a(id, n)
  cross join insurers i where i.sort_order <= 3;

  insert into shared_site_accounts (site, login_id, password, updated_by)
  values ('보험사 공용 포털(가상)', 'demo-id', 'demo-password', v_guest_id);

  insert into board_posts (title, content, author_id, author_name) values
    ('체험판 게시판입니다', '자유롭게 글을 써 보세요. 매일 초기화됩니다.', v_guest_id, '체험 게스트'),
    ('이번 달 우수 설계사 축하드립니다', '김민준 팀장님 축하드립니다!', v_agent_ids[1], v_names[1]);

  -- 일반성과 시상 대상자 예시 (수수료명세서의 일반성과 계산에 쓰임)
  update profiles set general_performance_rate = 0.3 where id = any(v_agent_ids[1:2]);

  return format('데모 데이터 초기화 완료: 계약 %s건, 직원 %s명', (select count(*) from contracts), array_length(v_agent_ids, 1));
end;
$fn$;

-- 브라우저(anon/로그인 사용자)에서 RPC로 호출하지 못하게 막는다
revoke all on function reset_demo_data(text) from public;
revoke all on function reset_demo_data(text) from anon, authenticated;
revoke all on function demo_fill_statements() from public;
revoke all on function demo_fill_statements() from anon, authenticated;
