-- ============================================================
-- 04-audit.sql
-- 明鉴 · 通用写操作审计日志（jp_audit_log）
--
-- 作用：记录「谁（actor_uid）在什么时间（ts，默认 now()）对哪张表
--      （tbl）的哪一行（row_id）做了什么动作（action）」，附带
--      结构化上下文（meta JSONB）。用于覆盖一切写操作（下注、结算、
--      争议、管理动作等）的通用审计。
--
-- 与 jp_disputes 的关系（重要，避免重复审计）：
--   jp_disputes 已经自带 6 个争议专用审计列（proposed_result /
--   old_result / old_final_odds / new_result / new_final_odds /
--   resolved_by），专门记录「争议→改判」的前后对照，由争议流程直接写。
--   本表不重复记录争议前后的字段级对照，只负责「通用动作」层面的一条
--   审计事件（例如「发起了一次争议 / 管理员执行了某项操作」），二者
--   职责互补、不重叠。
--
-- 安全模型：
--   - 匿名（anon）：无任何策略 → 默认拒绝（anon = none）。
--   - 已登录（authenticated）：仅能 INSERT 自己 uid 的行
--     （actor_uid = auth.uid()），且仅能 SELECT 自己的行。
--   - 管理员读策略（admin read）：TODO —— 当前尚无「管理员角色」模型，
--     盲目开放会破坏安全隔离。待引入管理员白名单（uid ∈ 站长列表）
--     后再补一条 service/admin 读取策略（见文末 TODO）。
--
-- 幂等性：CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS 后重建，
--         可重复执行；首次执行与后续执行结果一致。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 建表（幂等）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jp_audit_log (
  id         BIGSERIAL    PRIMARY KEY,
  ts         TIMESTAMPTZ  DEFAULT now(),
  actor_uid  TEXT,
  action     TEXT,
  tbl        TEXT,
  row_id     TEXT,
  meta       JSONB
);

-- 索引：按时间倒序查询 + 按表/行快速定位（幂等，已存在则跳过）
CREATE INDEX IF NOT EXISTS idx_jp_audit_log_ts    ON jp_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_jp_audit_log_tbl   ON jp_audit_log (tbl);
CREATE INDEX IF NOT EXISTS idx_jp_audit_log_actor ON jp_audit_log (actor_uid);

-- 开启行级安全（幂等，重复执行无害）
ALTER TABLE jp_audit_log ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2) RLS 策略（幂等：先删后建）
--    不写任何 anon 策略 ⇒ 匿名默认拒绝（anon = none）。
--    仅 authenticated 拥有「写自己 / 读自己」两条策略。
-- ------------------------------------------------------------
DO $$
DECLARE
  t text := 'jp_audit_log';
BEGIN
  -- 清空该表全部既有策略，避免重复执行时命名冲突
  EXECUTE (
    SELECT coalesce(string_agg(
      'DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(t) || ';', ' '), '')
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t
  );

  -- 已登录：仅可插入 actor_uid = 自己 的行
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (actor_uid = auth.uid())',
    t || '_auth_insert_own', t);

  -- 已登录：仅可读 actor_uid = 自己 的行
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR SELECT USING (actor_uid = auth.uid())',
    t || '_auth_select_own', t);
END $$;

-- ============================================================
-- TODO（管理员读策略，待管理员角色模型落地后补）：
--   待引入管理员白名单（例如 jp_admin_whitelist(uid) 或 auth.users 上的
--   role 标记）后，增加一条管理员读策略，例如：
--
--   CREATE POLICY jp_audit_log_admin_read ON jp_audit_log
--     FOR SELECT USING (auth.uid() IN (SELECT uid FROM jp_admin_whitelist));
--
--   在管理员模型就绪前，保持「仅本人可读」的保守默认，避免审计日志被
--   越权批量读取。管理员写同样受 _auth_insert_own 约束；若需由系统/站长
--   代写，应改用 service role（绕过 RLS）执行。
-- ============================================================
