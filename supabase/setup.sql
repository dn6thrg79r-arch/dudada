-- Run once in your own Supabase project's SQL Editor. This never disables RLS.
create table if not exists public.study_notebooks (
 owner_id uuid not null references auth.users(id) on delete cascade,
 id text not null,
 payload jsonb not null,
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key(owner_id,id),
 constraint notebook_id_matches check(payload->>'id'=id),
 constraint notebook_revision_positive check(revision>0)
);
create table if not exists public.study_documents (
 owner_id uuid not null references auth.users(id) on delete cascade,
 id text not null,
 manifest jsonb not null,
 primary key(owner_id,id),
 foreign key(owner_id,id) references public.study_notebooks(owner_id,id) on delete cascade,
 constraint pdf_owner_prefix check(manifest->>'prefix' like owner_id::text || '/%')
);
alter table public.study_notebooks enable row level security;
alter table public.study_documents enable row level security;
revoke all on public.study_notebooks, public.study_documents from anon;
grant select,insert,update,delete on public.study_notebooks, public.study_documents to authenticated;
drop policy if exists notebook_owner on public.study_notebooks;
create policy notebook_owner on public.study_notebooks for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists document_owner on public.study_documents;
create policy document_owner on public.study_documents for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('study-pdfs','study-pdfs',false,10485760,array['application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/octet-stream'];
drop policy if exists pdf_owner on storage.objects;
create policy pdf_owner on storage.objects for all to authenticated
 using (bucket_id='study-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text)
 with check(bucket_id='study-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text);
