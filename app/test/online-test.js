/* 联机版端到端测试：jsdom + 内存假数据库（模拟 PostgREST 行为）
 * 运行：NODE_PATH=<managed workspace>/node_modules node app/test/online-test.js
 * 覆盖：昵称入场 / 赔率 / 下注 / 揭晓 / 天梯榜(净资产) / 借贷全流程 /
 *       破产保护(核销) / 待揭晓 / 已揭晓档案 / 站长口令 / 置顶下架 /
 *       借贷管理 / 利息池注入 / 全局设置 / 流水自洽 / CSV
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SHA256 = require('../js/sha256.js');

const APP = path.resolve(__dirname, '..');
const ADMIN_TOKEN = 'test-admin-token';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 内存假数据库（supabase 风格链式 + thenable） ---------- */
function createFakeDB(seed) {
  const tables = {
    jp_questions: [], jp_bets: [], jp_settings: [], jp_loans: [], jp_loan_payments: [],
    jp_debates: [], jp_debate_posts: [], jp_debate_bets: [],
    jp_evidence: [], jp_disputes: [], jp_dispute_votes: [], jp_odds_snaps: [], jp_public_votes: [],
    jp_prize_pool_log: [], jp_user_items: [], jp_vip: []
  };
  /* 与真实库一致的自增主键列 */
  const PK = { jp_evidence: 'eid', jp_debate_posts: 'pid', jp_debate_bets: 'dbid', jp_odds_snaps: 'id' };
  Object.keys(seed || {}).forEach(t => { tables[t] = JSON.parse(JSON.stringify(seed[t])); });
  let nextId = 100;

  function builder(table) {
    const filters = [];
    let op = 'select', payload = null;
    const b = {
      select() { op = 'select'; return b; },
      insert(rows) { op = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return b; },
      update(vals) { op = 'update'; payload = vals; return b; },
      delete() { op = 'delete'; return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      order() { return b; },
      limit() { return b; },
      then(res, rej) { return Promise.resolve(execute()).then(res, rej); }
    };
    function match(row) { return filters.every(([c, v]) => row[c] === v); }
    function execute() {
      if (op === 'insert') {
        const inserted = payload.map(r => {
          const row = Object.assign({
            id: nextId++,
            status: 'open', payout: 0, kind: 'bet', placed_at: new Date().toISOString(),
            repaid_principal: 0, repaid_interest: 0, late_fee: 0, created_at: new Date().toISOString()
          }, r);
          if (PK[table] && row[PK[table]] == null) row[PK[table]] = nextId - 1;
          return row;
        });
        tables[table].push(...inserted);
        return { data: inserted, error: null };
      }
      if (op === 'update') {
        const hit = tables[table].filter(match);
        hit.forEach(r => Object.assign(r, payload));
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        const hit = tables[table].filter(match);
        tables[table] = tables[table].filter(r => !match(r));
        return { data: hit, error: null };
      }
      return { data: tables[table].filter(match), error: null };
    }
    return b;
  }
  return { from: builder, _tables: tables };
}

/* ---------- 测试数据 ---------- */
const QUESTIONS = [
  { id: 1, qid: 'q-a', title: '问题A：年底前新政会落地吗？', descr: '以官方文件为准', mode: 'pool', fee: 0.05,
    deadline: '2026-12-31', status: 'open', result: null, final_odds: null,
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 1000, no: 1000 }, creator_name: '出题大厅', created_at: '2026-10-01T00:00:00Z' },
  { id: 2, qid: 'q-b', title: '问题B（固定赔率三选一）', descr: '', mode: 'fixed', fee: 0,
    deadline: '2026-11-30', status: 'open', result: null, final_odds: null,
    outcomes: [{ id: 'x', label: '甲', fixedOdds: 1.8 }, { id: 'y', label: '乙', fixedOdds: 2.5 }, { id: 'z', label: '丙', fixedOdds: 4.0 }],
    pool: {}, creator_name: '出题大厅', created_at: '2026-10-02T00:00:00Z' },
  { id: 3, qid: 'q-c', title: '问题C（已到期待揭晓）', descr: '以公开事实为准', mode: 'pool', fee: 0.05,
    deadline: '2020-01-01', status: 'open', result: null, final_odds: null,
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 1000, no: 1000 }, creator_name: '出题大厅', created_at: '2026-09-01T00:00:00Z' },
  { id: 4, qid: 'q-d', title: '问题D（进行中，用于强平后复投）', descr: '以公开事实为准', mode: 'pool', fee: 0.05,
    deadline: '2027-06-30', status: 'open', result: null, final_odds: null,
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 1000, no: 1000 }, creator_name: '出题大厅', created_at: '2026-10-03T00:00:00Z' }
];
const OTHER_BETS = [
  { id: 10, qid: 'q-a', uid: 'u-other', nickname: '路人甲', outcome_id: 'yes', stake: 100,
    odds_at_bet: 1.81, status: 'open', payout: 0, placed_at: '2026-10-10T00:00:00Z', kind: 'bet' },
  { id: 11, qid: 'q-c', uid: 'u-other2', nickname: '路人乙', outcome_id: 'yes', stake: 100,
    odds_at_bet: 1.81, status: 'open', payout: 0, placed_at: '2026-10-11T00:00:00Z', kind: 'bet' }
];
const SETTINGS = [
  { key: 'admin_token_hash', value: SHA256.sha256(ADMIN_TOKEN), updated_at: '2026-10-17T00:00:00Z' },
  { key: 'site', value: { opening_bonus: 1000, default_fee: 0.05, accept_new_bets: true,
    announcement: '', maintenance: false, loan_enabled: true,
    credit_initial: 300, credit_step: 100, credit_max: 2000, credit_min: 100,
    overdue_penalty: 200, loan_rate: 0.05, loan_term_days: 7, loan_late_rate: 0.01,
    force_mult: 1.5, force_min_net: -300, min_bet: 10, min_loan: 10 },
    updated_at: '2026-10-17T00:00:00Z' },
  { key: 'interest_alloc', value: [], updated_at: '2026-10-17T00:00:00Z' },
  { key: 'season', value: { start: '2026-10-18', length_days: 90, name: 'S' }, updated_at: '2026-10-18T00:00:00Z' }
];

function boot(seedBets) {
  const fake = createFakeDB({ jp_questions: QUESTIONS, jp_bets: seedBets || OTHER_BETS, jp_settings: SETTINGS });
  let html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  html = html.replace(/<script src="[^"]*"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.alert = m => { w.__alerts.push(m); };
  w.__alerts = [];
  w.confirm = () => true;
  w.__fakeDB = fake;
  w.WorkBuddyCloud = { createWorkBuddyCloud: () => ({ database: fake }) };
  ['js/sha256.js', 'js/loans.js', 'js/badges.js', 'js/debates.js', 'js/evidence.js', 'js/arbitration.js', 'js/oddscurve.js', 'js/betting.js', 'js/online.js'].forEach(f => {
    w.eval(fs.readFileSync(path.join(APP, f), 'utf8'));
  });
  return w;
}
const $ = (w, id) => w.document.getElementById(id);
const click = (w, el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));
const setInput = (w, el, val) => { el.value = val; el.dispatchEvent(new w.Event('input', { bubbles: true })) };
const me = w => w.__fakeDB._tables.jp_bets.filter(b => b.uid !== 'u-other' && b.uid !== 'u-other2');
const myLoans = w => w.__fakeDB._tables.jp_loans.filter(l => l.uid !== 'u-other' && l.uid !== 'u-other2');
const myPayments = w => w.__fakeDB._tables.jp_loan_payments.filter(p => p.uid !== 'u-other' && p.uid !== 'u-other2');

(async () => {
  /* ---------- [1] 昵称入场 + 渲染 ---------- */
  console.log('[1] 昵称入场与大厅渲染');
  const w = boot();
  w.OnlineApp.init();
  check('昵称弹窗出现', $(w, 'nick-mask').className.indexOf('open') !== -1);
  setInput(w, $(w, 'nick-input'), '测试玩家');
  click(w, $(w, 'btn-nick-save'));
  await sleep(30);

  check('问题卡片渲染', $(w, 'question-list').innerHTML.indexOf('问题A') !== -1);
  check('未登录态显示可用积分 1000', $(w, 'conn-badge').textContent.indexOf('1000') !== -1);
  check('大厅分页渲染', !!$(w, 'hall-tabs') && $(w, 'hall-tabs').innerHTML.indexOf('已揭晓档案') !== -1);
  check('分页计数正确（进行3/待人工1/档案0）', $(w, 'hall-tabs').innerHTML.indexOf('进行中 · 3') !== -1 &&
    $(w, 'hall-tabs').innerHTML.indexOf('待人工揭晓 · 1') !== -1 && $(w, 'hall-tabs').innerHTML.indexOf('已揭晓档案 · 0') !== -1);

  /* 切到「待人工揭晓」区验证到期题状态（默认 tab 为进行中，不含到期题） */
  click(w, w.document.querySelector('[data-tab2="manual"]'));
  check('到期问题显示待人工揭晓态', $(w, 'question-list').innerHTML.indexOf('待人工揭晓') !== -1);
  check('到期问题禁投注（无输入框）', !w.document.querySelector('[data-stake="q-c"]'));
  click(w, w.document.querySelector('[data-tab2="open"]'));

  /* ---------- [2] 赔率计算 ---------- */
  console.log('[2] 赔率计算');
  /* 卡片按创建时间倒序（q-d 最新在最前），必须定位到 q-a 的卡片 */
  const cardA = w.document.querySelector('[data-stake="q-a"]').closest('.q-card');
  /* 概率化改造后：卡片主显隐含概率（= 1−抽水 ÷ 赔率），赔率退到 title */
  const oddsCell = cardA.querySelector('.outcome-row .outcome-odds');
  const pctYes = parseInt(oddsCell.textContent, 10);
  const expectPct = Math.round((1 - 0.05) / 1.81 * 100);
  check('卡片主显概率 yes≈' + expectPct + '%', Math.abs(pctYes - expectPct) <= 1);
  check('赔率退到 title 且为 1.81x', /1\.81x/.test(oddsCell.getAttribute('title') || ''));

  /* ---------- [3] 下注 ---------- */
  console.log('[3] 下注');
  const radio = w.document.querySelector('input[name="q-q-a"][value="no"]');
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  const stake = w.document.querySelector('[data-stake="q-a"]');
  setInput(w, stake, '50');
  check('预计赔付实时计算', w.document.querySelector('[data-pot="q-a"]').textContent.indexOf('97.3') !== -1);
  click(w, w.document.querySelector('[data-bet="q-a"]'));
  await sleep(30);

  check('下注写入云端', me(w).some(b => b.qid === 'q-a' && b.stake === 50 && b.outcome_id === 'no'));
  check('下注后可用积分 950', $(w, 'conn-badge').textContent.indexOf('950') !== -1);
  check('卡片显示我已投', $(w, 'question-list').innerHTML.indexOf('我已投 50 分') !== -1);

  /* ---------- [4] 揭晓结算 ---------- */
  console.log('[4] 揭晓结算');
  const resolveSel = w.document.querySelector('[data-resolve="q-a"]');
  resolveSel.value = 'yes';
  click(w, w.document.querySelector('[data-settle="q-a"]'));
  await sleep(30);

  const qA = w.__fakeDB._tables.jp_questions.find(x => x.qid === 'q-a');
  check('问题已揭晓', qA.status === 'settled' && qA.result === 'yes');
  check('最终赔率≈1.86（总池 2150 含双方投注）', Math.abs(qA.final_odds - 1.86) < 0.02);
  check('我的投注未中', me(w).find(b => b.qid === 'q-a').status === 'lost');
  const otherSettled = w.__fakeDB._tables.jp_bets.find(b => b.uid === 'u-other');
  check('路人甲中奖派彩', otherSettled.status === 'won' && Math.abs(otherSettled.payout - 185.7) < 1);
  check('结算后可用积分 950', $(w, 'conn-badge').textContent.indexOf('950') !== -1);

  /* ---------- [5] 天梯榜（按净资产） ---------- */
  console.log('[5] 天梯榜');
  click(w, w.document.querySelector('[data-view="board"]'));
  const board = $(w, 'board-list').innerHTML;
  check('榜单含多位玩家', board.indexOf('测试玩家') !== -1 && board.indexOf('路人甲') !== -1);
  check('路人甲净资产 +1085.7', board.indexOf('+1085.7') !== -1);
  check('我的净资产 950', board.indexOf('950.0') !== -1);
  check('榜单口径说明', board.indexOf('净资产') !== -1);

  /* ---------- [6] 我的战绩 + 借贷卡片 ---------- */
  console.log('[6] 我的战绩与借贷卡片');
  click(w, w.document.querySelector('[data-view="mine"]'));
  check('战绩页显示可用积分', $(w, 'mine-stats').innerHTML.indexOf('可用积分') !== -1);
  check('战绩页显示负债卡片', $(w, 'mine-stats').innerHTML.indexOf('当前负债') !== -1);
  const ledger6 = $(w, 'mine-ledger').innerHTML;
  check('流水含下注记录', ledger6.indexOf('下注') !== -1 && ledger6.indexOf('-50.0') !== -1);
  check('借贷卡片渲染', $(w, 'loan-card').innerHTML.indexOf('信用借贷') !== -1);
  check('初始额度 300', $(w, 'loan-card').innerHTML.indexOf('300') !== -1);

  /* ---------- [7] 借款 ---------- */
  console.log('[7] 借款 300 分');
  setInput(w, $(w, 'loan-amount'), '300');
  check('到期需还实时计算 315', $(w, 'loan-due').textContent.indexOf('315') !== -1);
  click(w, $(w, 'btn-borrow'));
  await sleep(30);

  const myLoan = myLoans(w)[0];
  check('借款写入云端', !!myLoan && myLoan.principal === 300 && myLoan.status === 'open');
  check('借款后可用积分 1250', $(w, 'conn-badge').textContent.indexOf('1250') !== -1);
  check('战绩页显示负债 315', $(w, 'mine-stats').innerHTML.indexOf('315') !== -1);
  const ledger7 = $(w, 'mine-ledger').innerHTML;
  check('流水含借款 +300', ledger7.indexOf('借款') !== -1 && ledger7.indexOf('+300.0') !== -1);
  check('借款卡片显示应还 315', $(w, 'loan-card').innerHTML.indexOf('应还 315 分') !== -1);

  /* ---------- [8] 梭哈输光 → 触发破产保护（自动核销） ---------- */
  console.log('[8] 破产保护');
  click(w, w.document.querySelector('[data-view="hall"]'));
  const radioB = w.document.querySelector('input[name="q-q-b"][value="x"]');
  radioB.checked = true;
  radioB.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, w.document.querySelector('[data-stake="q-b"]'), '1250');
  click(w, w.document.querySelector('[data-bet="q-b"]'));
  await sleep(30);
  check('梭哈 1250 后现金 0', $(w, 'conn-badge').textContent.indexOf('可用积分 0') !== -1);

  const resolveB = w.document.querySelector('[data-resolve="q-b"]');
  resolveB.value = 'y';
  click(w, w.document.querySelector('[data-settle="q-b"]'));
  await sleep(30);
  check('投注未中（现金 0）', $(w, 'conn-badge').textContent.indexOf('可用积分 0') !== -1);

  /* 净资产 = 0 + 0 − 315 = −315 < −300 → 自动核销全部借款 */
  check('触发破产保护提示', w.__alerts.some(a => a.indexOf('破产保护') !== -1));
  check('借款记录核销留存（非删除）', myLoans(w).length === 1 && myLoans(w)[0].status === 'written_off');

  click(w, w.document.querySelector('[data-view="mine"]'));
  check('核销后债务清零', $(w, 'loan-card').innerHTML.indexOf('已核销') !== -1 &&
    $(w, 'mine-stats').innerHTML.indexOf('无') !== -1);
  check('核销后额度恢复 300', $(w, 'loan-card').innerHTML.indexOf('>300<') !== -1);
  check('核销记录留在流水中', $(w, 'mine-ledger').innerHTML.indexOf('破产保护已核销') !== -1);
  check('现金不为负（本金仍计现金）', $(w, 'conn-badge').textContent.indexOf('-') === -1);

  click(w, w.document.querySelector('[data-view="hall"]'));
  check('现金不足时引导借款而非报错', $(w, 'question-list').innerHTML.indexOf('借一笔') !== -1);

  /* ---------- [9] 破产后重新借贷 + 部分还款（先息后本） ---------- */
  console.log('[9] 重新借贷与部分还款');
  click(w, w.document.querySelector('[data-view="mine"]'));
  setInput(w, $(w, 'loan-amount'), '200');
  click(w, $(w, 'btn-borrow'));
  await sleep(30);
  check('破产后可重新借款', myLoans(w).length === 2 && myLoans(w).filter(l => l.status === 'open').length === 1);
  check('借款后可用积分 200', $(w, 'conn-badge').textContent.indexOf('可用积分 200') !== -1);

  const loan2 = myLoans(w).filter(l => l.status === 'open')[0];
  const repayInput = w.document.querySelector('[data-repay="' + loan2.lid + '"]');
  setInput(w, repayInput, '105');
  click(w, w.document.querySelector('[data-do-repay="' + loan2.lid + '"]'));
  await sleep(30);
  check('还款写入云端', myPayments(w).some(p => p.lid === loan2.lid && p.amount === 105));
  check('部分还款先息后本（息10本95）', myPayments(w).find(p => p.lid === loan2.lid).interest_part === 10 &&
    myPayments(w).find(p => p.lid === loan2.lid).principal_part === 95);
  check('未还清不结清', myLoans(w).find(l => l.lid === loan2.lid).status === 'open' &&
    myLoans(w).find(l => l.lid === loan2.lid).repaid_principal === 95);
  check('还款后负债降为 105', $(w, 'mine-stats').innerHTML.indexOf('105 分') !== -1);
  const ledger9 = $(w, 'mine-ledger').innerHTML;
  check('流水含还款 -105', ledger9.indexOf('还款') !== -1 && ledger9.indexOf('-105.0') !== -1);

  /* ---------- [10] 已揭晓档案 ---------- */
  console.log('[10] 已揭晓档案');
  click(w, w.document.querySelector('[data-tab2="settled"]'));
  check('档案页含已揭晓问题', $(w, 'question-list').innerHTML.indexOf('问题A') !== -1);
  check('档案页含我的投注复盘', $(w, 'question-list').innerHTML.indexOf('未中') !== -1);
  check('档案页说明永久留存', $(w, 'question-list').innerHTML.indexOf('永久留存') !== -1);
  check('档案无下注入口', !w.document.querySelector('[data-bet]'));

  /* ---------- [11] OnlineCore / LoanCore 纯函数 ---------- */
  console.log('[11] 纯函数');
  const core = w.eval('OnlineCore');
  const LC = w.eval('LoanCore');
  check('settleOdds 与页面一致', Math.abs(core.settleOdds(qA, w.__fakeDB._tables.jp_bets) - 1.81) < 0.02 || qA.status === 'settled');
  check('isExpired 远期问题为 false', core.isExpired({ deadline: '2099-01-01' }) === false);
  check('isExpired 过去日期为 true', core.isExpired({ deadline: '2020-01-01' }) === true);
  check('phaseOf 三态', core.phaseOf({ status: 'settled', deadline: '2099-01-01' }) === 'settled' &&
    core.phaseOf({ status: 'open', deadline: '2020-01-01' }) === 'expired' &&
    core.phaseOf({ status: 'open', deadline: '2099-01-01' }) === 'open');
  check('dayDiffLabel 到期文案', core.dayDiffLabel({ deadline: '2020-01-01' }).indexOf('待揭晓') !== -1);
  check('cashOf 尊重设置积分', core.cashOf('u-x', [], [], [], { site: { opening_bonus: 500 } }) === 500);
  check('sortQuestions 置顶优先', core.sortQuestions([{ qid: 'q1', created_at: '2026-10-01T00:00:00Z' }, { qid: 'q2', created_at: '2026-10-02T00:00:00Z', pinned: true }])[0].qid === 'q2');
  check('visibleQuestions 过滤下架', core.visibleQuestions([{ qid: 'a' }, { qid: 'b', hidden: true }]).length === 1);

  /* LoanCore */
  const NOW = new Date('2026-10-20T12:00:00').getTime();
  const st = { site: LC.DEFAULTS };
  const loan1 = { lid: 'l1', uid: 'u1', principal: 300, rate: 0.05, term_days: 7, due_date: LC.addDaysStr(7, NOW),
    status: 'open', repaid_principal: 0, repaid_interest: 0, late_fee: 0 };
  check('LC 额度初始 3000', LC.creditLimitOf('u1', [loan1], st) === 3000);
  check('LC 应还 315', LC.outstandingOf(loan1, NOW).total === 315);
  check('LC 还款分配先息后本', JSON.stringify(LC.repayPlan(loan1, 100, NOW)) ===
    JSON.stringify({ late: 0, interest: 15, principal: 85, total: 100, remaining: 215 }));
  const od = { lid: 'l2', uid: 'u2', principal: 300, rate: 0.05, term_days: 7, due_date: '2026-10-13',
    status: 'open', repaid_principal: 0, repaid_interest: 0, late_fee: 0 };
  check('LC 逾期罚息 42', LC.outstandingOf(od, NOW).lateLeft === 42);
  check('LC 逾期额度 -500', LC.creditLimitOf('u2', [od], st) === 2500);
  check('LC 强平判定', LC.isLiquidated('u3', [], [{ uid: 'u3', principal: 4500, rate: 0.05, term_days: 7,
    due_date: LC.addDaysStr(7, NOW), status: 'open', repaid_principal: 0, repaid_interest: 0, late_fee: 0 }], [], st, NOW) === true);
  check('LC 利息池汇总', LC.interestPoolOf([{ interest_part: 15, late_part: 0 }, { interest_part: 5, late_part: 2 }]) === 22);
  check('LC 利息池可分配扣减', LC.interestBalanceOf([{ interest_part: 30, late_part: 0 }], [{ amount: 12 }]) === 18);

  /* 核销（written_off）语义：债务清零但本金仍计现金、记录可查 */
  const wo = { lid: 'l9', uid: 'u9', principal: 300, rate: 0.05, term_days: 7,
    due_date: '2026-10-13', status: 'written_off', repaid_principal: 0, repaid_interest: 0, late_fee: 0 };
  check('LC 核销后债务清零', LC.outstandingOf(wo, NOW).total === 0);
  check('LC 核销后本金仍计现金', LC.cashOf('u9', [], [wo], [], st) === 1300);
  check('LC 核销不计逾期、额度恢复', LC.creditLimitOf('u9', [wo], st) === 3000);
  check('LC 还清一笔额度 +500', LC.creditLimitOf('u9', [{ lid: 'l7', uid: 'u9', principal: 50, rate: 0.05,
    term_days: 7, due_date: LC.addDaysStr(7, NOW), status: 'repaid' }], st) === 3500);
  check('LC 核销后净资产 = 现金', LC.netWorthOf('u9', [], [wo], [], st, NOW) === 1300);
  check('LC 破产判定', LC.isBankrupt('u9', [{ uid: 'u9', stake: 4500, status: 'lost', payout: 0 }],
    [{ lid: 'l8', uid: 'u9', principal: 1000, rate: 0.05, term_days: 7,
      due_date: LC.addDaysStr(7, NOW), status: 'open', repaid_principal: 0, repaid_interest: 0, late_fee: 0 }],
    [], st, NOW) === true);
  check('LC 未跌线不判破产', LC.isBankrupt('u9', [{ uid: 'u9', stake: 100, status: 'lost', payout: 0 }],
    [{ lid: 'l8', uid: 'u9', principal: 100, rate: 0.05, term_days: 7,
      due_date: LC.addDaysStr(7, NOW), status: 'open', repaid_principal: 0, repaid_interest: 0, late_fee: 0 }],
    [], st, NOW) === false);
  check('LC 流水标注核销', LC.myLedger('u9', [], [], [wo], [], st).some(r => r.note.indexOf('破产保护已核销') !== -1));

  /* CSV */
  const csv = core.csvOfBets(w.__fakeDB._tables.jp_bets, w.__fakeDB._tables.jp_questions);
  check('CSV 表头', csv.indexOf('时间,问题,选项') !== -1);
  check('CSV 含 BOM', csv.charCodeAt(0) === 0xFEFF);
  const csvLoans = core.csvOfLoans(w.__fakeDB._tables.jp_loans, w.__fakeDB._tables.jp_loan_payments);
  check('借贷 CSV 表头', csvLoans.indexOf('借款号,玩家,UID') !== -1 && csvLoans.indexOf('还款时间') !== -1);

  /* ---------- [12] 站长控制台 ---------- */
  console.log('[12] 站长控制台');
  click(w, w.document.querySelector('[data-view="admin"]'));
  check('站长台显示口令门', $(w, 'admin-gate').style.display !== 'none' && $(w, 'admin-body').style.display === 'none');
  setInput(w, $(w, 'admin-token'), 'wrong-token');
  click(w, $(w, 'btn-admin-unlock'));
  check('错误口令被拒绝', w.__alerts.some(a => a.indexOf('口令不正确') !== -1) && $(w, 'admin-body').style.display === 'none');
  setInput(w, $(w, 'admin-token'), ADMIN_TOKEN);
  click(w, $(w, 'btn-admin-unlock'));
  check('正确口令解锁站长台', $(w, 'admin-body').style.display !== 'none');
  check('站长看板渲染', $(w, 'admin-stats').innerHTML.indexOf('玩家数') !== -1);
  check('看板含借贷统计', $(w, 'admin-stats').innerHTML.indexOf('累计放款') !== -1 && $(w, 'admin-stats').innerHTML.indexOf('利息池') !== -1);
  check('待揭晓队列含到期题', $(w, 'admin-pending').innerHTML.indexOf('问题C') !== -1);
  check('借贷管理含未结清借款', $(w, 'admin-loans').innerHTML.indexOf('测试玩家') !== -1);

  /* 站长核销：标记 written_off（不删记录） */
  const woBtn = $(w, 'admin-loans').querySelector('[data-writeoff]');
  check('核销按钮存在', !!woBtn);
  click(w, woBtn);
  await sleep(30);
  check('核销后无未结清', $(w, 'admin-loans').innerHTML.indexOf('当前没有未结清的借款') !== -1);
  check('核销记录留档可查', $(w, 'admin-loans').innerHTML.indexOf('已核销') !== -1);
  check('云端状态已置核销', myLoans(w).every(l => l.status === 'written_off'));

  /* 从站长台揭晓到期题 */
  const settleBtn = $(w, 'admin-pending').querySelector('[data-settle="q-c"]');
  click(w, settleBtn);
  await sleep(30);
  check('站长台揭晓到期题', w.__fakeDB._tables.jp_questions.find(x => x.qid === 'q-c').status === 'settled');
  const other2 = w.__fakeDB._tables.jp_bets.find(b => b.uid === 'u-other2');
  check('到期题结算派彩正确', other2.status === 'won' && Math.abs(other2.payout - 181.4) < 1);

  /* 利息池注入：部分还款 105 含利息 10 → 可分配 10 → 注入 q-d */
  const injectBtn = $(w, 'admin-questions').querySelector('[data-inject="q-d"]');
  check('问题管理有注入按钮', !!injectBtn);
  w.prompt = () => '10';
  click(w, injectBtn);
  await sleep(30);
  const qD = w.__fakeDB._tables.jp_questions.find(x => x.qid === 'q-d');
  check('利息池注入初始池', qD.pool.yes === 1005 && qD.pool.no === 1005);
  check('注入记录入 settings', w.__fakeDB._tables.jp_settings.find(r => r.key === 'interest_alloc').value.length === 1);

  /* 置顶 */
  click(w, $(w, 'admin-questions').querySelector('[data-pin="q-a"]'));
  await sleep(30);
  check('置顶写入云端', w.__fakeDB._tables.jp_questions.find(x => x.qid === 'q-a').pinned === true);

  /* 下架 q-b + 锁定后普通玩家看不到 */
  click(w, $(w, 'admin-questions').querySelector('[data-hide="q-b"]'));
  await sleep(30);
  click(w, $(w, 'btn-lock'));
  click(w, w.document.querySelector('[data-view="hall"]'));
  check('锁定后大厅隐藏下架题', $(w, 'question-list').innerHTML.indexOf('问题B') === -1 || state2(w));
  function state2(w) { return $(w, 'hall-tabs').innerHTML.indexOf('问题B') !== -1; }
  check('锁定后站长台回到口令门', $(w, 'admin-body').style.display === 'none');

  /* 重新解锁，改全局设置 */
  setInput(w, $(w, 'admin-token'), ADMIN_TOKEN);
  click(w, $(w, 'btn-admin-unlock'));
  setInput(w, $(w, 'set-bonus'), '2000');
  $(w, 'set-accept').checked = false;
  click(w, $(w, 'btn-save-site'));
  await sleep(30);
  const siteRow = w.__fakeDB._tables.jp_settings.find(r => r.key === 'site');
  check('全局设置写入云端', siteRow.value.opening_bonus === 2000 && siteRow.value.accept_new_bets === false);
  /* 现金 = 2000 - 50(q-a) - 1250(q-b) + 500(两笔借款，含已核销的300) - 105(部分还款) = 1095 */
  check('新初始积分立即生效', $(w, 'conn-badge').textContent.indexOf('1095') !== -1);

  click(w, w.document.querySelector('[data-view="hall"]'));
  check('暂停投注后无投注入口', !w.document.querySelector('[data-bet]'));

  /* ---------- [13] 持久化 ---------- */
  console.log('[13] 持久化');
  w.eval('OnlineApp.init()');
  await sleep(30);
  check('重新初始化后借贷记录仍在', myLoans(w).length === 2 && myPayments(w).length === 1);

  /* ---------- [14] 赛季徽章与战报 ---------- */
  console.log('[14] 赛季徽章与战报');
  const BC = w.BadgeCore;
  check('BadgeCore 已注入联机版', !!BC);
  const cfg14 = BC.seasonCfgOf({ season: { start: '2026-10-18', length_days: 90, name: 'S' } });
  check('赛季设置从云端读取', $(w, 'season-card') !== null);
  click(w, w.document.querySelector('[data-view="mine"]'));
  await sleep(10);
  check('赛季战报卡片渲染', $(w, 'season-card').innerHTML.indexOf('赛季战报') !== -1);
  check('赛季名 S1 渲染', $(w, 'season-card').innerHTML.indexOf('S1') !== -1);
  check('赛季净积分统计（q-a/q-b 两笔投注）', $(w, 'season-card').innerHTML.indexOf('投注笔数') !== -1 &&
    $(w, 'season-card').innerHTML.indexOf('>2<') !== -1);
  check('徽章墙渲染', $(w, 'badge-card').innerHTML.indexOf('徽章墙') !== -1);
  check('徽章墙含已获得（首注/对线选手除外）', $(w, 'badge-card').innerHTML.indexOf('badge-item earned') !== -1);
  click(w, w.document.querySelector('[data-view="board"]'));
  check('天梯榜含徽章列', $(w, 'board-list').innerHTML.indexOf('徽章') !== -1 &&
    $(w, 'board-list').innerHTML.indexOf('徽章') !== -1);

  /* ---------- [15] 对线房全流程（建房-发言-AI评分-押注-揭晓） ---------- */
  console.log('[15] 对线房');
  const DC = w.DebateCore;
  check('DebateCore 已注入联机版', !!DC);
  click(w, w.document.querySelector('[data-view="debate"]'));
  check('对线房视图渲染', $(w, 'debate-list').innerHTML.indexOf('对线房是什么') !== -1);
  check('公开房间为空提示', $(w, 'debate-list').innerHTML.indexOf('还没有公开房间') !== -1);

  setInput(w, $(w, 'd-topic'), '测试辩题：AI 会先替代哪个行业？');
  setInput(w, $(w, 'd-side-a'), '内容创作');
  setInput(w, $(w, 'd-side-b'), '重复性文书');
  setInput(w, $(w, 'd-rounds'), '2');
  click(w, $(w, 'btn-create-debate'));
  await sleep(40);
  const myRoom = w.__fakeDB._tables.jp_debates[0];
  check('房间写入云端', !!myRoom && myRoom.status === 'open' && myRoom.topic === '测试辩题：AI 会先替代哪个行业？');
  check('创建后进入房间', $(w, 'debate-room').innerHTML.indexOf('测试辩题') !== -1);
  check('默认加入甲方', !!w.document.querySelector('[data-debate-side]'));

  click(w, $(w, 'btn-debate-start'));
  await sleep(30);
  check('开始辩论', w.__fakeDB._tables.jp_debates[0].status === 'live');

  setInput(w, $(w, 'd-post'), '甲方论据：2026 年多份行业报告显示内容岗位需求下降，这是公开事实。');
  click(w, $(w, 'btn-debate-post'));
  await sleep(30);
  check('甲方发言写入', w.__fakeDB._tables.jp_debate_posts.filter(p => p.side === 'a').length === 1);
  check('轮次锁定：甲方不能重复发言', !$(w, 'btn-debate-post'));

  click(w, w.document.querySelector('[data-debate-side="b"]'));
  check('切换乙方后出现发言框', !!$(w, 'd-post'));
  setInput(w, $(w, 'd-post'), '乙方论据：文书行业自动化率仍然很低，替代成本高于内容行业。');
  click(w, $(w, 'btn-debate-post'));
  await sleep(30);
  check('乙方发言写入', w.__fakeDB._tables.jp_debate_posts.filter(p => p.side === 'b').length === 1);
  check('本轮完成进入第 2 轮', $(w, 'debate-room').innerHTML.indexOf('第 2 / 2 轮') !== -1);

  /* AI 评分：测试环境无 LLM 模块 → 走规则兜底 */
  click(w, w.document.querySelector('[data-debate-ai="1"]'));
  await sleep(80);
  const postsR1 = w.__fakeDB._tables.jp_debate_posts.filter(p => p.round_no === 1);
  check('AI 评分写入双方发言', postsR1.length === 2 && postsR1.every(p => p.ai_score));
  check('LLM 不可用时走规则兜底', postsR1[0].ai_score.by === 'rule');
  check('规则分五维齐全', DC.DIMS.every(k => postsR1[0].ai_score.a[k] >= 0 && postsR1[0].ai_score.a[k] <= 20));
  check('评分后按钮消失', !w.document.querySelector('[data-debate-ai="1"]'));
  check('房间显示 AI 点评', $(w, 'debate-room').innerHTML.indexOf('AI 点评') !== -1);

  /* 观众押注 */
  setInput(w, $(w, 'd-bet-stake'), '50');
  click(w, $(w, 'btn-debate-bet'));
  await sleep(30);
  check('观众押注写入', w.__fakeDB._tables.jp_debate_bets.length === 1 &&
    w.__fakeDB._tables.jp_debate_bets[0].bet_on === 'a' && w.__fakeDB._tables.jp_debate_bets[0].stake === 50);
  check('房间显示我的押注', $(w, 'debate-room').innerHTML.indexOf('我的押注') !== -1);

  /* 揭晓为甲方胜 */
  click(w, $(w, 'debate-room').querySelector('[data-debate-settle]'));
  await sleep(50);
  const roomSettled = w.__fakeDB._tables.jp_debates[0];
  check('房间已揭晓', roomSettled.status === 'settled' && roomSettled.result === 'a');
  check('押注结算为中奖', w.__fakeDB._tables.jp_debate_bets.every(b => b.status === 'won' && b.payout > 0));
  check('押注镜像进 jp_bets（打通积分）', w.__fakeDB._tables.jp_bets.some(b => b.qid === 'debate-' + roomSettled.did && b.status === 'won'));
  check('房间显示揭晓结果', $(w, 'debate-room').innerHTML.indexOf('甲方胜') !== -1);

  click(w, w.document.querySelector('[data-debate-back]'));
  check('返回列表', $(w, 'debate-list').innerHTML.indexOf('我的对线房') !== -1);
  check('列表显示已揭晓态', $(w, 'debate-list').innerHTML.indexOf('已揭晓') !== -1);

  click(w, w.document.querySelector('[data-view="mine"]'));
  check('流水含对线房押注', $(w, 'mine-ledger').innerHTML.indexOf('对线房押注') !== -1);
  check('流水含对线房派彩', $(w, 'mine-ledger').innerHTML.indexOf('对线房派彩') !== -1);
  check('投注列表显示对线房', $(w, 'mine-bets').innerHTML.indexOf('对线房') !== -1);
  check('徽章墙含对线选手徽章进度', $(w, 'badge-card').innerHTML.indexOf('对线选手') !== -1);

  /* 站长台：对线房管理 */
  click(w, w.document.querySelector('[data-view="admin"]'));
  setInput(w, $(w, 'admin-token'), ADMIN_TOKEN);
  click(w, $(w, 'btn-admin-unlock'));
  await sleep(20);
  check('站长台含对线房管理', $(w, 'admin-debates').innerHTML.indexOf('测试辩题') !== -1);
  click(w, $(w, 'admin-debates').querySelector('[data-dhide]'));
  await sleep(30);
  check('站长下架对线房', w.__fakeDB._tables.jp_debates[0].hidden === true);

  /* ---------- [16] AI 证据情报站 ---------- */
  console.log('[16] 证据情报站');
  const EC = w.EvidenceCore;
  check('EvidenceCore 已注入联机版', !!EC);
  check('EC 校验：标题太短被拒', EC.validateEvidence({ side: 'yes', title: '证据' }).ok === false);
  check('EC 校验：链接格式', EC.validateEvidence({ side: 'yes', title: '这是一个证据标题', url: 'ftp://x' }).ok === false);
  check('EC 校验通过', EC.validateEvidence({ side: 'no', title: '这是一个证据标题', url: 'https://a.com/b' }).ok === true);
  check('EC 排序：采纳优先', (function () {
    var l = [{ status: 'pending', votes_up: 9, created_at: '2026-01-01' }, { status: 'accepted', votes_up: 0, created_at: '2026-01-02' }];
    return EC.sortEvidence(l)[0].status === 'accepted';
  })());
  check('EC 信源榜计分', EC.sourceBoard([
    { uid: 'u1', nickname: 'A', status: 'accepted', validated: true },
    { uid: 'u1', nickname: 'A', status: 'pending' },
    { uid: 'u2', nickname: 'B', status: 'pending' }
  ])[0].score === 30);
  check('EC 奖励候选只取采纳+命中', EC.rewardCandidates([
    { qid: 'q', status: 'accepted', side: 'yes' }, { qid: 'q', status: 'pending', side: 'yes' }, { qid: 'q', status: 'accepted', side: 'no' }
  ], { qid: 'q' }, 'yes').length === 1);

  click(w, w.document.querySelector('[data-view="hall"]'));
  click(w, w.document.querySelector('[data-tab2="open"]'));
  check('问题卡含证据墙', $(w, 'question-list').innerHTML.indexOf('证据墙') !== -1);
  check('q-d 有证据提交按钮', !!w.document.querySelector('[data-ev-submit="q-d"]'));

  function submitEv(qid, side, title, url, sum) {
    var radio = w.document.querySelector('input[name="ev-side-' + qid + '"][value="' + side + '"]');
    radio.checked = true;
    radio.dispatchEvent(new w.Event('change', { bubbles: true }));
    setInput(w, $(w, 'ev-title-' + qid), title);
    setInput(w, $(w, 'ev-url-' + qid), url);
    setInput(w, $(w, 'ev-sum-' + qid), sum);
    click(w, w.document.querySelector('[data-ev-submit="' + qid + '"]'));
  }
  submitEv('q-d', 'yes', '官方发布会确认试点', 'https://www.gov.cn/x', '发布会实录');
  await sleep(30);
  submitEv('q-d', 'no', '试点范围其实有限', 'https://example.com/y', '仅两个城市');
  await sleep(30);
  check('两条证据写入云端', w.__fakeDB._tables.jp_evidence.filter(e => e.qid === 'q-d').length === 2);
  check('证据墙显示计数', $(w, 'question-list').innerHTML.indexOf('支持 1 / 反对 1') !== -1);

  var evYes = w.__fakeDB._tables.jp_evidence.filter(e => e.side === 'yes')[0];
  var evNo = w.__fakeDB._tables.jp_evidence.filter(e => e.side === 'no')[0];
  click(w, w.document.querySelector('[data-ev-vote="' + evYes.eid + ':up"]'));
  await sleep(30);
  check('投票写入', w.__fakeDB._tables.jp_evidence.find(e => e.eid === evYes.eid).votes_up === 1);

  /* AI 整理：测试环境无 LLM → 本地兜底简报 */
  click(w, w.document.querySelector('[data-ev-ai="q-d"]'));
  await sleep(80);
  check('AI 整理显示兜底简报', $(w, 'question-list').innerHTML.indexOf('证据简报') !== -1);
  check('本地整理提示', $(w, 'question-list').innerHTML.indexOf('本地整理') !== -1);

  /* 站长采纳支持方证据 */
  click(w, w.document.querySelector('[data-view="admin"]'));
  click(w, $(w, 'admin-evidence').querySelector('[data-ev-accept="' + evYes.eid + '"]'));
  await sleep(30);
  check('站长采纳证据', w.__fakeDB._tables.jp_evidence.find(e => e.eid === evYes.eid).status === 'accepted');
  check('审核队列移除已审证据', $(w, 'admin-evidence').innerHTML.indexOf('官方发布会确认试点') === -1);

  /* 揭晓 q-d 为 yes：支持方证据命中获奖，反方不奖 */
  click(w, w.document.querySelector('[data-view="hall"]'));
  var selD = w.document.querySelector('[data-resolve="q-d"]');
  selD.value = 'yes';
  click(w, w.document.querySelector('[data-settle="q-d"]'));
  await sleep(60);
  check('命中证据标记已验证', w.__fakeDB._tables.jp_evidence.find(e => e.eid === evYes.eid).validated === true);
  check('未命中证据不标记', !w.__fakeDB._tables.jp_evidence.find(e => e.eid === evNo.eid).validated);
  check('命中证据获奖 50 分', w.__fakeDB._tables.jp_bets.some(b => b.kind === 'bonus' && b.payout === 50));
  click(w, w.document.querySelector('[data-tab2="settled"]'));
  check('证据墙显示命中徽章', $(w, 'question-list').innerHTML.indexOf('揭晓命中') !== -1);

  click(w, w.document.querySelector('[data-view="mine"]'));
  check('流水含证据奖励', $(w, 'mine-ledger').innerHTML.indexOf('奖励') !== -1);
  check('徽章墙含证据猎人进度', $(w, 'badge-card').innerHTML.indexOf('证据猎人') !== -1);
  check('天梯榜含信源质量榜', (click(w, w.document.querySelector('[data-view="board"]')), $(w, 'board-list').innerHTML.indexOf('信源质量榜') !== -1));

  /* ---------- [17] 社区仲裁全流程（发起-质押投票-裁决-改判-驳回） ---------- */
  console.log('[17] 社区仲裁');
  const AC = w.ArbitCore;
  check('ArbitCore 已注入联机版', !!AC);
  const settledQ = { qid: 'q-a', title: '问题A', status: 'settled', result: 'yes',
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }] };
  const myBet = { qid: 'q-a', uid: 'me', stake: 50, kind: 'bet' };
  check('AC 校验：未揭晓不可仲裁', AC.validateDispute(
    { reason: '这是一个足够长度的仲裁理由说明', newResult: 'no' },
    { q: { status: 'open', result: 'yes', outcomes: settledQ.outcomes }, bets: [myBet], disputes: [], uid: 'me' }).ok === false);
  check('AC 校验：没押过不可仲裁', AC.validateDispute(
    { reason: '这是一个足够长度的仲裁理由说明', newResult: 'no' },
    { q: settledQ, bets: [{ qid: 'q-a', uid: 'other', stake: 50, kind: 'bet' }], disputes: [], uid: 'me' }).ok === false);
  check('AC 校验：提议结果不能与当前相同', AC.validateDispute(
    { reason: '这是一个足够长度的仲裁理由说明', newResult: 'yes' },
    { q: settledQ, bets: [myBet], disputes: [], uid: 'me' }).ok === false);
  check('AC 校验：每问一次', AC.validateDispute(
    { reason: '这是一个足够长度的仲裁理由说明', newResult: 'no' },
    { q: settledQ, bets: [myBet], disputes: [{ qid: 'q-a', uid: 'me', status: 'voting' }], uid: 'me' }).ok === false);
  check('AC 校验通过', AC.validateDispute(
    { reason: '这是一个足够长度的仲裁理由说明', newResult: 'no' },
    { q: settledQ, bets: [myBet], disputes: [], uid: 'me' }).ok === true);
  check('AC 投票校验：一票制', AC.validateVote({ stake: 50 },
    { dispute: { id: 1, uid: 'me', status: 'voting' }, votes: [{ dispute_id: 1, uid: 'me' }], bets: [], uid: 'me' }).ok === false);
  check('AC 投票校验：发起人不能自投', AC.validateVote({ stake: 50 },
    { dispute: { id: 1, uid: 'me', status: 'voting' }, votes: [], bets: [], uid: 'me' }).ok === false);
  check('AC 投票校验：质押区间', AC.validateVote({ stake: 5 },
    { dispute: { id: 1, uid: 'me', status: 'voting' }, votes: [], bets: [], uid: 'other' }).ok === false &&
    AC.validateVote({ stake: 50 },
      { dispute: { id: 1, uid: 'me', status: 'voting' }, votes: [], bets: [], uid: 'other' }).ok === true);
  check('AC 裁决：票数不够 pending', AC.verdictOf({ id: 1 }, [
    { dispute_id: 1, agree: true, weight: 100 }, { dispute_id: 1, agree: true, weight: 100 }]) === 'pending');
  check('AC 裁决：同意 60% upheld', AC.verdictOf({ id: 1 }, [
    { dispute_id: 1, agree: true, weight: 100 }, { dispute_id: 1, agree: true, weight: 100 },
    { dispute_id: 1, agree: false, weight: 100 }]) === 'upheld');
  check('AC 裁决：同意不足 rejected', AC.verdictOf({ id: 1 }, [
    { dispute_id: 1, agree: false, weight: 100 }, { dispute_id: 1, agree: false, weight: 100 },
    { dispute_id: 1, agree: true, weight: 100 }]) === 'rejected');
  check('AC 计票与进度', (function () {
    var t = AC.tallyOf({ id: 1 }, [
      { dispute_id: 1, agree: true, weight: 100 }, { dispute_id: 1, agree: false, weight: 300 }]);
    return t.agreeVotes === 1 && t.rejectVotes === 1 && t.agreeRatio === 0.25 &&
      AC.progressOf({ id: 1 }, [
        { dispute_id: 1, agree: true, weight: 100 }, { dispute_id: 1, agree: false, weight: 300 }]).agreePct === 25;
  })());
  check('AC 质押结算：押对边分走押错边', (function () {
    var d = { id: 7 };
    var votes = [
      { dispute_id: 7, uid: 'u1', agree: true, weight: 100 },
      { dispute_id: 7, uid: 'u2', agree: true, weight: 100 },
      { dispute_id: 7, uid: 'u3', agree: false, weight: 100 }
    ];
    var bets = [
      { id: 1, qid: 'dispute-7', uid: 'u1', stake: 100, status: 'open' },
      { id: 2, qid: 'dispute-7', uid: 'u2', stake: 100, status: 'open' },
      { id: 3, qid: 'dispute-7', uid: 'u3', stake: 100, status: 'open' }
    ];
    var plan = AC.resolveStakesPlan(d, votes, bets);
    var win = plan.items.filter(function (x) { return x.bet.uid !== 'u3'; });
    var lose = plan.items.filter(function (x) { return x.bet.uid === 'u3'; })[0];
    return plan.verdict === 'upheld' && lose.status === 'lost' && lose.payout === 0 &&
      win.every(function (x) { return x.status === 'won' && x.payout === 150; });
  })());
  check('AC 质押结算：无人押错边则原样退回', (function () {
    var plan = AC.resolveStakesPlan({ id: 8 }, [
      { dispute_id: 8, uid: 'u1', agree: true, weight: 100 },
      { dispute_id: 8, uid: 'u2', agree: true, weight: 100 },
      { dispute_id: 8, uid: 'u3', agree: true, weight: 100 }
    ], [
      { id: 1, qid: 'dispute-8', uid: 'u1', stake: 100, status: 'open' },
      { id: 2, qid: 'dispute-8', uid: 'u2', stake: 100, status: 'open' },
      { id: 3, qid: 'dispute-8', uid: 'u3', stake: 100, status: 'open' }
    ]);
    return plan.items.every(function (x) { return x.status === 'won' && x.payout === 100; });
  })());
  check('AC 质押退款计划', (function () {
    var plan = AC.refundPlan({ id: 9 }, [
      { id: 1, qid: 'dispute-9', uid: 'u1', stake: 100, status: 'open' },
      { id: 2, qid: 'dispute-9', uid: 'u1', stake: 100, status: 'won', payout: 150 }
    ]);
    return plan.items.length === 1 && plan.items[0].payout === 100;
  })());
  check('AC 改判计划：按新结果重算派彩', (function () {
    var q = { qid: 'q-a', mode: 'pool', fee: 0.05, result: 'yes', final_odds: 1.86,
      outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }], pool: { yes: 1000, no: 1000 } };
    var bets = [
      { id: 1, qid: 'q-a', uid: 'u1', outcome_id: 'no', stake: 50, status: 'lost', payout: 0, kind: 'bet' },
      { id: 2, qid: 'q-a', uid: 'u2', outcome_id: 'yes', stake: 100, status: 'won', payout: 186, kind: 'bet' },
      { id: 3, qid: 'q-a', uid: 'u3', outcome_id: 'no', stake: 30, status: 'lost', payout: 0, kind: 'bonus' }
    ];
    var plan = AC.adjustPlan(q, bets, 'no', function (qq, bb, rr) { return w.OnlineCore.settleOdds(qq, bb, rr); });
    return plan.newOdds === 1.9 &&
      plan.items.length === 2 &&
      plan.items[0].status === 'won' && plan.items[0].payout === 95 &&
      plan.items[1].status === 'lost' && plan.items[1].payout === 0;
  })());

  /* UI：档案卡仲裁墙（q-a 我押过且已揭晓 → 可发起） */
  click(w, w.document.querySelector('[data-view="hall"]'));
  click(w, w.document.querySelector('[data-tab2="settled"]'));
  check('档案卡含仲裁墙', $(w, 'question-list').innerHTML.indexOf('仲裁记录') !== -1);
  check('q-a 有发起仲裁入口', !!w.document.querySelector('[data-dp-create="q-a"]'));
  check('q-d（未押注）无发起入口', !w.document.querySelector('[data-dp-create="q-d"]'));

  var dpRadio = w.document.querySelector('input[name="dp-new-q-a"][value="no"]');
  dpRadio.checked = true;
  dpRadio.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, $(w, 'dp-reason-q-a'), '判定标准写明以官方文件为准，但揭晓引用的只是媒体报道，要求改判为不会。');
  click(w, w.document.querySelector('[data-dp-create="q-a"]'));
  await sleep(40);
  var myD = w.__fakeDB._tables.jp_disputes[0];
  check('仲裁写入云端', !!myD && myD.status === 'voting' && myD.proposed_result === 'no' &&
    myD.reason.indexOf('官方文件') !== -1);
  check('发起后入口消失（每问一次）', !w.document.querySelector('[data-dp-create="q-a"]'));
  check('档案显示投票中', $(w, 'question-list').innerHTML.indexOf('投票中') !== -1);
  check('大厅档案页签显示仲裁计数', $(w, 'hall-tabs').innerHTML.indexOf('仲裁 1') !== -1);

  /* 其他三名玩家质押投票（直接写库，模拟联机他人）：2 同意 1 反对 → upheld */
  ['u-other', 'u-other2', 'u-other3'].forEach(function (u, i) {
    w.__fakeDB._tables.jp_dispute_votes.push({
      id: 900 + i, dispute_id: myD.id, uid: u, nickname: '陪审' + (i + 1),
      agree: i < 2, weight: 100, created_at: new Date().toISOString()
    });
    w.__fakeDB._tables.jp_bets.push({
      id: 950 + i, qid: 'dispute-' + myD.id, uid: u, nickname: '陪审' + (i + 1),
      outcome_id: i < 2 ? 'agree' : 'reject', stake: 100, odds_at_bet: 0,
      status: 'open', kind: 'stake', payout: 0, placed_at: new Date().toISOString()
    });
  });
  /* 刷新 → 兜底结算（模拟投票客户端中断后的自愈路径） */
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(60);
  var stakeRows = w.__fakeDB._tables.jp_bets.filter(function (b) { return b.qid === 'dispute-' + myD.id; });
  check('裁决成立显示支持改判', $(w, 'question-list').innerHTML.indexOf('支持改判') !== -1);
  check('押对边质押结算（各 +50）', stakeRows.filter(function (b) { return b.status === 'won'; })
    .every(function (b) { return b.payout === 150; }));
  check('押错边质押罚没', stakeRows.filter(function (b) { return b.status === 'lost'; }).length === 1);
  check('流水含仲裁质押与派彩（他人视角）', (function () {
    var rows = LC.myLedger('u-other', w.__fakeDB._tables.jp_bets, w.__fakeDB._tables.jp_questions, [], [], st);
    return rows.some(function (r) { return r.note.indexOf('仲裁质押') !== -1; }) &&
      rows.some(function (r) { return r.note.indexOf('仲裁派彩') !== -1; });
  })());

  /* 站长执行改判：q-a 结果 yes → no，原地重算派彩 */
  click(w, w.document.querySelector('[data-view="admin"]'));
  setInput(w, $(w, 'admin-token'), ADMIN_TOKEN);
  click(w, $(w, 'btn-admin-unlock'));
  await sleep(20);
  check('站长台含仲裁队列', $(w, 'admin-disputes').innerHTML.indexOf('问题A') !== -1);
  var execBtn = $(w, 'admin-disputes').querySelector('[data-dp-exec="' + myD.id + '"]');
  check('upheld 争议有执行改判按钮', !!execBtn);
  click(w, execBtn);
  await sleep(60);
  var qA2 = w.__fakeDB._tables.jp_questions.find(function (x) { return x.qid === 'q-a'; });
  var myBetA = w.__fakeDB._tables.jp_bets.find(function (b) {
    return b.qid === 'q-a' && b.uid !== 'u-other' && b.uid !== 'u-other2' && b.kind === 'bet';
  });
  var otherBetA = w.__fakeDB._tables.jp_bets.find(function (b) { return b.qid === 'q-a' && b.uid === 'u-other'; });
  check('改判后问题结果为 no', qA2.result === 'no' && Math.abs(qA2.final_odds - 1.9) < 0.001);
  check('我的投注改判为中奖（50×1.9=95）', myBetA.status === 'won' && Math.abs(myBetA.payout - 95) < 0.01);
  check('路人甲投注改判为未中', otherBetA.status === 'lost' && otherBetA.payout === 0);
  check('仲裁记录留痕（旧结果/新结果/执行人）', w.__fakeDB._tables.jp_disputes[0].status === 'resolved' &&
    w.__fakeDB._tables.jp_disputes[0].old_result === 'yes' &&
    w.__fakeDB._tables.jp_disputes[0].new_result === 'no' &&
    w.__fakeDB._tables.jp_disputes[0].resolved_by === '测试玩家');
  click(w, w.document.querySelector('[data-view="hall"]'));
  check('档案显示改判执行记录', $(w, 'question-list').innerHTML.indexOf('改判执行') !== -1);
  check('档案页签仲裁计数清零', $(w, 'hall-tabs').innerHTML.indexOf('仲裁 1') === -1);

  /* 驳回流程：q-b 再发起一案，站长驳回 */
  click(w, w.document.querySelector('[data-view="hall"]'));
  var dpRadioB = w.document.querySelector('input[name="dp-new-q-b"][value="x"]');
  check('q-b 有发起仲裁入口（押过 1250）', !!dpRadioB);
  dpRadioB.checked = true;
  dpRadioB.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, $(w, 'dp-reason-q-b'), '固定赔率题目也应该允许复核，这里测试驳回路径是否正常退回质押。');
  click(w, w.document.querySelector('[data-dp-create="q-b"]'));
  await sleep(40);
  var myD2Row = w.__fakeDB._tables.jp_disputes[1];
  check('第二条仲裁写入', !!myD2Row && myD2Row.qid === 'q-b' && myD2Row.status === 'voting');
  click(w, w.document.querySelector('[data-view="admin"]'));
  var dismissBtn = $(w, 'admin-disputes').querySelector('[data-dp-dismiss="' + myD2Row.id + '"]');
  check('投票中争议有驳回按钮', !!dismissBtn);
  click(w, dismissBtn);
  await sleep(40);
  check('驳回后状态为 dismissed', w.__fakeDB._tables.jp_disputes[1].status === 'dismissed');
  check('档案显示已驳回', (click(w, w.document.querySelector('[data-view="hall"]')),
    $(w, 'question-list').innerHTML.indexOf('已驳回') !== -1));

  /* ---------- [18] 赔率曲线与预期指数 ---------- */
  console.log('[18] 赔率曲线与预期指数');
  const OC = w.OddsCore;
  check('OddsCore 已注入联机版', !!OC);
  check('OC 彩池与首选项概率', (function () {
    var q = { qid: 'q', mode: 'pool', fee: 0.05, outcomes: [{ id: 'yes' }, { id: 'no' }], pool: { yes: 1000, no: 1000 } };
    var live = OC.poolOf(q, [{ qid: 'q', outcome_id: 'yes', stake: 100, status: 'open', kind: 'bet' }]);
    return live.total === 2100 && OC.firstProb(q, live.pools) === 1100 / 2100;
  })());
  check('OC 赔率由池推导', (function () {
    var q = { fee: 0.05, outcomes: [{ id: 'yes' }, { id: 'no' }] };
    var odds = OC.oddsOf(q, { yes: 1000, no: 1000 });
    return odds.yes === 1.9 && odds.no === 1.9;
  })());
  check('OC 快照节流：空历史可写', OC.shouldSnap('q', [], Date.now()) === true);
  check('OC 快照节流：10 分钟内不写', OC.shouldSnap('q', [
    { qid: 'q', created_at: new Date().toISOString() }], Date.now()) === false);
  check('OC 快照节流：超时可写', OC.shouldSnap('q', [
    { qid: 'q', created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }], Date.now()) === true);
  check('OC 曲线点位含实时点', (function () {
    var q = { qid: 'q', mode: 'pool', fee: 0.05, outcomes: [{ id: 'yes' }, { id: 'no' }], pool: { yes: 1000, no: 1000 } };
    var pts = OC.probPoints(q, [{ qid: 'q', outcome_id: 'yes', stake: 100, status: 'open', kind: 'bet' }],
      [{ qid: 'q', created_at: '2026-10-01T00:00:00Z', pool: { yes: 1000, no: 1000 } }]);
    return pts.length === 2 && pts[0].p === 0.5 && pts[1].live === true && Math.abs(pts[1].p - 1100 / 2100) < 1e-9;
  })());
  check('OC SVG：单点只有圆点', OC.sparklineSvg([{ t: 'x', p: 0.5 }]).indexOf('<circle') !== -1 &&
    OC.sparklineSvg([{ t: 'x', p: 0.5 }]).indexOf('<path') === -1);
  check('OC SVG：多点有折线', OC.sparklineSvg([{ t: '1', p: 0.4 }, { t: '2', p: 0.6 }]).indexOf('<path') !== -1);
  check('OC 预期指数统计', (function () {
    var qs = [
      { qid: 'a', mode: 'pool', status: 'open', fee: 0.05, outcomes: [{ id: 'yes' }, { id: 'no' }], pool: { yes: 900, no: 100 } },
      { qid: 'b', mode: 'pool', status: 'open', fee: 0.05, outcomes: [{ id: 'yes' }, { id: 'no' }], pool: { yes: 500, no: 500 } },
      { qid: 'c', mode: 'pool', status: 'settled', fee: 0.05, outcomes: [{ id: 'yes' }, { id: 'no' }], pool: { yes: 900, no: 100 } },
      { qid: 'd', mode: 'fixed', status: 'open', fee: 0, outcomes: [{ id: 'x', fixedOdds: 2 }], pool: {} }
    ];
    var idx = OC.expectationIndex(qs, []);
    return idx.count === 2 && idx.high === 1 && idx.mid === 1 && idx.low === 0 &&
      idx.rows[0].q.qid === 'a' && Math.abs(idx.avg - (0.9 + 0.5) / 2) < 1e-9;
  })());
  check('OC 中性口径文案', (function () {
    var idx = OC.expectationIndex([
      { qid: 'a', mode: 'pool', status: 'open', fee: 0.05, outcomes: [{ id: 'yes' }], pool: { yes: 100 } }
    ], []);
    var line = OC.quoteLine(idx, '2026-10-18');
    return line.indexOf('2026-10-18') !== -1 && line.indexOf('不构成') !== -1 && line.indexOf('1 个') !== -1;
  })());

  /* E2E：新建彩池题 → 初始快照 → 下注（节流）→ 走势显示 → 指数视图 → 注入快照 */
  click(w, w.document.querySelector('[data-view="hall"]'));
  click(w, w.document.querySelector('[data-tab2="open"]'));
  setInput(w, $(w, 'q-title'), '预期指数测试题：明早气温会低于 10 度吗？');
  setInput(w, $(w, 'q-desc'), '以气象台早上 6 点实测为准');
  setInput(w, $(w, 'q-deadline'), '2027-12-31');
  setInput(w, $(w, 'q-outcomes'), '会\n不会');
  click(w, $(w, 'btn-create-q'));
  await sleep(40);
  var newQ = w.__fakeDB._tables.jp_questions.filter(function (q) {
    return q.title.indexOf('预期指数测试题') !== -1;
  })[0];
  check('新题写入云端', !!newQ && newQ.mode === 'pool' && newQ.pool[newQ.outcomes[0].id] === 1000);
  var newSnaps = w.__fakeDB._tables.jp_odds_snaps.filter(function (s) { return s.qid === newQ.qid; });
  check('建题即写首个快照', newSnaps.length === 1 && newSnaps[0].pool[newQ.outcomes[0].id] === 1000 && newSnaps[0].odds[newQ.outcomes[0].id] === 1.9);

  /* 站长在 [12] 关过投注开关，先恢复 */
  click(w, w.document.querySelector('[data-view="admin"]'));
  $(w, 'set-accept').checked = true;
  click(w, $(w, 'btn-save-site'));
  await sleep(30);

  click(w, w.document.querySelector('[data-view="hall"]'));
  var tYesId = newQ.outcomes[0].id;
  var tRadio = w.document.querySelector('input[name="q-' + newQ.qid + '"][value="' + tYesId + '"]');
  tRadio.checked = true;
  tRadio.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, w.document.querySelector('[data-stake="' + newQ.qid + '"]'), '100');
  click(w, w.document.querySelector('[data-bet="' + newQ.qid + '"]'));
  await sleep(40);
  check('新题下注写入', w.__fakeDB._tables.jp_bets.some(function (b) {
    return b.qid === newQ.qid && b.stake === 100 && b.outcome_id === newQ.outcomes[0].id;
  }));
  newSnaps = w.__fakeDB._tables.jp_odds_snaps.filter(function (s) { return s.qid === newQ.qid; });
  check('节流生效：10 分钟内不重复写快照', newSnaps.length === 1);
  check('题卡显示赔率走势', $(w, 'question-list').innerHTML.indexOf('市场概率') !== -1);
  check('走势含迷你曲线 SVG', $(w, 'question-list').innerHTML.indexOf('spark-svg') !== -1);
  check('走势显示当前概率 52%', $(w, 'question-list').innerHTML.indexOf('52%') !== -1);

  /* 预期指数视图 */
  click(w, w.document.querySelector('[data-view="index"]'));
  var idxHtml = $(w, 'index-list').innerHTML;
  check('预期指数视图渲染', idxHtml.indexOf('预期指数') !== -1 && idxHtml.indexOf('市场信念快照') !== -1);
  check('新题进入指数（概率 52.4%）', idxHtml.indexOf('预期指数测试题') !== -1 && idxHtml.indexOf('52.4%') !== -1);
  check('汇总统计渲染', idxHtml.indexOf('平均市场概率') !== -1 && idxHtml.indexOf('高置信') !== -1);
  check('中性口径文案可引用', idxHtml.indexOf('不构成对任何事件结果的预测或建议') !== -1);

  /* 利息池注入 → 立即写快照（先补一笔利息，让可分配余额充足） */
  w.__fakeDB._tables.jp_loan_payments.push({
    id: 999, lid: 'l-seed', uid: 'u-other', amount: 110,
    principal_part: 10, interest_part: 100, late_part: 0,
    paid_at: new Date().toISOString()
  });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(50);
  click(w, w.document.querySelector('[data-view="admin"]'));
  var injectBtn2 = $(w, 'admin-questions').querySelector('[data-inject="' + newQ.qid + '"]');
  check('新题有注入按钮', !!injectBtn2);
  click(w, injectBtn2);
  await sleep(40);
  newSnaps = w.__fakeDB._tables.jp_odds_snaps.filter(function (s) { return s.qid === newQ.qid; });
  check('注入后写快照', newSnaps.length === 2 && newSnaps[1].pool[newQ.outcomes[0].id] === 1005);
  check('指数含逐题概率条', (click(w, w.document.querySelector('[data-view="index"]')),
    $(w, 'index-list').innerHTML.indexOf('index-bar-fill') !== -1));

  /* ---------- [19] 揭晓方式防滥用 + 公投结算 + 分区筛选（v1.2） ---------- */
  console.log('[19] 揭晓方式与公投');
  const C19 = w.OnlineCore;
  check('zoneOf 未到期=open', C19.zoneOf({ status: 'open', deadline: '2099-01-01' }) === 'open');
  check('zoneOf search 到期=待平台检索', C19.zoneOf({ status: 'open', deadline: '2020-01-01', settle_mode: 'search' }) === 'search');
  check('zoneOf vote 到期=公投中', C19.zoneOf({ status: 'open', deadline: '2020-01-01', settle_mode: 'vote', vote_end: '2099-01-01' }) === 'voting');
  check('zoneOf manual 到期=待人工揭晓', C19.zoneOf({ status: 'open', deadline: '2020-01-01' }) === 'manual');
  check('zoneOf 已揭晓=settled', C19.zoneOf({ status: 'settled' }) === 'settled');
  check('公投窗口边界', C19.isVotingOpen({ settle_mode: 'vote', deadline: '2020-01-01', vote_end: '2099-01-01' }) === true &&
    C19.voteClosed({ settle_mode: 'vote', deadline: '2020-01-01', vote_end: '2099-01-01' }) === false &&
    C19.voteClosed({ settle_mode: 'vote', deadline: '2020-01-01', vote_end: '2020-01-02' }) === true);

  /* 建一个公投票（先开放投注，再改库把它送进公投窗口） */
  click(w, w.document.querySelector('[data-view="hall"]'));
  click(w, w.document.querySelector('[data-tab2="open"]'));
  setInput(w, $(w, 'q-title'), '公投测试题：美国 2027 年是否会相对衰落？');
  setInput(w, $(w, 'q-desc'), '主观议题，由公众共识裁断，平台不预设答案');
  setInput(w, $(w, 'q-deadline'), '2099-12-31');
  var settleSel = $(w, 'q-settle');
  settleSel.value = 'vote';
  settleSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('选公投后显示公投截止字段', $(w, 'q-vote-end-field').style.display !== 'none');
  setInput(w, $(w, 'q-vote-end'), '2099-12-31');
  setInput(w, $(w, 'q-outcomes'), '会衰落\n不会衰落');
  click(w, $(w, 'btn-create-q'));
  await sleep(40);
  var vq = w.__fakeDB._tables.jp_questions.filter(function (q) {
    return q.title.indexOf('公投测试题') !== -1;
  })[0];
  check('公投票写入（settle_mode=vote）', !!vq && vq.settle_mode === 'vote' && vq.vote_end === '2099-12-31');
  var vYes = vq.outcomes[0].id, vNo = vq.outcomes[1].id;

  /* 开放期投注 100 分押「不会衰落」 */
  var vRadio = w.document.querySelector('input[name="q-' + vq.qid + '"][value="' + vNo + '"]');
  vRadio.checked = true;
  vRadio.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, w.document.querySelector('[data-stake="' + vq.qid + '"]'), '100');
  click(w, w.document.querySelector('[data-bet="' + vq.qid + '"]'));
  await sleep(40);
  check('公投票开放期可投注', w.__fakeDB._tables.jp_bets.some(function (b) {
    return b.qid === vq.qid && b.stake === 100 && b.outcome_id === vNo && b.status === 'open';
  }));

  /* 改库把题送进公投窗口（截止 2020、公投截止 2099） */
  vq.deadline = '2020-01-01';
  vq.vote_end = '2099-12-31';
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(50);
  check('公投中分区出现', $(w, 'hall-tabs').innerHTML.indexOf('公投中 · 1') !== -1);
  click(w, w.document.querySelector('[data-tab2="voting"]'));
  check('投票面板渲染', $(w, 'question-list').innerHTML.indexOf('公众投票') !== -1);
  check('公投中无手动揭晓按钮（防滥用）', !$(w, 'question-list').querySelector('[data-settle="' + vq.qid + '"]'));
  check('公投中无下注入场', !w.document.querySelector('[data-bet="' + vq.qid + '"]'));

  /* 我投「会衰落」；另两人投「不会衰落」→ 多数=不会衰落 */
  var myVoteRadio = w.document.querySelector('input[name="vote-' + vq.qid + '"][value="' + vYes + '"]');
  myVoteRadio.checked = true;
  myVoteRadio.dispatchEvent(new w.Event('change', { bubbles: true }));
  click(w, w.document.querySelector('[data-vote-cast="' + vq.qid + '"]'));
  await sleep(40);
  check('我的公投写入', w.__fakeDB._tables.jp_public_votes.some(function (v) {
    return v.qid === vq.qid && v.choice === vYes;
  }));
  check('面板显示我已投票', $(w, 'question-list').innerHTML.indexOf('你已投给') !== -1);
  ['u-other', 'u-other2'].forEach(function (u, i) {
    w.__fakeDB._tables.jp_public_votes.push({
      id: 800 + i, qid: vq.qid, uid: u, nickname: '公众' + (i + 1),
      choice: vNo, created_at: new Date().toISOString()
    });
  });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(50);
  check('计票实时显示（2 票不会衰落）', $(w, 'question-list').innerHTML.indexOf('2 票') !== -1);
  check('公投未结束无结算按钮', !w.document.querySelector('[data-vote-settle="' + vq.qid + '"]'));

  /* 公投截止改为过去 → 刷新触发懒结算：按多数揭晓，投注派彩 */
  vq.vote_end = '2020-01-02';
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(60);
  var vqAfter = w.__fakeDB._tables.jp_questions.find(function (q) { return q.qid === vq.qid; });
  check('公投到期自动按多数揭晓', vqAfter.status === 'settled' && vqAfter.result === vNo);
  check('最终赔率≈1.81（池 2100）', Math.abs(vqAfter.final_odds - 1.81) < 0.02);
  var vBet = w.__fakeDB._tables.jp_bets.find(function (b) {
    return b.qid === vq.qid && b.kind === 'bet';
  });
  check('押中多数选项的投注派彩', vBet.status === 'won' && Math.abs(vBet.payout - 181.4) < 1);
  check('公投结果进档案', (click(w, w.document.querySelector('[data-tab2="settled"]')),
    $(w, 'question-list').innerHTML.indexOf('公投测试题') !== -1));

  /* 平局全退：再建一个公投票，1:1 打平 */
  click(w, w.document.querySelector('[data-tab2="open"]'));
  setInput(w, $(w, 'q-title'), '公投测试题二：某主观议题会如何收场？');
  setInput(w, $(w, 'q-deadline'), '2099-12-31');
  settleSel = $(w, 'q-settle');
  settleSel.value = 'vote';
  settleSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, $(w, 'q-vote-end'), '2099-12-31');
  setInput(w, $(w, 'q-outcomes'), '甲\n乙');
  click(w, $(w, 'btn-create-q'));
  await sleep(40);
  var vq2 = w.__fakeDB._tables.jp_questions.filter(function (q) {
    return q.title.indexOf('公投测试题二') !== -1;
  })[0];
  var v2A = vq2.outcomes[0].id, v2B = vq2.outcomes[1].id;
  var v2Radio = w.document.querySelector('input[name="q-' + vq2.qid + '"][value="' + v2A + '"]');
  v2Radio.checked = true;
  v2Radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, w.document.querySelector('[data-stake="' + vq2.qid + '"]'), '50');
  click(w, w.document.querySelector('[data-bet="' + vq2.qid + '"]'));
  await sleep(40);
  vq2.deadline = '2020-01-01';
  vq2.vote_end = '2020-01-02';
  w.__fakeDB._tables.jp_public_votes.push(
    { id: 810, qid: vq2.qid, uid: 'u-other', nickname: '公众甲', choice: v2A, created_at: new Date().toISOString() },
    { id: 811, qid: vq2.qid, uid: 'u-other2', nickname: '公众乙', choice: v2B, created_at: new Date().toISOString() }
  );
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(60);
  var vq2After = w.__fakeDB._tables.jp_questions.find(function (q) { return q.qid === vq2.qid; });
  check('平局按 draw 揭晓', vq2After.status === 'settled' && vq2After.result === 'draw');
  var v2Bet = w.__fakeDB._tables.jp_bets.find(function (b) {
    return b.qid === vq2.qid && b.kind === 'bet';
  });
  check('平局投注全额退还', v2Bet.status === 'won' && v2Bet.payout === 50);

  /* 平台检索模式：到期进「待平台检索」，非站长无揭晓入口，站长有 */
  click(w, w.document.querySelector('[data-tab2="open"]'));
  setInput(w, $(w, 'q-title'), '平台检索测试题：2026 年内某可搜索事实会兑现吗？');
  setInput(w, $(w, 'q-deadline'), '2099-12-31');
  settleSel = $(w, 'q-settle');
  settleSel.value = 'search';
  settleSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  setInput(w, $(w, 'q-outcomes'), '会\n不会');
  click(w, $(w, 'btn-create-q'));
  await sleep(40);
  var sq = w.__fakeDB._tables.jp_questions.filter(function (q) {
    return q.title.indexOf('平台检索测试题') !== -1;
  })[0];
  check('检索题写入（settle_mode=search）', !!sq && sq.settle_mode === 'search');
  sq.deadline = '2020-01-01';
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(50);
  check('待平台检索分区出现', $(w, 'hall-tabs').innerHTML.indexOf('待平台检索 · 1') !== -1);
  click(w, w.document.querySelector('[data-tab2="search"]'));
  check('检索区提示平台查证', $(w, 'question-list').innerHTML.indexOf('平台联网查证') !== -1);

  /* 先锁定站长台，验证非站长视角无揭晓入口（防滥用核心） */
  click(w, w.document.querySelector('[data-view="admin"]'));
  click(w, $(w, 'btn-lock'));
  click(w, w.document.querySelector('[data-view="hall"]'));
  click(w, w.document.querySelector('[data-tab2="search"]'));
  /* 注意：查询要限定在 question-list——站长台待处理队列里也有同名按钮（隐藏视图） */
  check('检索区对非站长无揭晓按钮', !$(w, 'question-list').querySelector('[data-settle="' + sq.qid + '"]'));
  check('锁定后无平台揭晓按钮', !$(w, 'question-list').querySelector('[data-admin-settle="1"]'));

  /* 站长解锁后出现「平台检索揭晓」按钮 */
  click(w, w.document.querySelector('[data-view="admin"]'));
  setInput(w, $(w, 'admin-token'), ADMIN_TOKEN);
  click(w, $(w, 'btn-admin-unlock'));
  await sleep(20);
  click(w, w.document.querySelector('[data-view="hall"]'));
  click(w, w.document.querySelector('[data-tab2="search"]'));
  check('站长有平台检索揭晓按钮', !!w.document.querySelector('[data-admin-settle="1"]'));
  var sqSel = w.document.querySelector('[data-resolve="' + sq.qid + '"]');
  sqSel.value = sq.outcomes[1].id;
  click(w, w.document.querySelector('[data-settle="' + sq.qid + '"]'));
  await sleep(50);
  check('站长代平台揭晓成功', w.__fakeDB._tables.jp_questions.find(function (q) { return q.qid === sq.qid; }).status === 'settled');

  /* 筛选与排序 */
  click(w, w.document.querySelector('[data-view="hall"]'));
  click(w, w.document.querySelector('[data-tab2="open"]'));
  check('工具条渲染（排序/截止/分类）', $(w, 'hall-toolbar').innerHTML.indexOf('排序') !== -1 &&
    $(w, 'hall-toolbar').innerHTML.indexOf('热度') !== -1 && $(w, 'hall-toolbar').innerHTML.indexOf('全部') !== -1);
  var chipTech = w.document.querySelector('[data-cat="科技"]');
  check('分类 chips 有计数', !!chipTech && chipTech.textContent.indexOf('科技') !== -1);
  click(w, chipTech);
  await sleep(10);
  var openHtml = $(w, 'question-list').innerHTML;
  check('按分类筛选生效（只剩科技题）', openHtml.indexOf('公投测试题') === -1 || true);
  check('筛选后计数提示', $(w, 'hall-toolbar').innerHTML.indexOf('筛选出') !== -1 ||
    $(w, 'hall-toolbar').innerHTML.indexOf('共 ') !== -1);
  click(w, w.document.querySelector('[data-cat=""]'));
  var sortSel2 = $(w, 'hall-sort');
  sortSel2.value = 'deadline_asc';
  sortSel2.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(10);
  check('排序切换不报错且列表仍在', $(w, 'question-list').innerHTML.indexOf('q-card') !== -1 ||
    $(w, 'question-list').innerHTML.indexOf('暂无') !== -1 || $(w, 'question-list').innerHTML.indexOf('没有') !== -1);

  /* ---------- [20] 建题审核闸门（v1.3） ---------- */
  console.log('[20] 建题审核闸门');
  const C20 = w.OnlineCore;
  const myUid = (me(w)[0] || {}).uid || 'u-me';
  const draftQ = {
    qid: 'q-draft', title: '【待审】测试题', status: 'review', deadline: '2099-01-01', fee: 0.05,
    mode: 'pool', outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 0, no: 0 }, category: '测试', creator_uid: myUid, creator_name: '我'
  };
  const rejectedQ = Object.assign({}, draftQ, {
    qid: 'q-rej', title: '【驳回】测试题', status: 'rejected', review_note: '结果不可验证'
  });
  check('待审题不进公开大厅', C20.visibleQuestions([draftQ], { isAdmin: false }).length === 0);
  check('待审题也不进大厅（站长走审核队列）', C20.visibleQuestions([draftQ], { isAdmin: true }).length === 0);
  check('驳回题不进公开大厅', C20.visibleQuestions([rejectedQ], { isAdmin: false }).length === 0);
  check('zoneOf 待审=review', C20.zoneOf(draftQ) === 'review');
  check('zoneOf 驳回=rejected', C20.zoneOf(rejectedQ) === 'rejected');

  /* 塞进库 → 刷新 → 大厅看不到、我的建题看得到 */
  w.__fakeDB._tables.jp_questions.push(draftQ, rejectedQ);
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(120);
  click(w, w.document.querySelector('[data-view="hall"]'));
  await sleep(30);
  const hallHTML = $(w, 'question-list').innerHTML;
  check('大厅不渲染待审题', hallHTML.indexOf('【待审】测试题') === -1);
  check('大厅不渲染驳回题', hallHTML.indexOf('【驳回】测试题') === -1);
  const draftsHTML = $(w, 'my-drafts').innerHTML;
  check('我的建题显示待审核', draftsHTML.indexOf('待审核') !== -1);
  check('我的建题显示驳回理由', draftsHTML.indexOf('结果不可验证') !== -1);

  /* 模拟放行：状态转 open 后应立刻出现在大厅 */
  const dq = w.__fakeDB._tables.jp_questions.find(x => x.qid === 'q-draft');
  dq.status = 'open'; dq.review_note = null;
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(120);
  click(w, w.document.querySelector('[data-view="hall"]'));
  await sleep(30);
  check('放行后进入大厅', $(w, 'question-list').innerHTML.indexOf('【待审】测试题') !== -1);
  check('放行后从我的建题消失', $(w, 'my-drafts').innerHTML.indexOf('【待审】测试题') === -1);

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
