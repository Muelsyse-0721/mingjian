/* 真实云端 round-trip 验证：jsdom + 真实 CDN SDK + Node fetch
 * 插入一条测试投注（不带 select，返回 201 即可）→ 按 uid 读回校验 → 更新 → 删除清理。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://jp-ladder.app.workbuddy.host/', runScripts: 'dangerously' });
const w = dom.window;
w.fetch = fetch;

const sdkPath = path.resolve(__dirname, 'vendor', 'wbcloud.js');
if (!fs.existsSync(sdkPath)) {
  console.error('缺少 SDK 副本：app/test/vendor/wbcloud.js（从 CDN 下载后放入）');
  process.exit(1);
}
w.eval(fs.readFileSync(sdkPath, 'utf8'));

const cloud = w.WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: 'https://jp-ladder.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK'
});

(async () => {
  let fail = 0;
  const check = (name, ok) => { console.log(ok ? '  PASS ' + name : '  FAIL ' + name); if (!ok) fail++; };

  console.log('[A] 读取题库');
  const qs = await cloud.database.from('jp_questions').select('qid, title, mode, status').order('created_at', { ascending: false });
  check('题库可读（>=100 题）', !qs.error && Array.isArray(qs.data) && qs.data.length >= 100);
  check('题库含固定赔率题', qs.data.some(q => q.mode === 'fixed'));

  console.log('[B] 写入一条测试投注');
  const ins = await cloud.database.from('jp_bets').insert({
    qid: 'bank-4', uid: 'test-roundtrip', nickname: '联调测试',
    outcome_id: 'yes', stake: 10, odds_at_bet: 1.90, kind: 'bet'
  });
  check('插入成功（201）', !ins.error && (ins.success === true || ins.status === 201));

  console.log('[C] 读回验证');
  const back = await cloud.database.from('jp_bets').select('*').eq('uid', 'test-roundtrip');
  check('按 uid 读回 1 条', !back.error && back.data.length === 1);
  check('字段完整（stake=10, outcome=yes）', back.data[0].stake === 10 && back.data[0].outcome_id === 'yes');
  check('默认值生效（status=open, kind=bet）', back.data[0].status === 'open' && back.data[0].kind === 'bet');

  console.log('[D] 更新与删除（清理测试数据）');
  const upd = await cloud.database.from('jp_bets').update({ status: 'lost' }).eq('uid', 'test-roundtrip').select();
  check('更新生效', !upd.error && upd.data.length === 1 && upd.data[0].status === 'lost');
  const del = await cloud.database.from('jp_bets').delete().eq('uid', 'test-roundtrip').select();
  check('清理成功', !del.error && del.data.length === 1);
  const after = await cloud.database.from('jp_bets').select('id').eq('uid', 'test-roundtrip');
  check('清理后读为空', !after.error && after.data.length === 0);

  console.log('[E] jp_settings（站长设置表）');
  const setRead = await cloud.database.from('jp_settings').select('key, value');
  check('设置表可读', !setRead.error && Array.isArray(setRead.data));
  check('含站长口令哈希', setRead.data.some(r => r.key === 'admin_token_hash' && String(r.value).length === 64));
  check('含站点设置', setRead.data.some(r => r.key === 'site' && r.value && r.value.opening_bonus > 0));
  const setIns = await cloud.database.from('jp_settings').insert({ key: 'roundtrip-test', value: { ok: true }, updated_by: 'test' });
  check('设置表可写（201）', !setIns.error && (setIns.success === true || setIns.status === 201));
  const setBack = await cloud.database.from('jp_settings').select('value').eq('key', 'roundtrip-test');
  check('测试设置读回', !setBack.error && setBack.data.length === 1 && setBack.data[0].value.ok === true);
  const setDel = await cloud.database.from('jp_settings').delete().eq('key', 'roundtrip-test').select();
  check('测试设置清理', !setDel.error && setDel.data.length === 1);
  const setAfter = await cloud.database.from('jp_settings').select('key').eq('key', 'roundtrip-test');
  check('清理后为空', !setAfter.error && setAfter.data.length === 0);

  console.log('[F] jp_loans / jp_loan_payments（借贷表 round-trip）');
  const loanIns = await cloud.database.from('jp_loans').insert({
    lid: 'l-roundtrip-test', uid: 'test-roundtrip', nickname: '联调测试',
    principal: 100, rate: 0.05, term_days: 7, due_date: '2099-01-01'
  });
  check('借款表可写（201）', !loanIns.error && (loanIns.success === true || loanIns.status === 201));

  const loanBack = await cloud.database.from('jp_loans').select('*').eq('uid', 'test-roundtrip');
  check('借款读回（默认 status=open）', !loanBack.error && loanBack.data.length === 1 && loanBack.data[0].status === 'open');

  const payIns = await cloud.database.from('jp_loan_payments').insert({
    lid: 'l-roundtrip-test', uid: 'test-roundtrip', amount: 50,
    principal_part: 45, interest_part: 5, late_part: 0
  });
  check('还款表可写（201）', !payIns.error && (payIns.success === true || payIns.status === 201));

  const woUpd = await cloud.database.from('jp_loans').update({ status: 'written_off' }).eq('lid', 'l-roundtrip-test').select();
  check('核销状态可更新', !woUpd.error && woUpd.data.length === 1 && woUpd.data[0].status === 'written_off');

  const payDel = await cloud.database.from('jp_loan_payments').delete().eq('uid', 'test-roundtrip').select();
  check('还款记录清理', !payDel.error && payDel.data.length === 1);
  const loanDel = await cloud.database.from('jp_loans').delete().eq('lid', 'l-roundtrip-test').select();
  check('借款记录清理', !loanDel.error && loanDel.data.length === 1);
  const loanAfter = await cloud.database.from('jp_loans').select('lid').eq('lid', 'l-roundtrip-test');
  check('清理后借贷表为空', !loanAfter.error && loanAfter.data.length === 0);

  console.log('[G] jp_debates / jp_debate_posts / jp_debate_bets（对线房表 round-trip）');
  const roomIns = await cloud.database.from('jp_debates').insert({
    did: 'd-roundtrip-test', topic: '联调测试辩题', side_a: '甲方', side_b: '乙方',
    creator_uid: 'test-roundtrip', creator_name: '联调测试',
    status: 'open', current_round: 1, max_rounds: 2
  });
  check('对线房表可写（201）', !roomIns.error && (roomIns.success === true || roomIns.status === 201));

  const postIns = await cloud.database.from('jp_debate_posts').insert({
    did: 'd-roundtrip-test', uid: 'test-roundtrip', nickname: '联调测试',
    side: 'a', round_no: 1, content: '联调测试发言'
  });
  check('发言表可写（201）', !postIns.error && (postIns.success === true || postIns.status === 201));

  const dbetIns = await cloud.database.from('jp_debate_bets').insert({
    did: 'd-roundtrip-test', uid: 'test-roundtrip', nickname: '联调测试',
    bet_on: 'a', stake: 20, odds_at_bet: 1.9
  });
  check('对线押注表可写（201）', !dbetIns.error && (dbetIns.success === true || dbetIns.status === 201));

  const roomBack = await cloud.database.from('jp_debates').select('*').eq('did', 'd-roundtrip-test');
  check('对线房读回（默认 current_round=1）', !roomBack.error && roomBack.data.length === 1 && roomBack.data[0].current_round === 1);
  const postBack = await cloud.database.from('jp_debate_posts').select('*').eq('did', 'd-roundtrip-test');
  check('发言读回', !postBack.error && postBack.data.length === 1 && postBack.data[0].side === 'a');
  const dbetBack = await cloud.database.from('jp_debate_bets').select('*').eq('did', 'd-roundtrip-test');
  check('对线押注读回', !dbetBack.error && dbetBack.data.length === 1 && dbetBack.data[0].stake === 20);

  const roomUpd = await cloud.database.from('jp_debates').update({ status: 'live' }).eq('did', 'd-roundtrip-test').select();
  check('房间状态可更新', !roomUpd.error && roomUpd.data.length === 1 && roomUpd.data[0].status === 'live');

  const dbetDel = await cloud.database.from('jp_debate_bets').delete().eq('did', 'd-roundtrip-test').select();
  check('对线押注清理', !dbetDel.error && dbetDel.data.length === 1);
  const postDel = await cloud.database.from('jp_debate_posts').delete().eq('did', 'd-roundtrip-test').select();
  check('发言清理', !postDel.error && postDel.data.length === 1);
  const roomDel = await cloud.database.from('jp_debates').delete().eq('did', 'd-roundtrip-test').select();
  check('房间清理', !roomDel.error && roomDel.data.length === 1);

  console.log('[H] jp_evidence（证据表 round-trip）');
  const evIns = await cloud.database.from('jp_evidence').insert({
    qid: 'bank-4', uid: 'test-roundtrip', nickname: '联调测试',
    side: 'yes', url: 'https://example.com/rt', title: '联调测试证据', summary: 'round-trip',
    status: 'pending', votes_up: 0, votes_down: 0
  });
  check('证据表可写（201）', !evIns.error && (evIns.success === true || evIns.status === 201));
  const evBack = await cloud.database.from('jp_evidence').select('*').eq('uid', 'test-roundtrip');
  check('证据读回（自增 eid）', !evBack.error && evBack.data.length === 1 && evBack.data[0].eid > 0 && evBack.data[0].status === 'pending');
  const evUpd = await cloud.database.from('jp_evidence').update({ status: 'accepted' }).eq('uid', 'test-roundtrip').select();
  check('证据状态可更新', !evUpd.error && evUpd.data.length === 1 && evUpd.data[0].status === 'accepted');
  const evDel = await cloud.database.from('jp_evidence').delete().eq('uid', 'test-roundtrip').select();
  check('证据清理', !evDel.error && evDel.data.length === 1);

  console.log('[I] jp_disputes / jp_dispute_votes（仲裁表 round-trip）');
  const dpIns = await cloud.database.from('jp_disputes').insert({
    qid: 'bank-4', uid: 'test-roundtrip', nickname: '联调测试',
    reason: '联调测试仲裁理由', status: 'voting', proposed_result: 'no'
  });
  check('争议表可写（201）', !dpIns.error && (dpIns.success === true || dpIns.status === 201));
  /* 插入不返回行体（无 return=representation），按 uid 读回取自增 id */
  const dpRead = await cloud.database.from('jp_disputes').select('*').eq('uid', 'test-roundtrip');
  const dpId = dpRead.data && dpRead.data[0] && dpRead.data[0].id;
  check('争议读回并带自增 id', !dpRead.error && dpRead.data.length === 1 && typeof dpId === 'number' && dpId > 0);

  const dvIns = await cloud.database.from('jp_dispute_votes').insert({
    dispute_id: dpId, uid: 'test-roundtrip-voter', nickname: '联调投票',
    agree: true, weight: 50
  });
  check('投票表可写（201）', !dvIns.error && (dvIns.success === true || dvIns.status === 201));

  const dpBack = await cloud.database.from('jp_disputes').select('*').eq('uid', 'test-roundtrip');
  check('争议读回（status=voting）', !dpBack.error && dpBack.data.length === 1 && dpBack.data[0].status === 'voting');
  const dvBack = await cloud.database.from('jp_dispute_votes').select('*').eq('dispute_id', dpId);
  check('投票读回', !dvBack.error && dvBack.data.length === 1 && dvBack.data[0].weight === 50);

  const dpUpd = await cloud.database.from('jp_disputes').update({ status: 'resolved', new_result: 'no' }).eq('uid', 'test-roundtrip').select();
  check('争议状态可更新', !dpUpd.error && dpUpd.data.length === 1 && dpUpd.data[0].status === 'resolved');

  const dvDel = await cloud.database.from('jp_dispute_votes').delete().eq('dispute_id', dpId).select();
  check('投票清理', !dvDel.error && dvDel.data.length === 1);
  const dpDel = await cloud.database.from('jp_disputes').delete().eq('uid', 'test-roundtrip').select();
  check('争议清理', !dpDel.error && dpDel.data.length === 1);

  console.log('[J] jp_odds_snaps（赔率快照表 round-trip）');
  const snapIns = await cloud.database.from('jp_odds_snaps').insert({
    qid: 'rt-odds-test', odds: { yes: 1.9, no: 1.9 }, pool: { yes: 1000, no: 1000 }
  });
  check('快照表可写（201）', !snapIns.error && (snapIns.success === true || snapIns.status === 201));
  const snapBack = await cloud.database.from('jp_odds_snaps').select('*').eq('qid', 'rt-odds-test');
  check('快照读回（jsonb 完整）', !snapBack.error && snapBack.data.length === 1 &&
    snapBack.data[0].odds.yes === 1.9 && snapBack.data[0].pool.no === 1000);
  const snapDel = await cloud.database.from('jp_odds_snaps').delete().eq('qid', 'rt-odds-test').select();
  check('快照清理', !snapDel.error && snapDel.data.length === 1);
  const realSnaps = await cloud.database.from('jp_odds_snaps').select('qid').limit(1);
  check('历史快照不受影响', !realSnaps.error && realSnaps.data.length >= 1);

  console.log('[K] jp_public_votes（公投表 round-trip）');
  const pvIns = await cloud.database.from('jp_public_votes').insert({
    qid: 'rt-vote-test', uid: 'test-roundtrip', nickname: '联调测试', choice: 'yes'
  });
  check('公投表可写（201）', !pvIns.error && (pvIns.success === true || pvIns.status === 201));
  const pvBack = await cloud.database.from('jp_public_votes').select('*').eq('uid', 'test-roundtrip');
  check('公投读回', !pvBack.error && pvBack.data.length === 1 && pvBack.data[0].choice === 'yes');
  const pvUpd = await cloud.database.from('jp_public_votes').update({ choice: 'no' }).eq('uid', 'test-roundtrip').select();
  check('公投可改票', !pvUpd.error && pvUpd.data.length === 1 && pvUpd.data[0].choice === 'no');
  const pvDel = await cloud.database.from('jp_public_votes').delete().eq('uid', 'test-roundtrip').select();
  check('公投清理', !pvDel.error && pvDel.data.length === 1);

  console.log('[L] jp_questions 新列（settle_mode / category / vote_end）');
  const qCols = await cloud.database.from('jp_questions').select('qid, settle_mode, category, vote_end').limit(3);
  check(' settle_mode/category 可读', !qCols.error && qCols.data.every(q => typeof q.settle_mode === 'string' && typeof q.category === 'string'));
  const catStat = await cloud.database.from('jp_questions').select('category').eq('qid', 'bank-1');
  check('题库分类已回填（bank-1=科技）', !catStat.error && catStat.data.length === 1 && catStat.data[0].category === '科技');

  console.log('\nround-trip 结果: ' + (fail ? fail + ' 项失败' : '全部通过'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
