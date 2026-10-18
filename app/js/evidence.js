/* ============================================================
 * 明鉴 · AI 证据情报站（EvidenceCore 纯函数，联机版专用）
 * 每个问题下一面「证据墙」：任何人可提交带链接的公开证据，
 * 社区投票排序，站长采纳/驳回；问题揭晓时，被采纳且命中结果的
 * 证据提交者获得积分奖励。AI 只负责整理，不制造证据。
 * ============================================================ */
var EvidenceCore = (function () {
  'use strict';

  var EVIDENCE_REWARD = 50;      /* 被采纳且揭晓命中的证据奖励 */
  var SIDES = ['yes', 'no', 'neutral'];

  function round2(v) { return Math.round(v * 100) / 100; }

  /* ---------- 校验 ---------- */
  function validateEvidence(input) {
    var title = String((input && input.title) || '').trim();
    var url = String((input && input.url) || '').trim();
    var summary = String((input && input.summary) || '').trim();
    var side = String((input && input.side) || '');
    if (SIDES.indexOf(side) === -1) return { ok: false, reason: '选择证据支持的立场' };
    if (title.length < 4) return { ok: false, reason: '证据标题至少 4 个字' };
    if (title.length > 80) return { ok: false, reason: '证据标题不超过 80 字' };
    if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, reason: '链接格式不正确（http/https）' };
    if (summary.length > 300) return { ok: false, reason: '摘要不超过 300 字' };
    if (!url && summary.length < 10) return { ok: false, reason: '没有链接时，摘要至少 10 个字' };
    return { ok: true };
  }

  /* ---------- 排序与统计 ---------- */
  /* 采纳 > 净票数 > 时间 */
  function sortEvidence(list) {
    return (list || []).slice().sort(function (a, b) {
      if ((b.status === 'accepted') !== (a.status === 'accepted')) return b.status === 'accepted' ? 1 : -1;
      var na = (Number(a.votes_up) || 0) - (Number(a.votes_down) || 0);
      var nb = (Number(b.votes_up) || 0) - (Number(b.votes_down) || 0);
      if (nb !== na) return nb - na;
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1;
    });
  }

  function sideTally(list) {
    var t = { yes: 0, no: 0, neutral: 0, accepted: 0 };
    (list || []).forEach(function (e) {
      if (t[e.side] == null) t[e.side] = 0;
      t[e.side]++;
      if (e.status === 'accepted') t.accepted++;
    });
    return t;
  }

  /* 信源质量榜：按采纳数、再按命中数 */
  function sourceBoard(evidence) {
    var byUid = {};
    (evidence || []).forEach(function (e) {
      var p = byUid[e.uid] || (byUid[e.uid] = {
        uid: e.uid, nickname: e.nickname, submitted: 0, accepted: 0, validated: 0, score: 0
      });
      p.submitted++;
      if (e.status === 'accepted') p.accepted++;
      if (e.validated) p.validated++;
    });
    var list = Object.keys(byUid).map(function (k) {
      var p = byUid[k];
      p.score = p.accepted * 10 + p.validated * 20;
      return p;
    });
    list.sort(function (a, b) { return b.score - a.score || b.accepted - a.accepted; });
    return list;
  }

  /* ---------- 揭晓联动 ---------- */
  /* 问题以 resultOid 揭晓时：被采纳且立场命中的证据 → 应奖励、应标记已验证 */
  function rewardCandidates(evidence, q, resultOid) {
    return (evidence || []).filter(function (e) {
      return e.qid === q.qid && e.status === 'accepted' && !e.validated &&
        e.side === resultOid;
    });
  }

  /* ---------- AI 证据综述 ---------- */
  function aiDigestPrompt(q, evidence) {
    var yes = evidence.filter(function (e) { return e.side === 'yes'; });
    var no = evidence.filter(function (e) { return e.side === 'no'; });
    function fmt(list) {
      if (!list.length) return '（无）';
      return list.map(function (e, i) {
        return (i + 1) + '. ' + e.title + (e.url ? '（' + e.url + '）' : '') +
          (e.summary ? '：' + e.summary : '');
      }).join('\n');
    }
    return '你是中立的证据整理员。下面是预测问题「' + q.title + '」下观众提交的公开证据，请整理成简报。\n' +
      '判定标准：' + (q.descr || '以公开事实为准') + '\n\n' +
      '支持「' + ((q.outcomes || []).filter(function (o) { return o.id === 'yes'; })[0] || {}).label + '」的证据：\n' + fmt(yes) + '\n\n' +
      '支持「' + ((q.outcomes || []).filter(function (o) { return o.id === 'no'; })[0] || {}).label + '」的证据：\n' + fmt(no) + '\n\n' +
      '要求：不添加证据之外的新事实；不预判结果；指出双方证据的强弱与缺口。\n' +
      '只回复一行 JSON：{"summary":"120字内的中立摘要","stronger":"yes或no或tie","gap":"一句话指出最缺的证据"}';
  }

  /* 兜底：无 AI 时的本地整理 */
  function localDigest(q, evidence) {
    var t = sideTally(evidence);
    return {
      by: 'local',
      summary: '本地整理：支持方证据 ' + t.yes + ' 条，反方 ' + t.no + ' 条，中立 ' + t.neutral +
        ' 条，已采纳 ' + t.accepted + ' 条。AI 不可用时仅做计数。',
      stronger: t.yes === t.no ? 'tie' : (t.yes > t.no ? 'yes' : 'no'),
      gap: '点击「AI 整理证据」获取完整综述。'
    };
  }

  function parseDigest(text) {
    var m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      var obj = JSON.parse(m[0]);
      if (!obj || typeof obj.summary !== 'string') return null;
      return {
        by: 'ai',
        summary: String(obj.summary).slice(0, 200),
        stronger: ['yes', 'no', 'tie'].indexOf(obj.stronger) === -1 ? 'tie' : obj.stronger,
        gap: String(obj.gap || '').slice(0, 120)
      };
    } catch (e) { return null; }
  }

  return {
    EVIDENCE_REWARD: EVIDENCE_REWARD, SIDES: SIDES,
    validateEvidence: validateEvidence, sortEvidence: sortEvidence, sideTally: sideTally,
    sourceBoard: sourceBoard, rewardCandidates: rewardCandidates,
    aiDigestPrompt: aiDigestPrompt, localDigest: localDigest, parseDigest: parseDigest
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EvidenceCore;
}
