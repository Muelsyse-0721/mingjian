/* ============================================================
 * 明鉴 · 纯校验模块（validate.js）
 * ------------------------------------------------------------
 * 设计约束（来自 Phase 1 架构事实）：
 *   - 没有自定义后端，唯一的“服务端”是带 RLS 的云数据库。
 *   - 本模块「只做纯逻辑校验」，无 DOM、无 DB 调用、不发任何请求。
 *   - 所有函数统一返回 { ok: boolean, error?: string }，
 *     供 online.js（Phase 2）在写库前做快速 UX 反馈。
 *   - 真正的强制保证由 agent B 的 RLS 策略 + 唯一约束负责，
 *     本模块不重复“强制”，只负责“早失败、好提示”。
 * ============================================================ */
var Validate = (function () {
  'use strict';

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  /* ---------- 1. 余额校验 ----------
   * 可用积分 = 现金(cash) + 已在该投注池中的金额(inPool)。
   * inPool 用于“改单复用”：用户已对同一选项有一笔未结算投注时，
   * 那部分金额可计入可用额度，避免重复扣减。
   * 返回 ok=false 表示余额不足或金额非法。 */
  function checkBalance(cash, inPool, betAmount) {
    cash = Number(cash); inPool = Number(inPool); betAmount = Number(betAmount);
    if (!isFiniteNum(cash) || !isFiniteNum(inPool) || !isFiniteNum(betAmount)) {
      return { ok: false, error: '金额数据异常' };
    }
    if (betAmount <= 0) return { ok: false, error: '投注额必须为正数' };
    var avail = cash + inPool;
    if (betAmount > avail) {
      return { ok: false, error: '积分不足：当前可用 ' + Math.floor(avail) + ' 分' };
    }
    return { ok: true };
  }

  /* ---------- 2. 重复投票校验 ----------
   * existingVotes: 该问题已有的公投记录数组 [{uid, qid, ...}]
   * 若 uid 已对 qid 投过票，返回 duplicate:true（真正的唯一保证
   * 在 agent B 的 DB 唯一约束，这里只做前端早失败）。 */
  function checkDupVote(existingVotes, uid, qid) {
    existingVotes = existingVotes || [];
    for (var i = 0; i < existingVotes.length; i++) {
      var v = existingVotes[i];
      if (v && v.uid === uid && v.qid === qid) {
        return { ok: false, error: '您已对该问题投过票', duplicate: true };
      }
    }
    return { ok: true, duplicate: false };
  }

  /* ---------- 3. 揭晓模式闸门 ----------
   * mode: 'manual' | 'search' | 'vote'
   * role: '站长' | 'admin' | 其他
   * 规则：search / vote 模式禁止手动发起揭晓；
   *       manual 模式仅允许 站长 直接揭晓。
   * 返回 ok=false 时 error 给出原因，online.js 直接提示即可。 */
  function checkSettleModeGate(mode, role) {
    if (mode !== 'manual') {
      var label = mode === 'search' ? '待平台检索' : (mode === 'vote' ? '公投' : mode);
      return { ok: false, error: '本问题为「' + label + '」揭晓，到期后按对应流程结算，不能手动发起。' };
    }
    if (role !== '站长' && role !== 'admin') {
      return { ok: false, error: '人工揭晓仅站长可发起' };
    }
    return { ok: true };
  }

  /* ---------- 4. 投注归属校验 ----------
   * bet.uid 必须等于当前 uid，防止越权操作他人投注。 */
  function checkBetOwnership(bet, uid) {
    if (!bet || typeof bet !== 'object') return { ok: false, error: '投注记录不存在' };
    if (bet.uid !== uid) return { ok: false, error: '只能操作自己的投注' };
    return { ok: true };
  }

  /* ---------- 5. 最小投注额校验（补充） ---------- */
  function checkMinBet(betAmount, minBet) {
    betAmount = Number(betAmount); minBet = Number(minBet);
    if (!isFiniteNum(betAmount) || !isFiniteNum(minBet)) return { ok: false, error: '金额数据异常' };
    if (betAmount < minBet) return { ok: false, error: '投注额最少 ' + minBet + ' 分' };
    return { ok: true };
  }

  /* ---------- 6. 公投选项校验（补充） ---------- */
  function checkVoteChoice(choice, outcomes) {
    outcomes = outcomes || [];
    for (var i = 0; i < outcomes.length; i++) {
      if (outcomes[i] && outcomes[i].id === choice) return { ok: true };
    }
    return { ok: false, error: '选项不存在' };
  }

  /* ---------- 7. 问题可投注校验（补充，now 单位 ms） ----------
   * 校验问题处于 open 且（若提供 now）未过截止时间。 */
  function checkQuestionOpen(q, now) {
    if (!q) return { ok: false, error: '问题不存在' };
    if (q.status !== 'open') return { ok: false, error: '问题已揭晓或不存在' };
    if (now != null) {
      var deadline = q.deadline ? Date.parse(q.deadline) : NaN;
      if (!isNaN(deadline) && now > deadline) return { ok: false, error: '已过截止日期，等待揭晓' };
    }
    return { ok: true };
  }

  return {
    checkBalance: checkBalance,
    checkDupVote: checkDupVote,
    checkSettleModeGate: checkSettleModeGate,
    checkBetOwnership: checkBetOwnership,
    checkMinBet: checkMinBet,
    checkVoteChoice: checkVoteChoice,
    checkQuestionOpen: checkQuestionOpen
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Validate;
