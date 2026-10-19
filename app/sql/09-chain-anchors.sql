-- 明鉴 · 链上存证云端表（2026-10-20）
-- 在应用数据库执行；与 docs/17-链上存证.md 配套。
-- 注意：secret 不要写进仓库，执行时替换 <RANDOM_SECRET> 并用 openssl rand -hex 24 生成。

-- 1) 批次表
create table if not exists public.jp_chain_anchors (
  id           bigint primary key,
  tx_hash      text not null,
  block_number bigint,
  root         text not null,
  item_count   int  not null,
  from_ts      bigint not null,
  to_ts        bigint not null,
  chain_id     int  not null,
  registry     text not null,
  explorer     text,
  items        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
alter table public.jp_chain_anchors enable row level security;
drop policy if exists chain_anchor_read on public.jp_chain_anchors;
create policy chain_anchor_read on public.jp_chain_anchors
  for select to anon, authenticated using (true);
grant select on public.jp_chain_anchors to anon, authenticated;

-- 2) 逐题索引表（角标/验证页按 qid 查）
create table if not exists public.jp_chain_anchor_items (
  qid         text primary key,
  anchor_id   bigint not null references public.jp_chain_anchors(id) on delete cascade,
  tx_hash     text not null,
  result      text not null,
  settled_at  bigint not null,
  leaf        text not null,
  proof       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.jp_chain_anchor_items enable row level security;
drop policy if exists chain_anchor_items_read on public.jp_chain_anchor_items;
create policy chain_anchor_items_read on public.jp_chain_anchor_items
  for select to anon, authenticated using (true);
grant select on public.jp_chain_anchor_items to anon, authenticated;

-- 3) 推送密钥（不暴露给任何客户端）
create table if not exists public.jp_chain_secret (
  id     int primary key default 1,
  secret text not null
);
alter table public.jp_chain_secret enable row level security;  -- 不开任何策略
revoke all on public.jp_chain_secret from anon, authenticated;

insert into public.jp_chain_secret (id, secret)
values (1, '<RANDOM_SECRET>')
on conflict (id) do update set secret = excluded.secret;

-- 4) 唯一写入口
create or replace function public.chain_anchor_push(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_secret text;
  v_id     bigint;
begin
  select secret into v_secret from jp_chain_secret where id = 1;
  if v_secret is null or p_token is distinct from v_secret then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  v_id := (p_payload->>'id')::bigint;
  if v_id is null then raise exception 'bad payload'; end if;

  insert into jp_chain_anchors (id, tx_hash, block_number, root, item_count, from_ts, to_ts, chain_id, registry, explorer, items)
  values (
    v_id,
    p_payload->>'tx',
    nullif(p_payload->>'blockNumber','')::bigint,
    p_payload->>'root',
    (p_payload->>'count')::int,
    (p_payload->>'fromTs')::bigint,
    (p_payload->>'toTs')::bigint,
    (p_payload->>'chainId')::int,
    p_payload->>'registry',
    p_payload->>'explorer',
    coalesce(p_payload->'items','{}'::jsonb)
  )
  on conflict (id) do update set
    tx_hash = excluded.tx_hash, block_number = excluded.block_number, root = excluded.root,
    item_count = excluded.item_count, from_ts = excluded.from_ts, to_ts = excluded.to_ts,
    chain_id = excluded.chain_id, registry = excluded.registry, explorer = excluded.explorer,
    items = excluded.items;

  -- 幂等：同一批次重推时先清旧 items
  delete from jp_chain_anchor_items where anchor_id = v_id;
  insert into jp_chain_anchor_items (qid, anchor_id, tx_hash, result, settled_at, leaf, proof)
  select
    e.qkey, v_id, p_payload->>'tx',
    coalesce(e.qval->>'result',''),
    coalesce((e.qval->>'settledAt')::bigint, 0),
    coalesce(e.qval->>'leaf',''),
    coalesce(e.qval->'proof','[]'::jsonb)
  from jsonb_each(coalesce(p_payload->'items','{}'::jsonb)) as e(qkey, qval);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

revoke all on function public.chain_anchor_push(text, jsonb) from public;
grant execute on function public.chain_anchor_push(text, jsonb) to anon, authenticated;
