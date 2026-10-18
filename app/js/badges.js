/* ============================================================
 * 明鉴 · 赛季徽章与预言家战报（BadgeCore 纯函数，单机/联机共用）
 * - 赛季：以 season.start 为起点、每 length_days 天一个赛季（默认 90 天）
 * - 徽章：全部由投注/借贷/证据/仲裁/对线数据计算，无需额外存储
 * - 战报：本赛季胜负、胜率、净积分、最佳/最差单场、连胜纪录、赛季榜
 * ============================================================ */
var BadgeCore = (function () {
  'use strict';

  var DAY = 86400000;

  /* ---------- 赛季 ---------- */
  var DEFAULT_SEASON = { start: '2026-10-18', length_days: 90, name: 'S' };

  function seasonCfgOf(settings) {
    var raw = (settings && settings.season) || {};
    var start = /^\d{4}-\d{2}-\d{2}$/.test(raw.start || '') ? raw.start : DEFAULT_SEASON.start;
    var len = Math.max(7, Math.min(365, Number(raw.length_days) || DEFAULT_SEASON.length_days));
    var name = String(raw.name || DEFAULT_SEASON.name).slice(0, 12);
    return { start: start, length_days: len, name: name };
  }

  function dateStr(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 时间戳所属赛季序号（从 0 开始；早于起点为负） */
  function seasonIndexOf(ts, cfg) {
    var t = ts ? new Date(ts).getTime() : Date.now();
    if (!isFinite(t)) t = Date.now();
    var start = new Date(cfg.start + 'T00:00:00').getTime();
    return Math.floor((t - start) / (cfg.length_days * DAY));
  }

  function seasonRange(idx, cfg) {
    var start = new Date(cfg.start + 'T00:00:00').getTime() + idx * cfg.length_days * DAY;
    return {
      index: idx,
      name: cfg.name + (idx + 1),
      start: dateStr(new Date(start)),
      end: dateStr(new Date(start + cfg.length_days * DAY)) /* 开区间端点 */
    };
  }

  function currentSeasonIndex(cfg, now) {
    return seasonIndexOf(now || Date.now(), cfg);
  }

  /* ---------- 徽章 ---------- */
  /* 徽章上下文：一次算清所有徽章需要的原始量 */
  function badgeContext(uid, data) {
    data = data || {};
    /* 只统计真实投注行：奖励（bonus）/ 质押（stake）等非投注行不计输赢 */
    var bets = (data.bets || []).filter(function (b) {
      return b.uid === uid && (!b.kind || b.kind === 'bet');
    });
    var loans = (data.loans || []).filter(function (l) { return l.uid === uid; });
    var payments = (data.payments || []).filter(function (p) { return p.uid === uid; });
    var evidence = (data.evidence || []).filter(function (e) { return e.uid === uid; });
    var votes = (data.disputeVotes || []).filter(function (v) { return v.uid === uid; });
    var posts = (data.debatePosts || []).filter(function (p) { return p.uid === uid; });

    var settled = bets.filter(function (b) { return b.status !== 'open'; });
    var won = settled.filter(function (b) { return b.status === 'won'; });
    var winRate = settled.length ? Math.round(won.length / settled.length * 100) : 0;

    /* 连胜：按揭晓时间排序后的尾部连胜 */
    var bySettle = settled.slice().sort(function (a, b) {
      return (a.settled_at || '') > (b.settled_at || '') ? 1 : -1;
    });
    var curStreak = 0, maxStreak = 0;
    bySettle.forEach(function (b) {
      if (b.status === 'won') { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak }
      else curStreak = 0;
    });

    /* 冷门命中：押中时下注赔率 ≥ 2.0 */
    var coldHit = won.some(function (b) { return Number(b.odds_at_bet) >= 2.0; });
    /* 单笔最大派彩 */
    var maxPayout = won.reduce(function (m, b) { return Math.max(m, Number(b.payout) || 0); }, 0);
    /* 累计派彩 */
    var totalPayout = won.reduce(function (s, b) { return s + (Number(b.payout) || 0); }, 0);

    /* 破产重生：有核销记录，且核销后又凭投注赚回 100+ */
    var writtenOff = loans.filter(function (l) { return l.status === 'written_off'; });
    var comeback = false;
    if (writtenOff.length) {
      var woAt = writtenOff.reduce(function (m, l) {
        var t = l.closed_at ? new Date(l.closed_at).getTime() : 0;
        return (!m || (t && t < m)) ? t : m;
      }, 0);
      var after = bets.filter(function (b) {
        return b.status === 'won' && b.settled_at && new Date(b.settled_at).getTime() > woAt;
      }).reduce(function (s, b) { return s + (Number(b.payout) || 0) - (Number(b.stake) || 0); }, 0);
      comeback = after >= 100;
    }

    var repaidCount = loans.filter(function (l) { return l.status === 'repaid'; }).length;
    var overdueEver = loans.some(function (l) {
      if (l.status === 'repaid' && Number(l.late_fee) > 0) return true;
      return l.status === 'open' && l.due_date && l.due_date < dateStr(new Date());
    });
    var evidenceAccepted = evidence.filter(function (e) { return e.status === 'accepted'; }).length;

    return {
      betCount: bets.length, settledCount: settled.length, wonCount: won.length,
      winRate: winRate, maxStreak: maxStreak, coldHit: coldHit,
      maxPayout: maxPayout, totalPayout: totalPayout,
      comeback: comeback, writtenOffCount: writtenOff.length,
      repaidCount: repaidCount, overdueEver: overdueEver,
      evidenceAccepted: evidenceAccepted, voteCount: votes.length, postCount: posts.length
    };
  }

  function prog(cur, target) {
    return {
      earned: cur >= target,
      progress: Math.max(0, Math.min(1, cur / target)),
      progressText: cur + ' / ' + target
    };
  }

  /* 徽章目录：全部可从上下文计算 */
  var BADGES = [
    { id: 'first_bet', name: '初试锋芒', icon: '🎯', desc: '下第一笔注', run: function (c) { return prog(c.betCount, 1); } },
    { id: 'ten_bets', name: '十搏九想', icon: '🔟', desc: '累计 10 笔投注', run: function (c) { return prog(c.betCount, 10); } },
    { id: 'veteran', name: '老手入场', icon: '🎓', desc: '累计 50 笔投注', run: function (c) { return prog(c.betCount, 50); } },
    { id: 'prophet', name: '神预言', icon: '🔮', desc: '已结算 ≥5 场且胜率 ≥70%',
      run: function (c) { var r = prog(c.settledCount, 5); r.earned = r.earned && c.winRate >= 70; r.progressText = c.settledCount + '/5 场 · 胜率 ' + c.winRate + '%'; return r; } },
    { id: 'cold_hunter', name: '冷门猎人', icon: '🐺', desc: '押中过下注赔率 ≥2.0 的选项',
      run: function (c) { return { earned: c.coldHit, progress: c.coldHit ? 1 : 0, progressText: c.coldHit ? '已达成' : '未达成' }; } },
    { id: 'streak5', name: '五连绝世', icon: '⚡', desc: '达成 5 连胜', run: function (c) { return prog(c.maxStreak, 5); } },
    { id: 'big_win', name: '一把回本', icon: '💰', desc: '单笔派彩 ≥ 500 分',
      run: function (c) { var r = prog(Math.round(c.maxPayout), 500); r.progressText = Math.round(c.maxPayout) + ' / 500 分'; return r; } },
    { id: 'comeback', name: '破产重生', icon: '🌱', desc: '触发破产保护后重新赚回 100 分',
      run: function (c) { return { earned: c.comeback, progress: c.comeback ? 1 : 0, progressText: c.comeback ? '已达成' : '未达成' }; } },
    { id: 'credit_ok', name: '有借有还', icon: '🤝', desc: '还清 3 笔借款', run: function (c) { return prog(c.repaidCount, 3); } },
    { id: 'punctual', name: '准时先生', icon: '⏰', desc: '借款 ≥3 笔且从未逾期',
      run: function (c) { var r = prog(c.repaidCount + 0, 3); r.earned = !c.overdueEver && c.repaidCount >= 3; r.progressText = c.overdueEver ? '有逾期记录' : (c.repaidCount + ' / 3 笔'); return r; } },
    { id: 'evidence_hunter', name: '证据猎人', icon: '🔍', desc: '3 条证据被采纳',
      run: function (c) { return prog(c.evidenceAccepted, 3); } },
    { id: 'juror', name: '陪审团员', icon: '⚖️', desc: '参与 5 次社区仲裁投票',
      run: function (c) { return prog(c.voteCount, 5); } },
    { id: 'debater', name: '对线选手', icon: '🎤', desc: '在对线房发言 5 次',
      run: function (c) { return prog(c.postCount, 5); } },
    { id: 'sharpshooter', name: '百发百中', icon: '🏹', desc: '已结算 ≥8 场且胜率 ≥80%',
      run: function (c) { var r = prog(c.settledCount, 8); r.earned = r.earned && c.winRate >= 80; r.progressText = c.settledCount + '/8 场 · 胜率 ' + c.winRate + '%'; return r; } }
  ];

  /* 全部徽章（含未获得，带进度） */
  function allBadges(uid, data) {
    var c = badgeContext(uid, data);
    return BADGES.map(function (b) {
      var r = b.run(c) || {};
      return {
        id: b.id, name: b.name, icon: b.icon, desc: b.desc,
        earned: !!r.earned, progress: r.progress || 0, progressText: r.progressText || ''
      };
    });
  }

  function earnedBadges(uid, data) {
    return allBadges(uid, data).filter(function (b) { return b.earned; });
  }

  /* ---------- 赛季战报 ---------- */
  function tsOf(t) { var v = t ? new Date(t).getTime() : 0; return isFinite(v) ? v : 0; }

  /* 投注时间戳 → 本地日期串（placed_at 是 UTC ISO，直接 slice 会在东八区错一天） */
  function localDayStr(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return dateStr(d);
  }

  /* 单个玩家的赛季统计 */
  function seasonStats(uid, data, cfg, now) {
    data = data || {};
    var idx = currentSeasonIndex(cfg, now);
    var range = seasonRange(idx, cfg);
    var from = range.start, to = range.end;
    var bets = (data.bets || []).filter(function (b) {
      if (b.uid !== uid || (b.kind && b.kind !== 'bet')) return false;
      var d = localDayStr(b.placed_at);
      return d >= from && d < to;
    });
    var settled = bets.filter(function (b) { return b.status !== 'open'; });
    var won = settled.filter(function (b) { return b.status === 'won'; });
    var net = bets.reduce(function (s, b) {
      return s + (b.status === 'won' ? (Number(b.payout) || 0) : 0) - (Number(b.stake) || 0);
    }, 0);
    /* 最佳/最差单场（按派彩−投入） */
    var best = null, worst = null;
    settled.forEach(function (b) {
      var q = (data.questions || []).filter(function (x) { return x.qid === b.qid; })[0];
      var d = (b.status === 'won' ? (Number(b.payout) || 0) : 0) - (Number(b.stake) || 0);
      var item = { qid: b.qid, title: q ? q.title : b.qid, delta: d, stake: Number(b.stake) };
      if (!best || d > best.delta) best = item;
      if (!worst || d < worst.delta) worst = item;
    });
    return {
      season: range, index: idx,
      betCount: bets.length, settledCount: settled.length,
      won: won.length, lost: settled.length - won.length,
      winRate: settled.length ? Math.round(won.length / settled.length * 100) : 0,
      net: Math.round(net * 10) / 10,
      best: best, worst: worst,
      badges: earnedBadges(uid, data).length
    };
  }

  /* 赛季榜：所有在本赛季有投注的玩家，按净积分排序 */
  function seasonBoard(data, cfg, now) {
    data = data || {};
    var idx = currentSeasonIndex(cfg, now);
    var range = seasonRange(idx, cfg);
    var from = range.start, to = range.end;
    var byUid = {};
    (data.bets || []).forEach(function (b) {
      if (b.kind && b.kind !== 'bet') return;
      var d = localDayStr(b.placed_at);
      if (!d || d < from || d >= to) return;
      var p = byUid[b.uid] || (byUid[b.uid] = { uid: b.uid, nickname: b.nickname, net: 0, won: 0, lost: 0, bets: 0 });
      p.bets++;
      p.net += (b.status === 'won' ? (Number(b.payout) || 0) : 0) - (Number(b.stake) || 0);
      if (b.status === 'won') p.won++;
      else if (b.status === 'lost') p.lost++;
    });
    var list = Object.keys(byUid).map(function (k) {
      var p = byUid[k];
      p.net = Math.round(p.net * 10) / 10;
      return p;
    });
    list.sort(function (a, b) { return b.net - a.net; });
    return { season: range, rows: list };
  }

  /* 与上赛季的净积分对比 */
  function seasonCompare(uid, data, cfg, now) {
    var cur = seasonStats(uid, data, cfg, now);
    var prevRange = seasonRange(cur.index - 1, cfg);
    var bets = (data.bets || []).filter(function (b) {
      if (b.uid !== uid || (b.kind && b.kind !== 'bet')) return false;
      var d = localDayStr(b.placed_at);
      return d >= prevRange.start && d < prevRange.end;
    });
    var prevNet = bets.reduce(function (s, b) {
      return s + (b.status === 'won' ? (Number(b.payout) || 0) : 0) - (Number(b.stake) || 0);
    }, 0);
    return {
      current: cur.net,
      previous: Math.round(prevNet * 10) / 10,
      previousSeason: prevRange.name,
      delta: Math.round((cur.net - prevNet) * 10) / 10,
      hasPrevious: bets.length > 0
    };
  }

  return {
    DEFAULT_SEASON: DEFAULT_SEASON, BADGES: BADGES,
    seasonCfgOf: seasonCfgOf, seasonIndexOf: seasonIndexOf, seasonRange: seasonRange,
    currentSeasonIndex: currentSeasonIndex,
    badgeContext: badgeContext, allBadges: allBadges, earnedBadges: earnedBadges,
    seasonStats: seasonStats, seasonBoard: seasonBoard, seasonCompare: seasonCompare
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BadgeCore;
}
