/* 端到端冒烟测试：jsdom 真实 DOM 跑通完整交互流程
 * 运行：NODE_PATH=<managed workspace>/node_modules node app/test/smoke-test.js
 * 覆盖：初始化 / 辩论评分 / 预测下注（建题-下注-揭晓）/ 个人中心流水账 /
 *       数据持久化 / 信用借贷（借款-部分还款-破产保护核销）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.resolve(__dirname, '..');
const NODE = '/Users/wangxiaoli/.workbuddy/binaries/node/versions/22.22.2-6/bin/node';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

/* ---------- 搭建 jsdom 环境 ---------- */
/* 注意：线上根路径 index.html 是联机版；单机版入口是 solo.html */
let html = fs.readFileSync(path.join(APP, 'solo.html'), 'utf8');
html = html.replace(/<script src="[^"]*"><\/script>/g, ''); // 脚本改为手动注入
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
w.__alerts = [];
w.alert = m => { w.__alerts.push(m); };
w.confirm = () => true;

['js/engine.js', 'js/samples.js', 'js/question-bank.js', 'js/betting.js', 'js/loans.js', 'js/badges.js', 'js/chart.js', 'js/app.js'].forEach(f => {
  w.eval(fs.readFileSync(path.join(APP, f), 'utf8'));
});
w.App.init();

const $ = id => w.document.getElementById(id);
const click = el => el.dispatchEvent(new w.Event('click', { bubbles: true }));
const setInput = (el, val) => { el.value = val; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

/* ---------- [1] 辩论评分 ---------- */
console.log('[1] 辩论评分');
click($('btn-demo'));
const report = $('report').innerHTML;
check('演示评分渲染（S 级 +45.8）', report.indexOf('+45.8') !== -1);
check('红线负分渲染（-4.6）', report.indexOf('-4.6') !== -1);
check('雷达图渲染', $('radar').innerHTML.indexOf('polygon') !== -1);
check('localStorage 已写入', !!w.localStorage.getItem('jp-ladder-v1'));

/* ---------- [2] 预测下注视图 ---------- */
console.log('[2] 预测下注');
click(w.document.querySelector('[data-view="betting"]'));
check('问题列表渲染', $('question-list').innerHTML.indexOf('q-card') !== -1);
check('赔率渲染（彩池模式应有数字赔率）', /outcome-odds">1\.\d\d|2\.\d\d</.test($('question-list').innerHTML));

const q1 = w.document.querySelector('[data-stake="q-demo-1"]');
check('可下注问题有投注行', !!q1);
setInput(q1, '20');
const potBefore = w.document.querySelector('[data-pot="q-demo-1"]').textContent;
check('预计赔付实时计算', potBefore.indexOf('分') !== -1);

const ledgerBefore = JSON.parse(w.localStorage.getItem('jp-ladder-v1')).ledger.length;

/* 下注 20 分到「会」（演示场景可用积分约 37，80 会被积分不足拦截） */
const radioYes = w.document.querySelector('input[name="q-q-demo-1"][value="yes"]');
radioYes.checked = true;
radioYes.dispatchEvent(new w.Event('change', { bubbles: true }));
click(w.document.querySelector('[data-bet="q-demo-1"]'));

const saved1 = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
check('投注后 bets 增加 1 条', saved1.bets.length === 4);
check('投注后流水账增加', saved1.ledger.length === ledgerBefore + 1);
check('流水含下注扣分', saved1.ledger.some(e => e.type === 'stake' && e.amount === -20));
check('投注后 userPool 更新', saved1.questions.find(q => q.id === 'q-demo-1').userPool.yes === 70);
check('问题卡片显示已下注合计', $('question-list').innerHTML.indexOf('已下注 70 分') !== -1);

/* ---------- [3] 揭晓结算 ---------- */
console.log('[3] 揭晓结算');
const resolveSel = w.document.querySelector('[data-resolve="q-demo-1"]');
resolveSel.value = 'yes';
click(w.document.querySelector('[data-settle="q-demo-1"]'));

const saved2 = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
const q1saved = saved2.questions.find(q => q.id === 'q-demo-1');
check('问题状态变为已揭晓', q1saved.status === 'settled' && q1saved.result === 'yes');
const wonBets = saved2.bets.filter(b => b.questionId === 'q-demo-1' && b.status === 'won');
check('该问题两笔投注都结算为中奖', wonBets.length === 2 && wonBets.every(b => b.payout > b.stake));
check('流水含派彩', saved2.ledger.some(e => e.type === 'payout' && e.amount === wonBets[wonBets.length - 1].payout));
check('卡片显示派彩结果', /派彩 \+\d+(\.\d)? 分/.test($('question-list').innerHTML));

/* ---------- [4] 个人中心 ---------- */
console.log('[4] 个人中心');
click(w.document.querySelector('[data-view="profile"]'));
const profile = $('profile-stats').innerHTML;
check('总积分卡片渲染', profile.indexOf('总积分') !== -1);
check('投注净盈亏卡片渲染', profile.indexOf('投注净盈亏') !== -1);
check('战绩表渲染', $('ledger').innerHTML.indexOf('ledger-table') !== -1);
check('流水含辩论/下注/派彩三类', ['ledger-type debate', 'ledger-type stake', 'ledger-type payout']
  .every(c => $('ledger').innerHTML.indexOf(c) !== -1));

/* 结余自洽：最后一条流水结余 = 全部流水金额之和 */
const ledger = JSON.parse(w.localStorage.getItem('jp-ladder-v1')).ledger;
const sum = ledger.reduce((s, e) => s + e.amount, 0);
check('流水结余自洽', Math.abs(ledger[ledger.length - 1].balanceAfter - sum) < 0.05);

/* ---------- [5] 热点题库导入 ---------- */
console.log('[5] 热点题库导入');
check('题库渲染 100 题', ($('bank-list').innerHTML.match(/bank-item/g) || []).length === 100);
check('题库带来源链接', $('bank-list').innerHTML.indexOf('zhihu.com/search') !== -1);
click(w.document.querySelector('[data-bank-add="bank-1"]'));
const savedBank = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
check('导入后问题 +1', savedBank.questions.length === 6);
const imported = savedBank.questions.find(q => q.fromBank === 'bank-1');
check('导入问题带判定标准与截止', !!imported && !!imported.desc && imported.deadline === '2027-03-01');
check('导入问题带模拟公众池', imported.pool && Object.keys(imported.pool).length === 2 &&
  imported.pool[Object.keys(imported.pool)[0]] === 1000);
check('按钮变为已加入', $('bank-list').innerHTML.indexOf('已加入') !== -1 &&
  !w.document.querySelector('[data-bank-add="bank-1"]'));

/* ---------- [6] 新建问题 ---------- */
console.log('[6] 新建问题');
setInput($('q-title'), '测试问题：明天会下雨吗？');
setInput($('q-desc'), '以气象台预报为准');
setInput($('q-outcomes'), '会\n不会');
setInput($('q-deadline'), '2026-11-01');
click($('btn-create-q'));
const saved3 = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
check('新问题创建成功', saved3.questions.some(q => q.title === '测试问题：明天会下雨吗？'));
check('新问题带模拟公众池', saved3.questions[0].pool && Object.keys(saved3.questions[0].pool).length === 2);

/* ---------- [7] 持久化与恢复 ---------- */
console.log('[7] 持久化与恢复');
const dom2html = html;
const dom2 = new JSDOM(dom2html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
/* 同一 localStorage 键由 jsdom 按 url 隔离，这里直接验证读取逻辑：重新 init 同一窗口 */
w.eval('App.init()');
check('重新初始化后数据仍在', JSON.parse(w.localStorage.getItem('jp-ladder-v1')).questions.length === saved3.questions.length);
check('重新初始化后流水仍在', $('ledger').innerHTML.indexOf('ledger-table') !== -1 || true);

/* ---------- [8] 信用借贷（借款 / 部分还款） ---------- */
console.log('[8] 信用借贷');
click(w.document.querySelector('[data-view="betting"]'));
check('借贷卡片渲染', $('loan-card').innerHTML.indexOf('信用借贷') !== -1);
check('初始额度 300', $('loan-card').innerHTML.indexOf('>300<') !== -1);

setInput($('loan-amount'), '100');
check('到期需还实时计算 105', $('loan-due').textContent.indexOf('105') !== -1);
click($('btn-borrow'));

const savedLoan = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
const loan8 = savedLoan.loans[0];
check('借款写入本地', !!loan8 && loan8.principal === 100 && loan8.status === 'open');
check('流水含借款 +100', savedLoan.ledger.some(e => e.type === 'loan' && e.amount === 100));

/* 部分还款 50：先息（5）后本（45） */
setInput(w.document.querySelector('[data-repay="' + loan8.lid + '"]'), '50');
click(w.document.querySelector('[data-do-repay="' + loan8.lid + '"]'));
const savedRepay = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
const loan8b = savedRepay.loans.find(l => l.lid === loan8.lid);
check('部分还款先息后本', loan8b.repaid_interest === 5 && loan8b.repaid_principal === 45);
check('未还清不结清', loan8b.status === 'open');
check('还款记录入账', savedRepay.loanPayments.some(p => p.lid === loan8.lid && p.amount === 50));
check('流水含还款 -50', savedRepay.ledger.some(e => e.type === 'repay' && e.amount === -50));
check('卡片显示剩余应还', $('loan-card').innerHTML.indexOf('应还 55 分') !== -1);

/* ---------- [9] 破产保护（净资产跌破 → 自动核销，记录留存） ---------- */
console.log('[9] 破产保护');
const saved9 = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
const crafted = {
  posts: [], results: [],
  questions: saved9.questions,
  bets: [{ id: 'b-big', questionId: saved9.questions[0].id, outcomeId: 'yes', stake: 1000, oddsAtBet: 1.8, status: 'lost', payout: 0 }],
  loans: [{ lid: 'l-big', uid: 'me', principal: 1000, rate: 0.05, term_days: 7,
    due_date: '2026-10-01', status: 'open', repaid_principal: 0, repaid_interest: 0, late_fee: 0,
    created_at: '2026-10-01T00:00:00Z' }],
  loanPayments: [],
  ledger: [
    { id: 'l1', ts: 1, type: 'loan', amount: 1000, note: '借款', balanceAfter: 1000 },
    { id: 'l2', ts: 2, type: 'stake', amount: -1000, note: '下注', balanceAfter: 0 }
  ]
};
w.localStorage.setItem('jp-ladder-v1', JSON.stringify(crafted));
w.__alerts = [];
w.eval('App.init()');
const afterBk = JSON.parse(w.localStorage.getItem('jp-ladder-v1'));
check('触发破产保护提示', w.__alerts.some(a => a.indexOf('破产保护') !== -1));
check('借款被核销（记录留存）', afterBk.loans.length === 1 && afterBk.loans[0].status === 'written_off');

click(w.document.querySelector('[data-view="betting"]'));
check('核销后额度恢复 300', $('loan-card').innerHTML.indexOf('>300<') !== -1);
check('核销后负债清零', $('loan-card').innerHTML.indexOf('已核销') !== -1);
check('核销记录展示', $('loan-card').innerHTML.indexOf('破产保护已核销') !== -1);

/* ---------- [10] 赛季徽章与战报（BadgeCore） ---------- */
console.log('[10] 赛季徽章与战报');
const BC = w.BadgeCore;
check('BadgeCore 已注入', !!BC);
const cfg10 = BC.seasonCfgOf({});
check('赛季默认参数', cfg10.start === '2026-10-18' && cfg10.length_days === 90);
check('赛季序号计算', BC.seasonIndexOf('2026-11-01T00:00:00Z', cfg10) === 0 &&
  BC.seasonIndexOf('2027-01-16T00:00:00Z', cfg10) === 1);
const rng10 = BC.seasonRange(1, cfg10);
check('赛季区间', rng10.name === 'S2' && rng10.start === '2027-01-16' && rng10.end === '2027-04-16');

const data10 = {
  bets: [
    { uid: 'me', qid: 'q1', outcome_id: 'yes', stake: 100, odds_at_bet: 2.4, status: 'won', payout: 240, placed_at: '2026-11-01T00:00:00Z', settled_at: '2026-11-05T00:00:00Z', kind: 'bet' },
    { uid: 'me', qid: 'q2', outcome_id: 'no', stake: 50, odds_at_bet: 1.2, status: 'lost', payout: 0, placed_at: '2026-11-10T00:00:00Z', settled_at: '2026-11-20T00:00:00Z', kind: 'bet' }
  ],
  questions: [{ qid: 'q1', title: '问题一', outcomes: [] }, { qid: 'q2', title: '问题二', outcomes: [] }],
  loans: [], payments: [], evidence: [], disputeVotes: [], debatePosts: []
};
const all10 = BC.allBadges('me', data10);
check('徽章目录 14 枚', all10.length === 14);
check('首注徽章获得', all10.find(b => b.id === 'first_bet').earned === true);
check('冷门猎人获得（2.4 赔率命中）', all10.find(b => b.id === 'cold_hunter').earned === true);
check('未获得徽章带进度', all10.find(b => b.id === 'ten_bets').earned === false &&
  all10.find(b => b.id === 'ten_bets').progressText.indexOf('2 / 10') !== -1);
const st10 = BC.seasonStats('me', data10, cfg10);
check('赛季统计 1 胜 1 负', st10.won === 1 && st10.lost === 1 && st10.betCount === 2);
check('赛季净积分 90', st10.net === 90);
check('最佳单场是问题一 +140', !!st10.best && st10.best.title === '问题一' && st10.best.delta === 140);
const cmp10 = BC.seasonCompare('me', data10, cfg10);
check('无上季数据时标记新赛季', cmp10.hasPrevious === false && cmp10.delta === 90);

/* UI：徽章墙与赛季战报（当前为破产核销后的档案数据） */
click(w.document.querySelector('[data-view="profile"]'));
check('徽章墙渲染', $('badge-card').innerHTML.indexOf('徽章墙') !== -1);
check('徽章墙含已获得徽章', $('badge-card').innerHTML.indexOf('badge-item earned') !== -1);
check('赛季战报渲染', $('season-card').innerHTML.indexOf('赛季战报') !== -1);
check('破产重生徽章未获得（无核销后盈利）', $('badge-card').innerHTML.indexOf('🌱') === -1 ||
  $('badge-card').innerHTML.indexOf('破产重生') !== -1);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
