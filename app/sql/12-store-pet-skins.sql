-- ============================================================
-- 12-store-pet-skins.sql
-- 明鉴 · 桌宠皮肤上架（阶段4 · 商城扩充）
--
-- 内容：
--   ① 结论先行：皮肤目录由前端 app/js/store.js 的 PET_SKINS 提供，
--      当前项目内**没有** jp_store_items 表，因此不需要建表；
--      若将来该表存在，本脚本会幂等地补 9 条商品行。
--   ② 幂等确认 jp_user_items.equipped 的**列级** UPDATE 授权
--      （来源 app/sql/09-equip.sql）；缺失则补，且绝不给表级 UPDATE。
--
-- ★ 红线（与 05 / 06 / 07 / 09 一脉相承）★
--   · 皮肤只用「积分」结算，本脚本不建任何价格/余额/支付字段；
--   · 不写任何真实 uid / 手机号 / 用户标识；
--   · 不建 UPDATE / DELETE 策略 → 持有关系仍不可转卖、不可回售；
--   · 本脚本不含任何真实货币语义，也不提供退款通道。
--
-- 关联前端：
--   目录   —— app/js/store.js → PET_SKINS（9 条，Object.freeze）
--   购买   —— StoreCore.composePurchase() → jp_bets（扣分）+ jp_user_items（持有）+ jp_store_orders（订单）
--   换装   —— StoreCore.composeSkinPatch(uid, skinId, isEquipped) → 只更新 equipped 一列
--   玩家说明 —— docs/15-商城与会员说明.md
--
-- ⚠️ 本脚本只产出 SQL，绝不执行。线上变更须 product owner 确认后
--    由 DBA 用 genie-baas 执行。
--
-- 幂等性：全部逻辑包在 DO 块内，靠 information_schema 判断后执行；
--         重复执行不会重复插行、不会重复授权、不会报错。
-- 执行顺序：必须在 06-store-items.sql 与 09-equip.sql 之后执行。
-- ============================================================

-- ------------------------------------------------------------
-- 0) 目录事实（只读参考，供 DBA 核对，不参与执行）
--
--    id                    name                    price  character  variant
--    skin-claude-normal    Claude 桌宠 · 正常号     800    Claude     normal
--    skin-claude-mini      Claude 桌宠 · 小号       500    Claude     mini
--    skin-gpt-normal       GPT 桌宠 · 正常号        800    GPT        normal
--    skin-gpt-mini         GPT 桌宠 · 小号          500    GPT        mini
--    skin-gemini           Gemini 桌宠              600    Gemini     normal
--    skin-grok             Grok 桌宠                600    Grok       normal
--    skin-kimi             Kimi 桌宠                600    Kimi       normal
--    skin-glm              智谱桌宠                 600    智谱       normal
--    skin-qwen             千问桌宠                 600    千问       normal
--
--    kind 统一为 'pet-skin'，与旧装饰共用「同类单槽」换装规则；
--    价格唯一来源是 store.js，SQL 若与前端不一致，以前端为准。
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1) 若 jp_store_items 存在，幂等补 9 条皮肤商品行
--
--    为什么先判断表存在：本项目 05-store.sql 只建了订单表
--    jp_store_orders 与持有表 jp_user_items，并没有 jp_store_items。
--    商品目录是「代码即目录」（store.js 的 COSMETICS / PET_SKINS），
--    数据库只存订单与持有关系。故本段对当前库是空操作。
--
--    表存在时也只插入 id/name/kind/price 四列，且要求四列都存在，
--    避免撞上未来不同结构的同名表；用 NOT EXISTS 去重，不依赖
--    表上是否真的有 id 唯一约束。
-- ------------------------------------------------------------
DO $$
DECLARE
  has_table   boolean;
  has_columns boolean;
  inserted    integer;
BEGIN
  has_table := to_regclass('public.jp_store_items') IS NOT NULL;

  IF NOT has_table THEN
    RAISE NOTICE 'jp_store_items 不存在：皮肤目录由前端 store.js 的 PET_SKINS 提供，本段跳过（预期行为）';
    RETURN;
  END IF;

  SELECT count(*) = 4 INTO has_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'jp_store_items'
     AND column_name IN ('id', 'name', 'kind', 'price');

  IF NOT has_columns THEN
    RAISE NOTICE 'jp_store_items 结构与预期(id/name/kind/price)不符：不插入，请人工核对后再改本脚本';
    RETURN;
  END IF;

  INSERT INTO public.jp_store_items (id, name, kind, price)
  SELECT s.id, s.name, s.kind, s.price
    FROM jsonb_to_recordset($j$[
      {"id":"skin-claude-normal","name":"Claude 桌宠 · 正常号","kind":"pet-skin","price":800},
      {"id":"skin-claude-mini","name":"Claude 桌宠 · 小号","kind":"pet-skin","price":500},
      {"id":"skin-gpt-normal","name":"GPT 桌宠 · 正常号","kind":"pet-skin","price":800},
      {"id":"skin-gpt-mini","name":"GPT 桌宠 · 小号","kind":"pet-skin","price":500},
      {"id":"skin-gemini","name":"Gemini 桌宠","kind":"pet-skin","price":600},
      {"id":"skin-grok","name":"Grok 桌宠","kind":"pet-skin","price":600},
      {"id":"skin-kimi","name":"Kimi 桌宠","kind":"pet-skin","price":600},
      {"id":"skin-glm","name":"智谱桌宠","kind":"pet-skin","price":600},
      {"id":"skin-qwen","name":"千问桌宠","kind":"pet-skin","price":600}
    ]$j$::jsonb) AS s(id text, name text, kind text, price integer)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.jp_store_items t WHERE t.id = s.id
   );

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RAISE NOTICE 'jp_store_items 已存在：本次新增 % 条皮肤（幂等，重复执行应为 0）', inserted;
END $$;

-- ------------------------------------------------------------
-- 2) 换装授权自检：jp_user_items.equipped 的列级 UPDATE
--
--    09-equip.sql 的正确终态是：
--      · 无表级 UPDATE（表级 UPDATE 是"全列"语义，会架空列级限制）；
--      · 有列级 GRANT UPDATE (equipped) TO authenticated；
--      · 有 FOR UPDATE 策略（09 负责，本脚本不改策略）。
--
--    本段只做"幂等补齐"，防止有人重跑 06-store-items.sql（其 DO 块
--    会 DROP 全部策略并 REVOKE 表级权限）后忘了重跑 09：
--      · 若仍有表级 UPDATE → 先收回；
--      · 若缺 equipped 列级授权 → 补授。
--    仍然不授 INSERT 之外的任何写权限，也不给 anon 任何权限。
-- ------------------------------------------------------------
DO $$
DECLARE
  has_table       boolean;
  has_col         boolean;
  has_col_grant   boolean;
  has_table_grant boolean;
BEGIN
  has_table := to_regclass('public.jp_user_items') IS NOT NULL;

  IF NOT has_table THEN
    RAISE NOTICE 'jp_user_items 不存在：请先执行 06-store-items.sql，本段跳过';
    RETURN;
  END IF;

  SELECT count(*) = 1 INTO has_col
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'jp_user_items'
     AND column_name  = 'equipped';

  IF NOT has_col THEN
    RAISE NOTICE 'jp_user_items 缺少 equipped 列：结构与 06-store-items.sql 不符，本段跳过，请人工核对';
    RETURN;
  END IF;

  -- 2.1 收回表级 UPDATE（若有），避免列级限制失效
  SELECT count(*) > 0 INTO has_table_grant
    FROM information_schema.role_table_grants
   WHERE table_schema   = 'public'
     AND table_name     = 'jp_user_items'
     AND grantee        = 'authenticated'
     AND privilege_type = 'UPDATE';

  IF has_table_grant THEN
    EXECUTE 'REVOKE UPDATE ON TABLE public.jp_user_items FROM authenticated';
    RAISE NOTICE '已收回 jp_user_items 的表级 UPDATE（表级=全列，会架空列级授权）';
  END IF;

  -- 2.2 缺列级 equipped 授权则补
  SELECT count(*) > 0 INTO has_col_grant
    FROM information_schema.column_privileges
   WHERE table_schema   = 'public'
     AND table_name     = 'jp_user_items'
     AND grantee        = 'authenticated'
     AND privilege_type = 'UPDATE'
     AND column_name    = 'equipped';

  IF NOT has_col_grant THEN
    EXECUTE 'GRANT UPDATE (equipped) ON TABLE public.jp_user_items TO authenticated';
    RAISE NOTICE '已补授 jp_user_items.equipped 的列级 UPDATE';
  ELSE
    RAISE NOTICE 'jp_user_items.equipped 列级 UPDATE 已存在，无需变更';
  END IF;

  -- 2.3 anon 一律不授（与 06 / 09 一致，显式兜底）
  EXECUTE 'REVOKE ALL ON TABLE public.jp_user_items FROM anon';
END $$;

-- ============================================================
-- 执行后 PRE-CHECK（手动运行；只读查询）
-- ============================================================
-- 1) 确认没有表级 UPDATE 残留（应查不到 authenticated / UPDATE 的表级行）
--      SELECT grantee, privilege_type
--        FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'jp_user_items'
--       ORDER BY grantee, privilege_type;
--
-- 2) 确认列级 UPDATE 只有 equipped
--      SELECT grantee, column_name, privilege_type
--        FROM information_schema.column_privileges
--       WHERE table_schema = 'public' AND table_name = 'jp_user_items'
--         AND privilege_type = 'UPDATE';
--
-- 3) 确认换装策略存在（09 负责；本脚本不建）
--      SELECT policyname, cmd, roles, qual, with_check
--        FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'jp_user_items';
--
-- 4) 若 jp_store_items 存在，确认 9 条皮肤齐备（应为 9 行 / 价格合计 5400）
--      SELECT count(*) AS n, sum(price) AS total
--        FROM public.jp_store_items
--       WHERE kind = 'pet-skin';
-- ============================================================

-- ============================================================
-- 产品注意点
-- ============================================================
-- · 皮肤与旧装饰同权：纯展示，不加速任何 AI 调用、不加次数、不改赔率；
-- · 同一时刻只装备一件（含旧装饰），换装按「先卸后装」两步走，
--   顺序反了会短时出现两件同时 equipped=true；
-- · 已被 DBA 执行过 09 的环境，本脚本第 2 段只打印 NOTICE，不产生变更；
-- · 若将来真的引入 jp_store_items，请把它当作"目录投影"而非价格权威，
--   价格仍以 store.js 为唯一来源，避免两处价格漂移。
-- ============================================================
