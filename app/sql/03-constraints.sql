-- ============================================================
-- 03-constraints.sql
-- 明鉴 · DB 层防作弊唯一约束（一人一票）
--
-- 目的：在数据库层强制「同一用户对每个标的仅一票」，弥补前端
--       “一人一票”仅靠客户端校验（mine 查找 / validateVote）的不足，
--       防止并发竞态或越权写入产生重复票。
--
-- 列名来源（grep 代码核对）：
--   · jp_public_votes  问题 id 列 = qid      （online.js:626-627）
--   · jp_dispute_votes 争议 id 列 = dispute_id（online.js:2465-2467）
--
-- 幂等性：用 DO 块先查 pg_constraint 是否存在，避免重复 ADD 报错
--   （PostgreSQL 的 ALTER TABLE ... ADD CONSTRAINT 不支持 IF NOT EXISTS）。
--
-- ⚠️ 执行前必须做重复数据预检（见文末 PRE-CHECK）。若历史数据已存在
--   同一 (uid, 标的) 的多行，ADD CONSTRAINT 会失败；需先去重再应用。
--   本脚本只产出 SQL，绝不执行；预检 / 去重由 DBA 在线上库手动完成。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 应用唯一约束（幂等）
-- ------------------------------------------------------------
DO $$
BEGIN

  -- jp_public_votes：每个用户对每个问题仅一票
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_jp_public_votes_uid_qid'
  ) THEN
    ALTER TABLE jp_public_votes
      ADD CONSTRAINT uq_jp_public_votes_uid_qid UNIQUE (uid, qid);
  END IF;

  -- jp_dispute_votes：每个用户对每个争议仅一票
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_jp_dispute_votes_uid_dispute'
  ) THEN
    ALTER TABLE jp_dispute_votes
      ADD CONSTRAINT uq_jp_dispute_votes_uid_dispute UNIQUE (uid, dispute_id);
  END IF;

END $$;

-- ============================================================
-- PRE-CHECK（执行前在线上库手动运行；若返回行数 > 0，必须先去重）
-- ============================================================
-- -- 公投重复票：
-- SELECT uid, qid, count(*) AS n
--   FROM jp_public_votes
--  GROUP BY uid, qid
-- HAVING count(*) > 1
--  ORDER BY n DESC;
--
-- -- 争议重复票：
-- SELECT uid, dispute_id, count(*) AS n
--   FROM jp_dispute_votes
--  GROUP BY uid, dispute_id
-- HAVING count(*) > 1
--  ORDER BY n DESC;
--
-- 去重思路（示例，须 DBA 评审后执行，保留最新一行）：
--   DELETE FROM jp_public_votes a
--    USING jp_public_votes b
--    WHERE a.uid = b.uid AND a.qid = b.qid
--      AND a.ctid < b.ctid;   -- 保留 ctid 较大（较晚）的行
--   （jp_dispute_votes 同理，按 dispute_id 替换）
-- ============================================================

-- ============================================================
-- 产品注意点（需 owner 确认）
-- ============================================================
-- · jp_public_votes 前端允许「截止前改票」（online.js:623 走 update 而非
--   新 insert），UNIQUE(uid, qid) 与之兼容：改票是更新同一行，不新增。
-- · jp_dispute_votes 当前前端为「每次投票 insert 新行」(online.js:2472)，
--   且 ArbitCore.validateVote 应已阻止同一用户对同一争议重复投票。
--   若产品未来希望「允许用户改质押额 = 重新投票」，则 UNIQUE(uid, dispute_id)
--   会与“改票=新 insert”冲突，需改为“改票=update 原行”或放宽约束。
--   当前按任务要求强制一人一票，请确认前端投票流不会因约束报错。
-- ============================================================
