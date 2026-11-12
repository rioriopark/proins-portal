-- 게시판 첨부파일
-- 운영 Supabase 와 데모 Supabase(proins-demo) 각각의 SQL Editor 에서 한 번씩 실행한다.
-- 여러 번 실행해도 안전하다(이미 있으면 건너뛰거나 정책을 다시 만든다).

-- 1) 게시글에 첨부파일 목록 컬럼 추가: [{ "path": "...", "name": "원본파일명.pdf", "size": 12345 }, ...]
alter table board_posts add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 2) 첨부파일 저장 버킷 — 내부 업무자료라 비공개, 로그인 사용자만 서명 URL 로 열람. 파일당 최대 50MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('board-files', 'board-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- 3) 저장 경로는 "<올린 사람 profile id>/<임의 파일명>" 이다.
drop policy if exists "board_files_select" on storage.objects;
create policy "board_files_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'board-files');

drop policy if exists "board_files_insert_self" on storage.objects;
create policy "board_files_insert_self" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'board-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- 본인이 올린 파일, 또는 본사 소속이면 삭제 가능 (게시글 수정/삭제 권한과 같은 기준)
drop policy if exists "board_files_delete_owner_or_hq" on storage.objects;
create policy "board_files_delete_owner_or_hq" on storage.objects
  for delete to authenticated
  using (bucket_id = 'board-files' and ((storage.foldername(name))[1] = auth.uid()::text or my_org() = 'hq'));

-- 4) 게시글 작성은 로그인한 직원 누구나 본인 이름으로 가능하게 한다.
--    (수정/삭제는 기존처럼 작성자 본인 또는 본사 소속만)
drop policy if exists "board_posts_insert_self" on board_posts;
create policy "board_posts_insert_self" on board_posts
  for insert to authenticated
  with check (author_id = auth.uid());
