-- 架空ユーザー・架空の金銭情報によるサーバー機能の回帰試験。
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare a jsonb; b jsonb; c jsonb;
begin
  a := public.life_partner_sync('test-record','transaction','{"type":"expense","amount":500,"date":"2026-11-24","category":"食費","memo":"架空の記録"}',now(),now(),1,false,0,'mutation-1');
  if a->>'status' <> 'ok' or (a->'record'->>'revision')::int <> 1 then raise exception 'create_failed'; end if;
  b := public.life_partner_sync('test-record','transaction','{"amount":999}',now(),now(),1,false,0,'mutation-1');
  if a <> b then raise exception 'retry_not_idempotent'; end if;
  b := public.life_partner_sync('test-record','transaction','{"amount":700}',now(),now(),2,false,0,'stale-mutation');
  if b->>'status' <> 'conflict' or (b->'record'->>'revision')::int <> 1 then raise exception 'stale_update_not_rejected'; end if;
  c := public.life_partner_sync('test-record','transaction','{"amount":700}',now(),now(),2,false,1,'mutation-2');
  if c->>'status' <> 'ok' or (c->'record'->>'revision')::int <> 2 then raise exception 'update_failed'; end if;
  b := public.life_partner_sync('test-record','transaction','{"amount":999}',now(),now(),1,false,0,'mutation-1');
  if a <> b or (select revision from public.life_partner_records where id='test-record') <> 2 then raise exception 'retry_changed_current_data'; end if;
  b := public.life_partner_sync('test-record','task','{}',now(),now(),3,false,2,'kind-change');
  if b->>'status' <> 'conflict' then raise exception 'kind_change_allowed'; end if;
  b := public.life_partner_sync('missing-record','task','{}',now(),now(),3,false,2,'missing-change');
  if b->>'status' <> 'conflict' or b->'record' <> 'null'::jsonb then raise exception 'missing_record_conflict_failed'; end if;
  begin
    perform public.life_partner_sync('invalid-money','transaction','{"amount":1.5}',now(),now(),1,false,0,'invalid-money-change');
    raise exception 'fractional_yen_accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.life_partner_records set data='{}' where id='test-record';
    raise exception 'direct_update_allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare a jsonb;
begin
  if (select count(*) from public.life_partner_records) <> 0 then raise exception 'other_user_read_allowed'; end if;
  a := public.life_partner_sync('test-record','task','{"title":"架空の別ユーザー"}',now(),now(),1,false,0,'mutation-1');
  if a->'record'->>'owner' <> '00000000-0000-0000-0000-000000000002' then raise exception 'owner_not_bound'; end if;
  if (select count(*) from public.life_partner_records) <> 1 then raise exception 'own_read_failed'; end if;
  perform public.life_partner_delete_data();
  if (select count(*) from public.life_partner_records) <> 0 then raise exception 'own_delete_failed'; end if;
end;
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.life_partner_records) <> 1 then raise exception 'other_user_delete_touched_own_data'; end if;
end; $$;
do $$
declare payload jsonb; result jsonb;
begin
  -- クライアントで許可する300項目×1000文字の日本語もクラウド保存可能。
  select jsonb_build_object('title','架空の長い持ち物リスト','resetTime','06:00','lastReset','2026-11-24',
    'items',jsonb_agg(jsonb_build_object('id',n::text,'title',repeat('あ',1000),'checked',false)))
    into payload from generate_series(1,300) n;
  result := public.life_partner_sync('large-record','checklist',payload,now(),now(),1,false,0,'large-record-mutation');
  if result->>'status' <> 'ok' then raise exception 'valid_large_checklist_rejected'; end if;
  begin
    perform public.life_partner_sync('oversized-record','task',jsonb_build_object('title',repeat('x',2097153)),now(),now(),1,false,0,'oversized-mutation');
    raise exception 'oversized_payload_accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
set request.jwt.claim.sub = '';
do $$ begin
  begin
    perform public.life_partner_sync('test','task','{}',now(),now(),1,false,0,'unauthenticated');
    raise exception 'unauthenticated_rpc_allowed';
  exception when invalid_authorization_specification then null;
  end;
end; $$;
reset role;
set role anon;
do $$ begin
  begin
    perform count(*) from public.life_partner_records;
    raise exception 'anon_read_allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.life_partner_sync('test','task','{}',now(),now(),1,false,0,'anon');
    raise exception 'anon_rpc_allowed';
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;
-- 認証ユーザーの削除で記録・ACKが連動削除されること。
delete from auth.users where id='00000000-0000-0000-0000-000000000001';
do $$ begin
  if exists(select 1 from public.life_partner_records) or exists(select 1 from public.life_partner_mutations) then raise exception 'cascade_cleanup_failed'; end if;
end; $$;
select 'SQL assertions passed' as result;
