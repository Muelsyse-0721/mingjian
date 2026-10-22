#!/usr/bin/env node
/**
 * LMSR 参数模拟：用真实定价模块跑交易序列，输出滑点/花费/平台敞口。
 * 用途：改 b 或改抽水前，先看数字再决定。
 *
 *   node tools/lmsr-sim.js [b] [shares...]
 *   node tools/lmsr-sim.js 500 20 50 100 300
 */
const path = require('path');
const L = require(path.join(__dirname, '..', 'app', 'js', 'lmsr.js'));

const b = Number(process.argv[2] || 500);
const sizes = (process.argv.slice(3).length ? process.argv.slice(3) : ['20', '50', '100', '300']).map(Number);

console.log(`b=${b}  平台单题敞口上限 b·ln2 = ${L.exposure(b, 2).toFixed(1)} 分\n`);
console.log('买入（从 50/50 起，每次独立模拟）');
console.log('  份额    花费     均价   买后价格    滑点     抽水');
for (const sh of sizes) {
  const r = L.buy([0, 0], b, 0, sh);
  if (r.error) { console.log(`  ${String(sh).padStart(4)}   ${r.error}`); continue; }
  console.log(
    `  ${String(sh).padStart(4)}  ${r.cost.toFixed(1).padStart(7)}  ${r.avgPrice.toFixed(3)}  ` +
    `${(r.priceAfter * 100).toFixed(1).padStart(7)}%  ${((r.priceAfter - 0.5) * 100).toFixed(1).padStart(5)}pp  ` +
    `${r.fee.toFixed(2).padStart(5)}`
  );
}

console.log('\n买卖往返（验证能平仓、且不亏不赚）');
let q = [0, 0], spent = 0;
for (const [i, sh] of [[0, 100], [1, 100], [0, 200]]) {
  const r = L.buy(q, b, i, sh);
  console.log(`  买${i === 0 ? 'YES' : 'NO '} ${String(sh).padStart(3)} 份 → 花 ${r.cost.toFixed(1)}，价格 ${(r.prices[0] * 100).toFixed(1)}%`);
  q = r.q; spent += r.cost;
}
const before = spent;
let back = 0;
for (const [i, sh] of [[0, 200], [0, 100], [1, 100]]) {
  const r = L.sell(q, b, i, sh);
  if (r.error) { console.log('  卖出失败:', r.error); break; }
  q = r.q; back += r.proceeds;
}
console.log(`  全部卖出 → 收回 ${back.toFixed(1)}（投入 ${before.toFixed(1)}，差额 ${(back - before).toFixed(4)}）`);
console.log(`  回到初始价格 ${(L.prices(q, b)[0] * 100).toFixed(1)}%`);

console.log('\n抽水曲线（每 100 分成交）');
for (const p of [0.02, 0.05, 0.25, 0.5, 0.75, 0.95, 0.98]) {
  console.log(`  p=${(p * 100).toFixed(0).padStart(2)}%  →  ${L.feeOf(100, p).toFixed(2)} 分`);
}
