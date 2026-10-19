-- ============================================================
-- 10-ai-agents.sql
-- 明鉴 · AI 参与者表 + 站长代写对线表的策略补丁
--
-- 用途：
--   ① 建 jp_ai_agents：10 个固定 AI 参与者的身份登记表
--      （对应 app/js/ai-agents.js 的 AI_ROSTER，uid / 编号 / 昵称不可变）。
--   ② 补丁：为「站长代 AI 写行」开一条**仅限 AI uid** 的写入通道。
--      涉及四张表：jp_bets / jp_evidence / jp_debate_posts / jp_debate_bets。
--        INSERT：uid = auth.uid() OR (is_admin() AND uid LIKE 'ai-%')
--                —— 站长只能代 AI 插入，**不能伪造任何真人行**。
--        UPDATE/DELETE：uid = auth.uid() OR is_admin()
--                —— 结算派彩 / AI 评分 / 站长管理必须能改他人行（既有能力，不扩大）。
--
-- ★ 这是给「站长代 AI 写行」用的策略补丁，风险必须知情 ★
--   - 补丁后，任何 is_admin() 为真的账号可以以任意 uid 写入这两张表。
--     这与既有的「结算派彩补丁」同性质：站长本就有发放/改判能力，
--     边界只能是 jp_admin_whitelist 本身。
--   - 一旦站长账号失守，攻击者可伪造任意玩家的对线发言与对线押注，
--     且这些行在页面上看起来和真人写的没有区别。
--     缓解：① 白名单只保留站长本人；② 站长台操作留痕（见 04-audit.sql）；
--           ③ 不把 anon 纳入任何写策略。
--   - 本补丁对 jp_bets / jp_evidence / jp_debate_posts / jp_debate_bets
--     只放开 **AI uid 的 INSERT**；真人行仍严格 owner-only，
--     站长无法伪造任何真人的投注、证据或发言。
--   - UPDATE/DELETE 仍允许 is_admin() 改他人行：这是既有「结算派彩」
--     能力的延续（派彩要更新所有下注人的行），不是本次新增的敞口。
--   - AI 身份辨识不依赖数据库约束（库无法区分「AI 代写」与「本人写」），
--     一律由前端 AiCore.isAi(uid) / tagOf(uid) 渲染 AI 徽标。
--
-- 前置条件：
--   - 已执行 02-rls-tighten.sql（这两张表与其 owner 策略由它创建）。
--   - public.is_admin() 已存在（管理员唯一化补丁，白名单在云端维护）。
--     缺失时本脚本会以明确错误中止，而不是留下「策略建了一半」的状态。
--
-- 执行顺序：10-ai-agents.sql 应在 02-rls-tighten.sql 之后执行。
--   ★ 注意：02-rls-tighten.sql 会先 DROP 该表全部策略再重建。
--     每次重跑 02 之后必须重跑本脚本，否则这两张表会退回
--     「仅本人可写」，表现为站长代 AI 发言/押注被 42501 拒绝。
--
-- 幂等性：CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS 后重建 /
--         GRANT 可重复执行；整份脚本可安全重跑。
--
-- ⚠️ 本脚本只产出 SQL，绝不执行。线上变更须 product owner 确认后
--    由 DBA 用 genie-baas 执行。
-- ============================================================

-- ------------------------------------------------------------
-- 0) 前置检查：is_admin() 必须存在
--    两张补丁策略都引用它；提前报错比建到一半失败更容易排查。
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION
      'public.is_admin() 不存在：请先执行管理员唯一化补丁（jp_admin_whitelist + is_admin），再执行本脚本';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1) AI 参与者身份表
--    uid 以 'ai-' 开头是硬约束：既方便前端识别，也防止误录真人 uid。
--    "no" 是 SQL 关键字（NO ACTION 等），统一加双引号书写。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jp_ai_agents (
  uid            TEXT PRIMARY KEY,
  model          TEXT NOT NULL,
  "no"           INTEGER NOT NULL,
  display        TEXT NOT NULL,
  persona        TEXT,
  risk           NUMERIC DEFAULT 0.4,
  contrarian     NUMERIC DEFAULT 0.3,
  category_prefs JSONB DEFAULT '[]'::jsonb,
  bio            TEXT,
  start_points   INTEGER DEFAULT 2000,
  created_at     TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT jp_ai_agents_uid_ai_prefix CHECK (uid LIKE 'ai-%'),
  CONSTRAINT jp_ai_agents_no_unique UNIQUE ("no")
);

COMMENT ON TABLE public.jp_ai_agents IS
  'AI 参与者身份登记表。uid 固定为 ai-<模型>-<编号>，昵称固定为「模型名 #编号」，绝不伪装真人；对应 app/js/ai-agents.js 的 AI_ROSTER。';
COMMENT ON COLUMN public.jp_ai_agents."no" IS '固定编号 1..10，与昵称中的 #01..#10 一致，不可重复。';
COMMENT ON COLUMN public.jp_ai_agents.start_points IS '初始积分（seed 行 payout）；实际现金还要叠加站内 opening_bonus，见 ai-agents.js 文件头。';

-- ------------------------------------------------------------
-- 2) RLS 第一道门：表级授权
--    anon 只读（榜单/花名册公示）；authenticated 可写（写由策略再限）。
--    先 REVOKE 再 GRANT，清掉历史上可能残留的 anon 写权限。
-- ------------------------------------------------------------
ALTER TABLE public.jp_ai_agents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.jp_ai_agents FROM anon;
GRANT SELECT ON TABLE public.jp_ai_agents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.jp_ai_agents TO authenticated;

-- ------------------------------------------------------------
-- 3) 策略（第二道门）：幂等重建
--    anon_read   —— 匿名只读
--    auth_read   —— 登录用户读全表（榜单需要看到其他 AI）
--    admin_write —— 仅 is_admin() 可增删改（身份表不该由普通用户改）
-- ------------------------------------------------------------
DO $$
DECLARE
  t text := 'jp_ai_agents';
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_read', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_auth_read', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);

  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)',
    t || '_anon_read', t);

  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
    t || '_auth_read', t);

  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
    t || '_admin_write', t);
END $$;

-- ------------------------------------------------------------
-- 4) ★ 补丁：站长代 AI 写行（四张表，INSERT 仅限 AI uid）
--
--    现状（02-rls-tighten.sql 建）：
--      <table>_owner_insert  FOR INSERT WITH CHECK (uid = auth.uid()::text)
--      <table>_owner_update  FOR UPDATE USING/WITH CHECK (uid = auth.uid()::text)
--      <table>_owner_delete  FOR DELETE USING (uid = auth.uid()::text)
--    AI 的 uid 不是站长本人的 auth.uid()，因此站长代写必被拒。
--
--    改法（策略名不变，避免与 02 的命名约定分叉）：
--      INSERT：uid = auth.uid()::text OR (is_admin() AND uid LIKE 'ai-%')
--              —— 关键：站长只能代 AI 插入，不能伪造真人投注/证据/发言。
--      UPDATE/DELETE：uid = auth.uid()::text OR is_admin()
--              —— 结算派彩、AI 评分、站长管理需要改他人行，与既有能力一致。
--
--    表不存在时只发 NOTICE 并跳过，不让整份脚本失败。
-- ------------------------------------------------------------
DO $$
DECLARE
  t         text;
  tables    text[] := ARRAY['jp_bets', 'jp_evidence', 'jp_debate_posts', 'jp_debate_bets'];
  ins_scope text := '(uid = auth.uid()::text OR (public.is_admin() AND uid LIKE ''ai-%''))';
  own_scope text := '(uid = auth.uid()::text OR public.is_admin())';
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '跳过 %：表不存在（可能尚未执行 02-rls-tighten.sql）', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 第二道门：02 已授过，这里显式补齐，避免只补策略却仍 42501
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);

    -- INSERT：本人，或「站长代 AI」
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK %s',
      t || '_owner_insert', t, ins_scope);

    -- UPDATE（USING 管「哪些行可改」，WITH CHECK 管「改成什么样」）
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING %s WITH CHECK %s',
      t || '_owner_update', t, own_scope, own_scope);

    -- DELETE
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING %s',
      t || '_owner_delete', t, own_scope);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4b) 对线房：允许「房主」邀请 AI 在**自己的房间**发言
--
--   单靠 4) 的「is_admin + ai-」不够：普通房主不是站长，无法邀请 AI。
--   这里把 jp_debate_posts 的 INSERT 再放宽一条，但严格限定：
--     ① 行为本人（uid = auth.uid()）
--     ② 或站长代写 AI 行
--     ③ 或 AI 行，且该行的 did 属于调用者创建的房间
--   仍然不可能伪造他人的真人发言。
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.jp_debate_posts') IS NULL THEN
    RAISE NOTICE '跳过 jp_debate_posts：表不存在';
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS jp_debate_posts_owner_insert ON public.jp_debate_posts';
  EXECUTE '
    CREATE POLICY jp_debate_posts_owner_insert ON public.jp_debate_posts
    FOR INSERT TO authenticated
    WITH CHECK (
      uid = auth.uid()::text
      OR (public.is_admin() AND uid LIKE ''ai-%'')
      OR (uid LIKE ''ai-%'' AND EXISTS (
        SELECT 1 FROM public.jp_debates d
        WHERE d.did = jp_debate_posts.did AND d.creator_uid = auth.uid()::text
      ))
    )';
END $$;

-- ============================================================
-- 执行前 / 执行后 PRE-CHECK（手动运行；只读查询）
-- ============================================================
-- 1) 身份表结构与约束
--      SELECT column_name, data_type, column_default
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'jp_ai_agents'
--       ORDER BY ordinal_position;
--
--      SELECT conname, pg_get_constraintdef(oid)
--        FROM pg_constraint
--       WHERE conrelid = 'public.jp_ai_agents'::regclass;
--
-- 2) RLS 已开、策略齐全
--      SELECT relrowsecurity FROM pg_class WHERE oid = 'public.jp_ai_agents'::regclass;
--      SELECT policyname, cmd, roles, qual, with_check
--        FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'jp_ai_agents'
--       ORDER BY policyname;
--
-- 3) 补丁生效（三张表的 owner_* 策略 qual 都应含 is_admin）
--      SELECT tablename, policyname, cmd, qual, with_check
--        FROM pg_policies
--       WHERE schemaname = 'public'
--         AND tablename IN ('jp_debate_posts', 'jp_debate_bets')
--       ORDER BY tablename, policyname;
--
-- 4) 表级授权（anon 只应看到 SELECT）
--      SELECT table_name, grantee, privilege_type
--        FROM information_schema.role_table_grants
--       WHERE table_schema = 'public'
--         AND table_name IN ('jp_ai_agents', 'jp_debate_posts', 'jp_debate_bets')
--       ORDER BY table_name, grantee, privilege_type;
-- ============================================================

-- ============================================================
-- 接线提示（前端改动不在本脚本范围，仅供主 Agent 实施）
-- ============================================================
-- · 花名册落库：用 AiCore.AI_ROSTER 生成 10 行 upsert 到 jp_ai_agents
--   （uid / model / no / display / persona / risk / contrarian /
--     category_prefs / bio / start_points），只在站长台执行一次。
-- · 初始积分：AiCore.buildSeedRow(agent, points) 产出的行 insert 到
--   jp_bets。kind='bonus' + stake=0 + status='won' 会全额计入现金
--   （LoanCore.cashOf / leaderboard 已核对），且不进战绩与月榜。
--   现金 = 站内 opening_bonus + payout；若要严格 2000 起步，
--   传 2000 - opening_bonus。
-- · 代写发言：AiCore.composeLine + buildDebatePost → insert
--   jp_debate_posts（需本脚本第 4 节补丁）。
-- · 代写押注：AiCore.planRound → insert jp_bets（INSERT 走本脚本第 4 节：
--   仅 is_admin() AND uid LIKE 'ai-%' 可写，真人行不受影响）。
-- ============================================================
