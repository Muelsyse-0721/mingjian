/* ============================================================
 * 明鉴 · 社区仲裁（ArbitCore 纯函数，联机版专用）
 * 已揭晓的问题，押过的人可以发起仲裁；任何人可质押投票；
 * 达到阈值后社区裁决成立（upheld/rejected），站长据此执行
 * 改判或驳回。改判 = 更新问题结果 + 按新结果原地重算每笔
 * 投注的派彩（现金/流水/榜单自动跟随），仲裁记录完整留痕。
 * 质押分在裁决时结算：押对边的一方分走押错边一方的质押。
 * ============================================================ */
var ArbitCore = (function () {
  'use strict';

  var MIN_VOTES = 3;        /* 至少 3 票才有效 */
  var AGREE_RATIO = 0.6;    /* 同意占比 ≥60% → 支持改判（upheld） */
  var MIN_STAKE = 10;       /* 单票质押下限 */
  var MAX_STAKE = 500;      /* 单票质押上限 */
  var REASON_MIN = 10;      /* 仲裁理由字数下限 */
  var REASON_MAX = 300;     /* 仲裁理由字数上限 */

  function round2(v) { return Math.round(v * 100) / 100; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---------- 争议查询 ---------- */
  function disputesOf(qid, disputes) {
    return (disputes || []).filter(function (d) { return d.qid === qid; });
  }

  /* 同一问题同时只允许一个进行中的争议 */
  function activeDisputeOf(qid, disputes) {
    var list = disputesOf(qid, disputes).filter(function (d) { return d.status === 'voting'; });
    return list.length ? list[0] : null;
  }

  /* 质押行的 qid 约定（与对线房 debate- 前缀同风格） */
  function stakeQid(disputeId) { return 'dispute-' + disputeId; }
  function isStakeQid(qid) { return typeof qid === 'string' && qid.indexOf('dispute-') === 0; }

  function stakeRowsOf(disputeId, bets) {
    var qid = stakeQid(disputeId);
    return (bets || []).filter(function (b) { return b.qid === qid; });
  }

  function myStakeOf(disputeId, uid, bets) {
    var rows = stakeRowsOf(disputeId, bets).filter(function (b) { return b.uid === uid; });
    return rows.length ? rows[0] : null;
  }

  function myVoteOf(disputeId, uid, votes) {
    var list = (votes || []).filter(function (v) {
      return v.dispute_id === disputeId && v.uid === uid;
    });
    return list.length ? list[0] : null;
  }

  /* ---------- 发起仲裁校验 ---------- */
  /* ctx: { q, bets, disputes, uid }；input: { reason, newResult } */
  function validateDispute(input, ctx) {
    ctx = ctx || {};
    var q = ctx.q;
    if (!q || q.status !== 'settled') return { ok: false, reason: '只能对已揭晓的问题发起仲裁' };
    if (!q.result) return { ok: false, reason: '问题尚未记录揭晓结果' };
    var newResult = String((input && input.newResult) || '');
    var hit = (q.outcomes || []).some(function (o) { return o.id === newResult; });
    if (!hit) return { ok: false, reason: '请选择提议改判的结果' };
    if (newResult === q.result) return { ok: false, reason: '提议结果与当前揭晓结果相同' };
    var reason = String((input && input.reason) || '').trim();
    if (reason.length < REASON_MIN) return { ok: false, reason: '仲裁理由至少 ' + REASON_MIN + ' 个字' };
    if (reason.length > REASON_MAX) return { ok: false, reason: '仲裁理由不超过 ' + REASON_MAX + ' 字' };
    /* 本人押过：对结果有切身关注，防止围观者滥诉 */
    var bet = (ctx.bets || []).some(function (b) {
      if (b.qid !== q.qid || b.uid !== ctx.uid) return false;
      /* 彩池投注与 LMSR 买入都算「押过」 */
      if (b.kind === 'buy') return num(b.shares) > 0 || num(b.stake) > 0;
      if (b.kind && b.kind !== 'bet') return false;
      return num(b.stake) > 0;
    });
    if (!bet) return { ok: false, reason: '只有押过这个问题的人可以发起仲裁' };
    /* 挑战窗口：揭晓后限时质疑，过了窗口结果即为最终（ctx.challenge 未传则跳过，兼容旧调用） */
    if (ctx.challenge && ctx.challenge.until && ctx.challenge.provisional === false) {
      return { ok: false, reason: '挑战窗口已关闭（' + ctx.challenge.hours + ' 小时），结果已定' };
    }
    /* 每问一次（已驳回的允许再次发起） */
    var mine = disputesOf(q.qid, ctx.disputes).filter(function (d) {
      return d.uid === ctx.uid && d.status !== 'dismissed';
    });
    if (mine.length) return { ok: false, reason: '你已经对这个问题发起过仲裁了' };
    /* 已有进行中的争议时，不重复开庭 */
    if (activeDisputeOf(q.qid, ctx.disputes)) return { ok: false, reason: '这个问题已有进行中的仲裁，等它结案再来' };
    return { ok: true };
  }

  /* ---------- 投票校验 ---------- */
  /* ctx: { dispute, votes, bets, uid }；input: { stake } */
  function validateVote(input, ctx) {
    ctx = ctx || {};
    var d = ctx.dispute;
    if (!d || d.status !== 'voting') return { ok: false, reason: '本仲裁不在投票中' };
    if (d.uid === ctx.uid) return { ok: false, reason: '不能对自己发起的仲裁投票' };
    if (myVoteOf(d.id, ctx.uid, ctx.votes)) return { ok: false, reason: '你已经投过了，一票制' };
    var stake = Math.floor(Number(input && input.stake));
    if (!(stake >= MIN_STAKE)) return { ok: false, reason: '质押至少 ' + MIN_STAKE + ' 分' };
    if (stake > MAX_STAKE) return { ok: false, reason: '单票质押最多 ' + MAX_STAKE + ' 分' };
    return { ok: true };
  }

  /* ---------- 计票与裁决 ---------- */
  function tallyOf(dispute, votes) {
    var list = (votes || []).filter(function (v) { return v.dispute_id === dispute.id; });
    var t = { agreeWeight: 0, rejectWeight: 0, agreeVotes: 0, rejectVotes: 0, totalVotes: list.length };
    list.forEach(function (v) {
      var w = num(v.weight);
      if (v.agree) { t.agreeWeight += w; t.agreeVotes++; }
      else { t.rejectWeight += w; t.rejectVotes++; }
    });
    t.agreeWeight = round2(t.agreeWeight);
    t.rejectWeight = round2(t.rejectWeight);
    t.totalWeight = round2(t.agreeWeight + t.rejectWeight);
    t.agreeRatio = t.totalWeight > 0 ? t.agreeWeight / t.totalWeight : 0;
    return t;
  }

  /* 裁决：票数不够 → pending；同意占比达标 → upheld；否则 rejected */
  function verdictOf(dispute, votes) {
    var t = tallyOf(dispute, votes);
    if (t.totalVotes < MIN_VOTES) return 'pending';
    return t.agreeRatio >= AGREE_RATIO ? 'upheld' : 'rejected';
  }

  function verdictLabel(v) {
    return { pending: '投票中', upheld: '支持改判', rejected: '维持原判' }[v] || v;
  }

  /* ---------- 质押结算 ---------- */
  /* 裁决成立时：押对边的一方分走押错边一方的质押（按质押占比分配） */
  function resolveStakesPlan(dispute, votes, bets) {
    var v = verdictOf(dispute, votes);
    if (v === 'pending') return null;
    var rows = stakeRowsOf(dispute.id, bets).filter(function (b) { return b.status === 'open'; });
    var winAgree = v === 'upheld';
    var winRows = rows.filter(function (b) {
      var vote = (votes || []).filter(function (x) { return x.dispute_id === dispute.id && x.uid === b.uid; })[0];
      return vote ? !!vote.agree === winAgree : false;
    });
    var loseRows = rows.filter(function (b) { return winRows.indexOf(b) === -1; });
    var winPool = round2(winRows.reduce(function (s, b) { return s + num(b.stake); }, 0));
    var losePool = round2(loseRows.reduce(function (s, b) { return s + num(b.stake); }, 0));
    var items = [];
    loseRows.forEach(function (b) {
      items.push({ bet: b, status: 'lost', payout: 0 });
    });
    if (losePool > 0 && winPool > 0 && winRows.length) {
      /* 按质押占比分配，余数给质押最大的一方（保证总和守恒） */
      var shares = winRows.map(function (b) {
        return { bet: b, share: Math.floor(losePool * num(b.stake) / winPool * 100) / 100 };
      });
      var given = round2(shares.reduce(function (s, x) { return s + x.share; }, 0));
      var rest = round2(losePool - given);
      if (rest > 0) {
        shares.sort(function (a, b) { return num(b.bet.stake) - num(a.bet.stake); });
        shares[0].share = round2(shares[0].share + rest);
      }
      shares.forEach(function (x) {
        items.push({ bet: x.bet, status: 'won', payout: round2(num(x.bet.stake) + x.share) });
      });
    } else {
      /* 无人押错边（或全票一边）：质押原样退回 */
      winRows.forEach(function (b) {
        items.push({ bet: b, status: 'won', payout: num(b.stake) });
      });
    }
    return { verdict: v, winPool: winPool, losePool: losePool, items: items };
  }

  /* 驳回争议：质押全额退回 */
  function refundPlan(dispute, bets) {
    return {
      items: stakeRowsOf(dispute.id, bets)
        .filter(function (b) { return b.status === 'open'; })
        .map(function (b) { return { bet: b, status: 'won', payout: num(b.stake) }; })
    };
  }

  /* ---------- 改判差额（原地重算派彩） ---------- */
  /* 以 newResult 重算最终赔率，逐笔给出应处的状态与派彩。
   * 只动 kind=bet 的原始投注行；现金/流水/榜单随之自动一致。 */
  function adjustPlan(q, bets, newResult, settleOddsFn) {
    var newOdds = settleOddsFn(q, bets, newResult);
    var items = [];
    (bets || []).forEach(function (b) {
      if (b.qid !== q.qid) return;
      if (b.kind && b.kind !== 'bet') return;      /* 奖励/质押等非投注行不重算 */
      if (b.status === 'open') return;             /* 未结清的不碰（已揭晓题不存在） */
      var shouldWin = b.outcome_id === newResult;
      var newPayout = shouldWin ? round2(num(b.stake) * newOdds) : 0;
      items.push({ bet: b, status: shouldWin ? 'won' : 'lost', payout: newPayout });
    });
    return { newOdds: round2(newOdds), newResult: newResult, items: items };
  }

  /* ---------- 展示辅助 ---------- */
  function phaseLabel(d) {
    return { voting: '投票中', resolved: '已改判', dismissed: '已驳回' }[d && d.status] || (d ? d.status : '');
  }

  /* 进度条数据：同意/反对占比 + 距生效还差多少票 */
  function progressOf(dispute, votes) {
    var t = tallyOf(dispute, votes);
    var need = Math.max(0, MIN_VOTES - t.totalVotes);
    var agreePct = t.totalWeight > 0 ? Math.round(t.agreeRatio * 100) : 0;
    return {
      agreeWeight: t.agreeWeight, rejectWeight: t.rejectWeight,
      agreeVotes: t.agreeVotes, rejectVotes: t.rejectVotes,
      agreePct: agreePct, needVotes: need,
      text: t.agreeVotes + ' 票同意（' + agreePct + '%） / ' + t.rejectVotes + ' 票反对' +
        (need > 0 ? ' · 还差 ' + need + ' 票生效' : ' · 已满足票数')
    };
  }

  /* 站长队列用：按「待执行 > 投票中 > 已结案」排序 */
  function adminSort(disputes, votes) {
    var rank = { upheld: 0, voting: 1, rejected: 2, resolved: 3, dismissed: 4 };
    return (disputes || []).slice().sort(function (a, b) {
      var va = a.status === 'voting' ? verdictOf(a, votes) : a.status;
      var vb = b.status === 'voting' ? verdictOf(b, votes) : b.status;
      var ra = rank[va] == null ? 9 : rank[va];
      var rb = rank[vb] == null ? 9 : rank[vb];
      if (ra !== rb) return ra - rb;
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1;
    });
  }

  return {
    MIN_VOTES: MIN_VOTES, AGREE_RATIO: AGREE_RATIO,
    MIN_STAKE: MIN_STAKE, MAX_STAKE: MAX_STAKE,
    REASON_MIN: REASON_MIN, REASON_MAX: REASON_MAX,
    disputesOf: disputesOf, activeDisputeOf: activeDisputeOf,
    stakeQid: stakeQid, isStakeQid: isStakeQid,
    stakeRowsOf: stakeRowsOf, myStakeOf: myStakeOf, myVoteOf: myVoteOf,
    validateDispute: validateDispute, validateVote: validateVote,
    tallyOf: tallyOf, verdictOf: verdictOf, verdictLabel: verdictLabel,
    resolveStakesPlan: resolveStakesPlan, refundPlan: refundPlan,
    adjustPlan: adjustPlan, phaseLabel: phaseLabel,
    progressOf: progressOf, adminSort: adminSort
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ArbitCore;
}
