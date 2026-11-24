-- schema.sqlの後に適用。直接INSERT/UPDATE/DELETEは許可せずCAS RPCを通します。
begin;
alter table public.life_partner_records enable row level security;
alter table public.life_partner_mutations enable row level security;
drop policy if exists life_partner_read_own on public.life_partner_records;
create policy life_partner_read_own on public.life_partner_records for select to authenticated
  using ((select auth.uid()) = owner);
-- mutation ACKはRPC専用。読み取りポリシーも付与しません。
revoke all on public.life_partner_records, public.life_partner_mutations from anon, authenticated;
grant select on public.life_partner_records to authenticated;
revoke all on function public.life_partner_sync(text,text,jsonb,timestamptz,timestamptz,bigint,boolean,bigint,text) from public, anon;
grant execute on function public.life_partner_sync(text,text,jsonb,timestamptz,timestamptz,bigint,boolean,bigint,text) to authenticated;
revoke all on function public.life_partner_delete_data() from public, anon;
grant execute on function public.life_partner_delete_data() to authenticated;
commit;
