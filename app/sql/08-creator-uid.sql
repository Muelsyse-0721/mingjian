-- ============================================================
-- 08-creator-uid.sql
-- 明鉴 · 出题人身份列（creator_uid）
--
-- 背景：jp_questions 只有 creator_name（昵称），"每人同时进行建题数上限"
--       在前端按昵称过滤（online.js 的 createQuestion → mineOpen），
--       改个昵称即可绕过。本脚本补上不可伪造的 creator_uid，
--       让限额统计与归属判定有稳定锚点。
--
-- 内容：① 加列（幂等） ② 建索引（幂等） ③ best-effort 回填历史行
--       RLS 不变 —— jp_questions 的既有策略见 02-rls-tighten.sql，
--       本脚本不新增/不删除任何策略、不改动 GRANT。
--
-- ⚠️ 本脚本只产出 SQL，绝不执行。线上变更须 product owner 确认后
--    由 DBA 用 genie-baas 执行。
--
-- 执行顺序：可在 02-rls-tighten.sql 之后任意时点执行（独立变更）。
-- 幂等性：ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
--        回填使用 IS NULL 条件，可重复执行（第二次影响 0 行）。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 加列
--    类型与既有 uid 列保持一致（TEXT，非 uuid）：auth.uid() 在查询侧
--    统一用 auth.uid()::text 比较（与 02-rls-tighten.sql 的约定一致）。
--    不设 NOT NULL：历史行回填不全（见第 3 节），且新建行在
--    online.js 接线前仍可能缺该值；强制非空会直接打断建题流程。
--    deliberately 不加 FK 到 auth.users：跨 schema 引用会绑定平台实现。
-- ------------------------------------------------------------
ALTER TABLE public.jp_questions
  ADD COLUMN IF NOT EXISTS creator_uid TEXT;

COMMENT ON COLUMN public.jp_questions.creator_uid IS
  '出题人 auth uid（= auth.uid()::text）。用于建题限额归属；历史行按昵称尽力回填，可能为 NULL。';

-- ------------------------------------------------------------
-- 2) 索引
--    用途：按 creator_uid 统计"该用户 open 题数"（限额校验）
--          与后台按人筛选。单列即可，配合 status 的过滤走位图扫描。
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_jp_questions_creator_uid
  ON public.jp_questions (creator_uid);

-- ------------------------------------------------------------
-- 3) 历史数据回填（best-effort）
--
--    匹配依据：jp_profiles.nickname → jp_profiles.uid
--
--    风险：昵称不是唯一键（jp_profiles.nickname 无 UNIQUE 约束），
--          同一昵称可能对应多个 uid（改过名的历史残留、或故意重名）。
--          盲目按昵称匹配会把题目错记到别人名下 —— 错记的影响不只是
--          显示，还会让被错记的人凭空多占限额。
--
--    因此本脚本采取保守策略：只回填"昵称在 jp_profiles 中唯一对应
--    一个 uid"的行；重名昵称一律留 NULL（宁可统计不到，不可错记）。
--    留 NULL 的行在前端按 creator_name 兜底统计，行为与改动前一致。
--
--    说明：本脚本执行时不要求 jp_profiles 存在同名唯一索引；下方
--    HAVING count(*) = 1 在查询内自证唯一性。
-- ------------------------------------------------------------
UPDATE public.jp_questions q
   SET creator_uid = p.uid
  FROM (
    SELECT nickname,
           min(uid) AS uid          -- count = 1 时 min 即唯一值
      FROM public.jp_profiles
     WHERE nickname IS NOT NULL
       AND nickname <> ''
     GROUP BY nickname
    HAVING count(*) = 1
  ) p
 WHERE q.creator_uid IS NULL
   AND q.creator_name = p.nickname;

-- 若产品接受"重名按最近更新的档案归属"的猜测口径，可改用下面这段
-- （与上面互斥，二选一；默认不启用）：
--
--   UPDATE public.jp_questions q
--      SET creator_uid = p.uid
--     FROM (
--       SELECT DISTINCT ON (nickname) nickname, uid
--         FROM public.jp_profiles
--        WHERE nickname IS NOT NULL AND nickname <> ''
--        ORDER BY nickname, updated_at DESC NULLS LAST, uid
--     ) p
--    WHERE q.creator_uid IS NULL
--      AND q.creator_name = p.nickname;

-- ============================================================
-- 执行前 / 执行后 PRE-CHECK（手动运行；只读查询）
-- ============================================================
-- 1) 确认列已存在且类型为 text
--      SELECT column_name, data_type, is_nullable
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'jp_questions'
--         AND column_name IN ('creator_name', 'creator_uid');
--
-- 2) 回填覆盖率（expected: legacy = 历史题数，null_left = 未能归属数）
--      SELECT count(*) FILTER (WHERE creator_uid IS NULL)      AS null_left,
--             count(*) FILTER (WHERE creator_uid IS NOT NULL)  AS filled,
--             count(*)                                         AS total
--        FROM public.jp_questions;
--
-- 3) 哪些昵称存在重名（这些题会被保守策略跳过）
--      SELECT nickname, count(*) AS profiles
--        FROM public.jp_profiles
--       GROUP BY nickname HAVING count(*) > 1
--       ORDER BY profiles DESC;
--
-- 4) 抽查：某 uid 名下题目的昵称是否自洽
--      SELECT creator_uid, creator_name, count(*)
--        FROM public.jp_questions
--       WHERE creator_uid IS NOT NULL
--       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20;
-- ============================================================

-- ============================================================
-- 接线提示（前端改动不在本脚本范围，仅供主 Agent 实施）
-- ============================================================
-- · 建题写入：online.js createQuestion 的 insert 对象里补
--     creator_uid: state.uid
--   （与 creator_name 并存：昵称仅作展示，归属/限额一律看 uid）
--
-- · 限额统计：把
--     state.questions.filter(q => q.status === 'open' && q.creator_name === state.nickname)
--   改为按 creator_uid 统计：
--     state.questions.filter(q => q.status === 'open' && q.creator_uid === state.uid)
--   兼容过渡期（历史行 creator_uid 为 NULL）可写成
--     (q.creator_uid ? q.creator_uid === state.uid
--                    : q.creator_name === state.nickname)
--   注意：这只是前端提示性校验，真正防绕过仍应靠 RLS/触发器/服务端
--   约束；本脚本不承担该职责。
--
-- · 读取：select('*') 已含新列，无需改列清单；如前端有显式列清单，
--   记得加上 creator_uid。
-- ============================================================
