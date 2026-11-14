-- 기존 프로젝트: Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.
-- 재실행해도 기존 아이디와 학습자료를 삭제하지 않습니다.
begin;
create table if not exists public.study_usernames (
 username text primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 constraint study_username_length check (char_length(username) between 3 and 32)
);
create unique index if not exists study_username_one_active
 on public.study_usernames(owner_id) where active;
alter table public.study_usernames enable row level security;
revoke all on public.study_usernames from public, anon, authenticated;
grant select on public.study_usernames to authenticated;
drop policy if exists username_owner on public.study_usernames;
create policy username_owner on public.study_usernames for select to authenticated
 using ((select auth.uid())=owner_id);

-- 로그인 이름만 변경합니다. 인증 이메일/사용자 UUID/자료 경로는 변하지 않습니다.
-- 예전 이름은 다른 사람이 가져가지 못하도록 예약해 둡니다.
create or replace function public.resolve_study_username(p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.study_usernames%rowtype;
begin
 select * into r from public.study_usernames where username=lower(normalize(trim(p_username),NFKC));
 if not found then return jsonb_build_object('status','available'); end if;
 if not r.active then return jsonb_build_object('status','retired'); end if;
 return jsonb_build_object('status','active','email',
  (select email from auth.users where id=r.owner_id));
end $$;
create or replace function public.current_study_username()
returns text language sql security definer set search_path = '' as $$
 select username from public.study_usernames where owner_id=auth.uid() and active;
$$;
create or replace function public.register_study_username(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n text := lower(normalize(trim(p_username),NFKC));
 original_email text; current_name text;
begin
 if uid is null then raise exception 'not_authenticated'; end if;
 select email into original_email from auth.users where id=uid for update;
 select username into current_name from public.study_usernames where owner_id=uid and active;
 if current_name is not null then
  if current_name=n then return current_name; end if;
  raise exception 'username_changed';
 end if;
 if n is null or char_length(n) not between 3 and 32 or n !~ '^[[:alnum:]_-]+$' then
  raise exception 'invalid_username';
 end if;
 if original_email <> 'u.' || encode(sha256(convert_to(n,'UTF8')),'hex') || '@accounts.dudada.invalid' then
  raise exception 'username_changed';
 end if;
 if exists(select 1 from public.study_usernames where username=n and owner_id<>uid) then
  raise exception 'username_taken';
 end if;
 insert into public.study_usernames(username,owner_id,active) values(n,uid,true)
 on conflict(username) do update set active=true where study_usernames.owner_id=uid;
 if not found then raise exception 'username_taken'; end if;
 return n;
end $$;
create or replace function public.rename_study_username(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n text := lower(normalize(trim(p_username),NFKC));
begin
 if uid is null then raise exception 'not_authenticated'; end if;
 perform 1 from auth.users where id=uid for update;
 if n is null or char_length(n) not between 3 and 32 or n !~ '^[[:alnum:]_-]+$' then
  raise exception 'invalid_username';
 end if;
 if not exists(select 1 from public.study_usernames where owner_id=uid and active) then
  raise exception 'username_not_registered';
 end if;
 -- 기존 앱에서 만들어졌지만 아직 이름 테이블에 없는 계정도 보호합니다.
 if exists(select 1 from auth.users where id<>uid and email=
   'u.' || encode(sha256(convert_to(n,'UTF8')),'hex') || '@accounts.dudada.invalid')
 or exists(select 1 from public.study_usernames where username=n and owner_id<>uid) then
  raise exception 'username_taken';
 end if;
 update public.study_usernames set active=false where owner_id=uid and active;
 insert into public.study_usernames(username,owner_id,active) values(n,uid,true)
 on conflict(username) do update set active=true where study_usernames.owner_id=uid;
 if not found then raise exception 'username_taken'; end if;
 return n;
end $$;
revoke all on function public.resolve_study_username(text), public.current_study_username(),
 public.register_study_username(text), public.rename_study_username(text) from public, anon, authenticated;
grant execute on function public.resolve_study_username(text) to anon, authenticated;
grant execute on function public.current_study_username(), public.register_study_username(text),
 public.rename_study_username(text) to authenticated;
commit;
