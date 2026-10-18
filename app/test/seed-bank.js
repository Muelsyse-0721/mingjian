/* 云端题库播种：把 question-bank.js 中的 bank-11..bank-100 插入 jp_questions
 * 运行：NODE_PATH=<managed workspace>/node_modules node app/test/seed-bank.js
 * 幂等：已存在的 qid 跳过（按 qid 去重查询）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.resolve(__dirname, '..');
const bank = require(path.join(APP, 'js', 'question-bank.js')).QUESTION_BANK;

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://jp-ladder.app.workbuddy.host/', runScripts: 'dangerously'
});
const w = dom.window;
w.fetch = fetch;
w.eval(fs.readFileSync(path.join(APP, 'test', 'vendor', 'wbcloud.js'), 'utf8'));

const cloud = w.WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: 'https://jp-ladder.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK'
});

(async () => {
  const existing = await cloud.database.from('jp_questions').select('qid');
  if (existing.error) { console.error('读取失败:', existing.error); process.exit(1); }
  const have = new Set((existing.data || []).map(r => r.qid));
  console.log('云端已有问题:', have.size);

  const todo = bank.filter(q => !have.has(q.id));
  console.log('待插入:', todo.length);
  if (!todo.length) { console.log('无需播种'); return; }

  const rows = todo.map(q => {
    const pool = {};
    if (q.mode === 'pool' && q.simPool) q.outcomes.forEach(o => { pool[o.id] = q.simPool; });
    return {
      qid: q.id, title: q.title, descr: q.desc, mode: q.mode,
      fee: q.mode === 'pool' ? 0.05 : 0,
      deadline: q.deadline,
      outcomes: q.outcomes.map(o => {
        const d = { id: o.id, label: o.label };
        if (o.fixedOdds != null) d.fixedOdds = o.fixedOdds;
        return d;
      }),
      pool: pool, creator_name: '出题大厅', from_bank: q.id
    };
  });

  let ok = 0;
  for (let i = 0; i < rows.length; i += 15) {
    const batch = rows.slice(i, i + 15);
    const r = await cloud.database.from('jp_questions').insert(batch);
    if (r.error) { console.error('批次', i, '失败:', r.error); process.exit(1); }
    ok += batch.length;
    console.log('已插入', ok, '/', rows.length);
  }

  const after = await cloud.database.from('jp_questions').select('qid');
  console.log('播种后云端总数:', (after.data || []).length);
})();
