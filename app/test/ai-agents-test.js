/* ============================================================
 * 明鉴 · AI 参与者核心单测（纯 node，无 jsdom / 无网络）
 *
 * 运行：
 *   /Users/wangxiaoli/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     app/test/ai-agents-test.js
 *
 * 覆盖：花名册身份 / 确定性伪随机 / 下注决策 / 行组装 /
 *       证据与发言中立性 / 批量计划 / 异常输入鲁棒性
 * 输出：一行一项 PASS/FAIL，末尾汇总；有失败则 exit(1)。
 * ============================================================ */
'use strict';

var path = require('path');
var fs = require('fs');

var Ai = require(path.resolve(__dirname, '../js/ai-agents.js'));
var Evidence = require(path.resolve(__dirname, '../js/evidence.js'));

var pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}
function safe(fn) {
  try { return { ok: true, value: fn() }; }
  catch (e) { return { ok: false, error: e }; }
}

/* ---------- 固定测试题 ---------- */
function q1() {
  return {
    qid: 'q-test-tech', title: '明年会不会推出新的科技产业扶持政策', category: '科技',
    status: 'open', deadline: '2099-12-31', mode: 'pool', fee: 0.05,
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 600, no: 400 }
  };
}
function q2() {
  return {
    qid: 'q-test-econ', title: '下季度主要经济指标会回升吗', category: '经济',
    status: 'open', deadline: '2099-06-30', mode: 'pool', fee: 0.05,
    outcomes: [{ id: 'up', label: '回升' }, { id: 'flat', label: '持平' }, { id: 'down', label: '回落' }],
    pool: { up: 200, flat: 300, down: 500 }
  };
}
function qExpired() {
  return {
    qid: 'q-test-expired', title: '已经过期的题', category: '科技',
    status: 'open', deadline: '2020-01-01', mode: 'pool', fee: 0.05,
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 10, no: 10 }
  };
}
function qSettled() {
  return {
    qid: 'q-test-settled', title: '已经揭晓的题', category: '娱乐',
    status: 'settled', deadline: '2099-01-01', mode: 'pool', fee: 0.05,
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 10, no: 10 }
  };
}

/* 现金 1500 的 AI（opening_bonus 置 0，纯 bonus 行） */
var RICH = 'ai-deepseek-01';
var POOR = 'ai-doubao-09';
function seedBet(uid, points) {
  return {
    qid: 'ai-seed-' + uid, uid: uid, nickname: Ai.displayOf(uid, ''), outcome_id: 'seed',
    stake: 0, odds_at_bet: 0, status: 'won', kind: 'bonus', payout: points,
    placed_at: '2026-10-01T00:00:00.000Z', settled_at: '2026-10-01T00:00:00.000Z'
  };
}
var BETS = [seedBet(RICH, 1500), seedBet(POOR, 5)];
var SETTINGS = { site: { opening_bonus: 0, min_bet: 10 } };

/* ============================================================
 * [1] 花名册身份
 * ============================================================ */
console.log('[1] 花名册身份');
var roster = Ai.AI_ROSTER;
check('花名册长度 10', roster.length === 10);

var uids = roster.map(function (a) { return a.uid; });
var uniq = uids.filter(function (u, i) { return uids.indexOf(u) === i; });
check('10 个 uid 全部唯一', uniq.length === 10);
check('uid 全部以 ai- 开头', uids.every(function (u) { return /^ai-/.test(u); }));

var nos = roster.map(function (a) { return a.no; });
check('编号连续 1..10', nos.join(',') === '1,2,3,4,5,6,7,8,9,10');

check('昵称含模型名与 #编号', roster.every(function (a) {
  return a.display.indexOf(a.model) === 0 &&
    a.display.indexOf('#' + (a.no < 10 ? '0' + a.no : a.no)) >= 0;
}));
check('每个 AI 初始积分均为 2000', roster.every(function (a) { return a.startPoints === 2000; }));
check('花名册对象已冻结（身份不可运行时改写）',
  Object.isFrozen(roster) && roster.every(function (a) { return Object.isFrozen(a); }));

/* ============================================================
 * [2] 身份判定与展示
 * ============================================================ */
console.log('[2] 身份判定与展示');
check('isAi 命中 ai- 前缀', Ai.isAi('ai-gpt-02') === true);
check('isAi 拒绝真人 uid', Ai.isAi('u-8f2a') === false && Ai.isAi('') === false && Ai.isAi(null) === false);

var gpt = Ai.agentOf('ai-gpt-02');
check('agentOf 返回对应模型', !!gpt && gpt.model === '逻辑派' && gpt.no === 2);
check('agentOf 未知 uid 返回 null', Ai.agentOf('ai-not-exist') === null && Ai.agentOf(null) === null);

var tag = Ai.tagOf('ai-grok-07');
check('tagOf 返回 AI 徽标与昵称', !!tag && tag.badge === 'AI' && tag.label === '杠精 #07');
check('tagOf 非 AI 返回 null', Ai.tagOf('u-8f2a') === null);
check('displayOf AI 用花名册昵称', Ai.displayOf('ai-claude-03', '某真人') === '温和派 #03');
check('displayOf 真人回退到 fallback', Ai.displayOf('u-8f2a', '小王') === '小王');

/* ============================================================
 * [3] 确定性伪随机
 * ============================================================ */
console.log('[3] 确定性伪随机');
check('hashStr 稳定且落在 uint32 范围', (function () {
  var a = Ai.hashStr('明鉴-abc');
  var b = Ai.hashStr('明鉴-abc');
  return a === b && a >= 0 && a < 4294967296 && Math.floor(a) === a;
})());
check('rand01 落在 [0,1)', (function () {
  for (var i = 0; i < 200; i++) {
    var r = Ai.rand01('seed-' + i);
    if (!(r >= 0 && r < 1)) return false;
  }
  return true;
})());
check('代码未使用 Math.random（仅注释提及）', (function () {
  var src = fs.readFileSync(path.resolve(__dirname, '../js/ai-agents.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return src.indexOf('Math.random') < 0;
})());

var qa = q1();
check('同 seed 两次 pickOutcome 结果一致', roster.every(function (a) {
  var o1 = Ai.pickOutcome(a, qa, qa.pool, 'seed-x');
  var o2 = Ai.pickOutcome(a, qa, qa.pool, 'seed-x');
  return o1 === o2 && o1 !== null;
}));
check('不同 seed 能产生不同结果（至少一次）', (function () {
  var first = Ai.pickOutcome(roster[0], qa, qa.pool, 'seed-0');
  for (var i = 1; i <= 15; i++) {
    if (Ai.pickOutcome(roster[0], qa, qa.pool, 'seed-' + i) !== first) return true;
  }
  return false;
})());

/* ============================================================
 * [4] pickOutcome
 * ============================================================ */
console.log('[4] 投注选项决策');
check('返回的 oid 一定属于该题选项', (function () {
  var ids = ['yes', 'no'];
  for (var i = 0; i < roster.length; i++) {
    for (var s = 0; s < 20; s++) {
      var oid = Ai.pickOutcome(roster[i], qa, qa.pool, 's' + s);
      if (ids.indexOf(oid) < 0) return false;
    }
  }
  return true;
})());
check('三选项题也返回合法 oid', (function () {
  var q = q2();
  var ids = ['up', 'flat', 'down'];
  return roster.every(function (a) {
    return ids.indexOf(Ai.pickOutcome(a, q, q.pool, 'x')) >= 0;
  });
})());
check('池为空时仍返回合法 oid', (function () {
  var q = qa;
  var oid = Ai.pickOutcome(roster[0], q, {}, 's');
  return oid === 'yes' || oid === 'no';
})());
check('单选项题直接返回该选项', (function () {
  var q = { qid: 'q-one', outcomes: [{ id: 'only', label: '唯一' }] };
  return Ai.pickOutcome(roster[0], q, {}, 's') === 'only';
})());
check('异常输入（null/空选项）不崩且返回 null', (function () {
  return Ai.pickOutcome(null, qa, {}, 's') === null &&
    Ai.pickOutcome(roster[0], null, {}, 's') === null &&
    Ai.pickOutcome(roster[0], { qid: 'x', outcomes: [] }, {}, 's') === null &&
    Ai.pickOutcome(roster[0], { qid: 'x' }, {}, 's') === null;
})());

/* ============================================================
 * [5] pickStake
 * ============================================================ */
console.log('[5] 投注额决策');
check('余额低于 min_bet 返回 0', (function () {
  return Ai.pickStake(roster[0], 9, SETTINGS) === 0 &&
    Ai.pickStake(roster[0], 0, SETTINGS) === 0 &&
    Ai.pickStake(roster[0], -50, SETTINGS) === 0;
})());
check('单笔不超过 200', (function () {
  return roster.every(function (a) {
    return Ai.pickStake(a, 1000000, SETTINGS) <= 200;
  });
})());
check('不超过余额', (function () {
  return roster.every(function (a) {
    for (var b = 10; b <= 500; b += 37) {
      if (Ai.pickStake(a, b, SETTINGS) > b) return false;
    }
    return true;
  });
})());
check('投注额为整数且是 10 的倍数', (function () {
  return roster.every(function (a) {
    for (var b = 10; b <= 900; b += 53) {
      var s = Ai.pickStake(a, b, SETTINGS);
      if (s % 10 !== 0 || Math.floor(s) !== s) return false;
    }
    return true;
  });
})());
check('余额刚好等于 min_bet 时给最小额', Ai.pickStake(roster[9], 10, SETTINGS) === 10);

/* ============================================================
 * [6] 台账行组装
 * ============================================================ */
console.log('[6] 台账行组装');
var betRow = Ai.buildBetRow(roster[0], qa, 'yes', 30, 2.3456);
check('buildBetRow 字段与 placeBet 完全一致', (function () {
  var keys = Object.keys(betRow).sort().join(',');
  return keys === 'nickname,odds_at_bet,outcome_id,qid,stake,uid' &&
    betRow.qid === 'q-test-tech' &&
    betRow.uid === 'ai-deepseek-01' &&
    betRow.nickname === '数据党 #01' &&
    betRow.outcome_id === 'yes' &&
    betRow.stake === 30 &&
    betRow.odds_at_bet === 2.35;
})());
check('buildBetRow 不带 status/kind（走库默认）',
  !('status' in betRow) && !('kind' in betRow));

var seedRow = Ai.buildSeedRow(roster[0], 2000, { now: '2026-10-18T00:00:00.000Z' });
check('buildSeedRow kind=bonus / payout=points / qid 前缀', (function () {
  return seedRow.kind === 'bonus' &&
    seedRow.payout === 2000 &&
    seedRow.qid === 'ai-seed-ai-deepseek-01' &&
    seedRow.stake === 0 && seedRow.odds_at_bet === 0 &&
    seedRow.status === 'won' &&
    seedRow.placed_at === '2026-10-18T00:00:00.000Z' &&
    seedRow.settled_at === seedRow.placed_at;
})());
check('seed 行现金口径与 LoanCore 一致（bonus 全额计入）', (function () {
  var cash = Ai.cashOfBets(roster[0].uid, [seedRow], { site: { opening_bonus: 1000 } });
  return cash === 3000; /* 1000 开局赠送 + 2000 seed payout */
})());

var evRow = Ai.buildEvidenceRow(roster[3], qa, {
  side: 'neutral', url: 'https://example.com/a', title: '公开资料', summary: '仅作检索入口'
});
check('buildEvidenceRow 字段形状正确', (function () {
  return evRow.qid === 'q-test-tech' && evRow.uid === 'ai-gemini-04' &&
    evRow.nickname === '检索派 #04' && evRow.side === 'neutral' &&
    evRow.status === 'pending' && evRow.url === 'https://example.com/a';
})());

/* ============================================================
 * [7] 证据中立性
 * ============================================================ */
console.log('[7] 证据中立性');
var ev = Ai.composeEvidence(roster[0], qa);
check('composeEvidence 标题长度 4–80', ev.title.length >= 4 && ev.title.length <= 80);
check('composeEvidence 摘要不超过 300', ev.summary.length > 0 && ev.summary.length <= 300);
check('composeEvidence url 为 http(s)', /^https?:\/\/\S+$/i.test(ev.url));
check('composeEvidence 可通过 EvidenceCore 校验', (function () {
  /* AI 不替证据选边：side 为空，提交方按实际立场填 yes/no/neutral */
  var probe = { side: 'neutral', title: ev.title, url: ev.url, summary: ev.summary };
  return Evidence.validateEvidence(probe).ok === true;
})());
check('composeEvidence 不预设立场（标题无判断词、摘要声明中立）',
  ev.title.indexOf('支持') < 0 && ev.title.indexOf('反对') < 0 &&
  ev.summary.indexOf('不预设结论') >= 0);

/* ============================================================
 * [8] 对线发言
 * ============================================================ */
console.log('[8] 对线发言');
var TOPIC = '明年会不会推出新的科技产业扶持政策';
check('composeLine 长度 40–120 且围绕 topic', (function () {
  for (var i = 0; i < roster.length; i++) {
    for (var r = 1; r <= 4; r++) {
      var line = Ai.composeLine(roster[i], TOPIC, r % 2 ? 'a' : 'b', r, 'seed');
      if (line.length < 40 || line.length > 120) return false;
      if (line.indexOf(TOPIC.slice(0, 6)) < 0) return false;
    }
  }
  return true;
})());
check('同 seed 不同 round 内容不同', (function () {
  return roster.every(function (a) {
    var l1 = Ai.composeLine(a, TOPIC, 'a', 1, 'seed');
    var l2 = Ai.composeLine(a, TOPIC, 'a', 2, 'seed');
    return l1 !== l2;
  });
})());
check('不同 side 立场表达不同', (function () {
  var la = Ai.composeLine(roster[0], TOPIC, 'a', 1, 'seed');
  var lb = Ai.composeLine(roster[0], TOPIC, 'b', 1, 'seed');
  return la !== lb && la.indexOf('支持甲方') >= 0 && lb.indexOf('支持乙方') >= 0;
})());
check('发言不含辱骂词（傻/蠢/滚）', (function () {
  for (var i = 0; i < roster.length; i++) {
    for (var r = 1; r <= 4; r++) {
      var line = Ai.composeLine(roster[i], TOPIC, 'a', r, 'seed');
      if (/傻|蠢|滚/.test(line)) return false;
    }
  }
  return true;
})());
check('发言未编造具体数字', (function () {
  for (var i = 0; i < roster.length; i++) {
    var line = Ai.composeLine(roster[i], TOPIC, 'a', 1, 'seed');
    if (/[0-9]+\s*(%|％|倍|万人|亿元)/.test(line)) return false;
  }
  return true;
})());

var post = Ai.buildDebatePost(roster[1], { did: 'd-100' }, 'b', 2, '我的发言内容足够十个字以上。');
check('buildDebatePost 字段形状正确', (function () {
  return post.did === 'd-100' && post.uid === 'ai-gpt-02' &&
    post.nickname === '逻辑派 #02' && post.side === 'b' &&
    post.round_no === 2 && post.content.length >= 10;
})());

/* ============================================================
 * [9] 批量计划
 * ============================================================ */
console.log('[9] 批量计划');
var questions = [qa, q2(), qExpired(), qSettled()];
var plan = Ai.planRound(roster.slice(0, 2), questions, BETS, SETTINGS, { maxN: 5, now: '2026-10-18T12:00:00Z', seed: 'r1' });
check('planRound 有产出且不超过 maxN', plan.length > 0 && plan.length <= 5);
check('只给现金充足的 AI 下单（1500 下单 / 5 跳过）', (function () {
  return plan.length === 1 && plan[0].uid === RICH;
})());
check('planRound 只会选 open 且未过期的题', (function () {
  var allowed = ['q-test-tech', 'q-test-econ'];
  if (!plan.every(function (r) { return allowed.indexOf(r.qid) >= 0; })) return false;
  for (var i = 0; i < 20; i++) {
    var rows = Ai.planRound(roster, questions, BETS, SETTINGS, { now: '2026-10-18T12:00:00Z', seed: 's' + i });
    for (var j = 0; j < rows.length; j++) {
      if (allowed.indexOf(rows[j].qid) < 0) return false;
    }
  }
  return true;
})());
check('planRound 结果确定性（同输入同输出）', (function () {
  var a = Ai.planRound(roster, questions, BETS, SETTINGS, { now: 1760000000000, seed: 'x' });
  var b = Ai.planRound(roster, questions, BETS, SETTINGS, { now: 1760000000000, seed: 'x' });
  return JSON.stringify(a) === JSON.stringify(b) && a.length > 0;
})());
check('planRound 行字段合法（stake 是 10 的倍数、odds 为数字）', plan.every(function (r) {
  return r.stake % 10 === 0 && isFinite(r.odds_at_bet) && typeof r.nickname === 'string';
}));
check('planRound 默认上限 30（10 个 AI 各 1 笔）', (function () {
  /* 全员都有 1000 开局积分时，10 个 AI 每人 1 笔，远低于默认上限 */
  var many = Ai.planRound(roster, questions, BETS,
    { site: { opening_bonus: 1000, min_bet: 10 } }, { now: 1760000000000 });
  return many.length <= 30 && many.length === 10;
})());

/* ============================================================
 * [10] 异常输入鲁棒性
 * ============================================================ */
console.log('[10] 异常输入鲁棒性');
var calls = [
  ['isAi', function () { return Ai.isAi(null); }],
  ['agentOf', function () { return Ai.agentOf(undefined); }],
  ['tagOf', function () { return Ai.tagOf(''); }],
  ['displayOf', function () { return Ai.displayOf(null); }],
  ['pickOutcome', function () { return Ai.pickOutcome(null, null, null, null); }],
  ['pickStake', function () { return Ai.pickStake(null, null, null); }],
  ['buildBetRow', function () { return Ai.buildBetRow(null, null, null, null, null); }],
  ['buildSeedRow', function () { return Ai.buildSeedRow(null, 0); }],
  ['buildEvidenceRow', function () { return Ai.buildEvidenceRow(null, null, null); }],
  ['composeEvidence', function () { return Ai.composeEvidence(null, null); }],
  ['composeLine', function () { return Ai.composeLine(null, null, null, null, null); }],
  ['buildDebatePost', function () { return Ai.buildDebatePost(null, null, null, null, null); }],
  ['planRound', function () { return Ai.planRound(null, null, null, null, null); }],
  ['cashOfBets', function () { return Ai.cashOfBets('x', null, null); }],
  ['poolsOf', function () { return Ai.poolsOf(null, null); }],
  ['oddsOf', function () { return Ai.oddsOf(null, null, null); }]
];
check('所有导出函数在 null/undefined 下不抛异常', calls.every(function (c) {
  var r = safe(c[1]);
  if (!r.ok) console.log('    抛出异常:', c[0], String(r.error && r.error.message));
  return r.ok;
}));
check('planRound 空数组返回空列表', (function () {
  var r1 = Ai.planRound([], [], [], SETTINGS, {});
  var r2 = Ai.planRound(roster, [], [], SETTINGS, {});
  return Array.isArray(r1) && r1.length === 0 && Array.isArray(r2) && r2.length === 0;
})());
check('无 deadline 的 open 题可被选中（与线上 isExpired 一致）', (function () {
  var q = q1();
  delete q.deadline;
  var rows = Ai.planRound([roster[0]], [q], BETS, SETTINGS, { now: 1760000000000 });
  return rows.length === 1 && rows[0].qid === 'q-test-tech';
})());

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
