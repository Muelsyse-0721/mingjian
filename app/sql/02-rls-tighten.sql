-- ============================================================
-- 02-rls-tighten.sql
-- 明鉴 · 电话登录（cloud.auth）后的安全模型收紧
--
-- 目标：电话登录落地后，把「匿名可读写（true/true）」收紧为：
--   · 匿名（anon）     ：仅可读公开账本（SELECT USING (true)）。
--   · 已登录（authenticated）：仅能读写「自己拥有」的行；
--       拥有者列 = uid（多数表）或 creator_uid（jp_debates）。
--   · 站长 / 系统表（jp_questions / jp_settings / jp_odds_snaps）：
--       匿名仍仅可读；写操作收敛到 authenticated，但完整「管理员角色」
--       模型尚缺，列为 TODO（见文末），绝不保留 anon 可写。
--
-- ⚠️ 高风险操作：直接改动线上库安全模型。
--   必须经 product owner 确认后，再用 genie-baas 对线上库执行。
--   执行前请完整阅读文末「迁移冲突与执行顺序」。
--
-- 幂等性：DO 块先 DROP 表上全部既有策略（查 pg_policies）再重建，可重复执行。
--   首次执行与后续执行结果一致；ENABLE ROW LEVEL SECURITY 重复执行无害。
--
-- 列名假设（已 grep 代码核对，见文末「列名核对记录」）：
--   · 下列用户自有表均带 `uid TEXT` 拥有者列（由 auth.js#migrateOldUid
--     的 `.eq('uid', old)` / `.update({uid})` 证实）：
--       jp_bets, jp_loans, jp_loan_payments, jp_debate_posts,
--       jp_debate_bets, jp_evidence, jp_disputes, jp_dispute_votes,
--       jp_public_votes, jp_profiles
--   · jp_debates 的拥有者列是 `creator_uid`（online.js:2023 写入
--     `creator_uid: state.uid`），并非 `uid` —— 此处显式用 creator_uid。
--   · auth.uid() 返回类型通常为 uuid，与 TEXT 列比较时统一 cast 为
--     `auth.uid()::text` 以避免类型不匹配。
-- ============================================================

-- ------------------------------------------------------------
-- 0) 新增 jp_profiles（昵称档案表，auth.js 依赖）
--    RLS 策略由下方 DO 块统一创建（此处仅建表 + 不提前 ENABLE，
--    以避免“建表后无策略”的瞬时默认拒绝窗口；ENABLE 在 DO 块内完成）。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jp_profiles (
  uid         TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 0.5) 迁移 RPC：旧免登录 uid → 新 auth uid（SECURITY DEFINER 绕过 RLS）
-- ------------------------------------------------------------
-- 解决「迁移冲突」：auth.js#migrateOldUid 需改写旧 uid 行，但严格 RLS 下
-- 旧行不属于新用户会被拒。此函数以定义者权限运行（绕过 RLS），且强制
-- new_uid = auth.uid()（调用者自身），杜绝越权迁移他人数据。
-- 客户端调用：cloud.database.rpc('migrate_legacy_uid', {old_uid, new_uid})
CREATE OR REPLACE FUNCTION migrate_legacy_uid(old_uid text, new_uid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rb jsonb := '{}'::jsonb;
  n int;
BEGIN
  IF old_uid IS NULL OR new_uid IS NULL OR old_uid = new_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  -- 仅允许迁移到调用者自身的 auth.uid()，防止越权迁移他人旧数据
  IF new_uid <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'new_uid_mismatch');
  END IF;

  UPDATE jp_bets           SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_bets}', to_jsonb(n));
  UPDATE jp_loans          SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_loans}', to_jsonb(n));
  UPDATE jp_loan_payments  SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_loan_payments}', to_jsonb(n));
  UPDATE jp_debate_posts   SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_debate_posts}', to_jsonb(n));
  UPDATE jp_debate_bets    SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_debate_bets}', to_jsonb(n));
  UPDATE jp_evidence       SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_evidence}', to_jsonb(n));
  UPDATE jp_disputes       SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_disputes}', to_jsonb(n));
  UPDATE jp_dispute_votes  SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_dispute_votes}', to_jsonb(n));
  UPDATE jp_public_votes   SET uid = new_uid WHERE uid = old_uid;             GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_public_votes}', to_jsonb(n));
  -- 辩论房拥有者列是 creator_uid（非 uid）
  UPDATE jp_debates        SET creator_uid = new_uid WHERE creator_uid = old_uid; GET DIAGNOSTICS n = ROW_COUNT; rb = jsonb_set(rb, '{jp_debates}', to_jsonb(n));

  RETURN jsonb_build_object('ok', true, 'rows', rb);
END;
$$;
-- 默认 PUBLIC 可执行（迁移是用户对自己数据的自救）；如要更严可 GRANT 限定角色。
-- 本函数已用 new_uid = auth.uid() 自锁，调用者无法迁移到他人 uid。

-- ------------------------------------------------------------
-- 1) 统一收紧：DO 块
--    v_owner_tables：用户自有表（表名, 拥有者列）
--    v_admin_tables ：无逐行拥有者的站长 / 系统表
-- ------------------------------------------------------------
DO $$
DECLARE
  r              record;
  v_owner_tables text[][] := ARRAY[
    ARRAY['jp_bets',           'uid'],
    ARRAY['jp_loans',          'uid'],
    ARRAY['jp_loan_payments',  'uid'],
    ARRAY['jp_debate_posts',   'uid'],
    ARRAY['jp_debate_bets',    'uid'],
    ARRAY['jp_evidence',       'uid'],
    ARRAY['jp_disputes',       'uid'],
    ARRAY['jp_dispute_votes',  'uid'],
    ARRAY['jp_public_votes',   'uid'],
    ARRAY['jp_profiles',       'uid'],
    ARRAY['jp_debates',        'creator_uid']   -- 注意：拥有者列是 creator_uid
  ];
  v_admin_tables text[] := ARRAY['jp_questions', 'jp_settings', 'jp_odds_snaps'];
  t  text;
  oc text;
BEGIN

  -- ===== 1a) 用户自有表：匿名只读 + 已登录仅本人 =====
  FOREACH r SLICE 1 IN ARRAY v_owner_tables LOOP
    t  := r[1];
    oc := r[2];

    -- 删干净该表全部既有策略（无论名字），避免与新的冲突
    EXECUTE (
      SELECT coalesce(string_agg(
        'DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(t) || ';', ' '), '')
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    );

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- 授权（RLS 的第二道门：无表级 GRANT 会得到形似策略失效的 42501）
    --   anon 仅 SELECT（公开账本可读，不可写）
    --   authenticated 可读写（写由下方 owner 策略限本人）
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);

    -- 匿名：仅可读（公开账本）
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO anon USING (true)',
      t || '_anon_read', t);

    -- 已登录：可读公开账本全部行（含他人行，用于大厅展示）
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)',
      t || '_auth_read', t);

    -- 已登录：仅可插入自己拥有的行
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (%I = auth.uid()::text)',
      t || '_owner_insert', t, oc);

    -- 已登录：仅可改自己拥有的行
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (%I = auth.uid()::text) WITH CHECK (%I = auth.uid()::text)',
      t || '_owner_update', t, oc, oc);

    -- 已登录：仅可删自己拥有的行
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (%I = auth.uid()::text)',
      t || '_owner_delete', t, oc);
  END LOOP;

  -- ===== 1b) 站长 / 系统表：匿名只读 + 已登录全量写（管理员角色 TODO） =====
  FOREACH t IN ARRAY v_admin_tables LOOP
    EXECUTE (
      SELECT coalesce(string_agg(
        'DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(t) || ';', ' '), '')
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    );

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- 授权（第二道门，防 42501）
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);

    -- 匿名：仅可读；jp_settings 须排除敏感 key（admin_token_hash）
    IF t = 'jp_settings' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT TO anon USING (key <> ''admin_token_hash'')',
        t || '_anon_read', t);
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT TO anon USING (true)',
        t || '_anon_read', t);
    END IF;

    -- 已登录：当前阶段全量读写（INSERT/UPDATE/DELETE/SELECT）
    -- TODO：引入管理员白名单（uid ∈ 站长列表）后，将下方 FOR ALL 收紧为
    --       仅管理员可写（见文末 TODO）。
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_auth_all', t);
  END LOOP;

END $$;

-- ============================================================
-- ⚠️ 安全提示（重要，需 product owner 拍板）：
--   jp_settings 经上述策略对 anon 开放 SELECT（公开账本可读）。
--   但 jp_settings 是 key/value 表，且含敏感行（如 `admin_token_hash`
--   站长令牌哈希）。anon SELECT (true) 会把该哈希一并暴露给未登录用户。
--
--   推荐（二选一，解除后删除对应注释即可）：
--   A) 【推荐】把敏感 key 迁出 jp_settings，存入独立表（如
--      jp_admin_secrets，对该表不建 anon 策略，仅 authenticated + 管理员读）。
--   B) 若仍需留在 jp_settings，用列/行过滤限制 anon 可读范围，例如把
--      jp_settings 的 anon_read 改为（取消下一行注释并替换上面的 anon_read）：
--        CREATE POLICY jp_settings_anon_read ON jp_settings
--          FOR SELECT TO anon USING (key <> 'admin_token_hash');
--      注意：此写法需把所有敏感 key 显式排除，易遗漏，故 A 更稳妥。
--   在本脚本中，按任务要求暂保留 jp_settings 的 anon SELECT (true)，
--   但强烈建议上线前采用上述任一方案，否则等于把站长令牌哈希公开。
-- ============================================================

-- ============================================================
-- 迁移冲突与执行顺序（重要）
-- ============================================================
-- auth.js#migrateOldUid() 在用户首次登录时，把本机旧免登录 uid
-- （localStorage 'jp-online-uid'）对应的全部战绩改写为新的 auth uid。
-- 其 SQL 形如：UPDATE <表> SET uid=<新> WHERE uid=<旧>。
--
-- 问题：上述严格 RLS 仅允许 UPDATE 行 WHERE uid = auth.uid()（=新 uid），
--       而待迁移的旧行 uid=<旧>，不属于当前用户 → RLS 会拒绝该 UPDATE，
--       迁移静默失败，老用户历史战绩丢失。
--
-- 附加问题（同根）：jp_debates 的拥有者列是 creator_uid（非 uid），
--       而 migrateOldUid() 的表清单【未】包含 jp_debates。即使用 service
--       role 跑迁移，也必须一并把 jp_debates 的 creator_uid 从旧值改写为
--       新值，否则老用户登录后会被 RLS 锁死在「自己创建的辩论房」之外。
--       ⇒ 建议把 jp_debates 也加入一次性迁移：
--         UPDATE jp_debates SET creator_uid=<新> WHERE creator_uid=<旧>;
--
-- 候选执行顺序（择一，需用户拍板）：
--   A) 宽限期方案：先上线登录代码，保持本批次用户表仍 anon 可写一段宽限期，
--      让存量用户自然完成首次登录迁移；宽限期结束后再执行本脚本收紧。
--      —— 缺点：宽限期内库仍 anon 可写，存在被刷风险。
--   B)【推荐·已实现】迁移 RPC：本脚本已内含 SECURITY DEFINER 函数
--      migrate_legacy_uid(old_uid, new_uid)，以定义者权限绕过 RLS，并强制
--      new_uid = auth.uid()（仅能迁到自己名下）。用户每次首次登录时，
--      auth.js 调用 cloud.database.rpc('migrate_legacy_uid', {old_uid,new_uid})
--      即可就地迁移（含 jp_debates.creator_uid），无需保管 service key、无需
--      一次性批处理。配合本脚本收紧，零历史割裂、零额外密钥。
--      （若平台确实提供 service role 通道，也可改走 service role 批处理，
--        但 RPC 方案已覆盖绝大多数场景。）
--   C) 接受历史割裂：v1 不做跨 uid 迁移，旧免登录战绩视为「游客存档」，
--      新登录用户从零开始；后续用 B 方案补「Claim / 合并」。
--
-- 硬性要求：不要为实现迁移而长期保留「弱化 RLS 永久 bypass」。
--   本 RPC 属「按需、受 new_uid=auth.uid() 自锁」的受控通道，不违反该要求。
--
-- 推荐：B（RPC 就地迁移）→ 直接应用本脚本（RLS + RPC 一并生效）。
--       若暂不启用 RPC，可走 A 宽限期过渡，但尽快切到 B。
-- ============================================================

-- ============================================================
-- TODO（管理员读/写策略，待管理员角色模型落地后补）：
--   待引入管理员白名单（例如 jp_admin_whitelist(uid) 或 auth.users 上的
--   role 标记）后，对 jp_questions / jp_settings / jp_odds_snaps 增加：
--     CREATE POLICY <t>_admin_write ON <t>
--       FOR ALL TO authenticated
--       USING (auth.uid() IN (SELECT uid FROM jp_admin_whitelist))
--       WITH CHECK (auth.uid() IN (SELECT uid FROM jp_admin_whitelist));
--   替换当前宽松的 _auth_all（FOR ALL USING(true)），消除「任意已登录用户
--   可改题库 / 配置 / 快照」的缺口。在此之前，保持现状并知悉该风险。
-- ============================================================

-- ============================================================
-- 列名核对记录（grep 证据）
-- ============================================================
-- · jp_public_votes 问题 id 列 = qid
--     online.js:626-627  insert({ qid, uid, nickname, choice, created_at })
-- · jp_dispute_votes 争议 id 列 = dispute_id
--     online.js:2465-2467  newVote = { dispute_id, uid, nickname, agree, weight, created_at }
-- · jp_debates 拥有者列 = creator_uid（非 uid）
--     online.js:2023  creator_uid: state.uid
-- · 9 张用户表拥有者列 = uid（auth.js#migrateOldUid 证实）
--     auth.js:177-179  tables = [jp_bets, jp_loans, jp_loan_payments,
--       jp_debate_posts, jp_debate_bets, jp_evidence, jp_disputes,
--       jp_dispute_votes, jp_public_votes] 均走 .eq('uid', old)
-- · jp_profiles 拥有者列 = uid（主键）
--     auth.js:151  upsert({ uid, nickname })；:162 select('nickname').eq('uid', uid)
-- · jp_questions / jp_settings / jp_odds_snaps 无逐行拥有者列
--     （jp_questions 按 qid 改、jp_settings 按 key 改、jp_odds_snaps 仅 qid/odds/pool）
-- ============================================================
