/* ============================================================
 * 明鉴 · 辩论评分校准跑分（真实云端 LLM）
 * 运行：NODE_PATH=<managed workspace>/node_modules node app/test/calibration/run-calibration.js
 *
 * 两项测试：
 * [A] 金标准相关性——LLM 五维评分 vs 人工金标准分，皮尔逊相关系数（目标 ≥0.7）
 * [B] 立场互换中立性——同一段文字正放/对调各评一次：
 *     ① 同段文字两遍分差 < 5（无立场偏好）
 *     ② 两遍中强的一方总分都更高（强弱判断不受立场影响）
 *
 * 输出：控制台报告 + calibration/REPORT.md（可提交存档）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = __dirname;
const APP = path.resolve(DIR, '..', '..');
const LLM_MODEL = 'hy3';

const gold = JSON.parse(fs.readFileSync(path.join(DIR, 'gold-set.json'), 'utf8'));
const swap = JSON.parse(fs.readFileSync(path.join(DIR, 'stance-swap.json'), 'utf8'));

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://jp-ladder.app.workbuddy.host/', runScripts: 'dangerously'
});
const w = dom.window;
w.fetch = fetch;
w.eval(fs.readFileSync(path.join(APP, 'test', 'vendor', 'wbcloud.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(APP, 'js', 'debates.js'), 'utf8'));

const cloud = w.WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: 'https://jp-ladder.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK'
});

const DebateCore = w.DebateCore;

/* 频率限制闸门：保证两次 LLM 调用发起间隔 ≥ MIN_GAP，避免触发 429 静默节流（空流） */
const MIN_GAP = 1500;
let _nextCall = 0;
function pace(minGap) {
  return new Promise(function (res) {
    (function tick() {
      const now = Date.now();
      const wait = Math.max(0, _nextCall - now);
      if (wait === 0) { _nextCall = now + minGap; res(); return; }
      setTimeout(tick, wait + 30);
    })();
  });
}

async function callLLM(prompt, maxTokens) {
  await pace(MIN_GAP);
  const stream = await cloud.llm.chat.completions.create({
    model: LLM_MODEL, stream: true, max_tokens: maxTokens || 900,
    messages: [{ role: 'user', content: prompt }]
  });
  var text = '';
  if (stream && stream[Symbol.asyncIterator]) {
    for await (const chunk of stream) {
      const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (d && d.content) text += d.content;
    }
  }
  return text;
}

/* 空流兜底：限频窗口内偶发空响应时指数退避重试 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function callLLMRetry(prompt, maxTokens, tries) {
  tries = tries || 4;
  for (let i = 0; i < tries; i++) {
    const text = await callLLM(prompt, maxTokens);
    if (text && text.trim().length > 20) return text;
    await sleep(1500 * (i + 1));
  }
  return '';
}

/* 并发池 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
      process.stdout.write('.');
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  process.stdout.write('\n');
  return results;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

(async () => {
  const startedAt = new Date();
  console.log('[A] 金标准相关性测试（' + gold.samples.length + ' 组）');
  const goldResults = await pool(gold.samples, 2, async (s) => {
    const room = { topic: s.topic, side_a: s.sideA, side_b: s.sideB };
    const prompt = DebateCore.aiScorePrompt(room, s.aPost, s.bPost);
    try {
      const text = await callLLMRetry(prompt);
      const parsed = DebateCore.parseAiScore(text);
      if (!parsed) return { id: s.id, ok: false, reason: '解析失败: ' + String(text).slice(0, 80) };
      return { id: s.id, ok: true, ai: { a: parsed.a, b: parsed.b }, gold: s.gold };
    } catch (e) {
      return { id: s.id, ok: false, reason: e.message || String(e) };
    }
  });

  const fails = goldResults.filter(r => !r.ok);
  const ok = goldResults.filter(r => r.ok);
  const DIMS = DebateCore.DIMS;
  const corr = {};
  const mae = {};
  DIMS.forEach(d => {
    const xs = [], ys = [];
    ok.forEach(r => { ['a', 'b'].forEach(side => { xs.push(r.ai[side][d]); ys.push(r.gold[side][d]); }); });
    corr[d] = pearson(xs, ys);
    mae[d] = xs.length ? xs.reduce((s, x, i) => s + Math.abs(x - ys[i]), 0) / xs.length : NaN;
  });
  const xsT = [], ysT = [];
  ok.forEach(r => {
    ['a', 'b'].forEach(side => {
      xsT.push(DebateCore.totalOfScore(r.ai[side]));
      ysT.push(DebateCore.totalOfScore(r.gold[side]));
    });
  });
  const corrTotal = pearson(xsT, ysT);

  console.log('\n[A] 结果：有效 ' + ok.length + '/' + goldResults.length +
    (fails.length ? '（失败：' + fails.map(f => f.id + ' ' + f.reason).join('; ') + '）' : ''));
  DIMS.forEach(d => {
    console.log('  ' + DebateCore.DIM_LABELS[d] + '：相关 ' + corr[d].toFixed(3) + ' · 平均绝对误差 ' + mae[d].toFixed(2));
  });
  console.log('  总分：相关 ' + corrTotal.toFixed(3));

  console.log('\n[B] 立场互换中立性测试（' + swap.pairs.length + ' 对，每对 2 次评分）');
  const swapResults = await pool(swap.pairs, 2, async (p) => {
    const room = { topic: p.topic, side_a: p.sideA, side_b: p.sideB };
    try {
      const t1 = await callLLMRetry(DebateCore.aiScorePrompt(room, p.postX, p.postY));
      const t2 = await callLLMRetry(DebateCore.aiScorePrompt(room, p.postY, p.postX));
      const r1 = DebateCore.parseAiScore(t1);   // X=甲方 Y=乙方
      const r2 = DebateCore.parseAiScore(t2);   // X=乙方 Y=甲方
      if (!r1 || !r2) return { id: p.id, ok: false, reason: '解析失败' };
      const diffsX = {}, diffsY = {};
      let maxDiff = 0;
      DIMS.forEach(d => {
        diffsX[d] = Math.abs(r1.a[d] - r2.b[d]);
        diffsY[d] = Math.abs(r1.b[d] - r2.a[d]);
        maxDiff = Math.max(maxDiff, diffsX[d], diffsY[d]);
      });
      const xTotal1 = DebateCore.totalOfScore(r1.a), yTotal1 = DebateCore.totalOfScore(r1.b);
      const xTotal2 = DebateCore.totalOfScore(r2.b), yTotal2 = DebateCore.totalOfScore(r2.a);
      const xWins = xTotal1 > yTotal1 && xTotal2 > yTotal2;
      const yWins = yTotal1 > xTotal1 && yTotal2 > xTotal2;
      return {
        id: p.id, ok: true, maxDiff, diffsX, diffsY,
        xTotal1, yTotal1, xTotal2, yTotal2,
        stronger: p.stronger,
        outcome: p.stronger === 'X' ? (xWins ? 'X赢' : 'X没赢') : (yWins ? 'X赢' : 'X没赢'),
        comments: [r1.comment, r2.comment]
      };
    } catch (e) {
      return { id: p.id, ok: false, reason: e.message || String(e) };
    }
  });

  const swapFails = swapResults.filter(r => !r.ok);
  const swapOk = swapResults.filter(r => r.ok);
  const maxSwapDiff = swapOk.length ? Math.max(...swapOk.map(r => r.maxDiff)) : NaN;
  const winCount = swapOk.filter(r => r.outcome === 'X赢').length;
  const diffOver = swapOk.filter(r => r.maxDiff >= 5);

  console.log('[B] 结果：有效 ' + swapOk.length + '/' + swapResults.length +
    (swapFails.length ? '（失败：' + swapFails.map(f => f.id).join(',') + '）' : ''));
  swapOk.forEach(r => {
    console.log('  ' + r.id + '：最大分差 ' + r.maxDiff + ' · ' + r.outcome +
      '（正放 ' + r.xTotal1 + ':' + r.yTotal1 + ' / 对调 ' + r.xTotal2 + ':' + r.yTotal2 + '）');
  });

  const CORR_TARGET = gold.meta.thresholds.correlation;
  const SWAP_TARGET = gold.meta.thresholds.stance_swap_max_diff;
  const passA = DIMS.every(d => isFinite(corr[d]) && corr[d] >= CORR_TARGET) && corrTotal >= CORR_TARGET;
  const passB = maxSwapDiff < SWAP_TARGET && winCount === swapOk.length;

  console.log('\n===== 校准结论 =====');
  console.log('[A] 金标准相关性（目标 ≥' + CORR_TARGET + '）：' + (passA ? '通过' : '未达标'));
  console.log('[B] 立场互换中立性（分差 <' + SWAP_TARGET + ' 且强弱判断全对）：' +
    (passB ? '通过' : '未达标') + '（最大分差 ' + maxSwapDiff + '，强弱判断 ' + winCount + '/' + swapOk.length + '）');

  /* 写报告 */
  const lines = [];
  lines.push('# 明鉴辩论评分校准报告');
  lines.push('');
  lines.push('- 时间：' + startedAt.toISOString());
  lines.push('- 模型：' + LLM_MODEL + '（云端 LLM，stream）');
  lines.push('- 金标准：' + gold.meta.name + '（' + gold.samples.length + ' 组）');
  lines.push('- 互换测试：' + swap.meta.name + '（' + swap.pairs.length + ' 对）');
  lines.push('');
  lines.push('## A. 金标准相关性（目标 ≥ ' + CORR_TARGET + '）');
  lines.push('');
  lines.push('| 维度 | 相关系数 | 平均绝对误差 |');
  lines.push('|---|---|---|');
  DIMS.forEach(d => lines.push('| ' + DebateCore.DIM_LABELS[d] + ' | ' + corr[d].toFixed(3) + ' | ' + mae[d].toFixed(2) + ' |'));
  lines.push('| **总分** | **' + corrTotal.toFixed(3) + '** | — |');
  lines.push('');
  lines.push('有效样本 ' + ok.length + '/' + goldResults.length + (fails.length ? '，失败：' + fails.map(f => f.id).join(',') : ''));
  lines.push('');
  lines.push('## B. 立场互换中立性（分差 < ' + SWAP_TARGET + '，强弱判断不受立场影响）');
  lines.push('');
  lines.push('| 样本 | 最大分差 | 正放 X:Y | 对调 X:Y | 强弱判断 |');
  lines.push('|---|---|---|---|---|');
  swapOk.forEach(r => lines.push('| ' + r.id + ' | ' + r.maxDiff + ' | ' + r.xTotal1 + ':' + r.yTotal1 +
    ' | ' + r.xTotal2 + ':' + r.yTotal2 + ' | ' + r.outcome + ' |'));
  lines.push('');
  lines.push('最大分差 **' + maxSwapDiff + '**；强弱判断 **' + winCount + '/' + swapOk.length + '** 正确。');
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push('- [A] 金标准相关性：**' + (passA ? '通过' : '未达标') + '**');
  lines.push('- [B] 立场互换中立性：**' + (passB ? '通过' : '未达标') + '**');
  lines.push('');
  if (!passA) lines.push('> 相关性未达标：检查 prompt 的评分锚点描述，或扩充金标准样本后再跑。');
  if (!passB) {
    lines.push('> 中立性未达标：' + (diffOver.length ? '分差超标样本：' + diffOver.map(r => r.id + '(' + r.maxDiff + ')').join('、') + '；' : '') +
      (winCount < swapOk.length ? '强弱判断反转 ' + (swapOk.length - winCount) + ' 例。' : '') +
      '需在 prompt 中强化「只评怎么辩」的锚点，或在评分前隐去立场标签重测。');
  }
  fs.writeFileSync(path.join(DIR, 'REPORT.md'), lines.join('\n'));
  console.log('\n报告已写入 ' + path.join(DIR, 'REPORT.md'));
  process.exit(passA && passB ? 0 : 2);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
