# 외부인 체험용 데모 배포

외부인에게 포털을 보여줄 때는 **운영 DB에 게스트 계정을 만들지 않는다.**
운영 DB에서는 가장 낮은 권한(위촉직 설계사)으로도 업무 연락처(직원·보험사 담당자 연락처), 조직,
시상안, 교육일정이 보이고, 본사 소속 계정이면 전체 계약과 보험사 계정 비밀번호까지 보인다.

대신 운영과 완전히 분리된 데모 환경을 하나 더 둔다.

| | 운영 | 데모 |
|---|---|---|
| Supabase | 기존 프로젝트 | 새 프로젝트 (가상 데이터만) |
| Vercel | 기존 프로젝트 | 같은 레포를 연결한 새 프로젝트 |
| 게스트 계정 | 없음 | 본사관리자 권한 1개 (모든 메뉴 체험) |

## 1. 데모용 Supabase 프로젝트

1. Supabase에서 새 프로젝트를 만든다 (무료 플랜으로 충분).
2. 데모 프로젝트 SQL Editor에서 `supabase/schema.sql` → `supabase/demo-schema-patch.sql` 순서로 실행한다.
   patch 파일은 schema.sql 이후 운영 DB에만 추가된 게시판·보험사·개인코드 테이블과 컬럼을 앱 코드 기준으로
   다시 만든 것이라, 운영 DB에 접속하지 않고도 체험판 구조를 만들 수 있다. (운영 DB에는 실행하지 말 것)
3. `supabase/demo-seed.sql` 전체를 데모 프로젝트 SQL Editor에서 한 번 실행한 뒤, 아래 한 줄로 가상 데이터를 채운다.
   `select reset_demo_data('게스트비밀번호');`
   - 게스트 계정(아이디 `guest`, 본사관리자 권한)과 가상 직원 8명, 최근 14개월 계약 약 400건,
     수수료명세서, 연락처, 시상안, 교육일정, 공지, 게시판 글이 만들어진다.
   - 데모 계정이 아닌 회원이 하나라도 있으면(=운영 DB) 아무것도 지우지 않고 멈춘다.
   - 매일 자동 초기화: Database > Extensions 에서 `pg_cron`을 켠 뒤
     `select cron.schedule('reset-demo', '0 19 * * *', $$select reset_demo_data('게스트비밀번호')$$);` (한국시간 04시)

## 2. 데모용 Vercel 프로젝트

같은 GitHub 레포를 새 Vercel 프로젝트로 한 번 더 import 하고 환경변수를 넣는다.

| 변수 | 값 |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 데모 Supabase 값 |
| `SUPABASE_SERVICE_ROLE_KEY` | 데모 Supabase 값 |
| `VITE_DEMO_MODE` / `DEMO_MODE` | `true` |
| `VITE_DEMO_GUEST_ID` / `VITE_DEMO_GUEST_PASSWORD` | `guest` / 3번에서 정한 게스트 비밀번호 |

**운영 Vercel 프로젝트에는 `DEMO_MODE` 계열 변수를 절대 넣지 않는다.**

## 데모 모드에서 달라지는 점

- 로그인 화면에 "게스트로 체험하기" 버튼이 생긴다 (아이디·비밀번호 입력 없이 바로 입장).
- 모든 화면 상단에 "체험용 데모 · 가상 데이터" 안내가 뜬다.
- 계정 생성·삭제·비밀번호 초기화 API, 시상안 AI 자동 입력 API가 서버에서 막힌다.
- 나의공간의 비밀번호 변경이 막힌다 (여러 방문자가 같은 게스트 계정을 쓰므로).

방문자가 데이터를 고치거나 지울 수 있으므로 `reset_demo_data`로 주기적으로 초기화한다 (위 pg_cron 설정).
