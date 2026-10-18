/* ============================================================
 * 明鉴 · 联机版 v1.1（预测下注 + 信用借贷 + 天梯榜 + 赛季徽章战报
 *                  + 对线房 + 证据情报站 + 社区仲裁 + 预期指数）
 * - 免登录昵称制：uid 存本机 localStorage，数据全在云端
 * - 公开账本：jp_questions / jp_bets / jp_loans / jp_loan_payments / jp_settings
 *   + jp_debates / jp_debate_posts / jp_debate_bets（对线房）
 *   + jp_evidence（证据情报站）+ jp_disputes / jp_dispute_votes（社区仲裁）
 *   + jp_odds_snaps（赔率曲线）
 * - 借贷规则见 js/loans.js（LoanCore）；徽章与赛季见 js/badges.js（BadgeCore）
 * - 对线房 AI 评分走云端 LLM（cloud.llm.chat.completions，流式）
 * ============================================================ */
var OnlineCore = (function () {
  'use strict';

  var OPENING_BONUS = 1000;

  /* ---------- 全局设置（含借贷参数，与 LoanCore.DEFAULTS 对齐） ---------- */
  var DEFAULT_SETTINGS = {
    opening_bonus: OPENING_BONUS,
    default_fee: 0.05,
    accept_new_bets: true,
    announcement: '',
    maintenance: false,
    loan_enabled: true,
    credit_initial: 300,
    credit_step: 100,
    credit_max: 2000,
    credit_min: 100,
    overdue_penalty: 200,
    loan_rate: 0.05,
    loan_term_days: 7,
    loan_late_rate: 0.01,
    force_mult: 1.5,
    force_min_net: -300,
    min_bet: 10,
    min_loan: 10
  };

  /* 从 jp_settings 行数组提取 { tokenHash, site, allocLog, season } */
  function settingsFromRows(rows) {
    var out = {
      tokenHash: '', site: DEFAULT_SETTINGS, allocLog: [],
      season: (typeof BadgeCore !== 'undefined' ? BadgeCore.DEFAULT_SEASON : { start: '2026-10-18', length_days: 90, name: 'S' })
    };
    (rows || []).forEach(function (r) {
      if (r.key === 'admin_token_hash') {
        out.tokenHash = typeof r.value === 'string' ? r.value : '';
      } else if (r.key === 'site') {
        out.site = normalizeSettings(r.value);
      } else if (r.key === 'interest_alloc') {
        out.allocLog = Array.isArray(r.value) ? r.value : [];
      } else if (r.key === 'season') {
        out.season = r.value || out.season;
      }
    });
    return out;
  }

  function normalizeSettings(raw) {
    var s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    var num = function (v, min, max, dflt) {
      v = Number(v);
      return (isFinite(v) && v >= min && v <= max) ? v : dflt;
    };
    s.opening_bonus = num(s.opening_bonus, 0, 1000000, DEFAULT_SETTINGS.opening_bonus);
    s.default_fee = num(s.default_fee, 0, 0.5, DEFAULT_SETTINGS.default_fee);
    s.accept_new_bets = !!s.accept_new_bets;
    s.maintenance = !!s.maintenance;
    s.announcement = String(s.announcement == null ? '' : s.announcement).slice(0, 500);
    /* 借贷参数 */
    s.loan_enabled = !!s.loan_enabled;
    s.credit_initial = num(s.credit_initial, 0, 100000, DEFAULT_SETTINGS.credit_initial);
    s.credit_step = num(s.credit_step, 0, 100000, DEFAULT_SETTINGS.credit_step);
    s.credit_max = num(s.credit_max, 0, 1000000, DEFAULT_SETTINGS.credit_max);
    s.credit_min = num(s.credit_min, 0, 100000, DEFAULT_SETTINGS.credit_min);
    s.overdue_penalty = num(s.overdue_penalty, 0, 100000, DEFAULT_SETTINGS.overdue_penalty);
    s.loan_rate = num(s.loan_rate, 0, 1, DEFAULT_SETTINGS.loan_rate);
    s.loan_term_days = num(s.loan_term_days, 1, 365, DEFAULT_SETTINGS.loan_term_days);
    s.loan_late_rate = num(s.loan_late_rate, 0, 1, DEFAULT_SETTINGS.loan_late_rate);
    s.force_mult = num(s.force_mult, 1, 100, DEFAULT_SETTINGS.force_mult);
    s.force_min_net = num(s.force_min_net, -1000000, 0, DEFAULT_SETTINGS.force_min_net);
    s.min_bet = num(s.min_bet, 1, 100000, DEFAULT_SETTINGS.min_bet);
    s.min_loan = num(s.min_loan, 1, 100000, DEFAULT_SETTINGS.min_loan);
    return s;
  }

  function effectiveBonus(settings) {
    var s = (settings && settings.site) || {};
    return isFinite(Number(s.opening_bonus)) ? Number(s.opening_bonus) : OPENING_BONUS;
  }

  /* ---------- 赔率 ---------- */
  function poolOf(q, bets) {
    var pools = {}, total = 0;
    q.outcomes.forEach(function (o) {
      var p = (q.pool && q.pool[o.id]) || 0;
      pools[o.id] = p;
      total += p;
    });
    bets.forEach(function (b) {
      if (b.kind && b.kind !== 'bet') return; /* 奖励/差额补退等非投注行不进池 */
      if (b.qid === q.qid && b.status === 'open') {
        pools[b.outcome_id] = (pools[b.outcome_id] || 0) + Number(b.stake);
        total += Number(b.stake);
      }
    });
    return { pools: pools, total: total };
  }

  function currentOdds(q, bets) {
    var odds = {};
    if (q.mode === 'fixed') {
      q.outcomes.forEach(function (o) { odds[o.id] = o.fixedOdds; });
      return { odds: odds, pools: null, total: null };
    }
    var r = poolOf(q, bets);
    q.outcomes.forEach(function (o) {
      odds[o.id] = r.pools[o.id] > 0 ? r.total * (1 - Number(q.fee)) / r.pools[o.id] : 0;
    });
    return { odds: odds, pools: r.pools, total: r.total };
  }

  function potentialPayout(q, bets, oid, stake) {
    if (q.mode === 'fixed') {
      var o = q.outcomes.filter(function (x) { return x.id === oid; })[0];
      return stake * (o ? o.fixedOdds : 0);
    }
    var r = poolOf(q, bets);
    var winPool = r.pools[oid] + stake;
    var total = r.total + stake;
    return stake * total * (1 - Number(q.fee)) / winPool;
  }

  /* 揭晓时的最终赔率：resultOid 优先（揭晓前 q.result 尚未写入） */
  function settleOdds(q, bets, resultOid) {
    var result = resultOid || q.result;
    if (q.mode === 'fixed') {
      var o = q.outcomes.filter(function (x) { return x.id === result; })[0];
      return o ? o.fixedOdds : 0;
    }
    var r = poolOf(q, bets);
    return r.pools[result] > 0 ? r.total * (1 - Number(q.fee)) / r.pools[result] : 0;
  }

  /* ---------- 生命周期 ---------- */
  function dayStrOf(now) {
    var d = new Date(now || Date.now());
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isExpired(q, now) {
    if (!q.deadline) return false;
    return q.deadline < dayStrOf(now);
  }

  function phaseOf(q, now) {
    if (q.status === 'settled') return 'settled';
    if (isExpired(q, now)) return 'expired';
    return 'open';
  }

  /* ---------- 揭晓方式与大厅分区（v1.2） ---------- */
  /* settle_mode: search=平台检索（到期后由平台联网查证揭晓，用户不能发起）
   *              vote=公投揭晓（到期后进入公投窗口，一人一票，多数决）
   *              manual=人工揭晓（ legacy：任何人可按公开事实发起） */
  function settleModeOf(q) {
    var m = q && q.settle_mode;
    return (m === 'search' || m === 'vote') ? m : 'manual';
  }

  /* 公投窗口：投注截止后 ~ 公投截止前（含截止当天） */
  function isVotingOpen(q, now) {
    if (settleModeOf(q) !== 'vote' || !q.vote_end) return false;
    var today = dayStrOf(now);
    return !!q.deadline && q.deadline < today && today <= q.vote_end;
  }

  /* 公投窗口已结束（待结算） */
  function voteClosed(q, now) {
    if (settleModeOf(q) !== 'vote' || !q.vote_end) return false;
    var today = dayStrOf(now);
    return !!q.deadline && q.deadline < today && q.vote_end < today;
  }

  /* 大厅分区：open 进行中 / search 待平台检索 / voting 公投中 / manual 待人工揭晓 / settled 已揭晓 */
  function zoneOf(q, now) {
    if (q.status === 'settled') return 'settled';
    if (!isExpired(q, now)) return 'open';
    if (settleModeOf(q) === 'vote') return 'voting';
    return settleModeOf(q);
  }

  var ZONE_LABELS = {
    open: '进行中', search: '待平台检索', voting: '公投中', manual: '待人工揭晓', settled: '已揭晓档案'
  };
  var SETTLE_LABELS = { search: '平台检索', vote: '公投揭晓', manual: '人工揭晓' };

  function dayDiffLabel(q, now) {
    if (!q.deadline) return '';
    var today = dayStrOf(now);
    if (q.deadline < today) {
      var days = Math.round((new Date(today) - new Date(q.deadline)) / 86400000);
      return '已到期 ' + Math.max(days, 1) + ' 天 · 待揭晓';
    }
    var left = Math.round((new Date(q.deadline) - new Date(today)) / 86400000);
    return left === 0 ? '今天截止' : ('剩 ' + left + ' 天');
  }

  /* ---------- 积分与资产（委托 LoanCore） ---------- */
  function cashOf(uid, bets, loans, payments, settings) {
    return (typeof LoanCore !== 'undefined' ? LoanCore : null)
      ? LoanCore.cashOf(uid, bets, loans, payments, settings)
      : effectiveBonus(settings);
  }

  /* 大厅展示 */
  function visibleQuestions(questions, opts) {
    opts = opts || {};
    return (questions || []).filter(function (q) {
      return opts.isAdmin ? true : !q.hidden;
    });
  }

  function sortQuestions(questions) {
    return (questions || []).slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1;
    });
  }

  function outcomeLabelOf(q, oid) {
    var o = (q.outcomes || []).filter(function (x) { return x.id === oid; })[0];
    return o ? o.label : oid;
  }

  /* ---------- 导出 ---------- */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvOfBets(bets, questions) {
    var qmap = {};
    (questions || []).forEach(function (q) { qmap[q.qid] = q; });
    var lines = ['时间,问题,选项,玩家,UID,投注分,下注赔率,状态,派彩'];
    (bets || []).forEach(function (b) {
      if (b.kind && b.kind !== 'bet') return; /* 非投注行（奖励/差额补退）不入投注 CSV */
      var q = qmap[b.qid] || { title: b.qid, outcomes: [] };
      lines.push([
        b.placed_at, q.title, outcomeLabelOf(q, b.outcome_id), b.nickname, b.uid,
        b.stake, b.odds_at_bet, b.status, b.status === 'won' ? b.payout : 0
      ].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\n');
  }
  function csvOfLoans(loans, payments) {
    return (typeof LoanCore !== 'undefined' ? LoanCore : { csvOfLoans: function () { return ''; } })
      .csvOfLoans(loans, payments);
  }

  return {
    OPENING_BONUS: OPENING_BONUS, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    settingsFromRows: settingsFromRows, normalizeSettings: normalizeSettings,
    effectiveBonus: effectiveBonus,
    poolOf: poolOf, currentOdds: currentOdds, potentialPayout: potentialPayout,
    settleOdds: settleOdds, isExpired: isExpired, phaseOf: phaseOf, dayDiffLabel: dayDiffLabel,
    settleModeOf: settleModeOf, isVotingOpen: isVotingOpen, voteClosed: voteClosed,
    zoneOf: zoneOf, ZONE_LABELS: ZONE_LABELS, SETTLE_LABELS: SETTLE_LABELS,
    cashOf: cashOf, visibleQuestions: visibleQuestions,
    sortQuestions: sortQuestions, outcomeLabelOf: outcomeLabelOf,
    csvOfBets: csvOfBets, csvOfLoans: csvOfLoans
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OnlineCore;
}

/* ============================================================
 * UI 层（依赖 DOM + cloud SDK + LoanCore）
 * ============================================================ */
var OnlineApp = (function () {
  'use strict';

  var PUBLIC_CONFIG = {
    endpoint: 'https://jp-ladder.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK'
  };
  var UID_KEY = 'jp-online-uid';
  var NICK_KEY = 'jp-online-nick';
  var ADMIN_KEY = 'jp-online-admin';       /* 仅存「已解锁」标记，真正的校验在云端哈希 */
  var LLM_KEY = 'jp-online-llm';           /* 站长本机 LLM 配置（key 不出本机） */
  var REFRESH_MS = 30000;

  var cloud = null;
  var state = {
    questions: [], bets: [], loans: [], payments: [],
    debates: [], debatePosts: [], debateBets: [],
    evidence: [], disputes: [], disputeVotes: [], oddsSnaps: [],
    publicVotes: [],
    settings: { tokenHash: '', site: OnlineCore.DEFAULT_SETTINGS, allocLog: [], season: null },
    uid: '', nickname: '',
    view: 'hall', hallTab: 'open', debateRoom: '',
    hallSort: 'new', hallCat: '', hallTime: '',
    evidenceDigest: {},
    busy: false, lastError: '',
    adminUnlocked: false,
    llmBusy: '', llmSuggestion: null
  };

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function on(id, ev, fn) {
    var el = $(id);
    if (el) { el.addEventListener(ev, fn); return true; }
    return false;
  }
  function uid() {
    var id = localStorage.getItem(UID_KEY);
    if (!id) {
      id = 'u-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
      localStorage.setItem(UID_KEY, id);
    }
    return id;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v) { return (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1); }
  function scoreColor(v) { return v > 0 ? '#A32D2D' : (v < 0 ? '#3B6D11' : '#5F5E5A'); }
  function fmtTs(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function findQuestion(qid) {
    for (var i = 0; i < state.questions.length; i++) if (state.questions[i].qid === qid) return state.questions[i];
    return null;
  }
  function findLoan(lid) {
    for (var i = 0; i < state.loans.length; i++) if (state.loans[i].lid === lid) return state.loans[i];
    return null;
  }
  function myBets() {
    return state.bets.filter(function (b) { return b.uid === state.uid && (!b.kind || b.kind === 'bet'); });
  }
  function myLoans() {
    return state.loans.filter(function (l) { return l.uid === state.uid; });
  }
  function totalPoints() {
    return LoanCore.cashOf(state.uid, state.bets, state.loans, state.payments, state.settings);
  }
  function loanSummary() {
    return LoanCore.summaryOf(state.uid, state.bets, state.loans, state.payments, state.settings);
  }
  function isBankrupt() {
    return LoanCore.isBankrupt(state.uid, state.bets, state.loans, state.payments, state.settings);
  }
  function setBusy(v) { state.busy = v; renderAll(); }
  function showError(msg) { state.lastError = msg; renderAll(); }

  /* ---------- 云端 ---------- */
  function initCloud() {
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: PUBLIC_CONFIG.publishableKey
    });
  }

  function loadData() {
    return Promise.all([
      cloud.database.from('jp_questions').select('*').order('created_at', { ascending: false }),
      cloud.database.from('jp_bets').select('*').order('placed_at', { ascending: false }),
      cloud.database.from('jp_settings').select('*'),
      cloud.database.from('jp_loans').select('*').order('created_at', { ascending: false }),
      cloud.database.from('jp_loan_payments').select('*').order('paid_at', { ascending: false }),
      cloud.database.from('jp_debates').select('*').order('created_at', { ascending: false }).limit(200),
      cloud.database.from('jp_debate_posts').select('*').order('posted_at', { ascending: false }).limit(500),
      cloud.database.from('jp_debate_bets').select('*').order('placed_at', { ascending: false }).limit(500),
      cloud.database.from('jp_evidence').select('*').order('created_at', { ascending: false }).limit(500),
      cloud.database.from('jp_disputes').select('*').order('created_at', { ascending: false }).limit(200),
      cloud.database.from('jp_dispute_votes').select('*').order('created_at', { ascending: false }).limit(500),
      cloud.database.from('jp_odds_snaps').select('*').order('created_at', { ascending: false }).limit(800),
      cloud.database.from('jp_public_votes').select('*').order('created_at', { ascending: false }).limit(2000)
    ]).then(function (rs) {
      if (rs[0].error) throw new Error(rs[0].error.message || '题库加载失败');
      if (rs[1].error) throw new Error(rs[1].error.message || '投注加载失败');
      if (rs[2].error) throw new Error(rs[2].error.message || '设置加载失败');
      if (rs[3].error) throw new Error(rs[3].error.message || '借贷记录加载失败');
      if (rs[4].error) throw new Error(rs[4].error.message || '还款记录加载失败');
      state.questions = rs[0].data || [];
      state.bets = rs[1].data || [];
      state.settings = OnlineCore.settingsFromRows(rs[2].data || []);
      state.loans = rs[3].data || [];
      state.payments = rs[4].data || [];
      state.debates = rs[5].data || [];
      state.debatePosts = rs[6].data || [];
      state.debateBets = rs[7].data || [];
      state.evidence = rs[8].data || [];
      state.disputes = rs[9].data || [];
      state.disputeVotes = rs[10].data || [];
      state.oddsSnaps = rs[11].data || [];
      state.publicVotes = rs[12].data || [];
      state.lastError = '';
    });
  }

  function refresh() {
    setBusy(true);
    return loadData()
      .then(function () { return checkBankruptcy(); })
      .then(function () { return checkDisputeStakes(); })
      .then(function () { return checkVoteSettles(); })
      .then(function () { setBusy(false); renderAll(); })
      .catch(function (e) { setBusy(false); showError(e.message || '网络异常'); });
  }

  /* 破产保护：净资产跌破破产线时自动核销全部未清借款
   * 核销 = 状态置 written_off（不删记录）：债务清零、额度恢复；
   * 本金仍计入现金（钱确实到过账），流水与站长台账均可追溯 */
  function checkBankruptcy() {
    var open = state.loans.filter(function (l) { return l.uid === state.uid && l.status === 'open'; });
    if (!open.length) return Promise.resolve();
    if (!isBankrupt()) return Promise.resolve();
    setBusy(true);
    var chain = Promise.resolve();
    open.forEach(function (l) {
      chain = chain.then(function () {
        return cloud.database.from('jp_loans')
          .update({ status: 'written_off', closed_at: new Date().toISOString() })
          .eq('lid', l.lid).then(check);
      });
    });
    return chain.then(loadData)
      .then(function () {
        setBusy(false);
        renderAll();
        alert('已触发破产保护：全部负债已核销清零，从头再来。\n信用额度重置为 ' +
          LoanCore.creditLimitOf(state.uid, state.loans, state.settings) + ' 分。');
      })
      .catch(function (e) { setBusy(false); showError(e.message || '破产保护执行失败'); });
  }

  /* 统一写操作：busy → 执行 → 重载 → 破产检查 → 仲裁质押兜底结算 → 公投到期兜底结算 → 渲染；失败弹窗且恢复 */
  function withCloud(work) {
    if (state.busy) return;
    setBusy(true);
    return work().then(function () {
      return loadData();
    }).then(function () {
      return checkBankruptcy();
    }).then(function () {
      return checkDisputeStakes();
    }).then(function () {
      return checkVoteSettles();
    }).then(function () {
      setBusy(false);
      renderAll();
    }).catch(function (e) {
      setBusy(false);
      alert(e.message || '操作失败，请重试');
    });
  }

  /* 仲裁质押兜底结算：裁决已成立但质押仍未结算时补结算
   * （如投票客户端在写质押结果前中断）。幂等：只动仍为 open 的行 */
  function checkDisputeStakes() {
    var jobs = state.disputes.filter(function (d) {
      if (d.status !== 'voting') return false;
      if (ArbitCore.verdictOf(d, state.disputeVotes) === 'pending') return false;
      return ArbitCore.stakeRowsOf(d.id, state.bets).some(function (b) { return b.status === 'open'; });
    });
    if (!jobs.length) return Promise.resolve();
    var chain = Promise.resolve();
    jobs.forEach(function (d) {
      chain = chain.then(function () {
        var plan = ArbitCore.resolveStakesPlan(d, state.disputeVotes, state.bets);
        if (!plan || !plan.items.length) return null;
        var c = Promise.resolve();
        plan.items.forEach(function (item) {
          c = c.then(function () {
            return cloud.database.from('jp_bets')
              .update({ status: item.status, payout: item.payout, settled_at: new Date().toISOString() })
              .eq('id', item.bet.id).eq('status', 'open').then(check);
          });
        });
        return c;
      });
    });
    return chain;
  }

  /* PostgREST update/delete 结果检查：有 error 字段即抛 */
  function check(r) {
    if (r && r.error) throw new Error(r.error.message || '云端写入失败');
    return r;
  }

  /* ---------- 动作：投注 ---------- */
  function placeBet(qid, oid, stake) {
    var q = findQuestion(qid);
    if (!q || q.status !== 'open') { alert('问题已揭晓或不存在'); return; }
    if (OnlineCore.isExpired(q)) { alert('已过截止日期，等待揭晓'); return; }
    if (!state.settings.site.accept_new_bets) { alert('站长已暂停接受新投注'); return; }
    if (state.settings.site.maintenance) { alert('站务维护中，暂停投注'); return; }
    stake = Math.floor(Number(stake));
    var minBet = state.settings.site.min_bet;
    if (!(stake >= minBet)) { alert('投注额最少 ' + minBet + ' 分'); return; }
    var avail = totalPoints();
    if (stake > Math.floor(avail)) { alert('积分不足：当前可用 ' + Math.floor(avail) + ' 分'); return; }

    var odds = OnlineCore.currentOdds(q, state.bets).odds[oid];
    withCloud(function () {
      var chain = cloud.database.from('jp_bets').insert({
        qid: qid, uid: state.uid, nickname: state.nickname,
        outcome_id: oid, stake: stake,
        odds_at_bet: Math.round(odds * 100) / 100
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message || '下注失败');
      });
      /* 赔率曲线快照：节流写入（含本笔投注后的最新池） */
      chain = chain.then(function () {
        if (q.mode !== 'pool') return null;
        if (!OddsCore.shouldSnap(qid, state.oddsSnaps, Date.now())) return null;
        var after = state.bets.concat([{ qid: qid, outcome_id: oid, stake: stake, status: 'open', kind: 'bet' }]);
        var cur = OnlineCore.currentOdds(q, after);
        var live = OnlineCore.poolOf(q, after);
        return cloud.database.from('jp_odds_snaps').insert({
          qid: qid, odds: cur.odds, pool: live.pools
        }).then(check);
      });
      return chain;
    });
  }

  /* ---------- 动作：揭晓结算 ---------- */
  /* 防滥用（v1.2）：只有 manual 模式的问题允许用户按公开事实发起揭晓；
   * search 模式到期后进「待平台检索」区（仅站长可查证揭晓，日常由平台自动化完成）；
   * vote 模式到期后进「公投中」区，按一人一票的多数决结算（见 settleVote）。
   * opts.byAdmin：站长代平台行使检索揭晓权。 */
  function settleQuestion(qid, resultOid, opts) {
    opts = opts || {};
    var q = findQuestion(qid);
    if (!q || q.status !== 'open') { alert('问题已揭晓'); return; }
    if (OnlineCore.settleModeOf(q) !== 'manual' && !(opts.byAdmin && state.adminUnlocked)) {
      alert('本问题为「' + OnlineCore.SETTLE_LABELS[OnlineCore.settleModeOf(q)] + '」揭晓，到期后按对应流程结算，不能手动发起。');
      return;
    }
    var label = resultOid === 'draw' ? '平局（投注全额退还）' : OnlineCore.outcomeLabelOf(q, resultOid);
    if (!opts.skipConfirm) {
      if (!confirm('确认按公开事实揭晓「' + q.title + '」？\n结果：' + label +
        '\n\n揭晓后所有人的相关投注将立即结算，不可撤销。')) return;
    }
    doSettle(q, resultOid);
  }

  /* 结算核心：支持 resultOid='draw'（公投平局 → 投注全额退还） */
  function doSettle(q, resultOid) {
    var isDraw = resultOid === 'draw';
    var finalOdds = isDraw ? 1 : OnlineCore.settleOdds(q, state.bets, resultOid);
    var wonBets = state.bets.filter(function (b) {
      if (b.qid !== q.qid || b.status !== 'open') return false;
      if (b.kind && b.kind !== 'bet') return false;
      return isDraw ? true : b.outcome_id === resultOid;
    });
    withCloud(function () {
      var chain = cloud.database.from('jp_questions')
        .update({ status: 'settled', result: resultOid, final_odds: Math.round(finalOdds * 100) / 100, settled_at: new Date().toISOString() })
        .eq('qid', q.qid).then(check);
      wonBets.forEach(function (b) {
        var payout = isDraw ? Number(b.stake) : Math.round(Number(b.stake) * finalOdds * 10) / 10;
        chain = chain.then(function () {
          return cloud.database.from('jp_bets')
            .update({ status: 'won', payout: payout, settled_at: new Date().toISOString() })
            .eq('id', b.id).then(check);
        });
      });
      chain = chain.then(function () {
        return cloud.database.from('jp_bets')
          .update({ status: 'lost', settled_at: new Date().toISOString() })
          .eq('qid', q.qid).eq('status', 'open').then(check);
      });
      /* 证据奖励：被采纳且立场命中的证据，提交者各奖 50 分（kind=bonus 镜像入账） */
      var cands = isDraw ? [] : EvidenceCore.rewardCandidates(state.evidence, q, resultOid);
      cands.forEach(function (e) {
        chain = chain.then(function () {
          return cloud.database.from('jp_bets').insert({
            qid: q.qid, uid: e.uid, nickname: e.nickname, outcome_id: e.side,
            stake: 0, odds_at_bet: 0, status: 'won', kind: 'bonus',
            payout: EvidenceCore.EVIDENCE_REWARD,
            placed_at: new Date().toISOString(), settled_at: new Date().toISOString()
          }).then(check);
        });
        chain = chain.then(function () {
          return cloud.database.from('jp_evidence').update({ validated: true }).eq('eid', e.eid).then(check);
        });
      });
      return chain;
    });
  }

  /* ---------- 动作：公投（v1.2） ---------- */
  function publicVotesOf(qid) {
    return state.publicVotes.filter(function (v) { return v.qid === qid; });
  }

  /* 一人一票：本机 uid 唯一；截止前可改票 */
  function castVote(qid, choice) {
    var q = findQuestion(qid);
    if (!q || OnlineCore.zoneOf(q) !== 'voting') { alert('当前不在公投期'); return; }
    if (OnlineCore.voteClosed(q)) { alert('公投已结束，等待结算'); return; }
    if (!q.outcomes.some(function (o) { return o.id === choice; })) { alert('选项不存在'); return; }
    var mine = publicVotesOf(qid).filter(function (v) { return v.uid === state.uid; })[0];
    var now = new Date().toISOString();
    withCloud(function () {
      if (mine) {
        return cloud.database.from('jp_public_votes')
          .update({ choice: choice, created_at: now }).eq('id', mine.id).then(check);
      }
      return cloud.database.from('jp_public_votes').insert({
        qid: qid, uid: state.uid, nickname: state.nickname, choice: choice, created_at: now
      }).then(check);
    });
  }

  /* 公投计票：返回 {result, tally, total, tie}；无人投票返回 null */
  function voteTallyOf(q) {
    var votes = publicVotesOf(q.qid);
    if (!votes.length) return null;
    var tally = {};
    votes.forEach(function (v) { tally[v.choice] = (tally[v.choice] || 0) + 1; });
    var best = null, tie = false;
    q.outcomes.forEach(function (o) {
      var n = tally[o.id] || 0;
      if (best === null || n > best.n) { best = { id: o.id, n: n }; tie = false; }
      else if (n === best.n) tie = true;
    });
    return { result: tie ? 'draw' : best.id, tally: tally, total: votes.length, tie: tie };
  }

  /* 按公投结果揭晓（按钮入口：需确认） */
  function settleVote(qid) {
    var q = findQuestion(qid);
    if (!q || q.status !== 'open') { alert('问题已揭晓'); return; }
    if (OnlineCore.settleModeOf(q) !== 'vote') { alert('只有公投模式的问题可按投票结算'); return; }
    var t = voteTallyOf(q);
    if (!t) { alert('还没有人投票，公投票数不足，暂不能结算'); return; }
    var label = t.tie ? '平局（投注全额退还）' : OnlineCore.outcomeLabelOf(q, t.result);
    if (!confirm('按公投结果揭晓「' + q.title + '」？\n结果：' + label +
      '（共 ' + t.total + ' 票）\n\n揭晓后所有投注立即结算，不可撤销。')) return;
    doSettle(q, t.result);
  }

  /* 公投到期兜底结算：投票窗口结束且有人投票 → 自动按多数决揭晓（幂等） */
  function checkVoteSettles() {
    var jobs = state.questions.filter(function (q) {
      return q.status === 'open' && OnlineCore.settleModeOf(q) === 'vote' &&
        OnlineCore.voteClosed(q) && publicVotesOf(q.qid).length > 0;
    });
    if (!jobs.length) return Promise.resolve();
    var chain = Promise.resolve();
    jobs.forEach(function (q) {
      chain = chain.then(function () {
        var t = voteTallyOf(q);
        if (!t) return null;
        return doSettleWrite(q, t.result);
      });
    });
    return chain;
  }

  /* doSettle 的写入部分（无 confirm/无 withCloud 包装，供懒结算复用） */
  function doSettleWrite(q, resultOid) {
    var isDraw = resultOid === 'draw';
    var finalOdds = isDraw ? 1 : OnlineCore.settleOdds(q, state.bets, resultOid);
    var wonBets = state.bets.filter(function (b) {
      if (b.qid !== q.qid || b.status !== 'open') return false;
      if (b.kind && b.kind !== 'bet') return false;
      return isDraw ? true : b.outcome_id === resultOid;
    });
    var chain = cloud.database.from('jp_questions')
      .update({ status: 'settled', result: resultOid, final_odds: Math.round(finalOdds * 100) / 100, settled_at: new Date().toISOString() })
      .eq('qid', q.qid).eq('status', 'open').then(check);
    wonBets.forEach(function (b) {
      var payout = isDraw ? Number(b.stake) : Math.round(Number(b.stake) * finalOdds * 10) / 10;
      chain = chain.then(function () {
        return cloud.database.from('jp_bets')
          .update({ status: 'won', payout: payout, settled_at: new Date().toISOString() })
          .eq('id', b.id).eq('status', 'open').then(check);
      });
    });
    chain = chain.then(function () {
      return cloud.database.from('jp_bets')
        .update({ status: 'lost', settled_at: new Date().toISOString() })
        .eq('qid', q.qid).eq('status', 'open').then(check);
    });
    return chain;
  }

  /* ---------- 动作：建题 ---------- */
  function createQuestion() {
    var title = $('q-title').value.trim();
    var descr = $('q-desc').value.trim();
    var mode = $('q-mode').value;
    var deadline = $('q-deadline').value;
    var lines = $('q-outcomes').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var simpool = $('q-simpool').checked;
    var settleMode = $('q-settle') ? $('q-settle').value : 'search';
    var voteEnd = $('q-vote-end') ? $('q-vote-end').value : '';

    if (!title) { alert('请填写问题标题'); return; }
    if (lines.length < 2 || lines.length > 4) { alert('选项需 2-4 个，每行一个'); return; }
    if (!deadline) { alert('请选择截止日期'); return; }
    /* 人工揭晓仅站长可选（防滥用：到期后一般不让人发起揭晓） */
    if (settleMode === 'manual' && !state.adminUnlocked) {
      alert('「人工揭晓」仅站长可设置；请选择「平台检索」或「公投揭晓」');
      return;
    }
    if (settleMode === 'vote') {
      if (!voteEnd) { alert('公投模式需设置公投截止日期'); return; }
      if (voteEnd < deadline) { alert('公投截止不能早于投注截止（建议晚 7 天以上，给投票留时间）'); return; }
    }

    var outcomes = lines.map(function (label, i) {
      return { id: 'o' + i + '-' + Date.now().toString(36), label: label };
    });
    if (mode === 'fixed') {
      var oddsList = $('q-odds').value.split(/[,，]/).map(function (s) { return Number(s.trim()); });
      if (oddsList.length !== outcomes.length || oddsList.some(function (v) { return !(v >= 1.01); })) {
        alert('固定赔率需为 ' + outcomes.length + ' 个不小于 1.01 的数字，逗号分隔');
        return;
      }
      outcomes.forEach(function (o, i) { o.fixedOdds = oddsList[i]; });
    }

    var pool = {};
    if (mode === 'pool' && simpool) outcomes.forEach(function (o) { pool[o.id] = 1000; });
    var qid = 'q-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);

    withCloud(function () {
      var chain = cloud.database.from('jp_questions').insert({
        qid: qid,
        title: title, descr: descr, mode: mode,
        fee: mode === 'pool' ? state.settings.site.default_fee : 0,
        deadline: deadline, outcomes: outcomes, pool: pool,
        settle_mode: settleMode, vote_end: settleMode === 'vote' ? voteEnd : null,
        category: ($('q-cat') ? $('q-cat').value : '') || '未分类',
        creator_name: state.nickname
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message || '创建失败');
        $('q-title').value = ''; $('q-desc').value = ''; $('q-outcomes').value = ''; $('q-odds').value = '';
      });
      /* 建题即写首个快照：曲线从开局就有起点 */
      chain = chain.then(function () {
        if (mode !== 'pool' || !simpool) return null;
        var total = outcomes.reduce(function (s, o) { return s + (pool[o.id] || 0); }, 0);
        var odds0 = {};
        outcomes.forEach(function (o) {
          odds0[o.id] = pool[o.id] > 0 ? Math.round(total * (1 - state.settings.site.default_fee) / pool[o.id] * 100) / 100 : 0;
        });
        return cloud.database.from('jp_odds_snaps').insert({ qid: qid, odds: odds0, pool: pool }).then(check);
      });
      return chain;
    });
  }

  /* ---------- 动作：借贷 ---------- */
  function borrow(amount) {
    var chk = LoanCore.canBorrowOf(state.uid, amount, state.bets, state.loans, state.settings);
    if (!chk.ok) { alert(chk.reason); return; }
    var p = LoanCore.params(state.settings);
    if (!confirm('确认借款 ' + amount + ' 分？\n期限 ' + p.loan_term_days + ' 天，到期利息 ' +
      chk.interest + ' 分，到期日 ' + chk.dueDate + '。\n逾期每天按本金 ' +
      Math.round(p.loan_late_rate * 100) + '% 计罚息。\n\n这是游戏内信用额度，与真实货币无关。')) return;
    withCloud(function () {
      return cloud.database.from('jp_loans').insert({
        lid: 'l-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36),
        uid: state.uid, nickname: state.nickname,
        principal: Math.floor(Number(amount)),
        rate: p.loan_rate, term_days: p.loan_term_days,
        due_date: chk.dueDate
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message || '借款失败');
      });
    });
  }

  function repay(lid) {
    var loan = findLoan(lid);
    if (!loan || loan.uid !== state.uid || loan.status !== 'open') { alert('借款不存在或已结清'); return; }
    var input = document.querySelector('[data-repay="' + lid + '"]');
    var amount = input ? Math.floor(Number(input.value) || 0) : 0;
    var o = LoanCore.outstandingOf(loan);
    if (!(amount > 0)) { alert('请输入还款金额'); return; }
    var plan = LoanCore.repayPlan(loan, amount);
    if (plan.total <= 0) { alert('当前无需还款'); return; }
    if (plan.total < amount) {
      if (!confirm('应还总额 ' + o.total + ' 分，将按 ' + plan.total + ' 分扣收。继续？')) return;
    }
    var avail = totalPoints();
    if (plan.total > Math.floor(avail)) {
      alert('可用积分不足：需还 ' + plan.total + ' 分，当前可用 ' + Math.floor(avail) + ' 分');
      return;
    }
    /* 结清判定与字段快照 */
    var next = JSON.parse(JSON.stringify(loan));
    LoanCore.applyRepayment(next, plan, new Date().toISOString());
    withCloud(function () {
      return cloud.database.from('jp_loan_payments').insert({
        lid: lid, uid: state.uid,
        amount: plan.total,
        principal_part: plan.principal, interest_part: plan.interest, late_part: plan.late
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message || '还款失败');
      }).then(function () {
        return cloud.database.from('jp_loans').update({
          repaid_principal: next.repaid_principal,
          repaid_interest: next.repaid_interest,
          late_fee: next.late_fee,
          status: next.status,
          closed_at: next.closed_at || null
        }).eq('lid', lid).then(check);
      });
    });
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderBanner();
    renderBadges();
    if (state.view === 'hall') renderHall();
    if (state.view === 'board') renderBoard();
    if (state.view === 'index') renderIndex();
    if (state.view === 'mine') renderMine();
    if (state.view === 'debate') renderDebate();
    if (state.view === 'admin') renderAdmin();
  }

  function renderBanner() {
    var el = $('site-banner');
    if (!el) return;
    var s = state.settings.site;
    if (s.maintenance) {
      el.style.display = '';
      el.className = 'site-banner maintenance';
      el.innerHTML = '⚠ 站务维护中，暂停接受新投注。' + (s.announcement ? ' ' + esc(s.announcement) : '');
    } else if (s.announcement) {
      el.style.display = '';
      el.className = 'site-banner';
      el.textContent = '📢 ' + s.announcement;
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
  }

  function renderBadges() {
    var badge = $('conn-badge');
    var avail = totalPoints();
    if (badge) {
      badge.textContent = state.busy ? '同步中…' : ('可用积分 ' + Math.floor(avail));
      badge.className = 'engine-badge' + (state.busy ? ' llm' : '');
    }
    var nv = $('nick-view');
    if (nv) nv.textContent = state.nickname || '未设置';
  }

  function hallQuestions() {
    return OnlineCore.sortQuestions(OnlineCore.visibleQuestions(state.questions, {
      isAdmin: state.adminUnlocked
    }));
  }

  function renderHall() {
    renderHallTabs();
    var list = $('question-list');
    if (!list) return;
    var byZone = { open: [], search: [], voting: [], manual: [], settled: [] };
    hallQuestions().forEach(function (q) { byZone[OnlineCore.zoneOf(q)].push(q); });

    /* 当前分区失效（被筛空/切换）时回到进行中 */
    if (!byZone[state.hallTab]) state.hallTab = 'open';

    if (state.hallTab === 'settled') {
      list.innerHTML = renderArchive(byZone.settled);
      bindEvidenceEvents();
      bindDisputeEvents();
      return;
    }
    var shown = filterSortQuestions(byZone[state.hallTab]);
    renderHallToolbar(byZone[state.hallTab], shown.length);
    if (!shown.length) {
      list.innerHTML = '<div class="card"><div class="q-empty">' +
        (byZone[state.hallTab].length
          ? '当前筛选条件下没有题目，换个条件试试。'
          : zoneEmptyText(state.hallTab)) +
        '</div></div>';
      return;
    }
    list.innerHTML = shown.map(questionCard).join('');
    bindQuestionEvents();
    bindEvidenceEvents();
    bindVoteEvents();
    startCountdown();
  }

  function zoneEmptyText(zone) {
    return {
      open: '题库加载中或暂无进行中的问题。',
      search: '当前没有待平台检索的问题。',
      voting: '当前没有公投中的问题。',
      manual: '当前没有待人工揭晓的问题。'
    }[zone] || '暂无题目。';
  }

  /* ---------- 筛选与排序（v1.2：减少逐条翻页） ---------- */
  function catOf(q) { return q.category || '未分类'; }

  function openBetCountOf(q) {
    return state.bets.filter(function (b) {
      return b.qid === q.qid && b.status === 'open' && (!b.kind || b.kind === 'bet');
    }).length;
  }
  function poolTotalOf(q) {
    return OnlineCore.poolOf(q, state.bets).total;
  }
  /* 热度 = 投注数 × 1000 + 彩池（让「有人玩」的题排在前面） */
  function heatOf(q) { return openBetCountOf(q) * 1000 + poolTotalOf(q); }

  function inTimeRange(q, range) {
    var d = q.deadline || q.vote_end || '';
    if (range === 'none') return !d;
    if (!d) return false;
    var today = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var todayStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    if (range === 'week') return d >= todayStr && d <= addDaysStr(todayStr, 7);
    if (range === 'month') return d >= todayStr && d <= addDaysStr(todayStr, 31);
    if (range === 'quarter') return d >= todayStr && d <= addDaysStr(todayStr, 92);
    if (range === 'year') return d >= todayStr && d <= today.getFullYear() + '-12-31';
    if (range === 'later') return d > today.getFullYear() + '-12-31';
    return true;
  }
  function addDaysStr(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function filterSortQuestions(qs) {
    var out = (qs || []).slice();
    if (state.hallCat) out = out.filter(function (q) { return catOf(q) === state.hallCat; });
    if (state.hallTime) out = out.filter(function (q) { return inTimeRange(q, state.hallTime); });
    var byCreated = function (a, b) { return (b.created_at || '') > (a.created_at || '') ? 1 : -1; };
    switch (state.hallSort) {
      case 'deadline_asc':
        out.sort(function (a, b) { return (a.deadline || '9999-12-31') > (b.deadline || '9999-12-31') ? 1 : -1; });
        break;
      case 'deadline_desc':
        out.sort(function (a, b) { return (a.deadline || '') < (b.deadline || '') ? 1 : -1; });
        break;
      case 'hot':
        out.sort(function (a, b) { return heatOf(b) - heatOf(a) || byCreated(a, b); });
        break;
      case 'pool':
        out.sort(function (a, b) { return poolTotalOf(b) - poolTotalOf(a) || byCreated(a, b); });
        break;
      default:
        out.sort(byCreated);
    }
    return out;
  }

  var SORT_OPTIONS = [
    { v: 'new', t: '最新发布' },
    { v: 'hot', t: '热度（投注+奖池）' },
    { v: 'pool', t: '奖池最大' },
    { v: 'deadline_asc', t: '最早截止' },
    { v: 'deadline_desc', t: '最晚截止' }
  ];
  var TIME_OPTIONS = [
    { v: '', t: '全部时间' },
    { v: 'week', t: '7 天内截止' },
    { v: 'month', t: '30 天内截止' },
    { v: 'quarter', t: '90 天内截止' },
    { v: 'year', t: '今年内截止' },
    { v: 'later', t: '明年起' },
    { v: 'none', t: '无截止' }
  ];

  function renderHallToolbar(zoneQs, shownN) {
    var box = $('hall-toolbar');
    if (!box) return;
    var cats = {};
    zoneQs.forEach(function (q) { cats[catOf(q)] = (cats[catOf(q)] || 0) + 1; });
    var catKeys = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    var html = '<div class="hall-toolbar">' +
      '<div class="toolbar-row">' +
      '<span class="toolbar-label">排序</span>' +
      '<select id="hall-sort">' + SORT_OPTIONS.map(function (o) {
        return '<option value="' + o.v + '"' + (state.hallSort === o.v ? ' selected' : '') + '>' + o.t + '</option>';
      }).join('') + '</select>' +
      '<span class="toolbar-label">截止</span>' +
      '<select id="hall-time">' + TIME_OPTIONS.map(function (o) {
        return '<option value="' + o.v + '"' + (state.hallTime === o.v ? ' selected' : '') + '>' + o.t + '</option>';
      }).join('') + '</select>' +
      '<span class="toolbar-count">共 ' + zoneQs.length + ' 题' + (shownN < zoneQs.length ? ' · 筛选出 ' + shownN + ' 题' : '') + '</span>' +
      '</div>' +
      '<div class="toolbar-row chips">' +
      '<button class="chip' + (state.hallCat === '' ? ' active' : '') + '" data-cat="">全部</button>' +
      catKeys.map(function (c) {
        return '<button class="chip' + (state.hallCat === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + ' ' + cats[c] + '</button>';
      }).join('') +
      '</div></div>';
    box.innerHTML = html;
    on('hall-sort', 'change', function () { state.hallSort = $('hall-sort').value; renderHall(); });
    on('hall-time', 'change', function () { state.hallTime = $('hall-time').value; renderHall(); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-cat]'), function (b) {
      b.addEventListener('click', function () {
        state.hallCat = b.getAttribute('data-cat');
        renderHall();
      });
    });
  }

  /* 大厅分区：进行中 / 待平台检索 / 公投中 / 待人工揭晓 / 已揭晓档案（结束问题永久留存） */
  function renderHallTabs() {
    var box = $('hall-tabs');
    if (!box) return;
    var byZone = { open: 0, search: 0, voting: 0, manual: 0, settled: 0 };
    hallQuestions().forEach(function (q) { byZone[OnlineCore.zoneOf(q)]++; });
    /* 进行中的仲裁数（提示有案待审） */
    var voting = state.disputes.filter(function (d) { return d.status === 'voting'; }).length;
    var defs = [
      { key: 'open', label: '进行中' },
      { key: 'search', label: '待平台检索' },
      { key: 'voting', label: '公投中' },
      { key: 'manual', label: '待人工揭晓' },
      { key: 'settled', label: '已揭晓档案', extra: voting ? '（仲裁 ' + voting + '）' : '' }
    ];
    /* 空分区隐藏（进行中与档案常驻），避免噪声 */
    var tabs = defs.filter(function (t) {
      return t.key === 'open' || t.key === 'settled' || byZone[t.key] > 0;
    });
    box.innerHTML = tabs.map(function (t) {
      return '<button class="hall-tab' + (state.hallTab === t.key ? ' active' : '') +
        '" data-tab2="' + t.key + '">' + t.label + ' · ' + byZone[t.key] + (t.extra || '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-tab2]'), function (b) {
      b.addEventListener('click', function () { state.hallTab = b.getAttribute('data-tab2'); renderHall(); });
    });
  }

  /* 已揭晓档案：问题永久留存，可查结果与我的投注 */
  function renderArchive(settledQs) {
    if (!settledQs.length) {
      return '<div class="card"><div class="q-empty">还没有已揭晓的问题。到期问题经揭晓后会在这里永久留存。</div></div>';
    }
    var html = '<div class="card"><div class="card-title">已揭晓档案 · 永久留存</div>' +
      '<p class="hint">所有结束的问题都会保留在这里（含结果、最终赔率与我的投注复盘），不接受删除。</p></div>';
    html += settledQs.map(function (q) {
      var myBetsQ = myBets().filter(function (b) { return b.qid === q.qid; });
      var mine = myBetsQ.length
        ? myBetsQ.map(function (b) {
            var won = b.status === 'won';
            return '<span>' + esc(OnlineCore.outcomeLabelOf(q, b.outcome_id)) + ' ' + b.stake + ' 分 → ' +
              (won ? '<b class="pot">派彩 +' + b.payout + '</b>' : (b.status === 'lost' ? '<b style="color:var(--green)">未中 −' + b.stake + '</b>' : '待结算')) + '</span>';
          }).join('')
        : '<span style="color:var(--text-3)">你没有投注这个问题。</span>';
      var isDraw = q.result === 'draw';
      var winLabel = isDraw ? '公投平局 · 投注全额退还' : OnlineCore.outcomeLabelOf(q, q.result);
        return '<div class="q-card q-settled">' +
        '<div class="q-head">' +
        '<span class="q-status settled">已揭晓</span>' +
        '<span class="q-cat">' + esc(catOf(q)) + '</span>' +
        '<span class="q-settle-mode">' + esc(OnlineCore.SETTLE_LABELS[OnlineCore.settleModeOf(q)]) + '</span>' +
        '<span class="q-deadline">截止 ' + esc(q.deadline) + '</span>' +
        '<span class="q-mode">' + (q.mode === 'fixed' ? '固定赔率' : '彩池赔率 · 抽水 ' + Math.round(Number(q.fee) * 100) + '%') + '</span>' +
        (q.creator_name ? '<span class="q-deadline">出题：' + esc(q.creator_name) + '</span>' : '') +
        '</div>' +
        '<div class="q-title">' + esc(q.title) + '</div>' +
        '<div class="q-outcomes">' + q.outcomes.map(function (o) {
          var cls = (!isDraw && o.id === q.result) ? 'win' : 'dim';
          var oddsTxt = (!isDraw && o.id === q.result && q.final_odds) ? '最终 ' + Number(q.final_odds).toFixed(2) : '';
          return '<label class="outcome-row ' + cls + '">' +
            '<span class="outcome-label">' + esc(o.label) + ((!isDraw && o.id === q.result) ? ' ✓' : '') + '</span>' +
            '<span class="outcome-odds">' + oddsTxt + '</span>' +
            '<span class="outcome-pool">' + ((!isDraw && o.id === q.result) ? esc(winLabel) : '') + '</span></label>';
        }).join('') + '</div>' +
        (isDraw ? '<div class="bet-row"><b>公投平局：最高票并列，全部投注全额退还。</b></div>' : '') +
        oddsTrend(q) +
        '<div class="bet-row"><span>我的投注：</span>' + mine + '</div>' +
        evidenceWall(q, true) +
        disputeWall(q) +
        '</div>';
    }).join('');
    return html;
  }

  /* 到期问题醒目化：本地每秒重算倒计时（不发请求） */
  var countdownTimer = null;
  function startCountdown() {
    if (countdownTimer) return;
    countdownTimer = setInterval(function () {
      if (state.view !== 'hall') return;
      Array.prototype.forEach.call(document.querySelectorAll('[data-countdown]'), function (el) {
        var q = findQuestion(el.getAttribute('data-countdown'));
        if (q) el.textContent = OnlineCore.dayDiffLabel(q);
      });
    }, 1000);
  }

  function questionCard(q) {
    var cur = OnlineCore.currentOdds(q, state.bets);
    var phase = OnlineCore.phaseOf(q);
    var zone = OnlineCore.zoneOf(q);
    var settled = phase === 'settled';
    var expired = phase === 'expired';
    var mode = OnlineCore.settleModeOf(q);
    var avail = totalPoints();
    var myBetsQ = myBets().filter(function (b) { return b.qid === q.qid; });
    var openStake = myBetsQ.filter(function (b) { return b.status === 'open' })
      .reduce(function (s, b) { return s + Number(b.stake); }, 0);
    var minBet = state.settings.site.min_bet;
    var canBet = !settled && !expired && avail >= minBet &&
      state.settings.site.accept_new_bets && !state.settings.site.maintenance;

    var statusTxt = { open: '进行中', search: '待平台检索', voting: '公投中', manual: '待人工揭晓', settled: '已揭晓' }[zone];
    var statusCls = { open: 'open', search: 'expired', voting: 'open', manual: 'expired', settled: 'settled' }[zone];
    var head = '<div class="q-head">' +
      '<span class="q-status ' + statusCls + '">' + statusTxt + '</span>' +
      '<span class="q-cat">' + esc(catOf(q)) + '</span>' +
      '<span class="q-settle-mode" title="揭晓方式">' + esc(OnlineCore.SETTLE_LABELS[mode]) + '</span>' +
      (zone === 'voting' && OnlineCore.voteClosed(q) ? '<span class="q-status expired">公投已结束 · 待结算</span>' : '') +
      (q.deadline ? '<span class="q-deadline" data-countdown="' + q.qid + '">' + esc(OnlineCore.dayDiffLabel(q)) + '</span>' : '') +
      '<span class="q-mode">' + (q.mode === 'fixed' ? '固定赔率' : '彩池赔率 · 抽水 ' + Math.round(Number(q.fee) * 100) + '%') + '</span>' +
      (q.creator_name ? '<span class="q-deadline">出题：' + esc(q.creator_name) + '</span>' : '') +
      (q.pinned ? '<span class="q-status pinned">置顶</span>' : '') +
      (q.hidden && state.adminUnlocked ? '<span class="q-status hidden">已下架</span>' : '') +
      (openStake ? '<span class="q-status open">我已投 ' + openStake + ' 分</span>' : '') +
      '</div>';

    var outcomes = '<div class="q-outcomes">' + q.outcomes.map(function (o) {
      var cls = settled ? (o.id === q.result ? 'win' : 'dim') : '';
      var oddsTxt = settled && o.id === q.result
        ? '最终 ' + (q.final_odds ? Number(q.final_odds).toFixed(2) : '—')
        : (cur.odds[o.id] ? cur.odds[o.id].toFixed(2) : '—');
      var poolTxt = cur.pools ? '池 ' + Math.round(cur.pools[o.id]).toLocaleString() : '';
      var radio = (settled || expired) ? '' :
        '<input type="radio" name="q-' + q.qid + '" value="' + o.id + '">';
      return '<label class="outcome-row ' + cls + '">' + radio +
        '<span class="outcome-label">' + esc(o.label) + '</span>' +
        '<span class="outcome-odds">' + oddsTxt + '</span>' +
        '<span class="outcome-pool">' + poolTxt + '</span></label>';
    }).join('') + '</div>';

    var betRow = '';
    if (settled) {
      betRow = myBetsQ.length
        ? '<div class="bet-row"><span>我的投注：</span>' + myBetsQ.map(function (b) {
            var won = b.status === 'won';
            return '<span>' + esc(OnlineCore.outcomeLabelOf(q, b.outcome_id)) + ' ' + b.stake + ' 分 → ' +
              (won ? '<b class="pot">派彩 +' + b.payout + '</b>' : (b.status === 'lost' ? '<b style="color:var(--green)">未中 −' + b.stake + '</b>' : '待结算')) + '</span>';
          }).join('') + '</div>'
        : '';
    } else if (zone === 'voting') {
      betRow = '';   /* 公投期由 votePanel 负责交互 */
    } else if (expired && mode === 'search') {
      betRow = '<div class="bet-row expired-note"><span>已过投注截止。本题为<b>平台检索</b>揭晓：到期后由平台联网查证公开事实并结算，任何人不能手动发起揭晓。</span></div>';
    } else if (expired && mode === 'vote') {
      betRow = '';
    } else if (expired) {
      betRow = '<div class="bet-row expired-note"><span>已过截止日期，等待按公开事实揭晓' +
        (state.adminUnlocked ? '（站长可在「站长台」用 AI 辅助判定）' : '') + '。</span></div>';
    } else if (canBet) {
      betRow = '<div class="bet-row">' +
        '<span>投注</span><input type="number" min="' + minBet + '" step="10" value="50" data-stake="' + q.qid + '">' +
        '<span>预计赔付 <b class="pot" data-pot="' + q.qid + '">—</b></span>' +
        '<button class="btn btn-primary" data-bet="' + q.qid + '" style="width:auto;padding:5px 14px">确认下注</button>' +
        '</div>';
    } else if (avail < minBet) {
      betRow = '<div class="bet-row"><span>可用积分不足 ' + minBet + ' 分。' +
        '<button class="btn-link" data-gomine="1">去「我的战绩」借一笔</button>，或等派彩到账。</span></div>';
    }

    /* 揭晓操作区：manual 任何人可发起；search 仅站长（代平台检索）；vote 走公投面板 */
    var hostRow = '';
    if (!settled && mode === 'manual') {
      hostRow = '<div class="host-row"><span>到期后任何人都可发起揭晓：</span>' +
        '<select data-resolve="' + q.qid + '">' + q.outcomes.map(function (o) {
          return '<option value="' + o.id + '">揭晓为：' + esc(o.label) + '</option>';
        }).join('') + '</select>' +
        '<button class="btn" data-settle="' + q.qid + '">揭晓结算</button></div>';
    } else if (!settled && mode === 'search' && expired && state.adminUnlocked) {
      hostRow = '<div class="host-row"><span>平台检索揭晓（站长代平台查证，日常由每日自动检索完成）：</span>' +
        '<select data-resolve="' + q.qid + '">' + q.outcomes.map(function (o) {
          return '<option value="' + o.id + '">查证揭晓为：' + esc(o.label) + '</option>';
        }).join('') + '</select>' +
        '<button class="btn" data-settle="' + q.qid + '" data-admin-settle="1">平台揭晓</button></div>';
    } else if (!settled && mode === 'search' && !expired) {
      hostRow = '<div class="host-row hint"><span>到期后由平台联网检索公开事实并揭晓，无需任何人手动发起。</span></div>';
    }

    var votePanelHtml = (zone === 'voting') ? votePanel(q) : '';
    var evidenceRow = evidenceWall(q, settled);

    return '<div class="q-card' + (expired ? ' q-expired' : '') + (zone === 'voting' ? ' q-voting' : '') + '">' + head +
      '<div class="q-title">' + esc(q.title) + '</div>' +
      (q.descr ? '<div class="q-desc">' + esc(q.descr) + '</div>' : '') +
      outcomes + oddsTrend(q) + betRow + votePanelHtml + hostRow + evidenceRow + '</div>';
  }

  /* ---------- 公投面板（v1.2） ---------- */
  function votePanel(q) {
    var votes = publicVotesOf(q.qid);
    var tally = {};
    votes.forEach(function (v) { tally[v.choice] = (tally[v.choice] || 0) + 1; });
    var total = votes.length;
    var mine = votes.filter(function (v) { return v.uid === state.uid; })[0];
    var closed = OnlineCore.voteClosed(q);
    var html = '<div class="vote-panel"><div class="card-title">公众投票 · ' +
      (closed ? '已结束 · 待结算' : '进行中') + '</div>' +
      '<p class="hint">一人一票（按本机身份，截止前可改票）；投票截止 <b>' + esc(q.vote_end) +
      '</b>。票数最高的选项成为最终揭晓结果；若最高票并列（平局），全部投注全额退还。' +
      '主观议题由公众共识裁断，平台不预设答案。</p>';
    q.outcomes.forEach(function (o) {
      var n = tally[o.id] || 0;
      var pct = total ? Math.round(n / total * 100) : 0;
      var checked = mine && mine.choice === o.id ? ' checked' : '';
      var dis = closed ? ' disabled' : '';
      html += '<div class="vote-row">' +
        '<label><input type="radio" name="vote-' + q.qid + '" value="' + o.id + '"' + checked + dis + '> ' +
        '<span class="outcome-label">' + esc(o.label) + '</span></label>' +
        '<div class="index-bar"><div class="index-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="vote-num">' + n + ' 票 · ' + pct + '%</span>' +
        '</div>';
    });
    html += '<div class="bet-row">' +
      (closed
        ? '<span class="hint">公投已结束' + (total ? '' : '（无人投票，需人工揭晓）') + '。</span>' +
          (total ? '<button class="btn btn-primary" data-vote-settle="' + q.qid + '" style="width:auto;padding:5px 14px">按公投结果结算</button>' : '')
        : '<button class="btn btn-primary" data-vote-cast="' + q.qid + '" style="width:auto;padding:5px 14px">' +
          (mine ? '改票' : '投一票') + '</button>' +
          (mine ? '<span class="hint">你已投给「' + esc(OnlineCore.outcomeLabelOf(q, mine.choice)) + '」</span>' : '')) +
      '</div></div>';
    return html;
  }

  function bindVoteEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-vote-cast]'), function (btn) {
      btn.addEventListener('click', function () {
        var qid = btn.getAttribute('data-vote-cast');
        var sel = document.querySelector('input[name="vote-' + qid + '"]:checked');
        if (!sel) { alert('先选择一个选项'); return; }
        castVote(qid, sel.value);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vote-settle]'), function (btn) {
      btn.addEventListener('click', function () {
        settleVote(btn.getAttribute('data-vote-settle'));
      });
    });
  }

  /* 赔率走势：历史快照 + 实时池推导的迷你曲线（仅彩池题有意义） */
  function oddsTrend(q) {
    if (!q || q.mode !== 'pool') return '';
    var pts = OddsCore.probPoints(q, state.bets, state.oddsSnaps);
    var first = (q.outcomes || [])[0];
    if (!first) return '';
    var curP = pts.length ? pts[pts.length - 1].p : 0;
    var live = OddsCore.poolOf(q, state.bets);
    if (live.total <= 0) return '';
    return '<div class="odds-trend">' +
      '<span class="odds-trend-label">「' + esc(first.label) + '」市场概率</span>' +
      '<b class="odds-trend-pct">' + Math.round(curP * 100) + '%</b>' +
      OddsCore.sparklineSvg(pts) +
      '<span class="hint">' + (pts.length > 1 ? '近 ' + pts.length + ' 个采样点' : '采样中') + '</span>' +
      '</div>';
  }

  function bindQuestionEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-stake]'), function (input) {
      function update() {
        var q = findQuestion(input.getAttribute('data-stake'));
        if (!q) return;
        var sel = document.querySelector('input[name="q-' + q.qid + '"]:checked');
        var pot = document.querySelector('[data-pot="' + q.qid + '"]');
        if (!sel || !pot) return;
        var stake = Math.floor(Number(input.value) || 0);
        pot.textContent = stake >= state.settings.site.min_bet
          ? OnlineCore.potentialPayout(q, state.bets, sel.value, stake).toFixed(1) + ' 分' : '—';
      }
      input.addEventListener('input', update);
      update();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bet]'), function (btn) {
      btn.addEventListener('click', function () {
        var qid = btn.getAttribute('data-bet');
        var sel = document.querySelector('input[name="q-' + qid + '"]:checked');
        if (!sel) { alert('先选择一个选项'); return; }
        var input = document.querySelector('[data-stake="' + qid + '"]');
        placeBet(qid, sel.value, input ? input.value : 0);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-settle]'), function (btn) {
      btn.addEventListener('click', function () {
        var qid = btn.getAttribute('data-settle');
        var sel = document.querySelector('[data-resolve="' + qid + '"]');
        settleQuestion(qid, sel ? sel.value : '', {
          byAdmin: btn.getAttribute('data-admin-settle') === '1'
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-gomine]'), function (btn) {
      btn.addEventListener('click', function () { switchView('mine'); });
    });
  }

  /* ---------- 渲染：天梯榜（按净资产排名） ---------- */
  function renderBoard() {
    var box = $('board-list');
    if (!box) return;
    var rows = LoanCore.leaderboard(state.bets, state.loans, state.payments, state.settings);
    if (!rows.length) {
      box.innerHTML = '<div class="card"><div class="q-empty">还没有人下注。天梯榜将在第一笔投注后出现。</div></div>';
      return;
    }
    var html = '<div class="card"><div class="card-title">天梯榜 · 按净资产排名（现金 + 在押 − 负债）</div>' +
      '<table class="ledger-table"><thead><tr>' +
      '<th>#</th><th>玩家</th><th style="text-align:right">净资产</th><th style="text-align:right">投注盈亏</th>' +
      '<th>战绩</th><th style="text-align:right">在押</th><th style="text-align:right">负债</th><th>徽章</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (p, i) {
      var me = p.uid === state.uid ? '（我）' : '';
      var badges = (typeof BadgeCore !== 'undefined')
        ? BadgeCore.earnedBadges(p.uid, badgeData()).length + ' 枚' : '—';
      html += '<tr' + (p.uid === state.uid ? ' style="background:#F5F8FC"' : '') + '>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(p.nickname) + me + '</td>' +
        '<td class="amt" style="color:' + scoreColor(p.total) + '">' + fmt(p.total) + '</td>' +
        '<td class="amt" style="color:' + scoreColor(p.betNet) + '">' + fmt(p.betNet) + '</td>' +
        '<td>' + p.won + ' 胜 / ' + p.lost + ' 负' + (p.settled ? '（' + p.winRate + '%）' : '') + '</td>' +
        '<td class="amt">' + p.openStake + '</td>' +
        '<td class="amt"' + (p.debt > 0 ? ' style="color:var(--green)"' : '') + '>' + (p.debt ? '−' + p.debt : '—') + '</td>' +
        '<td>' + badges + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    /* 信源质量榜：证据被采纳与揭晓命中的玩家 */
    var src = EvidenceCore.sourceBoard(state.evidence).slice(0, 10);
    if (src.length) {
      html += '<div class="card"><div class="card-title">信源质量榜 · 证据被采纳与揭晓命中的玩家</div>' +
        '<table class="ledger-table"><thead><tr><th>#</th><th>玩家</th><th>提交</th><th>采纳</th><th>揭晓命中</th><th>积分</th></tr></thead><tbody>';
      src.forEach(function (p, i) {
        html += '<tr' + (p.uid === state.uid ? ' style="background:#F5F8FC"' : '') + '>' +
          '<td>' + (i + 1) + '</td><td>' + esc(p.nickname) + (p.uid === state.uid ? '（我）' : '') + '</td>' +
          '<td>' + p.submitted + '</td><td>' + p.accepted + '</td><td>' + p.validated + '</td>' +
          '<td>' + p.score + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    box.innerHTML = html;
  }

  /* ---------- 渲染：预期指数（市场信念快照） ---------- */
  function renderIndex() {
    var box = $('index-list');
    if (!box) return;
    var openQs = hallQuestions().filter(function (q) { return OnlineCore.phaseOf(q) === 'open'; });
    var idx = OddsCore.expectationIndex(openQs, state.bets);
    var dateStr = new Date().toISOString().slice(0, 10);

    var html = '<div class="card"><div class="card-title">预期指数 · 市场信念快照</div>' +
      '<p class="hint">把每个进行中彩池题的首选项（通常是「会」）的市场概率排成一面墙：' +
      '概率来自真实投注分布（彩池 + 玩家下注），不是编辑观点、不是民意调查。' +
      '固定赔率题由主办方定价，不计入指数。</p>';
    if (!idx.count) {
      html += '<div class="q-empty">暂时没有可计题的彩池题（需要已有投注或初始池）。</div></div>';
      box.innerHTML = html;
      return;
    }
    html += '<div class="index-summary">' +
      '<div class="index-stat"><b>' + idx.count + '</b><span>进行中彩池题</span></div>' +
      '<div class="index-stat"><b>' + Math.round(idx.avg * 1000) / 10 + '%</b><span>平均市场概率</span></div>' +
      '<div class="index-stat"><b>' + idx.high + '</b><span>高置信（≥80%）</span></div>' +
      '<div class="index-stat"><b>' + idx.mid + '</b><span>势均力敌（20%-80%）</span></div>' +
      '<div class="index-stat"><b>' + idx.low + '</b><span>低概率（≤20%）</span></div>' +
      '</div>' +
      '<div class="index-quote">' + esc(OddsCore.quoteLine(idx, dateStr)) + '</div>' +
      '</div>';

    html += '<div class="card"><div class="card-title">逐题概率（由高到低）</div>';
    idx.rows.forEach(function (r) {
      var first = r.q.outcomes[0];
      var pct = Math.round(r.p * 100);
      html += '<div class="index-row">' +
        '<div class="index-row-head">' +
        '<span class="index-row-title">' + esc(r.q.title) + '</span>' +
        '<span class="index-row-pct">' + pct + '%</span></div>' +
        '<div class="index-bar"><div class="index-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="index-row-meta hint">「' + esc(first.label) + '」的市场概率 · 彩池 ' +
        Math.round(r.total).toLocaleString() + ' 分 · 赔率 ' +
        (r.odds[first.id] ? r.odds[first.id].toFixed(2) : '—') +
        (r.q.deadline ? ' · ' + esc(OnlineCore.dayDiffLabel(r.q)) : '') + '</div>' +
        '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  }

  /* ---------- 渲染：我的战绩（含借贷） ---------- */
  function renderMine() {
    var avail = totalPoints();
    var sum = loanSummary();
    var box = $('mine-stats');
    if (box) {
      var mine = myBets();
      var settledBets = mine.filter(function (b) { return b.status !== 'open'; });
      var won = settledBets.filter(function (b) { return b.status === 'won' }).length;
      var staked = mine.reduce(function (s, b) { return s + Number(b.stake); }, 0);
      var recovered = mine.reduce(function (s, b) { return s + (b.status === 'won' ? Number(b.payout) : 0); }, 0);
      box.innerHTML =
        '<div class="stat-row">' +
        '<div class="stat-card"><div class="stat-label">可用积分</div><div class="stat-value" style="color:' + scoreColor(avail) + '">' + fmt(avail) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">净资产</div><div class="stat-value" style="color:' + scoreColor(sum.netWorth) + '">' + fmt(sum.netWorth) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">投注战绩</div><div class="stat-value">' + won + ' 胜 / ' + (settledBets.length - won) + ' 负</div></div>' +
        '<div class="stat-card"><div class="stat-label">当前负债</div><div class="stat-value" style="color:' + (sum.debt > 0 ? 'var(--green)' : 'inherit') + '">' + (sum.debt ? sum.debt + ' 分' : '无') + '</div></div>' +
        '</div>';
    }

    renderLoanCard(sum);
    renderSeasonCard();
    renderBadgeWall();

    var betsBox = $('mine-bets');
    if (betsBox) {
      if (!myBets().length) {
        betsBox.innerHTML = '<div class="q-empty">还没有投注。去「下注大厅」押第一笔。</div>';
      } else {
        betsBox.innerHTML = myBets().slice().sort(function (a, b) { return b.placed_at - a.placed_at; }).map(function (b) {
          var q = findQuestion(b.qid) || { title: b.qid, outcomes: [] };
          var statusTxt = { open: '进行中', won: '已派彩', lost: '未中' }[b.status];
          var resultTxt = b.status === 'won' ? '<span class="amt-gain">+' + b.payout + '</span>'
            : (b.status === 'lost' ? '<span class="amt-loss">−' + b.stake + '</span>' : '<span style="color:var(--text-3)">待揭晓</span>');
          return '<div class="bet-item">' +
            '<span class="bet-status ' + b.status + '">' + statusTxt + '</span>' +
            '<span class="bet-q">' + esc(betTitleOf(b)) + '</span>' +
            '<span>' + b.stake + ' 分 @ ' + Number(b.odds_at_bet).toFixed(2) + '</span>' +
            '<span>' + resultTxt + '</span></div>';
        }).join('');
      }
    }

    var ledger = $('mine-ledger');
    if (ledger) {
      var rows = LoanCore.myLedger(state.uid, state.bets, state.questions, state.loans, state.payments, state.settings);
      if (!rows.length) {
        ledger.innerHTML = '<div class="q-empty">暂无流水。下注、借款后这里会显示每一笔积分的来龙去脉。</div>';
      } else {
        var html = '<table class="ledger-table"><thead><tr>' +
          '<th>时间</th><th>类型</th><th style="text-align:right">变动</th><th style="text-align:right">结余</th><th>说明</th>' +
          '</tr></thead><tbody>';
        rows.forEach(function (e) {
          var amtClass = e.amount > 0 ? 'amt-gain' : (e.amount < 0 ? 'amt-loss' : '');
          var typeName = { stake: '下注', payout: '派彩', loan: '借款', repay: '还款', bonus: '奖励', adjust: '差额补退' }[e.type];
          html += '<tr><td>' + fmtTs(e.ts) + '</td>' +
            '<td><span class="ledger-type ' + e.type + '">' + typeName + '</span></td>' +
            '<td class="amt ' + amtClass + '">' + fmt(e.amount) + '</td>' +
            '<td class="bal">' + e.balanceAfter.toFixed(1) + '</td>' +
            '<td class="ledger-note" title="' + esc(e.note) + '">' + esc(e.note) + '</td></tr>';
        });
        ledger.innerHTML = html + '</tbody></table>';
      }
    }
  }

  /* 借贷卡片：额度 / 借款 / 还款 */
  function renderLoanCard(sum) {
    var box = $('loan-card');
    if (!box) return;
    var s = state.settings.site;
    var p = LoanCore.params(state.settings);
    var loans = myLoans().slice().sort(function (a, b) { return b.created_at - a.created_at; });
    var openLoans = loans.filter(function (l) { return l.status === 'open'; });

    var statusHtml = sum.bankrupt
      ? '<span class="q-status expired">破产保护触发中</span>'
      : (sum.overdueCount ? '<span class="q-status expired">' + sum.overdueCount + ' 笔逾期</span>'
        : '<span class="q-status open">正常</span>');

    var html = '<div class="card-title">信用借贷</div>' +
      '<div class="stat-row">' +
      '<div class="stat-card"><div class="stat-label">信用额度</div><div class="stat-value">' + sum.limit + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">当前负债</div><div class="stat-value">' + sum.debt + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">可借</div><div class="stat-value">' + sum.available + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">状态</div><div class="stat-value" style="font-size:14px">' + statusHtml + '</div></div>' +
      '</div>' +
      '<p class="hint">规则：初始额度 ' + s.credit_initial + ' 分，每还清一笔 +' + s.credit_step +
      '，每笔逾期 −' + s.overdue_penalty + '（上限 ' + s.credit_max + '）。借款期限 ' + p.loan_term_days +
      ' 天、利率 ' + Math.round(p.loan_rate * 100) + '%，逾期每天按本金 ' + Math.round(p.loan_late_rate * 100) +
      '% 计罚息。还款顺序：罚息 → 利息 → 本金。净资产跌破 ' + p.force_min_net +
      ' 时触发破产保护：全部借款自动核销、从头再来（记录留存，天梯排名随之重置）。</p>' +
      '<p class="hint">⚠ 这是游戏内信用额度，不是真实借贷：不可充值、不可提现、不可转让，与真实货币无关。</p>';

    if (s.loan_enabled) {
      html += '<div class="field"><label>借款金额（最少 ' + s.min_loan + ' 分，即时到账）</label>' +
        '<div class="form-row">' +
        '<div class="field"><input type="number" id="loan-amount" min="' + s.min_loan + '" step="10" value="' +
        Math.min(100, Math.max(s.min_loan, Math.floor(sum.available))) + '" ' + (sum.available < s.min_loan ? 'disabled' : '') + '></div>' +
        '<div class="field"><span class="hint">到期需还本息 ≈ <b id="loan-due">—</b> 分</span></div>' +
        '</div></div>' +
        '<button class="btn btn-primary" id="btn-borrow" style="width:auto" ' + (sum.available < s.min_loan ? 'disabled' : '') + '>确认借款</button>';
    } else {
      html += '<p class="hint">站长已暂时关闭借贷功能。</p>';
    }

    html += '<div class="card-title" style="margin-top:18px">我的借款（' + openLoans.length + ' 笔未结清）</div>';
    if (!loans.length) {
      html += '<div class="q-empty">还没有借款记录。</div>';
    } else {
      html += loans.map(function (l) {
        var o = LoanCore.outstandingOf(l);
        var overdue = LoanCore.isOverdue(l);
        var badge = l.status === 'repaid' ? '<span class="q-status settled">已结清</span>'
          : (l.status === 'written_off' ? '<span class="q-status expired">已核销</span>'
            : (overdue ? '<span class="q-status expired">逾期 ' + LoanCore.daysOverdue(l) + ' 天</span>'
              : '<span class="q-status open">' + l.due_date + ' 到期</span>'));
        var detail = l.status === 'repaid'
          ? '已全额结清'
          : (l.status === 'written_off' ? '破产保护已核销：债务清零，记录留存'
            : '应还 ' + o.total + ' 分（本金 ' + o.principalLeft + (o.interestLeft ? ' + 利息 ' + o.interestLeft : '') +
              (o.lateLeft ? ' + 罚息 ' + o.lateLeft : '') + '）');
        var actions = l.status === 'open'
          ? '<div class="form-row" style="margin-top:6px;align-items:flex-end">' +
            '<div class="field" style="margin:0"><label>还款金额</label>' +
            '<input type="number" min="1" step="1" value="' + Math.ceil(o.total) + '" data-repay="' + l.lid + '" style="width:120px"></div>' +
            '<button class="btn btn-primary" data-do-repay="' + l.lid + '" style="width:auto">还款</button>' +
            '</div>'
          : '';
        return '<div class="loan-item' + (overdue ? ' loan-overdue' : '') + '">' +
          '<div class="loan-head"><span>借 ' + l.principal + ' 分 · 利率 ' + Math.round(Number(l.rate) * 100) + '% · ' + l.term_days + ' 天期</span>' + badge + '</div>' +
          '<div class="loan-detail">' + detail + '</div>' + actions + '</div>';
      }).join('');
    }

    box.innerHTML = html;

    on('btn-borrow', 'click', function () {
      var v = $('loan-amount').value;
      borrow(v);
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-do-repay]'), function (btn) {
      btn.addEventListener('click', function () { repay(btn.getAttribute('data-do-repay')); });
    });
    /* 实时显示到期需还本息 */
    var amt = $('loan-amount'), due = $('loan-due');
    if (amt && due) {
      function upd() {
        var v = Math.floor(Number(amt.value) || 0);
        due.textContent = v >= s.min_loan ? (v + Math.round(v * p.loan_rate * 100) / 100).toFixed(1) : '—';
      }
      amt.addEventListener('input', upd);
      upd();
    }
  }

  /* ============================================================
   * 赛季战报 + 徽章墙（BadgeCore）
   * ============================================================ */
  function badgeData() {
    return {
      bets: state.bets, questions: state.questions, loans: state.loans, payments: state.payments,
      evidence: state.evidence, disputeVotes: state.disputeVotes, debatePosts: state.debatePosts
    };
  }
  function seasonCfg() {
    return (typeof BadgeCore !== 'undefined' ? BadgeCore : { seasonCfgOf: function () { return { start: '2026-10-18', length_days: 90, name: 'S' }; } })
      .seasonCfgOf(state.settings);
  }

  /* 赛季战报：本赛季战绩 + 与上季对比 + 最佳/最差单场 */
  function renderSeasonCard() {
    var box = $('season-card');
    if (!box) return;
    if (typeof BadgeCore === 'undefined') { box.innerHTML = ''; return; }
    var cfg = seasonCfg();
    var st = BadgeCore.seasonStats(state.uid, badgeData(), cfg);
    var cmp = BadgeCore.seasonCompare(state.uid, badgeData(), cfg);
    var html = '<div class="card-title">赛季战报 · ' + esc(st.season.name) +
      '（' + esc(st.season.start) + ' ~ ' + esc(st.season.end) + '）</div>';
    html += '<div class="stat-row">' +
      '<div class="stat-card"><div class="stat-label">本赛季战绩</div><div class="stat-value">' +
      st.won + ' 胜 / ' + st.lost + ' 负' + (st.settledCount ? '（' + st.winRate + '%）' : '') + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">赛季净积分</div><div class="stat-value" style="color:' + scoreColor(st.net) + '">' + fmt(st.net) + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">投注笔数</div><div class="stat-value">' + st.betCount + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">对比' + esc(cmp.previousSeason) + '</div><div class="stat-value" style="color:' + scoreColor(cmp.delta) + '">' +
      (cmp.hasPrevious ? fmt(cmp.delta) : '新赛季') + '</div></div>' +
      '</div>';
    if (st.best) {
      html += '<p class="hint">最得意的一场：<b>' + esc(st.best.title) + '</b> ' + fmt(st.best.delta) +
        ' 分' + (st.worst ? '　·　最大败笔：<b>' + esc(st.worst.title) + '</b> ' + fmt(st.worst.delta) + ' 分' : '') + '</p>';
    } else {
      html += '<p class="hint">本赛季还没有投注。去「下注大厅」押下第一笔，赛季结束后这里会生成完整战报。</p>';
    }
    /* 赛季榜（前 10） */
    var board = BadgeCore.seasonBoard(badgeData(), cfg);
    if (board.rows.length) {
      html += '<div class="card-title" style="margin-top:14px">赛季榜 · ' + esc(board.season.name) + '（按本赛季净积分）</div>' +
        '<table class="ledger-table"><thead><tr><th>#</th><th>玩家</th><th style="text-align:right">净积分</th><th>战绩</th></tr></thead><tbody>';
      board.rows.slice(0, 10).forEach(function (p, i) {
        html += '<tr' + (p.uid === state.uid ? ' style="background:#F5F8FC"' : '') + '>' +
          '<td>' + (i + 1) + '</td><td>' + esc(p.nickname) + (p.uid === state.uid ? '（我）' : '') + '</td>' +
          '<td class="amt" style="color:' + scoreColor(p.net) + '">' + fmt(p.net) + '</td>' +
          '<td>' + p.won + ' 胜 / ' + p.lost + ' 负</td></tr>';
      });
      html += '</tbody></table>';
    }
    box.innerHTML = html;
  }

  /* 徽章墙：已获得彩色 + 未获得灰色带进度 */
  function renderBadgeWall() {
    var box = $('badge-card');
    if (!box) return;
    if (typeof BadgeCore === 'undefined') { box.innerHTML = ''; return; }
    var all = BadgeCore.allBadges(state.uid, badgeData());
    var earned = all.filter(function (b) { return b.earned; }).length;
    var html = '<div class="card-title">徽章墙（' + earned + ' / ' + all.length + '）</div>' +
      '<div class="badge-grid">' +
      all.map(function (b) {
        var pct = Math.round(b.progress * 100);
        return '<div class="badge-item' + (b.earned ? ' earned' : '') + '" title="' + esc(b.desc) + '">' +
          '<div class="badge-icon">' + (b.earned ? b.icon : '🔒') + '</div>' +
          '<div class="badge-name">' + esc(b.name) + '</div>' +
          '<div class="badge-desc">' + esc(b.desc) + '</div>' +
          (b.earned ? '<div class="badge-state">已获得</div>'
            : '<div class="badge-bar"><i style="width:' + pct + '%"></i></div>' +
              '<div class="badge-state">' + esc(b.progressText || '未获得') + '</div>') +
          '</div>';
      }).join('') + '</div>';
    box.innerHTML = html;
  }

  /* ============================================================
   * 对线房（DebateCore + 云端 LLM 五维评分）
   * ============================================================ */
  var DEBATE_SIDE_KEY = 'jp-debate-side-';   /* 每房本机记住「我加入哪方」 */
  var LLM_MODEL = 'hy3';

  function debateData() {
    return { rooms: state.debates, posts: state.debatePosts, bets: state.debateBets };
  }
  function findDebate(did) {
    for (var i = 0; i < state.debates.length; i++) if (state.debates[i].did === did) return state.debates[i];
    return null;
  }
  function myDebateSide(did) {
    try { return localStorage.getItem(DEBATE_SIDE_KEY + did) || ''; } catch (e) { return ''; }
  }
  function setMyDebateSide(did, side) {
    try { localStorage.setItem(DEBATE_SIDE_KEY + did, side); } catch (e) { /* ignore */ }
  }
  function debateSideLabel(side) { return side === 'a' ? '甲方' : (side === 'b' ? '乙方' : '—'); }

  /* 投注标题：对线房押注在 jp_bets 里的镜像行 */
  function betTitleOf(b) {
    if (b.qid && b.qid.indexOf('debate-') === 0) {
      var d = findDebate(b.qid.slice(7));
      return '对线房 · ' + (d ? d.topic : b.qid) + ' → ' + debateSideLabel(b.outcome_id);
    }
    var q = findQuestion(b.qid);
    return q ? q.title : b.qid;
  }

  /* 云端 LLM 流式调用：返回累计文本；失败抛错（调用方兜底规则分） */
  function callCloudLLM(prompt, maxTokens) {
    return Promise.resolve().then(function () {
      return cloud.llm.chat.completions.create({
        model: LLM_MODEL, stream: true, max_tokens: maxTokens || 800,
        messages: [{ role: 'user', content: prompt }]
      });
    }).then(function (stream) {
      var text = '';
      var pump = stream && stream[Symbol.asyncIterator]
        ? (async function () {
            for await (const chunk of stream) {
              var d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
              if (d && d.content) text += d.content;
            }
          })()
        : Promise.resolve();
      return pump.then(function () { return text; });
    });
  }

  function renderDebate() {
    if (state.debateRoom) renderDebateRoom();
    else renderDebateList();
  }

  /* ---------- 房间列表 + 建房 ---------- */
  function renderDebateList() {
    var box = $('debate-list');
    if (!box) return;
    var mine = DebateCore.myRooms(state.debates, state.debatePosts, state.debateBets, state.uid);
    var publicRooms = state.debates.filter(function (r) { return !r.invite_code && !r.hidden; });
    var enteredCode = '';
    try { enteredCode = localStorage.getItem('jp-debate-code') || ''; } catch (e) { /* ignore */ }

    var html = '<div class="card"><div class="card-title">对线房是什么</div>' +
      '<ul class="rules-list">' +
      '<li><b>两个人，一个话题，逐轮对线</b>：每轮双方各发言一次，AI 按五维（论据/逻辑/针对性/增量/礼仪，各 20 分）给每轮打分——<b>只评怎么辩，不评辩什么</b>。</li>' +
      '<li><b>观众可押谁辩得更好</b>：赔率随押注浮动（抽水 5%），平局全额退还。押注镜像计入总积分与流水。</li>' +
      '<li><b>邀请制</b>：带邀请码的房间不出现在公开列表，输入邀请码才能进入；房主控制开始、AI 评分与揭晓。</li>' +
      '<li><b>人人可建房</b>：房主也可以左右互搏（自己演双方），用来演示或自练。</li>' +
      '</ul></div>';

    /* 建房表单 */
    html += '<div class="card"><div class="card-title">开一间对线房</div>' +
      '<div class="field"><label>辩题（可验证、可讨论的事实性话题，4-80 字）</label>' +
      '<input type="text" id="d-topic" maxlength="80" placeholder="如：AI 会先在哪个行业大规模替代人工？"></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>甲方立场</label><input type="text" id="d-side-a" maxlength="40" placeholder="如：内容创作"></div>' +
      '<div class="field"><label>乙方立场</label><input type="text" id="d-side-b" maxlength="40" placeholder="如：重复性文书"></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>总轮次（每轮双方各一次）</label>' +
      '<input type="number" id="d-rounds" min="1" max="12" value="4"></div>' +
      '<div class="field"><label>邀请码（留空=公开；4-16 位字母数字）</label>' +
      '<input type="text" id="d-code" maxlength="16" placeholder="如 DEBATE2026"></div>' +
      '<div class="field"><label>截止日期（可选）</label><input type="date" id="d-deadline"></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-create-debate" style="width:auto">创建房间</button></div>';

    /* 邀请码入口 */
    html += '<div class="card"><div class="card-title">凭邀请码进入</div>' +
      '<div class="form-row"><div class="field"><input type="text" id="d-enter-code" maxlength="16" placeholder="输入邀请码" value="' + esc(enteredCode) + '"></div>' +
      '<button class="btn" id="btn-enter-code" style="width:auto">进入</button></div></div>';

    function roomCard(r) {
      var phase = DebateCore.phaseOf(r, state.debatePosts);
      var odds = DebateCore.oddsOf(r, state.debateBets);
      var rounds = DebateCore.postsOf(r, state.debatePosts).length;
      var phaseTxt = { open: '布场中', live: '辩论中', overdue: '待揭晓', finished: '待揭晓', settled: '已揭晓' }[phase];
      var phaseCls = phase === 'settled' ? 'settled' : (phase === 'live' ? 'open' : 'expired');
      var resultTxt = phase === 'settled'
        ? '结果：' + (r.result === 'draw' ? '平局' : debateSideLabel(r.result) + '胜') +
          (r.final_odds ? ' · 最终赔率 ' + Number(r.final_odds).toFixed(2) : '')
        : '';
      return '<div class="q-card' + (phase === 'settled' ? ' q-settled' : '') + '">' +
        '<div class="q-head">' +
        '<span class="q-status ' + phaseCls + '">' + phaseTxt + '</span>' +
        '<span class="q-deadline">第 ' + Math.min(rounds + 1, Number(r.max_rounds)) + ' / ' + r.max_rounds + ' 轮</span>' +
        (r.deadline ? '<span class="q-deadline">截止 ' + esc(r.deadline) + '</span>' : '') +
        (r.invite_code ? '<span class="q-status pinned">邀请制</span>' : '') +
        '</div>' +
        '<div class="q-title">' + esc(r.topic) + '</div>' +
        '<div class="q-outcomes">' +
        '<label class="outcome-row"><span class="outcome-label">甲方 · ' + esc(r.side_a) + '</span>' +
        '<span class="outcome-odds">' + (odds.a ? odds.a.toFixed(2) : '—') + '</span></label>' +
        '<label class="outcome-row"><span class="outcome-label">乙方 · ' + esc(r.side_b) + '</span>' +
        '<span class="outcome-odds">' + (odds.b ? odds.b.toFixed(2) : '—') + '</span></label>' +
        '</div>' +
        (resultTxt ? '<div class="bet-row"><span>' + esc(resultTxt) + '</span></div>' : '') +
        '<div class="bet-row"><span>房主：' + esc(r.creator_name || '—') + '</span>' +
        '<button class="btn btn-primary" data-debate-open="' + r.did + '" style="width:auto;padding:5px 14px">' +
        (phase === 'settled' ? '查看复盘' : '进入房间') + '</button></div></div>';
    }

    if (mine.length) {
      html += '<div class="card-title" style="margin:18px 0 8px">我的对线房（' + mine.length + '）</div>' + mine.map(roomCard).join('');
    }
    html += '<div class="card-title" style="margin:18px 0 8px">公开对线房（' + publicRooms.length + '）</div>' +
      (publicRooms.length ? publicRooms.map(roomCard).join('')
        : '<div class="card"><div class="q-empty">还没有公开房间。自己开一间，或凭邀请码进入。</div></div>');

    box.innerHTML = html;
    on('btn-create-debate', 'click', createDebate);
    on('btn-enter-code', 'click', function () {
      var code = $('d-enter-code').value.trim();
      if (!code) { alert('输入邀请码'); return; }
      try { localStorage.setItem('jp-debate-code', code); } catch (e) { /* ignore */ }
      var hit = state.debates.filter(function (r) { return r.invite_code === code; })[0];
      if (!hit) { alert('没有找到该邀请码对应的房间（可能已被下架）'); return; }
      state.debateRoom = hit.did;
      renderAll();
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-debate-open]'), function (b) {
      b.addEventListener('click', function () {
        state.debateRoom = b.getAttribute('data-debate-open');
        renderAll();
      });
    });
  }

  /* ---------- 房间详情 ---------- */
  function renderDebateRoom() {
    var box = $('debate-room');
    if (!box) return;
    var r = findDebate(state.debateRoom);
    if (!r) { state.debateRoom = ''; renderDebateList(); return; }
    var posts = DebateCore.postsOf(r, state.debatePosts);
    var phase = DebateCore.phaseOf(r, state.debatePosts);
    var odds = DebateCore.oddsOf(r, state.debateBets);
    var mySide = myDebateSide(r.did);
    var isHost = r.creator_uid === state.uid;
    var avail = totalPoints();
    var minBet = state.settings.site.min_bet;

    var html = '<div class="card"><div class="card-title">' +
      '<button class="btn-link" data-debate-back="1">← 返回列表</button>　' + esc(r.topic) + '</div>' +
      '<div class="q-head">' +
      '<span class="q-status ' + (phase === 'settled' ? 'settled' : phase === 'live' ? 'open' : 'expired') + '">' +
      ({ open: '布场中', live: '辩论中', overdue: '待揭晓', finished: '待揭晓', settled: '已揭晓' }[phase]) + '</span>' +
      '<span class="q-deadline">第 ' + DebateCore.currentRoundOf(r, state.debatePosts) + ' / ' + r.max_rounds + ' 轮</span>' +
      (r.deadline ? '<span class="q-deadline">截止 ' + esc(r.deadline) + '</span>' : '') +
      (r.invite_code ? '<span class="q-status pinned">邀请码 ' + esc(r.invite_code) + '</span>' : '') +
      '</div>' +
      '<div class="q-outcomes">' +
      '<label class="outcome-row"><span class="outcome-label">甲方 · ' + esc(r.side_a) + '</span>' +
      '<span class="outcome-odds">' + (odds.a ? odds.a.toFixed(2) : '—') + '</span>' +
      '<span class="outcome-pool">池 ' + Math.round(odds.pools.a) + '</span></label>' +
      '<label class="outcome-row"><span class="outcome-label">乙方 · ' + esc(r.side_b) + '</span>' +
      '<span class="outcome-odds">' + (odds.b ? odds.b.toFixed(2) : '—') + '</span>' +
      '<span class="outcome-pool">池 ' + Math.round(odds.pools.b) + '</span></label>' +
      '</div>';

    if (phase === 'settled') {
      html += '<div class="bet-row"><span>结果：<b>' +
        (r.result === 'draw' ? '平局（押注全额退还）' : debateSideLabel(r.result) + '胜') + '</b>' +
        (r.final_odds ? ' · 最终赔率 ' + Number(r.final_odds).toFixed(2) : '') + '</span></div>';
    }

    /* 站队（未选边时） */
    if (phase !== 'settled' && !mySide) {
      html += '<div class="bet-row"><span>选择你支持/加入的一方：</span>' +
        '<button class="btn" data-debate-side="a" style="width:auto">加入甲方</button>' +
        '<button class="btn" data-debate-side="b" style="width:auto">加入乙方</button>' +
        '<span class="hint">（只影响你以哪方身份发言；房主可随时切换）</span></div>';
    }
    /* 房主可随时切换发言身份（左右互搏/演示） */
    if (isHost && phase !== 'settled') {
      html += '<div class="bet-row"><span>房主切换发言身份：</span>' +
        '<button class="btn" data-debate-side="a" style="width:auto">以甲方发言</button>' +
        '<button class="btn" data-debate-side="b" style="width:auto">以乙方发言</button>' +
        '<span class="hint">当前身份：' + debateSideLabel(mySide) + '</span></div>';
    }

    /* 房主操作 */
    if (isHost && phase !== 'settled') {
      html += '<div class="host-row"><span>房主操作：</span>' +
        (r.status === 'open' ? '<button class="btn btn-primary" id="btn-debate-start" style="width:auto">开始辩论</button>' : '') +
        '<select data-debate-result="' + r.did + '">' +
        '<option value="a">揭晓为：甲方胜</option>' +
        '<option value="b">揭晓为：乙方胜</option>' +
        '<option value="draw">揭晓为：平局</option></select>' +
        '<button class="btn" data-debate-settle="' + r.did + '">揭晓结算</button>' +
        (r.hidden ? '<button class="btn" data-debate-unhide="1" style="width:auto">恢复上架</button>'
          : '<button class="btn" data-debate-hide="1" style="width:auto">下架房间</button>') +
        '</div>' +
        '<p class="hint">揭晓后所有押注按最终赔率立即结算，不可撤销；平局则全额退还。建议在双方都完成发言、AI 评分出来后揭晓。</p>';
    }

    /* 发言线程 */
    html += '<div class="card-title" style="margin-top:16px">辩论线程</div>';
    if (!posts.length) {
      html += '<div class="q-empty">还没有发言。' +
        (r.status === 'open' ? '房主点「开始辩论」后即可发言。' : '轮到的一方可在下方发言。') + '</div>';
    }
    posts.forEach(function (rd) {
      html += '<div class="debate-round"><div class="debate-round-no">第 ' + rd.round + ' 轮</div>';
      ['a', 'b'].forEach(function (side) {
        var p = rd[side];
        if (!p) {
          html += '<div class="debate-post empty"><div class="debate-post-head">' + debateSideLabel(side) +
            ' · ' + esc(side === 'a' ? r.side_a : r.side_b) + '</div>' +
            '<div class="debate-post-body">（' + (rd.a && rd.b ? '本轮已过' : '等待发言') + '）</div></div>';
          return;
        }
        var sc = p.ai_score;
        var scoreHtml = '';
        if (sc) {
          var mineS = sc[side] || {};
          var otherS = sc[side === 'a' ? 'b' : 'a'] || {};
          scoreHtml = '<div class="debate-score' + (sc.by === 'rule' ? ' rule' : '') + '">' +
            DebateCore.DIMS.map(function (k) {
              return '<span title="' + DebateCore.DIM_LABELS[k] + '">' + DebateCore.DIM_LABELS[k] + ' ' +
                (mineS[k] == null ? '—' : mineS[k]) + '</span>';
            }).join('') +
            '<b>小计 ' + (sc[side + '_total'] == null ? '—' : sc[side + '_total']) + ' / 100</b>' +
            '　·　对方 ' + (otherS.evidence == null ? '—' : DebateCore.totalOfScore(otherS) + ' / 100') +
            (sc.by === 'rule' ? '　·　规则兜底分' : '') +
            '</div>';
        }
        html += '<div class="debate-post' + (p.uid === state.uid ? ' mine' : '') + '">' +
          '<div class="debate-post-head">' + debateSideLabel(side) + ' · ' + esc(side === 'a' ? r.side_a : r.side_b) +
          '　<span class="hint">' + esc(p.nickname || '匿名') + ' · ' + fmtTs(p.posted_at) + '</span></div>' +
          '<div class="debate-post-body">' + esc(p.content) + '</div>' + scoreHtml + '</div>';
      });
      /* 本轮 AI 评分按钮：双方都发言且未评分时，任何人可触发（先到先得写入） */
      if (rd.a && rd.b && !rd.a.ai_score && phase !== 'settled') {
        html += '<div class="debate-round-actions">' +
          '<button class="btn" data-debate-ai="' + rd.round + '" style="width:auto">' +
          (state.llmBusy === 'r' + rd.round ? 'AI 评分中…' : 'AI 评分本轮') + '</button>' +
          '<span class="hint">AI 只评怎么辩、不评辩什么；任何人可触发，结果先到先得写入。</span></div>';
      } else if (rd.a && rd.b && rd.a.ai_score && rd.a.ai_score.comment) {
        html += '<div class="debate-round-actions"><span class="hint">AI 点评：' + esc(rd.a.ai_score.comment) + '</span></div>';
      }
      html += '</div>';
    });

    /* 发言框 */
    var cp = DebateCore.canPost(r, state.debatePosts, state.uid, mySide || (isHost ? 'a' : ''));
    if (phase === 'live' && mySide && cp.ok) {
      html += '<div class="card-title" style="margin-top:16px">第 ' + cp.round + ' 轮 · 我以' + debateSideLabel(mySide) + '身份发言</div>' +
        '<div class="field"><textarea id="d-post" rows="3" maxlength="500" placeholder="亮出你的论据（500 字内）。AI 将按五维为本轮打分。"></textarea></div>' +
        '<button class="btn btn-primary" id="btn-debate-post" style="width:auto">提交发言</button>';
    } else if (phase === 'live' && mySide && !cp.ok) {
      html += '<p class="hint">' + esc(cp.reason) + '</p>';
    }

    /* 观众押注 */
    if (phase === 'live' || phase === 'overdue' || phase === 'finished') {
      if (phase !== 'live') {
        html += '<p class="hint">辩论已结束，等待房主揭晓；揭晓前仍可下注。</p>';
      }
      html += '<div class="card-title" style="margin-top:16px">观众押注（押谁整场辩得更好）</div>' +
        '<div class="bet-row">' +
        '<input type="radio" name="d-bet" value="a" checked> 甲方 ' +
        '<input type="radio" name="d-bet" value="b"> 乙方' +
        '</div>' +
        '<div class="bet-row"><span>押注</span>' +
        '<input type="number" min="' + minBet + '" step="10" value="' + Math.min(50, Math.max(minBet, Math.floor(avail))) + '" id="d-bet-stake" style="width:110px">' +
        '<span>预计赔付 <b class="pot" id="d-bet-pot">—</b></span>' +
        '<button class="btn btn-primary" id="btn-debate-bet" style="width:auto;padding:5px 14px">确认押注</button>' +
        '<span class="hint">可用 ' + Math.floor(avail) + ' 分</span></div>';
    }

    /* 本房我的押注 */
    var myDBets = state.debateBets.filter(function (b) { return b.did === r.did && b.uid === state.uid; });
    if (myDBets.length) {
      html += '<div class="card-title" style="margin-top:16px">我的押注</div>' +
        myDBets.map(function (b) {
          var st = { open: '进行中', won: '已派彩', lost: '未中' }[b.status] || b.status;
          return '<div class="bet-item"><span class="bet-status ' + b.status + '">' + st + '</span>' +
            '<span class="bet-q">押 ' + debateSideLabel(b.bet_on) + '</span>' +
            '<span>' + b.stake + ' 分 @ ' + Number(b.odds_at_bet).toFixed(2) + '</span>' +
            '<span>' + (b.status === 'won' ? '<span class="amt-gain">+' + b.payout + '</span>'
              : b.status === 'lost' ? '<span class="amt-loss">−' + b.stake + '</span>' : '待揭晓') + '</span></div>';
        }).join('');
    }

    html += '</div>';
    box.innerHTML = html;

    /* ---------- 事件绑定 ---------- */
    Array.prototype.forEach.call(box.querySelectorAll('[data-debate-back]'), function (b) {
      b.addEventListener('click', function () { state.debateRoom = ''; renderAll(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-debate-side]'), function (b) {
      b.addEventListener('click', function () {
        setMyDebateSide(r.did, b.getAttribute('data-debate-side'));
        renderAll();
      });
    });
    on('btn-debate-post', 'click', function () { postDebate(r, mySide); });
    on('btn-debate-start', 'click', function () { startDebate(r); });
    on('btn-debate-hide', 'click', function () { hideDebate(r, true); });
    on('btn-debate-unhide', 'click', function () { hideDebate(r, false); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-debate-settle]'), function (b) {
      b.addEventListener('click', function () {
        var sel = box.querySelector('[data-debate-result="' + r.did + '"]');
        settleDebate(r, sel ? sel.value : 'a');
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-debate-ai]'), function (b) {
      b.addEventListener('click', function () {
        aiScoreRound(r, Number(b.getAttribute('data-debate-ai')));
      });
    });
    on('btn-debate-bet', 'click', function () {
      var sel = box.querySelector('input[name="d-bet"]:checked');
      var stake = $('d-bet-stake') ? $('d-bet-stake').value : 0;
      betDebate(r, sel ? sel.value : 'a', stake);
    });
    /* 实时赔付 */
    var stakeEl = $('d-bet-stake'), potEl = $('d-bet-pot');
    if (stakeEl && potEl) {
      function updPot() {
        var sel = box.querySelector('input[name="d-bet"]:checked');
        var v = Math.floor(Number(stakeEl.value) || 0);
        potEl.textContent = (sel && v >= minBet)
          ? DebateCore.potentialPayout(r, state.debateBets, sel.value, v).toFixed(1) + ' 分' : '—';
      }
      stakeEl.addEventListener('input', updPot);
      Array.prototype.forEach.call(box.querySelectorAll('input[name="d-bet"]'), function (rd) {
        rd.addEventListener('change', updPot);
      });
      updPot();
    }
  }

  /* ---------- 对线房动作 ---------- */
  function createDebate() {
    var v = DebateCore.validateRoom({
      topic: $('d-topic').value, sideA: $('d-side-a').value, sideB: $('d-side-b').value,
      maxRounds: $('d-rounds').value, inviteCode: $('d-code').value, deadline: $('d-deadline').value
    });
    if (!v.ok) { alert(v.reason); return; }
    var did = 'd-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    withCloud(function () {
      return cloud.database.from('jp_debates').insert({
        did: did, topic: v.room.topic, side_a: v.room.side_a, side_b: v.room.side_b,
        creator_uid: state.uid, creator_name: state.nickname,
        invite_code: v.room.invite_code, status: 'open', current_round: 1,
        max_rounds: v.room.max_rounds, deadline: v.room.deadline || null,
        pool: { a: 0, b: 0 }
      }).then(function (r) { if (r.error) throw new Error(r.error.message || '创建房间失败'); });
    });
    state.debateRoom = did;
    setMyDebateSide(did, 'a');
  }

  function startDebate(r) {
    withCloud(function () {
      return cloud.database.from('jp_debates').update({ status: 'live' }).eq('did', r.did).then(check);
    });
  }

  function hideDebate(r, hide) {
    withCloud(function () {
      return cloud.database.from('jp_debates').update({ hidden: hide }).eq('did', r.did).then(check);
    });
  }

  function postDebate(r, side) {
    var content = ($('d-post') ? $('d-post').value : '').trim();
    if (content.length < 10) { alert('发言至少 10 个字'); return; }
    if (content.length > 500) { alert('发言不超过 500 字'); return; }
    var cp = DebateCore.canPost(r, state.debatePosts, state.uid, side);
    if (!cp.ok) { alert(cp.reason); return; }
    withCloud(function () {
      return cloud.database.from('jp_debate_posts').insert({
        did: r.did, uid: state.uid, nickname: state.nickname,
        side: side, round_no: cp.round, content: content
      }).then(function (res) { if (res.error) throw new Error(res.error.message || '发言失败'); });
    });
  }

  function betDebate(r, side, stake) {
    stake = Math.floor(Number(stake));
    var minBet = state.settings.site.min_bet;
    if (!(stake >= minBet)) { alert('押注额最少 ' + minBet + ' 分'); return; }
    if (stake > Math.floor(totalPoints())) { alert('积分不足：当前可用 ' + Math.floor(totalPoints()) + ' 分'); return; }
    if (!confirm('确认押 ' + debateSideLabel(side) + ' ' + stake + ' 分？\n赔率随押注浮动，揭晓时按最终赔结算；平局全额退还。')) return;
    var odds = DebateCore.oddsOf(r, state.debateBets)[side];
    withCloud(function () {
      return cloud.database.from('jp_debate_bets').insert({
        did: r.did, uid: state.uid, nickname: state.nickname,
        bet_on: side, stake: stake, odds_at_bet: odds
      }).then(function (res) { if (res.error) throw new Error(res.error.message || '押注失败'); });
    });
  }

  /* AI 评分某轮：云端 LLM 流式 → 解析 → 双方发言都写分（先到先得） */
  function aiScoreRound(r, roundNo) {
    var rd = DebateCore.postsOf(r, state.debatePosts).filter(function (x) { return x.round === roundNo; })[0];
    if (!rd || !rd.a || !rd.b) return;
    if (rd.a.ai_score) { alert('本轮已经评过分了'); return; }
    state.llmBusy = 'r' + roundNo;
    renderAll();
    var score = null;
    callCloudLLM(DebateCore.aiScorePrompt(r, rd.a.content, rd.b.content))
      .then(function (text) {
        score = DebateCore.parseAiScore(text);
        if (!score) throw new Error('AI 返回格式无法解析');
      })
      .catch(function (e) {
        score = DebateCore.ruleScore(rd.a.content, rd.b.content);
        score.note = (e && e.message ? e.message : 'AI 不可用') + '——已改用规则兜底分';
      })
      .then(function () {
        var chain = Promise.resolve();
        [rd.a, rd.b].forEach(function (p) {
          chain = chain.then(function () {
            return cloud.database.from('jp_debate_posts').update({ ai_score: score }).eq('pid', p.pid).then(check);
          });
        });
        return chain;
      })
      .then(function () {
        state.llmBusy = '';
        renderAll();
      })
      .catch(function (e) {
        state.llmBusy = '';
        alert(e.message || 'AI 评分失败');
        renderAll();
      });
  }

  /* 揭晓：更新房间 + 结算押注 + 镜像写入 jp_bets（积分/流水/榜单打通） */
  function settleDebate(r, result) {
    if (r.status === 'settled') { alert('本房间已揭晓'); return; }
    if (!confirm('确认揭晓「' + r.topic + '」？\n结果：' +
      (result === 'draw' ? '平局（全额退还）' : debateSideLabel(result) + '胜') +
      '\n\n揭晓后所有押注立即结算，不可撤销。')) return;
    var plan = DebateCore.settlePlan(r, state.debateBets, result);
    var finalOdds = DebateCore.settleOdds(r, state.debateBets, result);
    withCloud(function () {
      var chain = cloud.database.from('jp_debates').update({
        status: 'settled', result: result,
        final_odds: result === 'draw' ? 1 : Math.round(finalOdds * 100) / 100,
        settled_at: new Date().toISOString()
      }).eq('did', r.did).then(check);
      plan.forEach(function (item) {
        chain = chain.then(function () {
          return cloud.database.from('jp_debate_bets').update({
            status: item.status, payout: item.payout, settled_at: new Date().toISOString()
          }).eq('dbid', item.bet.dbid).then(check);
        });
        /* 镜像进 jp_bets：让押注计入积分、流水与天梯榜 */
        chain = chain.then(function () {
          return cloud.database.from('jp_bets').insert({
            qid: 'debate-' + r.did, uid: item.bet.uid, nickname: item.bet.nickname,
            outcome_id: item.bet.bet_on, stake: item.bet.stake,
            odds_at_bet: item.bet.odds_at_bet,
            status: item.status, payout: item.payout,
            placed_at: item.bet.placed_at, settled_at: new Date().toISOString()
          }).then(check);
        });
      });
      return chain;
    });
  }

  /* ============================================================
   * 证据情报站（EvidenceCore）
   * ============================================================ */
  var EV_VOTE_KEY = 'jp-ev-vote-';   /* 本机记录我对每条证据的投票 */

  function evOfQ(qid) {
    return state.evidence.filter(function (e) { return e.qid === qid; });
  }
  function evMyVote(eid) {
    try { return localStorage.getItem(EV_VOTE_KEY + eid) || ''; } catch (e) { return ''; }
  }
  function evSetVote(eid, v) {
    try {
      if (v) localStorage.setItem(EV_VOTE_KEY + eid, v);
      else localStorage.removeItem(EV_VOTE_KEY + eid);
    } catch (e) { /* ignore */ }
  }

  /* 问题卡内嵌证据墙 */
  function evidenceWall(q, settled) {
    var list = EvidenceCore.sortEvidence(evOfQ(q.qid));
    var tally = EvidenceCore.sideTally(evOfQ(q.qid));
    var html = '<div class="evidence-wall"><div class="card-title">证据墙 · 支持 ' + tally.yes +
      ' / 反对 ' + tally.no + (tally.neutral ? ' / 中立 ' + tally.neutral : '') +
      ' · 已采纳 ' + tally.accepted + '</div>';

    /* 提交表单（未揭晓时可提交） */
    if (!settled) {
      html += '<div class="evidence-form"><div class="bet-row">' +
        '<label><input type="radio" name="ev-side-' + q.qid + '" value="yes" checked> 支持「' +
        esc((q.outcomes.filter(function (o) { return o.id === 'yes'; })[0] || {}).label || '是') + '」</label>' +
        '<label><input type="radio" name="ev-side-' + q.qid + '" value="no"> 支持「' +
        esc((q.outcomes.filter(function (o) { return o.id === 'no'; })[0] || {}).label || '否') + '」</label>' +
        '<label><input type="radio" name="ev-side-' + q.qid + '" value="neutral"> 中立信息</label>' +
        '</div>' +
        '<div class="form-row">' +
        '<div class="field"><label>标题（必填）</label><input type="text" maxlength="80" id="ev-title-' + q.qid + '" placeholder="一句话说明这条证据"></div>' +
        '<div class="field"><label>链接（选填，http/https）</label><input type="text" id="ev-url-' + q.qid + '" placeholder="https://..."></div>' +
        '</div>' +
        '<div class="field"><label>摘要（选填，300 字内）</label><input type="text" maxlength="300" id="ev-sum-' + q.qid + '"></div>' +
        '<button class="btn" data-ev-submit="' + q.qid + '" style="width:auto">提交证据</button>' +
        '<button class="btn" data-ev-ai="' + q.qid + '" style="width:auto">' +
        (state.llmBusy === 'ev-' + q.qid ? 'AI 整理中…' : 'AI 整理证据') + '</button>' +
        '</div>';
    }

    /* AI 综述 */
    var dg = state.evidenceDigest[q.qid];
    if (dg) {
      html += '<div class="evidence-digest' + (dg.by === 'local' ? ' local' : '') + '">' +
        '<b>AI 证据简报' + (dg.by === 'local' ? '（本地整理）' : '') + '：</b>' + esc(dg.summary) +
        (dg.gap ? '<div class="hint">最缺的证据：' + esc(dg.gap) + '</div>' : '') +
        '<div class="hint">AI 只整理已提交的证据，不添加新事实；仅供参考，不构成投资或决策建议。</div></div>';
    }

    /* 证据列表 */
    if (!list.length) {
      html += '<div class="q-empty">还没有证据。提交第一条带链接的公开证据，帮助所有人做判断。</div>';
    } else {
      html += list.map(function (e) {
        var myVote = evMyVote(e.eid);
        var sideTxt = e.side === 'yes' ? '支持方' : (e.side === 'no' ? '反对方' : '中立');
        var sideCls = e.side === 'yes' ? 'yes' : (e.side === 'no' ? 'no' : 'neutral');
        var badges = '';
        if (e.status === 'accepted') badges += '<span class="q-status settled">已采纳</span>';
        if (e.status === 'rejected') badges += '<span class="q-status expired">已驳回</span>';
        if (e.validated) badges += '<span class="q-status open">揭晓命中 +' + EvidenceCore.EVIDENCE_REWARD + '</span>';
        return '<div class="evidence-item' + (e.status === 'rejected' ? ' rejected' : '') + '">' +
          '<div class="evidence-head"><span class="evidence-side ' + sideCls + '">' + sideTxt + '</span>' +
          (e.url ? '<a class="evidence-link" href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.title) + ' ↗</a>'
            : '<span class="evidence-link">' + esc(e.title) + '</span>') +
          badges + '</div>' +
          (e.summary ? '<div class="evidence-sum">' + esc(e.summary) + '</div>' : '') +
          '<div class="evidence-foot"><span class="hint">' + esc(e.nickname || '匿名') + ' · ' + fmtTs(e.created_at) + '</span>' +
          '<span class="evidence-votes">' +
          '<button class="btn-link' + (myVote === 'up' ? ' voted' : '') + '" data-ev-vote="' + e.eid + ':up">👍 ' + (Number(e.votes_up) || 0) + '</button>' +
          '<button class="btn-link' + (myVote === 'down' ? ' voted' : '') + '" data-ev-vote="' + e.eid + ':down">👎 ' + (Number(e.votes_down) || 0) + '</button>' +
          '</span></div></div>';
      }).join('');
    }
    return html + '</div>';
  }

  function bindEvidenceEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ev-submit]'), function (btn) {
      btn.addEventListener('click', function () { submitEvidence(btn.getAttribute('data-ev-submit')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ev-ai]'), function (btn) {
      btn.addEventListener('click', function () { aiDigestEvidence(btn.getAttribute('data-ev-ai')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ev-vote]'), function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-ev-vote').split(':');
        voteEvidence(Number(parts[0]), parts[1]);
      });
    });
  }

  function submitEvidence(qid) {
    var q = findQuestion(qid);
    if (!q) return;
    if (OnlineCore.phaseOf(q) === 'settled') { alert('问题已揭晓，不能再提交证据'); return; }
    var sel = document.querySelector('input[name="ev-side-' + qid + '"]:checked');
    var v = EvidenceCore.validateEvidence({
      side: sel ? sel.value : '',
      title: $('ev-title-' + qid) ? $('ev-title-' + qid).value : '',
      url: $('ev-url-' + qid) ? $('ev-url-' + qid).value : '',
      summary: $('ev-sum-' + qid) ? $('ev-sum-' + qid).value : ''
    });
    if (!v.ok) { alert(v.reason); return; }
    var payload = {
      qid: qid, uid: state.uid, nickname: state.nickname,
      side: sel.value, status: 'pending',
      url: ($('ev-url-' + qid).value || '').trim(),
      title: $('ev-title-' + qid).value.trim(),
      summary: ($('ev-sum-' + qid).value || '').trim()
    };
    withCloud(function () {
      return cloud.database.from('jp_evidence').insert(payload)
        .then(function (r) { if (r.error) throw new Error(r.error.message || '提交失败'); });
    });
  }

  function voteEvidence(eid, dir) {
    var e = state.evidence.filter(function (x) { return x.eid === eid; })[0];
    if (!e) return;
    var cur = evMyVote(eid);
    var next = cur === dir ? '' : dir;
    var patch = { votes_up: Number(e.votes_up) || 0, votes_down: Number(e.votes_down) || 0 };
    if (cur === 'up') patch.votes_up--;
    if (cur === 'down') patch.votes_down--;
    if (next === 'up') patch.votes_up++;
    if (next === 'down') patch.votes_down++;
    evSetVote(eid, next);
    withCloud(function () {
      return cloud.database.from('jp_evidence').update(patch).eq('eid', eid).then(check);
    });
  }

  /* AI 整理证据：云端 LLM → 解析 → 展示（不落地，刷新后可重新生成） */
  function aiDigestEvidence(qid) {
    var q = findQuestion(qid);
    if (!q) return;
    var list = evOfQ(qid);
    if (!list.length) { alert('先提交至少一条证据'); return; }
    state.llmBusy = 'ev-' + qid;
    renderAll();
    callCloudLLM(EvidenceCore.aiDigestPrompt(q, list), 600)
      .then(function (text) {
        var dg = EvidenceCore.parseDigest(text);
        if (!dg) throw new Error('AI 返回格式无法解析');
        state.evidenceDigest[qid] = dg;
      })
      .catch(function (e) {
        state.evidenceDigest[qid] = EvidenceCore.localDigest(q, list);
        state.evidenceDigest[qid].note = (e && e.message ? e.message : 'AI 不可用');
      })
      .then(function () {
        state.llmBusy = '';
        renderAll();
      });
  }

  /* ============================================================
   * 社区仲裁（ArbitCore）
   * 已揭晓问题 → 押过的人发起仲裁 → 任何人质押投票 →
   * 达阈值社区裁决 → 站长执行改判（原地重算派彩）或驳回（退质押）
   * ============================================================ */
  function findDispute(id) {
    var n = Number(id);
    for (var i = 0; i < state.disputes.length; i++) {
      if (state.disputes[i].id === n) return state.disputes[i];
    }
    return null;
  }

  /* 我能不能对这个已揭晓问题发起仲裁（按钮准入） */
  function canCreateDispute(q) {
    if (!q || q.status !== 'settled' || !q.result) return false;
    if (ArbitCore.activeDisputeOf(q.qid, state.disputes)) return false;
    var mine = ArbitCore.disputesOf(q.qid, state.disputes).filter(function (d) {
      return d.uid === state.uid && d.status !== 'dismissed';
    });
    if (mine.length) return false;
    return state.bets.some(function (b) {
      return b.qid === q.qid && b.uid === state.uid && (!b.kind || b.kind === 'bet') && Number(b.stake) > 0;
    });
  }

  /* 档案卡内嵌仲裁墙 */
  function disputeWall(q) {
    var list = ArbitCore.disputesOf(q.qid, state.disputes);
    var voting = list.filter(function (d) { return d.status === 'voting'; }).length;
    var html = '<div class="dispute-wall"><div class="card-title">仲裁记录' +
      (voting ? ' · 进行中 ' + voting : '') + '</div>';

    list.slice().sort(function (a, b) { return (b.created_at || '') > (a.created_at || '') ? 1 : -1; })
      .forEach(function (d) {
        var verdict = d.status === 'voting' ? ArbitCore.verdictOf(d, state.disputeVotes) : d.status;
        var prog = ArbitCore.progressOf(d, state.disputeVotes);
        var statusCls = { upheld: 'open', rejected: 'expired', resolved: 'settled',
          dismissed: 'expired', pending: 'expired' }[verdict] || 'expired';
        var myVote = ArbitCore.myVoteOf(d.id, state.uid, state.disputeVotes);
        var myStake = ArbitCore.myStakeOf(d.id, state.uid, state.bets);
        html += '<div class="dispute-item' + (verdict === 'upheld' ? ' upheld' : '') + '">' +
          '<div class="dispute-head">' +
          '<span class="q-status ' + statusCls + '">' + ArbitCore.verdictLabel(verdict) + '</span>' +
          '<span class="hint">' + esc(d.nickname || '匿名') + ' 发起 · ' + fmtTs(d.created_at) + '</span>' +
          '</div>' +
          '<div class="dispute-reason">' + esc(d.reason) + '</div>' +
          '<div class="hint">提议改判为「' + esc(OnlineCore.outcomeLabelOf(q, d.proposed_result)) +
          '」（当前结果「' + esc(OnlineCore.outcomeLabelOf(q, q.result)) + '」）</div>' +
          /* 计票进度条 */
          '<div class="dispute-bar"><div class="dispute-bar-fill" style="width:' + prog.agreePct + '%"></div></div>' +
          '<div class="hint">' + esc(prog.text) + ' · 同意 ' + prog.agreeWeight + ' 分 / 反对 ' + prog.rejectWeight + ' 分</div>';
        if (myVote) {
          html += '<div class="hint">我已投票：' + (myVote.agree ? '同意改判' : '维持原判') +
            ' · 质押 ' + Number(myStake ? myStake.stake : myVote.weight) + ' 分' +
            (myStake && myStake.status === 'won' ? ' · 已结算（押对边）' : '') +
            (myStake && myStake.status === 'lost' ? ' · 已结算（押错边，质押罚没）' : '') + '</div>';
        }
        /* 投票表单：进行中 + 我没投 + 我不是发起人 */
        if (d.status === 'voting' && !myVote && d.uid !== state.uid) {
          html += '<div class="dispute-vote"><div class="bet-row">' +
            '<input type="number" min="' + ArbitCore.MIN_STAKE + '" max="' + ArbitCore.MAX_STAKE +
            '" step="1" value="' + ArbitCore.MIN_STAKE + '" data-dp-stake="' + d.id + '" style="width:90px">' +
            '<button class="btn" data-dp-vote="' + d.id + ':agree" style="width:auto">同意改判</button>' +
            '<button class="btn" data-dp-vote="' + d.id + ':reject" style="width:auto">维持原判</button>' +
            '</div><div class="hint">质押 ' + ArbitCore.MIN_STAKE + '-' + ArbitCore.MAX_STAKE +
            ' 分参与投票；裁决成立时，押对边一方分走押错边一方的质押。每人一票。</div></div>';
        }
        /* 改判执行记录 */
        if (d.status === 'resolved') {
          html += '<div class="dispute-record">改判执行：' +
            esc(OnlineCore.outcomeLabelOf(q, d.old_result)) + '（最终赔率 ' +
            (d.old_final_odds == null ? '—' : Number(d.old_final_odds).toFixed(2)) + '） → ' +
            esc(OnlineCore.outcomeLabelOf(q, d.new_result)) + '（最终赔率 ' +
            (d.new_final_odds == null ? '—' : Number(d.new_final_odds).toFixed(2)) + '）' +
            (d.resolved_by ? ' · 由 ' + esc(d.resolved_by) + ' 执行' : '') +
            (d.resolved_at ? ' · ' + fmtTs(d.resolved_at) : '') + '</div>';
        }
        if (d.status === 'dismissed') {
          html += '<div class="hint">站长已驳回该仲裁，质押全额退回。' +
            (d.resolved_at ? '（' + fmtTs(d.resolved_at) + '）' : '') + '</div>';
        }
        html += '</div>';
      });

    /* 发起仲裁入口 */
    if (canCreateDispute(q)) {
      var opts = q.outcomes.filter(function (o) { return o.id !== q.result; })
        .map(function (o) {
          return '<label><input type="radio" name="dp-new-' + q.qid + '" value="' + o.id + '"> ' +
            esc(o.label) + '</label>';
        }).join('');
      html += '<div class="dispute-create">' +
        '<div class="hint">对揭晓结果有异议？押过此题的人可发起仲裁：写下理由，社区质押投票裁决，' +
        '站长按裁决执行改判或驳回。</div>' +
        '<div class="bet-row">' + opts + '</div>' +
        '<div class="field"><label>仲裁理由（' + ArbitCore.REASON_MIN + '-' + ArbitCore.REASON_MAX +
        ' 字，说清楚哪里与公开事实不符）</label>' +
        '<textarea id="dp-reason-' + q.qid + '" rows="2" maxlength="' + ArbitCore.REASON_MAX +
        '" placeholder="如：判定标准写的是以官方文件为准，但揭晓时引用的是媒体报道…"></textarea></div>' +
        '<button class="btn" data-dp-create="' + q.qid + '" style="width:auto">发起仲裁</button>' +
        '</div>';
    }
    return html + '</div>';
  }

  function bindDisputeEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-dp-create]'), function (btn) {
      btn.addEventListener('click', function () {
        createDispute(btn.getAttribute('data-dp-create'));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-dp-vote]'), function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-dp-vote').split(':');
        voteDispute(Number(parts[0]), parts[1] === 'agree');
      });
    });
  }

  function createDispute(qid) {
    var q = findQuestion(qid);
    if (!q) return;
    var sel = document.querySelector('input[name="dp-new-' + qid + '"]:checked');
    var reasonEl = $('dp-reason-' + qid);
    var v = ArbitCore.validateDispute({
      newResult: sel ? sel.value : '',
      reason: reasonEl ? reasonEl.value : ''
    }, { q: q, bets: state.bets, disputes: state.disputes, uid: state.uid });
    if (!v.ok) { alert(v.reason); return; }
    withCloud(function () {
      return cloud.database.from('jp_disputes').insert({
        qid: qid, uid: state.uid, nickname: state.nickname,
        reason: reasonEl.value.trim(), status: 'voting',
        proposed_result: sel.value
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message || '发起仲裁失败');
      });
    });
  }

  function voteDispute(disputeId, agree) {
    var d = findDispute(disputeId);
    if (!d) return;
    var input = document.querySelector('[data-dp-stake="' + disputeId + '"]');
    var stake = input ? Math.floor(Number(input.value) || 0) : 0;
    var v = ArbitCore.validateVote({ stake: stake }, {
      dispute: d, votes: state.disputeVotes, bets: state.bets, uid: state.uid
    });
    if (!v.ok) { alert(v.reason); return; }
    var avail = totalPoints();
    if (stake > Math.floor(avail)) {
      alert('可用积分不足：质押 ' + stake + ' 分，当前可用 ' + Math.floor(avail) + ' 分');
      return;
    }
    var now = new Date().toISOString();
    var newVote = {
      dispute_id: d.id, uid: state.uid, nickname: state.nickname,
      agree: !!agree, weight: stake, created_at: now
    };
    var nextVotes = state.disputeVotes.concat([newVote]);
    var verdict = ArbitCore.verdictOf(d, nextVotes);
    withCloud(function () {
      var chain = cloud.database.from('jp_dispute_votes').insert(newVote).then(check);
      var stakeRow = null;
      chain = chain.then(function () {
        return cloud.database.from('jp_bets').insert({
          qid: ArbitCore.stakeQid(d.id), uid: state.uid, nickname: state.nickname,
          outcome_id: agree ? 'agree' : 'reject',
          stake: stake, odds_at_bet: 0, status: 'open', kind: 'stake',
          placed_at: now
        }).then(function (r) {
          check(r);
          stakeRow = (r.data && r.data[0]) || null;
        });
      });
      /* 权重缓存（展示用；权威计数以 jp_dispute_votes 行为准） */
      var t = ArbitCore.tallyOf(d, nextVotes);
      chain = chain.then(function () {
        return cloud.database.from('jp_disputes')
          .update({ agree_weight: t.agreeWeight, reject_weight: t.rejectWeight })
          .eq('id', d.id).then(check);
      });
      /* 裁决成立的瞬间结算质押（幂等：只动仍为 open 的行） */
      chain = chain.then(function () {
        if (verdict === 'pending' || !stakeRow) return null;
        var plan = ArbitCore.resolveStakesPlan(d, nextVotes, state.bets.concat([stakeRow]));
        if (!plan || !plan.items.length) return null;
        var c = Promise.resolve();
        plan.items.forEach(function (item) {
          c = c.then(function () {
            return cloud.database.from('jp_bets')
              .update({ status: item.status, payout: item.payout, settled_at: now })
              .eq('id', item.bet.id).eq('status', 'open').then(check);
          });
        });
        return c;
      });
      return chain;
    });
  }

  /* 执行改判：问题结果 + 每笔投注派彩原地重算，仲裁记录留痕 */
  function doResettle(q, newResult, dispute) {
    var plan = ArbitCore.adjustPlan(q, state.bets, newResult, function (qq, bb, rr) {
      return OnlineCore.settleOdds(qq, bb, rr);
    });
    var label = OnlineCore.outcomeLabelOf(q, newResult);
    var oldLabel = OnlineCore.outcomeLabelOf(q, q.result);
    /* 先快照旧值：云端 update 会原地改掉 q 对象，之后读就是新值了 */
    var oldResult = q.result, oldOdds = q.final_odds;
    if (!confirm('确认把「' + q.title + '」的结果从「' + oldLabel + '」改判为「' + label + '」？\n' +
      '新最终赔率 ' + plan.newOdds.toFixed(2) + '，将按新结果重算全部 ' + plan.items.length +
      ' 笔投注的派彩，不可撤销。')) return;
    var now = new Date().toISOString();
    withCloud(function () {
      var chain = cloud.database.from('jp_questions').update({
        result: newResult, final_odds: plan.newOdds, settled_at: now
      }).eq('qid', q.qid).then(check);
      plan.items.forEach(function (item) {
        chain = chain.then(function () {
          return cloud.database.from('jp_bets').update({
            status: item.status, payout: item.payout, settled_at: now
          }).eq('id', item.bet.id).then(check);
        });
      });
      if (dispute) {
        chain = chain.then(function () {
          return cloud.database.from('jp_disputes').update({
            status: 'resolved',
            old_result: oldResult, old_final_odds: oldOdds,
            new_result: newResult, new_final_odds: plan.newOdds,
            resolved_by: state.nickname || 'admin', resolved_at: now
          }).eq('id', dispute.id).then(check);
        });
      }
      return chain;
    });
  }

  /* 站长从仲裁队列执行改判（要求社区裁决已支持） */
  function executeResettle(disputeId) {
    var d = findDispute(disputeId);
    if (!d) return;
    var q = findQuestion(d.qid);
    if (!q || q.status !== 'settled') { alert('问题未揭晓'); return; }
    if (ArbitCore.verdictOf(d, state.disputeVotes) !== 'upheld') {
      alert('社区裁决未支持改判（需 ≥' + ArbitCore.MIN_VOTES + ' 票且同意占比 ≥' +
        Math.round(ArbitCore.AGREE_RATIO * 100) + '%）');
      return;
    }
    var sel = $('dp-exec-sel-' + d.id);
    var newResult = sel ? sel.value : d.proposed_result;
    if (newResult === q.result) { alert('改判结果与当前结果相同'); return; }
    doResettle(q, newResult, d);
  }

  /* 站长驳回仲裁：质押全额退回 */
  function dismissDispute(disputeId) {
    var d = findDispute(disputeId);
    if (!d || d.status !== 'voting') { alert('本仲裁已结案'); return; }
    if (!confirm('驳回该仲裁？所有质押将全额退回给投票人，问题结果不变。')) return;
    var plan = ArbitCore.refundPlan(d, state.bets);
    var now = new Date().toISOString();
    withCloud(function () {
      var chain = cloud.database.from('jp_disputes').update({
        status: 'dismissed', resolved_at: now
      }).eq('id', d.id).then(check);
      plan.items.forEach(function (item) {
        chain = chain.then(function () {
          return cloud.database.from('jp_bets')
            .update({ status: 'won', payout: item.payout, settled_at: now })
            .eq('id', item.bet.id).eq('status', 'open').then(check);
        });
      });
      return chain;
    });
  }

  /* ============================================================
   * 站长控制台
   * ============================================================ */
  function llmCfg() {
    try { return JSON.parse(localStorage.getItem(LLM_KEY) || '{}'); } catch (e) { return {}; }
  }

  function renderAdmin() {
    var gate = $('admin-gate');
    var body = $('admin-body');
    if (!gate || !body) return;
    if (!state.adminUnlocked) {
      gate.style.display = '';
      body.style.display = 'none';
      gate.innerHTML =
        '<div class="card admin-lock">' +
        '<div class="card-title">站长控制台 · 需要口令</div>' +
        '<p class="hint">输入站长口令解锁。口令以 SHA-256 哈希存于云端，不明文传输；解锁状态只记在本机浏览器。</p>' +
        '<div class="field"><label>站长口令</label>' +
        '<input type="password" id="admin-token" placeholder="jp-XXXXXX-XXXXXX-XXXXXX"></div>' +
        '<button class="btn btn-primary" id="btn-admin-unlock" style="width:auto">解锁</button>' +
        '<p class="hint">忘记口令？口令哈希存在云端 jp_settings 表，可用数据管理工具重置后重新设置。</p>' +
        '</div>';
      on('btn-admin-unlock', 'click', unlockAdmin);
      var ti = $('admin-token');
      if (ti) ti.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlockAdmin(); });
      return;
    }
    gate.style.display = 'none';
    body.style.display = '';
    renderAdminStats();
    renderAdminPending();
    renderAdminLoans();
    renderAdminDebates();
    renderAdminEvidence();
    renderAdminDisputes();
    renderAdminQuestions();
    renderAdminSettings();
  }

  function unlockAdmin() {
    var v = ($('admin-token') || {}).value || '';
    v = v.trim();
    if (!v) { alert('请输入站长口令'); return; }
    var hash = SHA256.sha256(v);
    if (!state.settings.tokenHash) { alert('云端尚未设置站长口令哈希，请先在数据管理中初始化'); return; }
    if (hash !== state.settings.tokenHash) { alert('口令不正确'); return; }
    state.adminUnlocked = true;
    localStorage.setItem(ADMIN_KEY, '1');
    /* 站长解锁后开放「人工揭晓」建题选项 */
    if ($('q-settle-manual')) $('q-settle-manual').style.display = '';
    renderAll();
  }

  function renderAdminStats() {
    var box = $('admin-stats');
    if (!box) return;
    var bets = state.bets.filter(function (b) { return !b.kind || b.kind === 'bet' });
    var uids = {};
    bets.forEach(function (b) { uids[b.uid] = 1; });
    state.loans.forEach(function (l) { uids[l.uid] = 1; });
    var players = Object.keys(uids).length;
    var staked = 0, paid = 0, openN = 0, settledN = 0, expiredN = 0, votingN = 0;
    state.questions.forEach(function (q) {
      var ph = OnlineCore.phaseOf(q);
      if (ph === 'open') openN++;
      else if (ph === 'expired') {
        expiredN++;
        if (OnlineCore.settleModeOf(q) === 'vote') votingN++;
      }
      else settledN++;
    });
    bets.forEach(function (b) {
      staked += Number(b.stake);
      if (b.status === 'won') paid += Number(b.payout);
    });
    var lent = 0, outstanding = 0, overdueN = 0;
    state.loans.forEach(function (l) {
      lent += Number(l.principal);
      if (l.status === 'open') {
        outstanding += LoanCore.outstandingOf(l).total;
        if (LoanCore.isOverdue(l)) overdueN++;
      }
    });
    var pool = LoanCore.interestPoolOf(state.payments);
    var balance = LoanCore.interestBalanceOf(state.payments, state.settings.allocLog);
    box.innerHTML =
      '<div class="stat-row">' +
      statCard('玩家数', players) +
      statCard('问题', state.questions.length + '（进行 ' + openN + ' / 到期 ' + expiredN +
        '（公投中 ' + votingN + '）/ 已揭晓 ' + settledN + '）') +
      statCard('投注笔数', bets.length) +
      statCard('总投入 / 总派彩', staked + ' / ' + Math.round(paid * 10) / 10) +
      '</div>' +
      '<div class="stat-row">' +
      statCard('累计放款', Math.round(lent) + ' 分') +
      statCard('未收回本息', Math.round(outstanding * 10) / 10 + ' 分') +
      statCard('逾期借款', overdueN + ' 笔') +
      statCard('利息池', '已收 ' + pool + ' / 可分配 ' + balance) +
      '</div>';
  }
  function statCard(label, value) {
    return '<div class="stat-card"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + esc(value) + '</div></div>';
  }

  /* 待平台检索 / 待揭晓队列 + AI 辅助判定 */
  function renderAdminPending() {
    var box = $('admin-pending');
    if (!box) return;
    var pending = OnlineCore.sortQuestions(state.questions).filter(function (q) {
      return OnlineCore.phaseOf(q) === 'expired';
    });
    if (!pending.length) {
      box.innerHTML = '<div class="q-empty">当前没有到期未揭晓的问题。到期的问题会自动出现在这里。</div>';
      return;
    }
    var html = '<div class="card-title">待平台检索 / 待揭晓队列（' + pending.length + '）</div>' +
      '<p class="hint">到期问题不会自动揭晓——「平台检索」题由每日自动检索查证结算（站长可在此人工兜底）；' +
      '「公投揭晓」题到期后进入公投，按一人一票多数决自动结算；只有 legacy「人工揭晓」题才需要在此手动处理。' +
      '可在下方配置 LLM 接口获取判定建议。</p>';
    pending.forEach(function (q) {
      var mode = OnlineCore.settleModeOf(q);
      var modeTxt = OnlineCore.SETTLE_LABELS[mode];
      html += '<div class="pending-item">' +
        '<div class="pending-title">' + esc(q.title) + '</div>' +
        '<div class="pending-meta">截止 ' + esc(q.deadline) + ' · ' + modeTxt + '揭晓 · ' +
        (q.mode === 'fixed' ? '固定赔率' : '彩池赔率') + ' · ' +
        (mode === 'vote' ? '公投截止 ' + esc(q.vote_end) + ' · ' : '') +
        q.outcomes.map(function (o) { return esc(o.label); }).join(' / ') + '</div>' +
        '<div class="pending-actions">' +
        (mode === 'search' ? '<button class="btn" data-ask="' + q.qid + '">' + (state.llmBusy === q.qid ? 'AI 判定中…' : 'AI 判定建议') + '</button>' : '') +
        '<select data-resolve="' + q.qid + '">' + q.outcomes.map(function (o) {
          return '<option value="' + o.id + '">揭晓为：' + esc(o.label) + '</option>';
        }).join('') + '</select>' +
        '<button class="btn btn-primary" data-settle="' + q.qid + '" style="width:auto">' +
        (mode === 'search' ? '平台检索揭晓' : '揭晓结算') + '</button>' +
        '</div></div>';
    });
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('[data-ask]'), function (btn) {
      btn.addEventListener('click', function () { askLlm(btn.getAttribute('data-ask')); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-settle]'), function (btn) {
      btn.addEventListener('click', function () {
        var qid = btn.getAttribute('data-settle');
        var sel = box.querySelector('[data-resolve="' + qid + '"]');
        settleQuestion(qid, sel ? sel.value : '', { byAdmin: true });
      });
    });

    /* AI 建议卡片 */
    var sg = state.llmSuggestion;
    if (sg) {
      var q = findQuestion(sg.qid);
      if (q) {
        var card = document.createElement('div');
        if (sg.error) {
          card.className = 'llm-card error';
          card.innerHTML = '<b>AI 判定失败：</b>' + esc(sg.error) +
            '<div class="hint">检查接口地址 / Key / 模型名；部分服务商有跨域限制。</div>';
        } else {
          card.className = 'llm-card';
          card.innerHTML = '<div class="llm-head">AI 判定建议 · ' + esc(q.title) + '</div>' +
            '<div class="llm-body">建议结果：<b>' + esc(OnlineCore.outcomeLabelOf(q, sg.outcomeId)) + '</b>' +
            ' · 置信度 ' + Math.round(sg.confidence * 100) + '%' +
            '<div class="llm-reason">依据：' + esc(sg.reason) + '</div></div>' +
            '<button class="btn btn-primary" data-apply="' + q.qid + '" style="width:auto">按此建议揭晓</button>' +
            '<span class="hint" style="margin-left:8px">AI 建议仅供参考，揭晓前请人工核对公开事实。</span>';
          card.querySelector('[data-apply]').addEventListener('click', function () {
            settleQuestion(q.qid, sg.outcomeId);
          });
        }
        box.appendChild(card);
      }
    }
  }

  /* 调 LLM（OpenAI 兼容接口）：key 只存站长本机 */
  function askLlm(qid) {
    var cfg = llmCfg();
    if (!cfg.key || !cfg.baseUrl) { alert('请先在下方「AI 判定配置」填写接口地址和 Key'); return; }
    var q = findQuestion(qid);
    if (!q) return;
    state.llmBusy = qid;
    state.llmSuggestion = null;
    renderAdmin();
    var today = new Date().toISOString().slice(0, 10);
    var prompt =
      '今天是 ' + today + '。请基于公开可核实的信息，判断下面这个预测问题的结果。\n' +
      '问题：' + q.title + '\n' +
      '判定标准：' + (q.descr || '以公开事实为准') + '\n' +
      '可选结果：' + q.outcomes.map(function (o) { return o.id + '=' + o.label; }).join('，') + '\n\n' +
      '只回复一行 JSON，不要解释：{"outcome_id":"<结果id>","confidence":<0到1之间的小数>,"reason":"<一句话依据>"}';
    fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      })
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        var content = j && j.choices && j.choices[0] && j.choices[0].message
          ? j.choices[0].message.content : '';
        var m = String(content).match(/\{[\s\S]*\}/);
        if (!m) throw new Error('AI 返回格式无法解析');
        var obj = JSON.parse(m[0]);
        var valid = q.outcomes.some(function (o) { return o.id === obj.outcome_id; });
        if (!valid) throw new Error('AI 返回了不存在的选项');
        state.llmSuggestion = {
          qid: qid, outcomeId: obj.outcome_id,
          confidence: Math.max(0, Math.min(1, Number(obj.confidence) || 0)),
          reason: String(obj.reason || '').slice(0, 300)
        };
      })
      .catch(function (e) {
        state.llmSuggestion = { qid: qid, error: e.message || '请求失败' };
      })
      .then(function () {
        state.llmBusy = '';
        renderAdmin();
      });
  }

  /* ---------- 站长台：借贷管理 ---------- */
  function renderAdminLoans() {
    var box = $('admin-loans');
    if (!box) return;
    var open = state.loans.filter(function (l) { return l.status === 'open'; });
    var closed = state.loans.filter(function (l) { return l.status !== 'open'; })
      .sort(function (a, b) { return (b.closed_at || '') > (a.closed_at || '') ? 1 : -1; })
      .slice(0, 20);
    var html = '';
    if (!open.length) {
      html += '<div class="q-empty">当前没有未结清的借款。</div>';
    } else {
      html = '<table class="ledger-table admin-table"><thead><tr>' +
        '<th>玩家</th><th>本金</th><th>到期</th><th>应还</th><th>状态</th><th>操作</th></tr></thead><tbody>';
      open.forEach(function (l) {
        var o = LoanCore.outstandingOf(l);
        var overdue = LoanCore.isOverdue(l);
        html += '<tr>' +
          '<td>' + esc(l.nickname) + '</td>' +
          '<td>' + l.principal + '</td>' +
          '<td>' + esc(l.due_date) + '</td>' +
          '<td>' + o.total + '</td>' +
          '<td>' + (overdue ? '<span style="color:var(--amber)">逾期 ' + LoanCore.daysOverdue(l) + ' 天</span>' : '正常') + '</td>' +
          '<td class="admin-ops"><button class="btn-link danger" data-writeoff="' + l.uid + '">核销其全部债务</button></td>' +
          '</tr>';
      });
      html += '</tbody></table>' +
        '<p class="hint">核销 = 将该玩家全部未结清借款标记为「已核销」：债务清零、记录留存，已借本金仍计入其现金（钱确实到过账）。用于死号 / 测试号清理，请谨慎。</p>';
    }
    if (closed.length) {
      html += '<div class="card-title" style="margin-top:12px">最近结束的借款（核销 / 结清记录留存）</div>' +
        '<table class="ledger-table admin-table"><thead><tr>' +
        '<th>玩家</th><th>本金</th><th>状态</th><th>已还本金</th><th>结清时间</th></tr></thead><tbody>';
      closed.forEach(function (l) {
        html += '<tr>' +
          '<td>' + esc(l.nickname) + '</td>' +
          '<td>' + l.principal + '</td>' +
          '<td>' + (l.status === 'written_off' ? '已核销' : '已结清') + '</td>' +
          '<td>' + (Number(l.repaid_principal) || 0) + '</td>' +
          '<td>' + esc(l.closed_at || '—') + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('[data-writeoff]'), function (b) {
      b.addEventListener('click', function () {
        var u = b.getAttribute('data-writeoff');
        if (!confirm('核销该玩家全部未结清借款？\n将标记为「已核销」：债务清零、记录留存，不可恢复为未清状态。')) return;
        withCloud(function () {
          return cloud.database.from('jp_loans')
            .update({ status: 'written_off', closed_at: new Date().toISOString() })
            .eq('uid', u).eq('status', 'open').then(check);
        });
      });
    });
  }

  /* ---------- 站长台：对线房管理 ---------- */
  function renderAdminDebates() {
    var box = $('admin-debates');
    if (!box) return;
    if (!state.debates.length) {
      box.innerHTML = '<div class="q-empty">还没有对线房。</div>';
      return;
    }
    var html = '<table class="ledger-table admin-table"><thead><tr>' +
      '<th>辩题</th><th>房主</th><th>状态</th><th>轮次</th><th>押注</th><th>操作</th></tr></thead><tbody>';
    state.debates.slice().sort(function (a, b) { return (b.created_at || '') > (a.created_at || '') ? 1 : -1; })
      .slice(0, 30).forEach(function (r) {
        var phase = DebateCore.phaseOf(r, state.debatePosts);
        var n = state.debateBets.filter(function (b) { return b.did === r.did; }).length;
        html += '<tr>' +
          '<td class="ledger-note">' + esc(r.topic) + (r.invite_code ? '（邀请制）' : '') + '</td>' +
          '<td>' + esc(r.creator_name || '—') + '</td>' +
          '<td>' + ({ open: '布场中', live: '辩论中', overdue: '待揭晓', finished: '待揭晓', settled: '已揭晓' }[phase]) +
            (r.hidden ? ' · 已下架' : '') + '</td>' +
          '<td>' + DebateCore.currentRoundOf(r, state.debatePosts) + '/' + r.max_rounds + '</td>' +
          '<td>' + n + ' 笔</td>' +
          '<td class="admin-ops">' +
          '<button class="btn-link" data-dhide="' + r.did + '">' + (r.hidden ? '恢复上架' : '下架') + '</button>' +
          '</td></tr>';
      });
    box.innerHTML = html + '</tbody></table>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-dhide]'), function (b) {
      b.addEventListener('click', function () {
        var r = findDebate(b.getAttribute('data-dhide'));
        if (!r) return;
        withCloud(function () {
          return cloud.database.from('jp_debates').update({ hidden: !r.hidden }).eq('did', r.did).then(check);
        });
      });
    });
  }

  /* ---------- 站长台：证据审核队列 ---------- */
  function renderAdminEvidence() {
    var box = $('admin-evidence');
    if (!box) return;
    var pending = EvidenceCore.sortEvidence(state.evidence.filter(function (e) { return e.status === 'pending'; }));
    var html = '<p class="hint">证据墙由社区维护：任何人可提交、可投票；站长采纳的证据在问题墙上置顶，' +
      '揭晓时立场命中的提交者各奖 ' + EvidenceCore.EVIDENCE_REWARD + ' 分。</p>';
    if (!pending.length) {
      html += '<div class="q-empty">没有待审核的证据。</div>';
    } else {
      html += '<table class="ledger-table admin-table"><thead><tr>' +
        '<th>问题</th><th>立场</th><th>证据</th><th>提交者</th><th>票数</th><th>操作</th></tr></thead><tbody>';
      pending.forEach(function (e) {
        var q = findQuestion(e.qid);
        html += '<tr>' +
          '<td class="ledger-note">' + esc(q ? q.title : e.qid) + '</td>' +
          '<td>' + ({ yes: '支持', no: '反对', neutral: '中立' }[e.side] || e.side) + '</td>' +
          '<td class="ledger-note">' + esc(e.title) + (e.url ? ' <a href="' + esc(e.url) + '" target="_blank" rel="noopener">↗</a>' : '') + '</td>' +
          '<td>' + esc(e.nickname || '匿名') + '</td>' +
          '<td>👍 ' + (Number(e.votes_up) || 0) + ' / 👎 ' + (Number(e.votes_down) || 0) + '</td>' +
          '<td class="admin-ops">' +
          '<button class="btn-link" data-ev-accept="' + e.eid + '">采纳</button>' +
          '<button class="btn-link danger" data-ev-reject="' + e.eid + '">驳回</button>' +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }
    /* 信源质量榜 */
    var board = EvidenceCore.sourceBoard(state.evidence).slice(0, 10);
    if (board.length) {
      html += '<div class="card-title" style="margin-top:14px">信源质量榜（按采纳与命中积分）</div>' +
        '<table class="ledger-table"><thead><tr><th>#</th><th>玩家</th><th>提交</th><th>采纳</th><th>揭晓命中</th><th>积分</th></tr></thead><tbody>';
      board.forEach(function (p, i) {
        html += '<tr><td>' + (i + 1) + '</td><td>' + esc(p.nickname) + '</td><td>' + p.submitted + '</td>' +
          '<td>' + p.accepted + '</td><td>' + p.validated + '</td><td>' + p.score + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('[data-ev-accept]'), function (b) {
      b.addEventListener('click', function () {
        withCloud(function () {
          return cloud.database.from('jp_evidence').update({ status: 'accepted' })
            .eq('eid', Number(b.getAttribute('data-ev-accept'))).then(check);
        });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ev-reject]'), function (b) {
      b.addEventListener('click', function () {
        withCloud(function () {
          return cloud.database.from('jp_evidence').update({ status: 'rejected' })
            .eq('eid', Number(b.getAttribute('data-ev-reject'))).then(check);
        });
      });
    });
  }

  /* ---------- 站长台：仲裁队列 ---------- */
  function renderAdminDisputes() {
    var box = $('admin-disputes');
    if (!box) return;
    var html = '<p class="hint">社区仲裁：押过题的人发起，任何人质押投票。≥' + ArbitCore.MIN_VOTES +
      ' 票且同意占比 ≥' + Math.round(ArbitCore.AGREE_RATIO * 100) + '% → 社区支持改判，站长执行；' +
      '驳回则质押全额退回。改判按新结果原地重算全部投注派彩，记录留痕可查。</p>';
    if (!state.disputes.length) {
      box.innerHTML = html + '<div class="q-empty">还没有仲裁案。</div>';
      return;
    }
    var list = ArbitCore.adminSort(state.disputes, state.disputeVotes);
    html += '<table class="ledger-table admin-table"><thead><tr>' +
      '<th>问题</th><th>发起人</th><th>提议</th><th>理由</th><th>计票</th><th>裁决</th><th>操作</th></tr></thead><tbody>';
    list.forEach(function (d) {
      var q = findQuestion(d.qid);
      var verdict = d.status === 'voting' ? ArbitCore.verdictOf(d, state.disputeVotes) : d.status;
      var prog = ArbitCore.progressOf(d, state.disputeVotes);
      var verdictCls = { upheld: 'open', rejected: 'expired', resolved: 'settled', dismissed: 'expired' }[verdict] || 'expired';
      var stakes = ArbitCore.stakeRowsOf(d.id, state.bets);
      var locked = stakes.filter(function (b) { return b.status === 'open'; })
        .reduce(function (s, b) { return s + Number(b.stake); }, 0);
      html += '<tr>' +
        '<td class="ledger-note">' + esc(q ? q.title : d.qid) + '</td>' +
        '<td>' + esc(d.nickname || '匿名') + '</td>' +
        '<td>' + esc(q ? OnlineCore.outcomeLabelOf(q, d.proposed_result) : d.proposed_result) + '</td>' +
        '<td class="ledger-note">' + esc(d.reason.length > 40 ? d.reason.slice(0, 40) + '…' : d.reason) + '</td>' +
        '<td>' + prog.agreeVotes + ' 赞 / ' + prog.rejectVotes + ' 弹 · 质押 ' + locked + '</td>' +
        '<td><span class="q-status ' + verdictCls + '">' + ArbitCore.verdictLabel(verdict) + '</span></td>' +
        '<td class="admin-ops">';
      if (d.status === 'voting' && verdict === 'upheld' && q) {
        var opts = q.outcomes.map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === d.proposed_result ? ' selected' : '') + '>' +
            esc(o.label) + (o.id === q.result ? '（当前）' : '') + '</option>';
        }).join('');
        html += '<select id="dp-exec-sel-' + d.id + '" style="width:auto;display:inline-block">' + opts + '</select>' +
          '<button class="btn-link" data-dp-exec="' + d.id + '">执行改判</button>' +
          '<button class="btn-link danger" data-dp-dismiss="' + d.id + '">驳回</button>';
      } else if (d.status === 'voting') {
        html += '<button class="btn-link danger" data-dp-dismiss="' + d.id + '">驳回</button>';
      } else if (d.status === 'resolved') {
        html += '<span class="hint">' + esc(OnlineCore.outcomeLabelOf(q, d.old_result)) + ' → ' +
          esc(OnlineCore.outcomeLabelOf(q, d.new_result)) + '</span>';
      } else {
        html += '<span class="hint">已驳回</span>';
      }
      html += '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table>';

    Array.prototype.forEach.call(box.querySelectorAll('[data-dp-exec]'), function (b) {
      b.addEventListener('click', function () {
        executeResettle(Number(b.getAttribute('data-dp-exec')));
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-dp-dismiss]'), function (b) {
      b.addEventListener('click', function () {
        dismissDispute(Number(b.getAttribute('data-dp-dismiss')));
      });
    });
  }

  /* ---------- 站长台：问题管理 ---------- */
  function renderAdminQuestions() {
    var box = $('admin-questions');
    if (!box) return;
    var qs = OnlineCore.sortQuestions(state.questions);
    var balance = LoanCore.interestBalanceOf(state.payments, state.settings.allocLog);
    var html = '<p class="hint">利息池可分配余额：<b>' + balance + '</b> 分（来自玩家已付利息与罚息）。「注入初始池」会把利息池按选项平均注入该题彩池，并记录用途。</p>' +
      '<table class="ledger-table admin-table"><thead><tr>' +
      '<th>问题</th><th>状态</th><th>投注</th><th>创建</th><th>操作</th></tr></thead><tbody>';
    qs.forEach(function (q) {
      var n = state.bets.filter(function (b) { return b.qid === q.qid && (!b.kind || b.kind === 'bet'); }).length;
      var phase = OnlineCore.phaseOf(q);
      var phaseTxt = { open: '进行中', expired: '待揭晓', settled: '已揭晓' }[phase];
      var injectBtn = (q.mode === 'pool' && phase !== 'settled')
        ? '<button class="btn-link" data-inject="' + q.qid + '">注入初始池</button>' : '';
      /* 已揭晓问题支持站长直接改判（修正错误用；流程同仲裁改判） */
      var resettleBtn = (q.status === 'settled')
        ? '<button class="btn-link" data-resettle="' + q.qid + '">改判结果</button>' : '';
      html += '<tr>' +
        '<td class="ledger-note">' + esc(q.title) + '</td>' +
        '<td>' + phaseTxt + (q.hidden ? ' · 已下架' : '') + (q.pinned ? ' · 置顶' : '') + '</td>' +
        '<td>' + n + ' 笔</td>' +
        '<td>' + esc(q.creator_name || '—') + '</td>' +
        '<td class="admin-ops">' +
        '<button class="btn-link" data-pin="' + q.qid + '">' + (q.pinned ? '取消置顶' : '置顶') + '</button>' +
        '<button class="btn-link" data-hide="' + q.qid + '">' + (q.hidden ? '恢复上架' : '下架') + '</button>' +
        injectBtn + resettleBtn +
        (n === 0 && phase !== 'settled'
          ? '<button class="btn-link danger" data-del="' + q.qid + '">删除</button>' : '') +
        '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table>';

    Array.prototype.forEach.call(box.querySelectorAll('[data-pin]'), function (b) {
      b.addEventListener('click', function () {
        var q = findQuestion(b.getAttribute('data-pin'));
        if (!q) return;
        withCloud(function () {
          return cloud.database.from('jp_questions').update({ pinned: !q.pinned }).eq('qid', q.qid).then(check);
        });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-hide]'), function (b) {
      b.addEventListener('click', function () {
        var q = findQuestion(b.getAttribute('data-hide'));
        if (!q) return;
        withCloud(function () {
          return cloud.database.from('jp_questions').update({ hidden: !q.hidden }).eq('qid', q.qid).then(check);
        });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-inject]'), function (b) {
      b.addEventListener('click', function () {
        var q = findQuestion(b.getAttribute('data-inject'));
        if (!q) return;
        var v = prompt('从利息池注入多少分到「' + q.title + '」的初始彩池？\n（按选项平均分配，可分配余额 ' +
          LoanCore.interestBalanceOf(state.payments, state.settings.allocLog) + ' 分）');
        v = Math.floor(Number(v) || 0);
        if (!(v > 0)) return;
        if (v > LoanCore.interestBalanceOf(state.payments, state.settings.allocLog)) {
          alert('超出可分配余额'); return;
        }
        var per = Math.round(v / q.outcomes.length * 10) / 10;
        var nextPool = {};
        q.outcomes.forEach(function (o) {
          nextPool[o.id] = (Number(q.pool && q.pool[o.id]) || 0) + per;
        });
        var log = state.settings.allocLog.concat([{
          qid: q.qid, amount: v, ts: new Date().toISOString(), by: state.nickname || 'admin'
        }]);
        withCloud(function () {
          return cloud.database.from('jp_questions').update({ pool: nextPool }).eq('qid', q.qid).then(check)
            .then(function () {
              return cloud.database.from('jp_settings')
                .update({ value: log, updated_by: state.nickname || 'admin', updated_at: new Date().toISOString() })
                .eq('key', 'interest_alloc').then(check);
            })
            .then(function () {
              /* 注入后写快照：曲线反映新池（用新池现算，不依赖内存旧值） */
              return cloud.database.from('jp_odds_snaps').insert({
                qid: q.qid, odds: OddsCore.oddsOf(q, nextPool), pool: nextPool
              }).then(check);
            });
        });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var q = findQuestion(b.getAttribute('data-del'));
        if (!q) return;
        if (!confirm('确定删除「' + q.title + '」？仅无投注的问题可删除。')) return;
        withCloud(function () {
          return cloud.database.from('jp_questions').delete().eq('qid', q.qid).then(check);
        });
      });
    });
    /* 站长直接改判（无仲裁流程，修正揭晓错误用） */
    Array.prototype.forEach.call(box.querySelectorAll('[data-resettle]'), function (b) {
      b.addEventListener('click', function () {
        var q = findQuestion(b.getAttribute('data-resettle'));
        if (!q || q.status !== 'settled') return;
        var opts = q.outcomes.map(function (o) {
          return o.id + ' = ' + o.label + (o.id === q.result ? '（当前结果）' : '');
        }).join('\n');
        var v = prompt('把「' + q.title + '」的结果改判为哪个？\n' + opts +
          '\n\n输入结果 id（如 yes）：');
        if (!v) return;
        v = v.trim();
        if (!q.outcomes.some(function (o) { return o.id === v; })) { alert('结果 id 不存在'); return; }
        if (v === q.result) { alert('与当前结果相同'); return; }
        doResettle(q, v, null);
      });
    });
  }

  /* ---------- 站长台：全局设置 ---------- */
  function renderAdminSettings() {
    var box = $('admin-settings');
    if (!box) return;
    var s = state.settings.site;
    var cfg = llmCfg();
    box.innerHTML =
      '<div class="card-title">全局设置（全站生效）</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>新玩家初始积分</label>' +
      '<input type="number" id="set-bonus" min="0" max="100000" value="' + s.opening_bonus + '"></div>' +
      '<div class="field"><label>默认抽水比例（0-0.5）</label>' +
      '<input type="number" id="set-fee" min="0" max="0.5" step="0.01" value="' + s.default_fee + '"></div>' +
      '<div class="field"><label>最低投注额</label>' +
      '<input type="number" id="set-minbet" min="1" max="100000" value="' + s.min_bet + '"></div>' +
      '</div>' +
      '<div class="field"><label>全站公告（留空不显示）</label>' +
      '<input type="text" id="set-announcement" maxlength="200" value="' + esc(s.announcement) + '" placeholder="如：今晚 8 点新题上线"></div>' +
      '<div class="admin-checks">' +
      '<label class="check-row"><input type="checkbox" id="set-accept" ' + (s.accept_new_bets ? 'checked' : '') + '> 接受新投注</label>' +
      '<label class="check-row"><input type="checkbox" id="set-maintenance" ' + (s.maintenance ? 'checked' : '') + '> 站务维护模式（全站暂停投注，显示公告）</label>' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-save-site" style="width:auto">保存全局设置</button>' +

      '<div class="card-title" style="margin-top:24px">借贷规则（全站生效）</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>初始信用额度</label>' +
      '<input type="number" id="set-credit-initial" min="0" max="100000" value="' + s.credit_initial + '"></div>' +
      '<div class="field"><label>还清一笔加额度</label>' +
      '<input type="number" id="set-credit-step" min="0" max="100000" value="' + s.credit_step + '"></div>' +
      '<div class="field"><label>额度上限</label>' +
      '<input type="number" id="set-credit-max" min="0" max="1000000" value="' + s.credit_max + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>额度下限</label>' +
      '<input type="number" id="set-credit-min" min="0" max="100000" value="' + s.credit_min + '"></div>' +
      '<div class="field"><label>每笔逾期扣额度</label>' +
      '<input type="number" id="set-overdue-penalty" min="0" max="100000" value="' + s.overdue_penalty + '"></div>' +
      '<div class="field"><label>最低借款额</label>' +
      '<input type="number" id="set-min-loan" min="1" max="100000" value="' + s.min_loan + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>借款利率（0-1）</label>' +
      '<input type="number" id="set-loan-rate" min="0" max="1" step="0.01" value="' + s.loan_rate + '"></div>' +
      '<div class="field"><label>借款期限（天）</label>' +
      '<input type="number" id="set-loan-term" min="1" max="365" value="' + s.loan_term_days + '"></div>' +
      '<div class="field"><label>逾期日罚息率（0-1）</label>' +
      '<input type="number" id="set-loan-late" min="0" max="1" step="0.001" value="' + s.loan_late_rate + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>负债强平标记线（负债/额度，仅记录不拦截）</label>' +
      '<input type="number" id="set-force-mult" min="1" max="100" step="0.1" value="' + s.force_mult + '"></div>' +
      '<div class="field"><label>破产保护线（净资产低于此值自动清零债务）</label>' +
      '<input type="number" id="set-force-net" min="-1000000" max="0" value="' + s.force_min_net + '"></div>' +
      '<div class="field"><label>&nbsp;</label>' +
      '<label class="check-row"><input type="checkbox" id="set-loan-enabled" ' + (s.loan_enabled ? 'checked' : '') + '> 开放借贷功能</label></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-save-loan" style="width:auto">保存借贷规则</button>' +

      '<div class="card-title" style="margin-top:24px">AI 判定配置（仅存本机，用于待揭晓队列的判定建议）</div>' +
      '<div class="field"><label>接口地址（OpenAI 兼容，如 https://api.deepseek.com/v1）</label>' +
      '<input type="text" id="set-llm-base" value="' + esc(cfg.baseUrl || '') + '" placeholder="https://api.deepseek.com/v1"></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>API Key</label>' +
      '<input type="password" id="set-llm-key" value="' + esc(cfg.key || '') + '" placeholder="sk-..."></div>' +
      '<div class="field"><label>模型名</label>' +
      '<input type="text" id="set-llm-model" value="' + esc(cfg.model || 'deepseek-chat') + '"></div>' +
      '</div>' +
      '<button class="btn" id="btn-save-llm" style="width:auto">保存 AI 配置</button>' +

      '<div class="card-title" style="margin-top:24px">数据与口令</div>' +
      '<div class="admin-checks">' +
      '<button class="btn" id="btn-export" style="width:auto">导出投注 CSV</button>' +
      '<button class="btn" id="btn-export-loans" style="width:auto">导出借贷 CSV</button>' +
      '<button class="btn" id="btn-export-evidence" style="width:auto">导出证据 CSV</button>' +
      '<button class="btn" id="btn-token" style="width:auto">修改站长口令</button>' +
      '<button class="btn" id="btn-lock" style="width:auto">锁定站长台</button>' +
      '</div>';

    on('btn-save-site', 'click', saveSiteSettings);
    on('btn-save-loan', 'click', saveLoanSettings);
    on('btn-save-llm', 'click', function () {
      localStorage.setItem(LLM_KEY, JSON.stringify({
        baseUrl: $('set-llm-base').value.trim(),
        key: $('set-llm-key').value.trim(),
        model: $('set-llm-model').value.trim() || 'deepseek-chat'
      }));
      alert('AI 配置已保存到本机');
    });
    on('btn-export', 'click', exportCSV);
    on('btn-export-loans', 'click', exportLoansCSV);
    on('btn-export-evidence', 'click', exportEvidenceCSV);
    on('btn-token', 'click', changeAdminToken);
    on('btn-lock', 'click', function () {
      state.adminUnlocked = false;
      localStorage.removeItem(ADMIN_KEY);
      renderAll();
    });
  }

  function saveSiteSettings() {
    var next = {
      opening_bonus: Math.floor(Number($('set-bonus').value) || 0),
      default_fee: Number($('set-fee').value),
      min_bet: Math.max(1, Math.floor(Number($('set-minbet').value) || 10)),
      announcement: $('set-announcement').value.trim(),
      accept_new_bets: $('set-accept').checked,
      maintenance: $('set-maintenance').checked,
      loan_enabled: $('set-loan-enabled').checked,
      credit_initial: Math.floor(Number($('set-credit-initial').value) || 0),
      credit_step: Math.floor(Number($('set-credit-step').value) || 0),
      credit_max: Math.floor(Number($('set-credit-max').value) || 0),
      credit_min: Math.floor(Number($('set-credit-min').value) || 0),
      overdue_penalty: Math.floor(Number($('set-overdue-penalty').value) || 0),
      min_loan: Math.max(1, Math.floor(Number($('set-min-loan').value) || 10)),
      loan_rate: Number($('set-loan-rate').value),
      loan_term_days: Math.max(1, Math.floor(Number($('set-loan-term').value) || 7)),
      loan_late_rate: Number($('set-loan-late').value),
      force_mult: Number($('set-force-mult').value),
      force_min_net: Number($('set-force-net').value)
    };
    withCloud(function () {
      return cloud.database.from('jp_settings')
        .update({ value: next, updated_by: state.nickname || 'admin', updated_at: new Date().toISOString() })
        .eq('key', 'site')
        .then(function (r) { if (r.error) throw new Error(r.error.message || '保存失败'); });
    });
  }

  /* 借贷规则单独保存（与全局设置同一行，拆开按钮） */
  function saveLoanSettings() { saveSiteSettings(); }

  function changeAdminToken() {
    var v = prompt('输入新的站长口令（建议 12 位以上，含字母数字）：');
    if (!v) return;
    v = v.trim();
    if (v.length < 8) { alert('口令至少 8 个字符'); return; }
    var hash = SHA256.sha256(v);
    withCloud(function () {
      return cloud.database.from('jp_settings')
        .update({ value: hash, updated_by: state.nickname || 'admin', updated_at: new Date().toISOString() })
        .eq('key', 'admin_token_hash')
        .then(function (r) { if (r.error) throw new Error(r.error.message || '修改失败'); });
    });
  }

  function exportCSV() {
    var csv = OnlineCore.csvOfBets(state.bets, state.questions);
    download(csv, 'mingjian-bets-' + new Date().toISOString().slice(0, 10) + '.csv');
  }
  function exportLoansCSV() {
    var csv = OnlineCore.csvOfLoans(state.loans, state.payments);
    download(csv, 'mingjian-loans-' + new Date().toISOString().slice(0, 10) + '.csv');
  }
  function exportEvidenceCSV() {
    var qmap = {};
    state.questions.forEach(function (q) { qmap[q.qid] = q.title; });
    var lines = ['问题,立场,标题,链接,摘要,提交者,UID,状态,赞,踩,已验证,提交时间'];
    state.evidence.forEach(function (e) {
      lines.push([
        qmap[e.qid] || e.qid, { yes: '支持', no: '反对', neutral: '中立' }[e.side] || e.side,
        e.title, e.url || '', e.summary || '', e.nickname, e.uid, e.status,
        e.votes_up || 0, e.votes_down || 0, e.validated ? '是' : '', e.created_at
      ].map(OnlineCore.csvCell).join(','));
    });
    download('\ufeff' + lines.join('\n'), 'mingjian-evidence-' + new Date().toISOString().slice(0, 10) + '.csv');
  }
  function download(text, name) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ---------- 视图切换 ---------- */
  function switchView(name) {
    state.view = name;
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('active', v.id === 'view-' + name);
    });
    renderAll();
  }

  /* ---------- 昵称 ---------- */
  function openNickModal() { $('nick-mask').classList.add('open'); }
  function closeNickModal() { $('nick-mask').classList.remove('open'); }
  function saveNick() {
    var v = $('nick-input').value.trim();
    if (v.length < 2 || v.length > 12) { alert('昵称需 2-12 个字符'); return; }
    state.nickname = v;
    localStorage.setItem(NICK_KEY, v);
    closeNickModal();
    renderAll();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    initCloud();
    state.uid = uid();
    state.nickname = localStorage.getItem(NICK_KEY) || '';
    state.adminUnlocked = localStorage.getItem(ADMIN_KEY) === '1';

    on('btn-nick', 'click', function () {
      $('nick-input').value = state.nickname;
      openNickModal();
    });
    on('btn-nick-save', 'click', saveNick);
    on('btn-create-q', 'click', createQuestion);
    on('q-mode', 'change', function () {
      $('q-odds-field').style.display = $('q-mode').value === 'fixed' ? '' : 'none';
    });
    /* 揭晓方式联动：公投才需要公投截止日；人工揭晓仅站长可选 */
    var manualOpt = $('q-settle-manual');
    if (manualOpt && !state.adminUnlocked) manualOpt.style.display = 'none';
    on('q-settle', 'change', function () {
      var isVote = $('q-settle').value === 'vote';
      $('q-vote-end-field').style.display = isVote ? '' : 'none';
      if (isVote && !$('q-vote-end').value && $('q-deadline').value) {
        $('q-vote-end').value = addDaysStr($('q-deadline').value, 7);
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });

    if (!state.nickname) {
      openNickModal();
    } else {
      closeNickModal();
    }
    refresh();
    setInterval(function () { if (!state.busy) refresh(); }, REFRESH_MS);
    /* 页面从后台切回时立即刷新（手机上切应用回来） */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !state.busy) refresh();
    });
  }

  return { init: init };
})();
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', OnlineApp.init);
}
