-- ============================================================
-- 05-store.sql
-- 明鉴 · 积分商城订单表（商业化 P3）
--
-- 用途：记录「装饰性内购」「VIP 权益解锁」等以「积分」结算的订单。
--       本表 ONLY 承载应用内非货币分值交易，绝不存任何真实货币字段、
--       绝不存任何收款/支付流水（无 法币加值 / 兑回现金 / 用户间让渡 / 货币互换）。
--
-- 关联前端：app/js/monetize.js 的 composeStoreRow() / buyCosmetic() /
--           buyVip() 负责组装行对象；实际 insert 由宿主应用用
--           cloud.database.from('jp_store_orders').insert(row) 执行。
--
-- ⚠️ 高风险操作：改动线上库结构与安全模型。
--   必须经 product owner 确认后再用 genie-baas 对线上库执行。
--
-- 幂等性：CREATE TABLE IF NOT EXISTS + DO 块先 DROP 该表全部既有策略
--         再重建，可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 订单表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jp_store_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid          TEXT NOT NULL,                 -- 下单用户（= auth.uid()）
  item_id      TEXT NOT NULL,                 -- 商品 id（见 monetize.js 目录）
  kind         TEXT NOT NULL,                 -- 'cosmetic' | 'vip'
  cost_points  INTEGER NOT NULL DEFAULT 0,    -- 花费的「积分」数量（非货币）
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 便于按用户查询自身订单
CREATE INDEX IF NOT EXISTS idx_store_orders_uid
  ON jp_store_orders (uid, created_at DESC);

-- ------------------------------------------------------------
-- 2) RLS：匿名无任何权限；已登录用户仅可写/读自己 uid 的行
--    （订单视为不可变：不授予 UPDATE / DELETE）
-- ------------------------------------------------------------
ALTER TABLE jp_store_orders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'jp_store_orders';
BEGIN
  -- 删干净该表全部既有策略（无论名字），避免重复创建冲突
  EXECUTE (
    SELECT coalesce(string_agg(
      'DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(t) || ';', ' '), '')
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t
  );

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

  -- 匿名（anon）：无策略 → 默认拒绝（anon none）
  -- 仅建立已登录用户的本人策略：

  -- 已登录：仅可插入自己 uid 的订单（INSERT 时校验 uid = auth.uid()）
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (uid = auth.uid())',
    t || '_owner_insert', t);

  -- 已登录：仅可读取自己 uid 的订单
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR SELECT USING (uid = auth.uid())',
    t || '_owner_select', t);

  -- 注意：不创建 UPDATE / DELETE 策略 → 订单不可改、不可删（不可变留痕）
END $$;

-- ============================================================
-- 执行前确认清单（迁移安全）
-- ============================================================
-- 1) 本脚本与 02-rls-tighten.sql 互不冲突：本表为新增，独立策略。
-- 2) 真实货币相关能力（机构付费话题等）不在本表承载，详见
--    app/js/monetize.js 中 OUT_OF_SCOPE 注释；本表无收款字段。
-- 3) 推荐执行顺序：在 02-rls-tighten.sql 之后执行本脚本即可。
-- ============================================================
