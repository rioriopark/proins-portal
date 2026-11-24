-- 조직도 위치(표시 순서) 변경
-- 운영 Supabase 와 데모 Supabase(proins-demo) 각각의 SQL Editor 에서 한 번씩 실행한다.
-- 여러 번 실행해도 안전하다.
--
-- 조직관리 > 조직도에서 ▲▼ 버튼으로 바꾼 순서를 저장한다. 값이 작을수록 위에 나오고,
-- 값이 없으면(null) 조직은 ID 순, 직원은 사번 순으로 지정된 항목 뒤에 나온다.
-- 상위 조직 변경은 기존 parent_id 컬럼을 그대로 쓰므로 추가 컬럼이 필요 없다.

alter table organizations   add column if not exists sort_order int;
alter table profiles        add column if not exists sort_order int;
alter table pending_invites add column if not exists sort_order int;

-- 가입 전 초대장에서 정한 순서를 가입 후 프로필로 넘기려면 handle_new_user 트리거 함수에서
-- sort_order 도 함께 복사해야 하지만, 지금은 넘기지 않는다(가입 직후에는 사번 순 자리로 돌아간다).
