-- ============================================================
-- 09-equip.sql
-- 明鉴 · 换装（仅允许更新 jp_user_items.equipped）
--
-- 背景：06-store-items.sql 刻意只授 SELECT / INSERT、不建 UPDATE 策略，
--       使持有关系"只买不换"。现需要支持展示态切换（换装），
--       但不能因此打开"改 item_id / 改 uid / 改他人行"的口子。
--
-- 方案：双约束
--   ① 列级授权 GRANT UPDATE(equipped)  —— 列维度：只能写 equipped 这一列；
--   ② 行级策略 FOR UPDATE USING/WITH CHECK (uid = auth.uid()::text)
--                                       —— 行维度：只能写自己的行，
--                                          且不能把 uid 改成别人。
--   注意：刻意不授予表级 UPDATE。表级 UPDATE 会隐式覆盖全部列，
--         列级限制将完全失效（PostgreSQL 的表级/列级 ACL 相互独立，
--         表级授权是"全列"语义）。
--
-- 内容：① 前置检查 ② 收回表级 UPDATE + 授列级 UPDATE(equipped)
--       ③ 幂等重建 UPDATE 策略 ④（注释）可选"每人至多一件已装备"索引
--
-- ⚠️ 本脚本只产出 SQL，绝不执行。线上变更须 product owner 确认后
--    由 DBA 用 genie-baas 执行。
--
-- 执行顺序：必须在 06-store-items.sql 之后执行。
-- ★ 重要：06 的 DO 块会 DROP 该表"全部"策略再重建。因此每次重跑
--   06-store-items.sql 之后，必须重跑本脚本，否则换装策略消失
--   （表现为换装静默失败：UPDATE 影响 0 行，不报权限错）。
--
-- 幂等性：REVOKE / GRANT 可重复执行；策略用 DROP POLICY IF EXISTS
--         后重建，可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 0) 前置检查：表必须已存在（缺失时给出明确错误，而不是晦涩的
--    "relation does not exist"）
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.jp_user_items') IS NULL THEN
    RAISE EXCEPTION 'jp_user_items 不存在：请先执行 06-store-items.sql';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1) 列级授权
--    先收回表级 UPDATE（若历史上有人授过），再只授 equipped 列。
--    顺序不能反：若先授列级、后仍有表级 UPDATE 残留，则等于全列可写。
-- ------------------------------------------------------------
REVOKE UPDATE ON TABLE public.jp_user_items FROM authenticated;
REVOKE UPDATE ON TABLE public.jp_user_items FROM anon;

GRANT UPDATE (equipped) ON TABLE public.jp_user_items TO authenticated;

-- anon 不授任何权限（06 已收回，这里再显式兜一次）
REVOKE ALL ON TABLE public.jp_user_items FROM anon;

-- ------------------------------------------------------------
-- 2) 行级策略：仅本人行可更新
--    USING      → 哪些行"可见可改"（必须是自己 uid）
--    WITH CHECK → 改完之后的行仍必须满足（防止把 uid 改成他人）
--
--    这里的 uid 是 TEXT，auth.uid() 通常是 uuid，故显式 ::text，
--    与 06-store-items.sql / 02-rls-tighten.sql 的写法保持一致。
-- ------------------------------------------------------------
ALTER TABLE public.jp_user_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS jp_user_items_owner_update ON public.jp_user_items;

  CREATE POLICY jp_user_items_owner_update
    ON public.jp_user_items
    FOR UPDATE
    TO authenticated
    USING (uid = auth.uid()::text)
    WITH CHECK (uid = auth.uid()::text);
END $$;

-- 保留 06 既有的 SELECT / INSERT 策略不动（读自己的装饰、首次入库）。
-- 仍然不建 DELETE 策略 → 持有关系依旧不可删、不可转卖。

-- ------------------------------------------------------------
-- 3) （可选，默认不启用）"每人至多一件已装备"的库级保证
--
--    换装需要两次写：先把旧的置 false，再把新的置 true。两步之间
--    存在瞬时窗口（0 件或 2 件已装备），部分唯一索引可兜住"2 件"，
--    但会要求前端严格按"先卸后装"顺序写；历史数据若已有同 uid 多件
--    equipped=true，建索引会直接失败。
--
--    因此默认注释掉，待确认前端顺序与存量数据后再单独评估：
--
--    CREATE UNIQUE INDEX IF NOT EXISTS uq_jp_user_items_one_equipped
--      ON public.jp_user_items (uid)
--      WHERE equipped;
-- ------------------------------------------------------------

-- ============================================================
-- 执行前 / 执行后 PRE-CHECK（手动运行；只读查询）
-- ============================================================
-- 1) 确认没有表级 UPDATE 残留（应查不到 'UPDATE' 这条表级授权）
--      SELECT grantee, privilege_type, is_grantable
--        FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'jp_user_items'
--       ORDER BY grantee, privilege_type;
--
-- 2) 确认列级授权只有 equipped（应仅见 authenticated / UPDATE / equipped）
--      SELECT grantee, column_name, privilege_type
--        FROM information_schema.column_privileges
--       WHERE table_schema = 'public' AND table_name = 'jp_user_items'
--         AND privilege_type = 'UPDATE';
--
-- 3) 确认策略存在且 cmd = UPDATE
--      SELECT policyname, cmd, roles, qual, with_check
--        FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'jp_user_items';
--
-- 4) 存量数据中同一 uid 已装备多件的情况（决定是否可启用第 3 节索引）
--      SELECT uid, count(*) AS equipped_cnt
--        FROM public.jp_user_items
--       WHERE equipped
--       GROUP BY uid HAVING count(*) > 1;
-- ============================================================

-- ============================================================
-- 接线提示（前端改动不在本脚本范围，仅供主 Agent 实施）
-- ============================================================
-- · 换装（先卸后装，两步；无事务，接受瞬时不一致）：
--     // 1) 卸下该用户当前所有装备
--     cloud.database.from('jp_user_items')
--       .update({ equipped: false })
--       .eq('uid', uid).eq('equipped', true);
--     // 2) 装上目标件
--     cloud.database.from('jp_user_items')
--       .update({ equipped: true })
--       .eq('item_id', itemId).eq('uid', uid);
--
--   要点：
--   - 必须带 .eq('uid', uid)（服务端策略已限本人，但显式带上可让
--     语义清晰、并避免误以为能批量改）；
--   - 顺序务必"先卸后装"：反过来会短时出现两件同时 equipped；
--   - 两步之间若第二步失败，用户会处于"没装备"的干净状态，
--     可重试，不会产生资损（equipped 只是展示位）；
--   - ROLLBACK/报错文案：列级权限被拒会返回
--     "permission denied for table jp_user_items"（42501），
--     不要误判为 RLS 策略问题。
-- · 不要尝试 update({ item_id }) 或 update({ uid })：两者均无列级
--   授权，服务端必然拒绝；这属于设计意图，不是 bug。
-- · 购买流程（store.js → insert）不受影响：INSERT 仍可写全列，
--   首次入库即可带 equipped:true（旧件需先卸再入库）。
-- ============================================================
