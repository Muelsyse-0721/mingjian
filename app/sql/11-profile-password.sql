-- ============================================================
-- 11-profile-password.sql
-- 明鉴 · 个人中心字段补丁（jp_profiles）
--
-- 用途：给 jp_profiles 补三列，供「个人中心」展示：
--   password_set  BOOLEAN     本账号是否设置过密码（仅本地标记，见下）
--   last_login_at TIMESTAMPTZ 最近一次成功登录时间（登录成功后由客户端写）
--   bio           TEXT        个人简介（前端截断到 80 字，见 js/profile.js BIO_MAX）
--
-- ★ password_set 的性质：它只是「本地标记」，不是密码存储 ★
--   真实密码由 auth provider（WorkBuddy Cloud 认证服务）持有并校验，
--   本表**不存、也不该存**任何密码、密码哈希或盐。
--   password_set 的唯一作用是让个人中心显示「已设密码 / 未设密码」，
--   避免每次渲染都去猜。它被篡改的最坏后果是：UI 显示错误的状态徽标，
--   不会影响任何鉴权结果（登录仍以 provider 为准）。
--
-- ★ 为什么密码只能在新号注册时设置 ★
--   SDK 的 signUp 必须携带 verificationToken（先 sendOtp + verifyOtp 取得），
--   且没有通用的 updateUser({password})；resetPasswordForEmail 只支持 email，
--   而本项目账号是手机号。因此历史「验证码注册」的老账号无法补设密码，
--   个人中心必须如实提示，不得提供「设置密码」按钮。
--   参考：app/js/auth.js 顶部注释、app/js/profile.js#composePasswordHint。
--
-- 列级 GRANT 判断依据（不要重复加）：
--   app/sql/02-rls-tighten.sql 的 DO 块对 jp_profiles 执行了
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.jp_profiles TO authenticated;
--   即**表级** UPDATE 授权已覆盖未来新增的列（PostgreSQL 的表级 GRANT
--   不按列快照，新增列自动纳入），因此本脚本**不需要**再写列级
--   GRANT UPDATE (password_set, last_login_at, bio)。仅当线上实例被手工
--   改成「列级授权」形态时，才需要执行文末注释里的补救语句。
--
-- 前置条件：已执行 02-rls-tighten.sql（jp_profiles 及其 RLS 策略由它创建）。
-- 执行顺序：11-profile-password.sql 应在 02-rls-tighten.sql 之后执行。
--
-- 幂等性：ADD COLUMN IF NOT EXISTS + DO 块内判重 + UPDATE 收敛，
--         整份脚本可安全重跑。
--
-- ⚠️ 本脚本只产出 SQL，绝不执行。线上变更须 product owner 确认后
--    由 DBA 用 genie-baas 执行。
-- ============================================================

-- ------------------------------------------------------------
-- 0) 前置检查：jp_profiles 必须存在
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.jp_profiles') IS NULL THEN
    RAISE EXCEPTION
      'public.jp_profiles 不存在：请先执行 app/sql/02-rls-tighten.sql，再执行本脚本';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1) 新增列（幂等）
--    password_set 用 NOT NULL DEFAULT false：老行自动落到「未设密码」，
--    避免 NULL 在 UI 上被误判成三态。
-- ------------------------------------------------------------
ALTER TABLE public.jp_profiles
  ADD COLUMN IF NOT EXISTS password_set  BOOLEAN     NOT NULL DEFAULT false;

ALTER TABLE public.jp_profiles
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE public.jp_profiles
  ADD COLUMN IF NOT EXISTS bio           TEXT;

-- ------------------------------------------------------------
-- 2) 把历史 NULL 收敛为 false
--    （ADD COLUMN ... DEFAULT false 已覆盖新增列；这一条是为「曾被手工
--      ALTER 成本列可空」的实例兜底，正常实例上影响 0 行。）
--    ★ password_set 只是本地展示标记：真实密码在 auth provider，
--      这里不写入也不推断任何凭据信息。
-- ------------------------------------------------------------
UPDATE public.jp_profiles
   SET password_set = false
 WHERE password_set IS NULL;

-- ------------------------------------------------------------
-- 3) 简介长度约束（与 app/js/profile.js 的 BIO_MAX=80 对齐）
--    幂等：先查 pg_constraint 再 ADD。
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jp_profiles_bio_len'
       AND conrelid = 'public.jp_profiles'::regclass
  ) THEN
    ALTER TABLE public.jp_profiles
      ADD CONSTRAINT jp_profiles_bio_len
      CHECK (bio IS NULL OR char_length(bio) <= 80);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) 字段说明（COMMENT 可重复执行，覆盖旧注释）
-- ------------------------------------------------------------
COMMENT ON COLUMN public.jp_profiles.password_set IS
  '是否设置过密码（仅本地展示标记；真实密码在 auth provider，本表不存凭据）。密码只能在新号注册时设置，老账号无法补设。';

COMMENT ON COLUMN public.jp_profiles.last_login_at IS
  '最近一次成功登录时间（客户端在 signIn/verify 成功后写入；仅用于个人中心展示，不作鉴权依据）。';

COMMENT ON COLUMN public.jp_profiles.bio IS
  '个人简介，≤80 字符（前端 profile.js 的 BIO_MAX 截断，DB 侧 CHECK 兜底）。';

-- ------------------------------------------------------------
-- 5) RLS / 授权：无需改动
--    jp_profiles 已在 02-rls-tighten.sql 中：
--      · ENABLE ROW LEVEL SECURITY
--      · anon 仅 SELECT
--      · authenticated 表级 SELECT/INSERT/UPDATE/DELETE
--      · owner 策略：uid = auth.uid()::text
--    新增列自动落在这套策略内（表级 GRANT + 行级策略与列无关），
--    因此本人可读写自己的 bio，读不到他人档案。
--    仅当线上被改成列级授权、出现 42501 时才需要执行：
--      GRANT UPDATE (password_set, last_login_at, bio)
--        ON TABLE public.jp_profiles TO authenticated;
--      GRANT SELECT (uid, nickname, password_set, last_login_at, bio)
--        ON TABLE public.jp_profiles TO anon;
-- ------------------------------------------------------------
