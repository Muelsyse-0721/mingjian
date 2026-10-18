/* ============================================================
 * 明鉴 · 邀请制对线房（DebateCore 纯函数，联机版专用）
 * 玩法：两人就一个话题对线，逐轮发言；AI 按五维（论据/逻辑/针对性/
 *       增量/礼仪，各 20 分）给每轮打分；观众可押「整场谁辩得更好」。
 * 与 Polymarket 的差异：这里评的是「怎么辩」，不是「猜结果」。
 * ============================================================ */
var DebateCore = (function () {
  'use strict';

  var DEBATE_FEE = 0.05;        /* 观众押注抽水 */
  var DEFAULT_MAX_ROUNDS = 6;
  var DIMS = ['evidence', 'logic', 'relevance', 'addition', 'manner'];
  var DIM_LABELS = { evidence: '论据', logic: '逻辑', relevance: '针对性', addition: '增量', manner: '礼仪' };

  function round2(v) { return Math.round(v * 100) / 100; }
  function tsOf(t) { var v = t ? new Date(t).getTime() : 0; return isFinite(v) ? v : 0; }

  /* ---------- 房间校验 ---------- */
  function validateRoom(input) {
    var topic = String((input && input.topic) || '').trim();
    var a = String((input && input.sideA) || '').trim();
    var b = String((input && input.sideB) || '').trim();
    if (topic.length < 4) return { ok: false, reason: '话题至少 4 个字' };
    if (topic.length > 80) return { ok: false, reason: '话题不超过 80 个字' };
    if (a.length < 2 || b.length < 2) return { ok: false, reason: '双方立场各至少 2 个字' };
    if (a.length > 40 || b.length > 40) return { ok: false, reason: '立场描述不超过 40 个字' };
    var rounds = Math.floor(Number(input && input.maxRounds) || DEFAULT_MAX_ROUNDS);
    if (!(rounds >= 1 && rounds <= 12)) return { ok: false, reason: '轮次数 1-12' };
    var code = String((input && input.inviteCode) || '').trim();
    if (code && !/^[A-Za-z0-9-]{4,16}$/.test(code)) return { ok: false, reason: '邀请码为 4-16 位字母数字' };
    return {
      ok: true,
      room: {
        topic: topic, side_a: a, side_b: b,
        max_rounds: rounds, invite_code: code,
        deadline: String((input && input.deadline) || '').slice(0, 10)
      }
    };
  }

  /* ---------- 阶段 ---------- */
  /* open=布场 | live=辩论中 | overdue=已截止待揭晓 | finished=轮次用完待揭晓 | settled=已揭晓 */
  function phaseOf(room, posts, now) {
    if (!room) return 'open';
    if (room.status === 'settled') return 'settled';
    if (room.status === 'open') return 'open';
    var rounds = postsOf(room, posts);
    if (rounds.length >= Number(room.max_rounds || DEFAULT_MAX_ROUNDS) &&
        rounds.every(function (r) { return r.a && r.b; })) return 'finished';
    if (room.deadline) {
      var d = new Date(now || Date.now());
      function p(n) { return (n < 10 ? '0' : '') + n; }
      var today = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      if (room.deadline < today) return 'overdue';
    }
    return 'live';
  }

  /* 该房间的全部发言，按轮次分组 */
  function postsOf(room, posts) {
    var mine = (posts || []).filter(function (p) { return p.did === room.did; });
    var byRound = {};
    mine.forEach(function (p) {
      var r = byRound[p.round_no] || (byRound[p.round_no] = { round: p.round_no, a: null, b: null });
      if (p.side === 'a' && !r.a) r.a = p;
      if (p.side === 'b' && !r.b) r.b = p;
    });
    return Object.keys(byRound).map(function (k) { return byRound[k]; })
      .sort(function (x, y) { return x.round - y.round; });
  }

  /* 当前进行到第几轮（1 起） */
  function currentRoundOf(room, posts) {
    var rounds = postsOf(room, posts);
    var complete = rounds.filter(function (r) { return r.a && r.b; }).length;
    return Math.min(complete + 1, Number(room.max_rounds || DEFAULT_MAX_ROUNDS));
  }

  /* 现在轮到谁发言：都没发→任意一方；一方已发→另一方；都发了→null（等下一轮） */
  function nextActor(room, posts) {
    var r = currentRoundOf(room, posts);
    var rounds = postsOf(room, posts).filter(function (x) { return x.round === r; })[0];
    if (!rounds) return 'any';
    if (rounds.a && !rounds.b) return 'b';
    if (rounds.b && !rounds.a) return 'a';
    return null;
  }

  /* 能否发言：房主可任选一方（左右互搏/演示），其他参与者只能发自己一方 */
  function canPost(room, posts, uid, side) {
    if (phaseOf(room, posts) !== 'live') return { ok: false, reason: '辩论未开始或已结束' };
    var actor = nextActor(room, posts);
    if (!actor) return { ok: false, reason: '本轮双方都已发言，等待下一轮' };
    if (actor !== 'any' && actor !== side) return { ok: false, reason: '现在轮到对方发言' };
    var r = currentRoundOf(room, posts);
    var rounds = postsOf(room, posts).filter(function (x) { return x.round === r; })[0];
    if (rounds && rounds[side]) return { ok: false, reason: '你本轮已经发言过了' };
    return { ok: true, round: r };
  }

  /* ---------- 赔率（观众押 a/b，彩池式） ---------- */
  function poolOf(room, bets) {
    var pools = { a: 0, b: 0 }, total = 0;
    (bets || []).forEach(function (b) {
      if (b.did !== room.did || b.status !== 'open') return;
      pools[b.bet_on] = (pools[b.bet_on] || 0) + Number(b.stake);
      total += Number(b.stake);
    });
    return { pools: pools, total: total };
  }

  function oddsOf(room, bets) {
    var r = poolOf(room, bets);
    function odds(side) {
      return r.pools[side] > 0 ? r.total * (1 - DEBATE_FEE) / r.pools[side] : 0;
    }
    return { a: round2(odds('a')), b: round2(odds('b')), pools: r.pools, total: r.total };
  }

  function potentialPayout(room, bets, side, stake) {
    var r = poolOf(room, bets);
    var winPool = r.pools[side] + stake;
    var total = r.total + stake;
    if (winPool <= 0) return round2(stake * 2);
    return round2(stake * total * (1 - DEBATE_FEE) / winPool);
  }

  /* 揭晓最终赔率：result 优先 */
  function settleOdds(room, bets, result) {
    var r = poolOf(room, bets);
    if (result === 'draw') return 1;
    return r.pools[result] > 0 ? round2(r.total * (1 - DEBATE_FEE) / r.pools[result]) : 0;
  }

  /* 结算方案：result=a/b 按赔率派彩；draw 全额退还（payout=stake） */
  function settlePlan(room, bets, result) {
    var finalOdds = settleOdds(room, bets, result);
    return (bets || []).filter(function (b) { return b.did === room.did && b.status === 'open'; })
      .map(function (b) {
        if (result === 'draw') return { bet: b, status: 'won', payout: round2(Number(b.stake)) };
        if (b.bet_on === result) return { bet: b, status: 'won', payout: round2(Number(b.stake) * finalOdds) };
        return { bet: b, status: 'lost', payout: 0 };
      });
  }

  /* ---------- AI 五维评分 ---------- */
  function totalOfScore(s) {
    if (!s) return 0;
    return DIMS.reduce(function (sum, k) { return sum + (Number(s[k]) || 0); }, 0);
  }

  /* 规则兜底评分（AI 不可用时）：只做粗粒度代理，明确标注 by=rule */
  function ruleScore(aContent, bContent) {
    function one(text) {
      var t = String(text || '');
      var len = t.length;
      var facts = (t.match(/\d|%|元|美元|人民币|倍|条|例|据|报道|公告|数据|文件/g) || []).length;
      var logic = (t.match(/因此|所以|但是|然而|如果|首先|其次|最后|综上|反过来说/g) || []).length;
      var engage = (t.match(/[?？]/g) || []).length;
      var rude = (t.match(/傻|蠢|垃圾|闭嘴|杠精|二极管/g) || []).length;
      var evidence = Math.min(20, 4 + facts * 3);
      var logicS = Math.min(20, 4 + logic * 3);
      var relevance = Math.min(20, 6 + Math.min(10, len / 30));
      var addition = Math.min(20, 4 + facts * 2 + engage);
      var manner = Math.max(0, 18 - rude * 6);
      return { evidence: evidence, logic: logicS, relevance: relevance, addition: addition, manner: manner };
    }
    var sa = one(aContent), sb = one(bContent);
    return {
      by: 'rule', note: '规则评分（AI 暂不可用，仅作粗粒度参考）',
      a: sa, b: sb, a_total: totalOfScore(sa), b_total: totalOfScore(sb),
      comment: '规则兜底分：按证据词频/逻辑连接词/礼仪词粗算，仅供参考。'
    };
  }

  /* AI 评分 prompt：严格 JSON 输出 */
  function aiScorePrompt(room, aPost, bPost) {
    return '你是辩论裁判，只评「怎么辩」，不评「辩什么」——不因立场给任何人加分或减分。\n' +
      '辩题：' + room.topic + '\n' +
      '甲方立场：' + room.side_a + '\n乙方立场：' + room.side_b + '\n\n' +
      '【甲方发言】\n' + String(aPost || '（未发言）') + '\n\n' +
      '【乙方发言】\n' + String(bPost || '（未发言）') + '\n\n' +
      '请按五个维度各打 0-20 的整数分：论据(evidence)、逻辑(logic)、针对性(relevance)、增量(addition)、礼仪(manner)。\n' +
      '只回复一行 JSON，不要解释：\n' +
      '{"a":{"evidence":0,"logic":0,"relevance":0,"addition":0,"manner":0},' +
      '"b":{"evidence":0,"logic":0,"relevance":0,"addition":0,"manner":0},' +
      '"comment":"一句话点评（60字内）"}';
  }

  /* 解析 AI 返回：校验结构与分值域，不合格返回 null */
  function parseAiScore(text) {
    var m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    var obj;
    try { obj = JSON.parse(m[0]); } catch (e) { return null; }
    function norm(side) {
      var s = obj && obj[side];
      if (!s) return null;
      var out = {};
      for (var i = 0; i < DIMS.length; i++) {
        var v = Math.round(Number(s[DIMS[i]]));
        if (!isFinite(v) || v < 0 || v > 20) return null;
        out[DIMS[i]] = v;
      }
      return out;
    }
    var a = norm('a'), b = norm('b');
    if (!a || !b) return null;
    return {
      by: 'ai',
      a: a, b: b, a_total: totalOfScore(a), b_total: totalOfScore(b),
      comment: String(obj.comment || '').slice(0, 120)
    };
  }

  /* 每轮胜负（按该轮双方总分） */
  function roundWinner(score) {
    if (!score) return null;
    if (score.a_total > score.b_total) return 'a';
    if (score.b_total > score.a_total) return 'b';
    return 'draw';
  }

  /* ---------- 我的房间 ---------- */
  function myRooms(rooms, posts, bets, uid) {
    var postedDid = {}, betDid = {};
    (posts || []).forEach(function (p) { if (p.uid === uid) postedDid[p.did] = 1; });
    (bets || []).forEach(function (b) { if (b.uid === uid) betDid[b.did] = 1; });
    return (rooms || []).filter(function (r) {
      return r.creator_uid === uid || postedDid[r.did] || betDid[r.did];
    });
  }

  return {
    DEBATE_FEE: DEBATE_FEE, DEFAULT_MAX_ROUNDS: DEFAULT_MAX_ROUNDS,
    DIMS: DIMS, DIM_LABELS: DIM_LABELS,
    validateRoom: validateRoom, phaseOf: phaseOf, postsOf: postsOf,
    currentRoundOf: currentRoundOf, nextActor: nextActor, canPost: canPost,
    poolOf: poolOf, oddsOf: oddsOf, potentialPayout: potentialPayout,
    settleOdds: settleOdds, settlePlan: settlePlan,
    totalOfScore: totalOfScore, ruleScore: ruleScore,
    aiScorePrompt: aiScorePrompt, parseAiScore: parseAiScore, roundWinner: roundWinner,
    myRooms: myRooms
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DebateCore;
}
