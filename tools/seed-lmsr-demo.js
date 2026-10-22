#!/usr/bin/env node
/**
 * 试点演示数据：让 AI 参与者在份额市场里真实买卖，跑通价格曲线与平仓流程。
 *
 * 为什么要脚本算：LMSR 的每笔成本取决于「当时」的 q，
 * 手工填 stake 会与曲线不符，导致价格跳变、账本对不上。
 *
 *   node tools/seed-lmsr-demo.js            # 打印将要写入的流水
 *   node tools/seed-lmsr-demo.js --json     # 输出 JSON（供 SQL 插入）
 */
const path = require('path');
const L = require(path.join(__dirname, '..', 'app', 'js', 'lmsr.js'));

const B = 500;

/* 三个 AI 身份取自 app/js/ai-agents.js 的既有设定，uid 一律 ai- 前缀 */
const AI = {
  data: { uid: 'ai-deepseek-01', nickname: '数据党 #01' },
  logic: { uid: 'ai-gpt-02', nickname: '逻辑派 #02' },
  warm: { uid: 'ai-claude-03', nickname: '温和派 #03' },
  search: { uid: 'ai-gemini-04', nickname: '检索派 #04' }
};

const QUESTIONS = {
  'q-lmsr-pilot1': [
    { ai: 'data', side: 0, op: 'buy', shares: 200 },
    { ai: 'logic', side: 1, op: 'buy', shares: 120 },
    { ai: 'search', side: 0, op: 'buy', shares: 100 },
    { ai: 'data', side: 0, op: 'sell', shares: 80 }
  ],
  'q-lmsr-pilot2': [
    { ai: 'warm', side: 1, op: 'buy', shares: 180 },
    { ai: 'data', side: 0, op: 'buy', shares: 150 }
  ],
  'q-lmsr-pilot3': [
    { ai: 'logic', side: 1, op: 'buy', shares: 120 },
    { ai: 'search', side: 0, op: 'buy', shares: 100 }
  ]
};

const rows = [];
const report = {};

for (const [qid, trades] of Object.entries(QUESTIONS)) {
  let q = [0, 0];
  const log = [];
  for (const t of trades) {
    const who = AI[t.ai];
    const r = t.op === 'buy'
      ? L.buy(q, B, t.side, t.shares)
      : L.sell(q, B, t.side, t.shares);
    if (r.error) { log.push({ error: r.error, ...t }); continue; }
    q = r.q;
    if (t.op === 'buy') {
      const stake = Math.round((r.cost + r.fee) * 100) / 100;
      rows.push({
        qid, uid: who.uid, nickname: who.nickname,
        outcome_id: t.side === 0 ? 'yes' : 'no',
        stake, odds_at_bet: Math.round((1 / r.avgPrice) * 100) / 100,
        shares: t.shares, price: Math.round(r.avgPrice * 1000) / 1000,
        kind: 'buy', status: 'open'
      });
      log.push(`买 ${t.shares} 份 @${r.avgPrice.toFixed(3)} → 付 ${stake}，价格 ${(r.priceAfter * 100).toFixed(1)}%`);
    } else {
      const get = Math.round((r.proceeds - r.fee) * 100) / 100;
      rows.push({
        qid, uid: who.uid, nickname: who.nickname,
        outcome_id: t.side === 0 ? 'yes' : 'no',
        stake: -get, odds_at_bet: Math.round((1 / r.avgPrice) * 100) / 100,
        shares: t.shares, price: Math.round(r.avgPrice * 1000) / 1000,
        kind: 'sell', status: 'open'
      });
      log.push(`卖 ${t.shares} 份 @${r.avgPrice.toFixed(3)} → 收 ${get}，价格 ${(r.priceAfter * 100).toFixed(1)}%`);
    }
  }
  report[qid] = { trades: log, final: L.prices(q, B).map(p => (p * 100).toFixed(1) + '%').join(' / ') };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  for (const [qid, r] of Object.entries(report)) {
    console.log(`\n${qid}  终价 ${r.final}`);
    r.trades.forEach(l => console.log('  ' + l));
  }
  console.log(`\n共 ${rows.length} 笔，总成交额 ${rows.reduce((s, r) => s + Math.abs(r.stake), 0).toFixed(1)} 分`);
}
