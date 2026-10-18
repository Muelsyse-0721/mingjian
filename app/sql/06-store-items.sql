-- ============================================================
-- 06-store-items.sql
-- 明鉴 · 装饰持有表（积分商城 · 阶段2「装饰消耗」）
--
-- 用途：记录用户用「积分」买下的纯装饰（名讳颜色 / 头像框 / 主题 / 称号）。
--       积分在购买时即被销毁（见 app/js/store.js 的 composeSpendRow），
--       本表只保留「谁永久拥有哪个装饰」这一不可变事实。
--
-- ★ 红线（结构层保证）★
--   · 本表无价格、无余额、无支付渠道字段 —— 不承载任何货币语义；
--   · 积分不可充值 / 提现 / 转让 / 兑换法币；本表也不参与这些流程；
--   · 持有关系不可改、不可删（只授 SELECT / INSERT），因此装饰
--     不能转卖、不能回售、不能换回积分；
--   · 匿名角色（anon）无任何策略与授权 → 默认全拒。
--
-- 关联前端：app/js/store.js 的 composeHoldingRow() 组装行；
--           实际写入由宿主（online.js）用
--           cloud.database.from('jp_user_items').insert(row) 执行。
--
-- ⚠️ 本脚本只产出 SQL，绝不执行。线上变更须 product owner 确认后
--    由 DBA 用 genie-baas 执行。
--
-- 幂等性：CREATE TABLE IF NOT EXISTS + 命名约束存在性检查 +
--          DO 块先 DROP 本表全部既有策略再重建，可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 持有表
--    (uid, item_id) 唯一 → 同一装饰不会重复入库（防重复扣分后重复发放）
--    刻意不在 CREATE TABLE 内写 UNIQUE：改用下方「命名约束 + 存在性检查」，
--    这样表已存在时也能补上约束。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jp_user_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid         TEXT NOT NULL,                       -- 持有者（= auth.uid()）
  item_id     TEXT NOT NULL,                       -- 商品 id（见 store.js 目录）
  acquired_at TIMESTAMPTZ DEFAULT now(),           -- 获得时间
  equipped    BOOLEAN DEFAULT false                -- 是否正在展示（唯一可变的展示态）
);

-- 补唯一约束（幂等：按约束名判断，已存在则跳过）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_jp_user_items_uid_item'
      AND conrelid = 'public.jp_user_items'::regclass
  ) THEN
    ALTER TABLE public.jp_user_items
      ADD CONSTRAINT uq_jp_user_items_uid_item UNIQUE (uid, item_id);
  END IF;
END $$;

-- 按用户查询自身装饰
CREATE INDEX IF NOT EXISTS idx_jp_user_items_uid
  ON public.jp_user_items (uid, acquired_at DESC);

-- ------------------------------------------------------------
-- 2) RLS：匿名全拒；已登录仅本人 SELECT / INSERT
--    （不建 UPDATE / DELETE 策略 → 持有关系不可改、不可删）
--
--    注：equipped 的切换同理受限于「无 UPDATE」——若要支持换装，
--    后续单独评估「仅允许更新 equipped 列」的方案（列级 GRANT 或
--    独立表）；当前阶段按「只买不换」处理，宁可不能换装，
--    也不给可篡改/可回滚的口子。
-- ------------------------------------------------------------
ALTER TABLE public.jp_user_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'jp_user_items';
BEGIN
  -- 删干净该表全部既有策略（无论名字），避免重复创建冲突
  EXECUTE (
    SELECT coalesce(string_agg(
      'DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(t) || ';', ' '), '')
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t
  );

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

  -- 表级授权（RLS 的第二道门：无 GRANT 会得到形似策略失效的 42501）
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO authenticated', t);

  -- 匿名（anon）：不建任何策略 → 默认拒绝
  -- 已登录：仅可读取自己的装饰
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (uid = auth.uid()::text)',
    t || '_owner_select', t);

  -- 已登录：仅可插入 uid = 自己的行
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (uid = auth.uid()::text)',
    t || '_owner_insert', t);

  -- 不创建 UPDATE / DELETE 策略 → 持有关系不可变（不可转卖/回售/删除）
END $$;

-- ============================================================
-- 执行前 PRE-CHECK（手动运行；只读查询）
-- ============================================================
-- 1) 确认积分台账 jp_bets.payout 允许负数（store.js 用 payout = -price 扣分）
--      SELECT column_name, data_type, numeric_precision
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'jp_bets'
--         AND column_name IN ('stake', 'payout', 'kind', 'status');
--
--      -- 若存在 CHECK 约束且限制 payout >= 0，则「负派彩扣分」会被拒绝，
--      -- 此时改用 kind='spend' / stake=price / status='lost'，
--      -- 但需同步修 LoanCore.leaderboard 的现金口径（目前会漏扣）。
--      SELECT conname, pg_get_constraintdef(oid) AS def
--        FROM pg_constraint
--       WHERE conrelid = 'public.jp_bets'::regclass AND contype = 'c';
--
-- 2) 确认 auth.uid() 可用（RLS 依赖它）
--      SELECT auth.uid();
--
-- 3) 确认 uq_jp_user_items_uid_item 是否已存在（重复执行本脚本时应为 1 行）
--      SELECT conname FROM pg_constraint WHERE conname = 'uq_jp_user_items_uid_item';
-- ============================================================

-- ============================================================
-- 产品注意点
-- ============================================================
-- · 「积分已扣、装饰未发放」的资损窗口：jp_bets（扣分）与
--   jp_user_items（发放）是两次独立写入，无事务。宿主应保证顺序为
--   先扣分 → 再发放；若发放失败，只能留痕记录待人工补发，绝不允许
--   自动退回积分（退回即可被当作「积分回售」通道被滥用）。
-- · 本表不含任何可兑换回积分的字段，也不设「出售/转让」接口。
-- ============================================================
