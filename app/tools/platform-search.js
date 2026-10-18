/* ============================================================
 * 明鉴 · 平台检索揭晓工具（app/tools/platform-search.js）
 * 用途：「平台检索」模式的问题到期后，由平台（Agent 每日自动化）
 * 联网查证公开事实，再用本脚本按事实揭晓并结算全部投注。
 *
 * 用法：
 *   node app/tools/platform-search.js list                      # 列出到期未揭晓的平台检索题
 *   node app/tools/platform-search.js settle <qid> <resultOid> [--note "公开事实依据"]
 *   node app/tools/platform-search.js settle <qid> <resultOid> --dry-run
 *
 * 结算口径与线上 doSettle 完全一致：
 *   最终赔率 = 总池 ×（1−抽水）÷ 结果选项池（只含未结算投注）
 *   中奖：payout = round(投注额 × 最终赔率, 1)；未中：status=lost
 *   证据奖励：被采纳且立场命中的证据提交者各奖 50 分（kind=bonus）
 * 幂等：已揭晓（status≠open）的问题直接跳过。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.resolve(__dirname, '..');
const EVIDENCE_REWARD = 50;

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

const round2 = v => Math.round(v * 100) / 100;
const todayStr = () => {
  const d = new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

function poolOf(q, bets) {
  const pools = {}; let total = 0;
  (q.outcomes || []).forEach(o => { pools[o.id] = Number(q.pool && q.pool[o.id]) || 0; total += pools[o.id]; });
  bets.forEach(b => {
    if (b.kind && b.kind !== 'bet') return;
    if (b.qid === q.qid && b.status === 'open') {
      pools[b.outcome_id] = (pools[b.outcome_id] || 0) + Number(b.stake);
      total += Number(b.stake);
    }
  });
  return { pools, total };
}
function settleOddsOf(q, bets, resultOid) {
  const r = poolOf(q, bets);
  return r.pools[resultOid] > 0 ? r.total * (1 - Number(q.fee || 0)) / r.pools[resultOid] : 0;
}

async function listDue() {
  const all = await cloud.database.from('jp_questions').select('*').order('deadline', { ascending: true });
  if (all.error) { console.error('读取失败:', all.error); process.exit(1); }
  const today = todayStr();
  const due = (all.data || []).filter(q =>
    q.status === 'open' && (q.settle_mode || 'manual') === 'search' && q.deadline && q.deadline < today);
  if (!due.length) { console.log('没有到期未揭晓的平台检索题。'); return; }
  console.log('到期未揭晓的平台检索题（' + due.length + '）：');
  due.forEach(q => {
    const bets = poolOf(q, []);
    console.log('- ' + q.qid + ' | ' + q.title + ' | 截止 ' + q.deadline + ' | 选项: ' +
      q.outcomes.map(o => o.id + '=' + o.label).join(', ') + ' | 初始池 ' + bets.total);
  });
}

async function settle(qid, resultOid, note, dryRun) {
  const qs = await cloud.database.from('jp_questions').select('*').eq('qid', qid);
  if (qs.error) { console.error('读取问题失败:', qs.error); process.exit(1); }
  const q = (qs.data || [])[0];
  if (!q) { console.error('问题不存在:', qid); process.exit(1); }
  if (q.status !== 'open') { console.log('已揭晓，跳过（幂等）。'); return; }
  const mode = q.settle_mode || 'manual';
  if (mode !== 'search') { console.error('该问题不是平台检索模式（' + mode + '），拒绝用本脚本揭晓。'); process.exit(1); }
  if (!(q.outcomes || []).some(o => o.id === resultOid)) { console.error('结果 id 不存在:', resultOid); process.exit(1); }

  const betsRes = await cloud.database.from('jp_bets').select('*').eq('qid', qid);
  if (betsRes.error) { console.error('读取投注失败:', betsRes.error); process.exit(1); }
  const bets = (betsRes.data || []).filter(b => !b.kind || b.kind === 'bet');
  const finalOdds = round2(settleOddsOf(q, bets, resultOid));
  const won = bets.filter(b => b.status === 'open' && b.outcome_id === resultOid);
  const lost = bets.filter(b => b.status === 'open' && b.outcome_id !== resultOid);

  /* 证据奖励（与线上一致） */
  const evRes = await cloud.database.from('jp_evidence').select('*').eq('qid', qid);
  const evidence = evRes.error ? [] : (evRes.data || []);
  const cands = evidence.filter(e => e.status === 'accepted' && !e.validated && e.side === resultOid);

  const label = (q.outcomes.find(o => o.id === resultOid) || {}).label;
  console.log('问题：' + q.title);
  console.log('判定标准：' + (q.descr || '以公开事实为准'));
  console.log('揭晓结果：' + resultOid + '（' + label + '） · 最终赔率 ' + finalOdds);
  console.log('投注：中奖 ' + won.length + ' 笔 / 未中 ' + lost.length + ' 笔 · 证据奖励 ' + cands.length + ' 条');
  if (note) console.log('依据：' + note);
  won.forEach(b => console.log('  中奖 ' + b.nickname + ' ' + b.stake + ' → ' + round2(Number(b.stake) * finalOdds)));
  if (dryRun) { console.log('（dry-run，未写入）'); return; }

  const now = new Date().toISOString();
  const upd = await cloud.database.from('jp_questions').update({
    status: 'settled', result: resultOid, final_odds: finalOdds, settled_at: now
  }).eq('qid', qid).eq('status', 'open');
  if (upd.error) { console.error('更新问题失败:', upd.error); process.exit(1); }
  if (!upd.data || upd.data.length === 0) { console.log('问题已被他人揭晓，跳过投注结算（幂等）。'); return; }

  for (const b of won) {
    const payout = round2(Number(b.stake) * finalOdds);
    const r = await cloud.database.from('jp_bets').update({ status: 'won', payout, settled_at: now }).eq('id', b.id);
    if (r.error) { console.error('结算中奖投注失败:', r.error); process.exit(1); }
  }
  for (const b of lost) {
    const r = await cloud.database.from('jp_bets').update({ status: 'lost', settled_at: now }).eq('id', b.id);
    if (r.error) { console.error('结算未中投注失败:', r.error); process.exit(1); }
  }
  for (const e of cands) {
    const r1 = await cloud.database.from('jp_bets').insert({
      qid: qid, uid: e.uid, nickname: e.nickname, outcome_id: e.side,
      stake: 0, odds_at_bet: 0, status: 'won', kind: 'bonus',
      payout: EVIDENCE_REWARD, placed_at: now, settled_at: now
    });
    if (r1.error) { console.error('证据奖励写入失败:', r1.error); process.exit(1); }
    const r2 = await cloud.database.from('jp_evidence').update({ validated: true }).eq('eid', e.eid);
    if (r2.error) { console.error('证据标记失败:', r2.error); process.exit(1); }
  }
  console.log('揭晓完成：' + q.title + ' → ' + label + '（赔率 ' + finalOdds + '）' + (note ? ' · 依据：' + note : ''));
}

(async () => {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === 'list') { await listDue(); return; }
  if (cmd === 'settle') {
    const qid = args[1], resultOid = args[2];
    if (!qid || !resultOid) { console.error('用法: settle <qid> <resultOid> [--note "…"] [--dry-run]'); process.exit(1); }
    const noteIdx = args.indexOf('--note');
    const note = noteIdx > -1 ? args[noteIdx + 1] : '';
    const dryRun = args.indexOf('--dry-run') !== -1;
    await settle(qid, resultOid, note, dryRun);
    return;
  }
  console.error('用法: list | settle <qid> <resultOid> [--note "…"] [--dry-run]');
  process.exit(1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
