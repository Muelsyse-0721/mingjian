#!/usr/bin/env node
/**
 * LMSR 定价核心单元测试
 * 运行：node app/test/lmsr-test.js
 *
 * 断言取自 docs/20 的模拟数字（b=500），改动参数必须同步更新这里的期望值。
 */
const path = require('path');
const L = require(path.join(__dirname, '..', 'js', 'lmsr.js'));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);

console.log('[1] 成本函数与价格');
const b = 500;
check('cost(0,0) = b·ln2', near(L.cost([0, 0], b), b * Math.LN2, 0.01),
  L.cost([0, 0], b) + ' vs ' + (b * Math.LN2));
const p0 = L.prices([0, 0], b);
check('空仓价格 50/50', near(p0[0], 0.5, 1e-9) && near(p0[1], 0.5, 1e-9));
const p3 = L.prices([0, 0, 0], b);
check('三选项初始各 33.3%', p3.every(x => near(x, 1 / 3, 1e-9)));
check('价格恒和为 1', near(p3.reduce((a, x) => a + x, 0), 1, 1e-9));

console.log('[2] 买入：滑点与花费（b=500）');
const r100 = L.buy([0, 0], b, 0, 100);
check('买 100 份无错误', !r100.error, r100.error);
check('买 100 份花费 ≈52.5', near(r100.cost, 52.5, 0.5), r100.cost.toFixed(2));
check('买 100 份后价格 ≈55%', near(r100.priceAfter, 0.550, 0.005), (r100.priceAfter * 100).toFixed(1) + '%');
check('均价低于买后价格', r100.avgPrice < r100.priceAfter && r100.avgPrice > 0.5);
const r20 = L.buy([0, 0], b, 0, 20);
check('买 20 份滑点仅 1pp', near(r20.priceAfter - 0.5, 0.01, 0.004), (r20.priceAfter - 0.5).toFixed(3));

console.log('[3] 买卖对称性（这是"能平仓"的根基）');
const back = L.sell(r100.q, b, 0, 100);
check('卖回 100 份无错误', !back.error, back.error);
check('卖出收入 = 买入花费', near(back.proceeds, r100.cost, 0.01), back.proceeds.toFixed(2));
check('卖回后回到原价格', near(back.priceAfter, 0.5, 1e-6));
const both = L.buy(L.buy([0, 0], b, 0, 200).q, b, 1, 200);
check('两边等量买入价格仍 50%', near(L.prices(both.q, b)[0], 0.5, 1e-9));

console.log('[4] 边界与保护');
const capped = L.buy([0, 0], b, 0, 5000);
check('超上限买入被拒', !!capped.error, JSON.stringify(capped).slice(0, 60));
const oversell = L.sell([10, 0], b, 0, 50);
check('卖出超过持仓被拒', !!oversell.error, oversell.error);
check('份额为 0 被拒', !!L.buy([0, 0], b, 0, 0).error);
check('非法选项被拒', !!L.buy([0, 0], b, 5, 10).error);

console.log('[5] 抽水：p(1−p) 曲线');
check('p=50% 每 100 分抽 5.00（= 名义 5%）', near(L.feeOf(100, 0.5), 5, 0.01), L.feeOf(100, 0.5));
check('p=5% 每 100 分抽 0.95', near(L.feeOf(100, 0.05), 0.95, 0.01), L.feeOf(100, 0.05));
check('极端价抽水 < 中间价 1/4', L.feeOf(100, 0.95) < L.feeOf(100, 0.5) / 4);

console.log('[6] 平台敞口上界');
check('b=500 二元上界 346.6', near(L.exposure(500, 2), 346.57, 0.05));
check('b=500 三选上界 549.3', near(L.exposure(500, 3), 549.31, 0.05));
check('n=1 无敞口', L.exposure(500, 1) === 0);

console.log('[7] 概率反解（供将来迁移参考）');
const qq = L.toQ([0.7, 0.3], b);
const backP = L.prices(qq, b);
check('反解后价格还原 70/30', near(backP[0], 0.7, 1e-6) && near(backP[1], 0.3, 1e-6),
  backP.map(x => (x * 100).toFixed(1)).join('/'));

console.log('[8] 最大可买');
const ms = L.maxShares([0, 0], b, 0, 100);
check('100 分预算在 50% 附近能买 ~190 份', ms > 150 && ms < 220, String(ms));
const msCost = L.buy([0, 0], b, 0, ms).cost;
check('最大可买不超过预算', msCost <= 100 + 1e-6, msCost.toFixed(2));

console.log('[9] 结算');
check('赢家每份 1 分', L.settlePayout(100, true) === 100);
check('输家归零', L.settlePayout(100, false) === 0);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
