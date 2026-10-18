-- ============================================================
-- 07-vip.sql
-- 明鉴 · VIP 特权表（阶段3）
--
-- 用途：记录用户当前生效的 VIP 档位与到期时间（一人一行）。
--       VIP 只能用「游戏内积分」购买时长，本表不存任何支付/法币字段，
--       也不承载任何充值 / 提现 / 转账 / 兑换能力。
--
-- 关联前端：app/js/vip.js 的 VipCore
--           - composeVipRow(uid, tier, now, fromIso) 负责组装行对象；
--           - 实际 upsert 由宿主应用用
--             cloud.database.from('jp_vip').upsert(row) 执行（on_conflict=uid）。
--
-- ⚠️ 高风险操作：改动线上库结构与安全模型。
--   必须经 product owner 确认后再用 genie-baas 对线上库执行。
--
-- 幂等性：CREATE TABLE IF NOT EXISTS + DO 块先 DROP 该表全部既有策略
--         再重建；GRANT / REVOKE 可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1) VIP 表（uid 为主键 → 一人一行，续费即更新到期时间）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jp_vip (
  uid         TEXT PRIMARY KEY,              -- 用户 uid（= auth.uid()）
  tier        TEXT,                          -- 'vip1' | 'vip2'（见 VipCore.TIERS）
  expires_at  TIMESTAMPTZ,                   -- 到期时间；到期即失效
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 2) RLS：匿名无任何权限；已登录用户仅可读/写自己 uid 的行
--    （不授予 DELETE：VIP 过期靠时间判定，不靠删行）
-- ------------------------------------------------------------
ALTER TABLE jp_vip ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'jp_vip';
BEGIN
  -- 删干净该表全部既有策略（无论名字），避免重复创建冲突
  EXECUTE (
    SELECT coalesce(string_agg(
      'DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(t) || ';', ' '), '')
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t
  );

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

  -- 匿名（anon）：无策略 → 默认拒绝（anon none），且下方显式 REVOKE 表级权限
  -- 仅建立已登录用户的本人策略：

  -- 已登录：仅可读取自己 uid 的 VIP 行
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR SELECT USING (uid = auth.uid())',
    t || '_owner_select', t);

  -- 已登录：仅可插入自己 uid 的 VIP 行（首次购买）
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (uid = auth.uid())',
    t || '_owner_insert', t);

  -- 已登录：仅可更新自己 uid 的 VIP 行（续费 / 升级档位）
  -- WITH CHECK 同样限定 uid，防止把行改成别人的
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR UPDATE USING (uid = auth.uid()) WITH CHECK (uid = auth.uid())',
    t || '_owner_update', t);

  -- 注意：不创建 DELETE 策略 → 用户不能删行（到期由 expires_at 判定）
END $$;

-- ------------------------------------------------------------
-- 3) 表级授权（RLS 之外的第二道门：缺 GRANT 会得到 42501）
-- ------------------------------------------------------------
REVOKE ALL ON TABLE public.jp_vip FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.jp_vip TO authenticated;

-- ============================================================
-- 执行前确认清单（迁移安全）
-- ============================================================
-- 1) 本表为新增，与 02-rls-tighten.sql / 05-store.sql 互不冲突：独立策略。
-- 2) 前端购买流程只用「积分」结算：扣积分走既有 jp_bets 加分/扣分行
--    （或商城订单），本表只存档位与到期时间，无任何收款字段。
-- 3) PostgREST upsert（on_conflict=uid）需要 INSERT + UPDATE + SELECT 三项
--    权限，本脚本均已授予。
-- 4) 推荐执行顺序：在 05-store.sql 之后执行本脚本。
-- ============================================================
