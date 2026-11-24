-- Life Partner / seikatusienn — Supabase SQL Editorで実行してください。
-- 続けて rls.sql を実行。既存テーブルを削除しない、再実行可能な初期スキーマです。
begin;

create table if not exists public.life_partner_records (
  owner uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  kind text not null check (kind in ('task','checklist','checkHistory','transaction','fixedCost','settings','reminder')),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 2097152),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version bigint not null check (version > 0 and version <= 9007199254740991),
  deleted boolean not null default false,
  revision bigint not null check (revision > 0 and revision <= 9007199254740991),
  primary key (owner, id)
);
create index if not exists life_partner_records_owner_updated on public.life_partner_records(owner, updated_at);

-- ACKを永続化し、保存応答が失われた場合でも同じ変更を二重適用しません。
create table if not exists public.life_partner_mutations (
  owner uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null check (length(mutation_id) between 1 and 200),
  record_id text not null,
  response jsonb not null,
  acknowledged_at timestamptz not null default now(),
  primary key (owner, mutation_id)
);

create or replace function public.life_partner_sync(
  p_id text, p_kind text, p_data jsonb, p_created_at timestamptz,
  p_updated_at timestamptz, p_version bigint, p_deleted boolean,
  p_expected_revision bigint, p_mutation_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_row public.life_partner_records%rowtype;
  prior_response jsonb;
  result jsonb;
begin
  if caller is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_id is null or length(p_id) not between 1 and 200
    or p_mutation_id is null or length(p_mutation_id) not between 1 and 200
    or p_kind is null or p_kind not in ('task','checklist','checkHistory','transaction','fixedCost','settings','reminder')
    or p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 2097152
    or p_created_at is null or p_updated_at is null or p_version is null or p_version < 1 or p_version > 9007199254740991
    or p_deleted is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_record' using errcode = '22023';
  end if;
  -- 円は0以上の整数。将来の拡張でも小数や負数を持ち込ませません。
  if p_kind in ('transaction','fixedCost') and (
    jsonb_typeof(p_data->'amount') is distinct from 'number'
    or (p_data->>'amount')::numeric < 0
    or (p_data->>'amount')::numeric > 999999999999
    or trunc((p_data->>'amount')::numeric) <> (p_data->>'amount')::numeric
  ) then raise exception 'invalid_yen_amount' using errcode = '22023'; end if;

  -- 同じmutationの再送・存在しないレコードへの同時作成もトランザクションで直列化。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lp:mutation:' || caller::text || ':' || p_mutation_id, 0));
  select m.response into prior_response from public.life_partner_mutations m
    where m.owner = caller and m.mutation_id = p_mutation_id;
  if found then return prior_response; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lp:record:' || caller::text || ':' || p_id, 0));
  select * into current_row from public.life_partner_records r where r.owner = caller and r.id = p_id for update;

  if (found and (current_row.revision <> p_expected_revision or current_row.kind <> p_kind))
    or (not found and p_expected_revision <> 0) then
    return jsonb_build_object('status','conflict','record',case when current_row.id is null then null else to_jsonb(current_row) end);
  end if;
  if current_row.id is null then
    insert into public.life_partner_records(owner,id,kind,data,created_at,updated_at,version,deleted,revision)
      values(caller,p_id,p_kind,p_data,p_created_at,p_updated_at,p_version,p_deleted,1)
      returning * into current_row;
  else
    update public.life_partner_records set data=p_data,updated_at=p_updated_at,version=p_version,
      deleted=p_deleted,revision=revision+1
      where owner=caller and id=p_id returning * into current_row;
  end if;
  result := jsonb_build_object('status','ok','record',to_jsonb(current_row));
  insert into public.life_partner_mutations(owner,mutation_id,record_id,response)
    values(caller,p_mutation_id,p_id,result);
  return result;
end;
$$;

-- 呼出ユーザー本人のみ。認証アカウントの削除とは別操作です。
create or replace function public.life_partner_delete_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  delete from public.life_partner_mutations where owner=caller;
  delete from public.life_partner_records where owner=caller;
end;
$$;

-- schema.sql単独適用でもテーブルを公開しません。権限はrls.sqlで限定します。
alter table public.life_partner_records enable row level security;
alter table public.life_partner_mutations enable row level security;
revoke all on public.life_partner_records, public.life_partner_mutations from anon, authenticated;
revoke all on function public.life_partner_sync(text,text,jsonb,timestamptz,timestamptz,bigint,boolean,bigint,text) from public, anon;
revoke all on function public.life_partner_delete_data() from public, anon;
commit;
