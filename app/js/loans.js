/* ============================================================
 * 明鉴 · 借贷核心 v1.0（纯函数，无 DOM / 云依赖，单机与联机共用）
 *
 * 规则（产品命名「信用额度」，非真实借贷）：
 * - 资格：任何人、任何状态可借（含负债中）；借款即时到账
 * - 额度：初始 credit_initial；每还清一笔 +credit_step；
 *         每笔当前逾期 −overdue_penalty；范围 [credit_min, credit_max]
 * - 计息：借款时一次性算出到期利息 interest = principal × loan_rate
 * - 逾期：每天按「本金」的 loan_late_rate 累计罚息（已付罚息可抵扣）
 * - 还款：随时可还，分配顺序 罚息 → 利息 → 本金；派彩不自动扣
 * - 强平线：负债 > 额度 × force_mult 时记强平标记（仅提示，不拦截投注）
 * - 破产保护：净资产 < force_min_net 时自动核销全部未清借款：
 *   状态置 written_off，债务清零、记录留存；本金仍计入现金（钱确实到过账）
 * - 净资产 = 现金 + 在押 − 负债；天梯榜按净资产排名
 * - 利息池：全部已收利息+罚息归平台池，由站长划入问题初始池（公示用途）
 * ============================================================ */
var LoanCore = (function () {
  'use strict';

  var DEFAULTS = {
    loan_enabled: true,
    credit_initial: 3000,
    credit_step: 500,
    credit_max: 30000,
    credit_min: 500,
    overdue_penalty: 500,
    loan_rate: 0.08,
    loan_term_days: 7,
    loan_late_rate: 0.02,
    force_mult: 1.5,
    force_min_net: -3000,
    min_loan: 10
  };

  function round2(v) { return Math.round(v * 100) / 100; }

  /* settings 既接受 {site:{...}} 也接受平铺对象 */
  function params(settings) {
    var raw = (settings && settings.site) || settings || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = Number(raw[k]);
      out[k] = isFinite(v) && raw[k] !== '' && raw[k] != null ? v : DEFAULTS[k];
    });
    out.loan_enabled = raw.loan_enabled === undefined ? true : !!raw.loan_enabled;
    return out;
  }

  /* ---------- 日期 ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr(now) {
    var d = new Date(now || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDaysStr(days, now) {
    var d = new Date(now || Date.now());
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function daysBetween(fromStr, toStr) {
    return Math.round((new Date(toStr) - new Date(fromStr)) / 86400000);
  }

  /* ---------- 状态 ---------- */
  function isOverdue(loan, now) {
    return !!loan && loan.status === 'open' && loan.due_date < todayStr(now);
  }
  function daysOverdue(loan, now) {
    return isOverdue(loan, now) ? daysBetween(loan.due_date, todayStr(now)) : 0;
  }
  function dueInterestOf(loan) {
    return round2(Number(loan.principal) * Number(loan.rate));
  }

  /* 当前应还：未还本金 + 未付利息 + 未付罚息（罚息按本金×日罚息率×逾期天，已付可抵） */
  function outstandingOf(loan, now) {
    var zero = { principalLeft: 0, interestLeft: 0, lateLeft: 0, base: 0, total: 0 };
    if (!loan || loan.status !== 'open') return zero;
    var principalLeft = Math.max(0, round2(Number(loan.principal) - Number(loan.repaid_principal || 0)));
    var interestLeft = Math.max(0, round2(dueInterestOf(loan) - Number(loan.repaid_interest || 0)));
    var lateTotal = round2(Number(loan.principal) * Number(loan.late_rate || params().loan_late_rate) * daysOverdue(loan, now));
    var lateLeft = Math.max(0, round2(lateTotal - Number(loan.late_fee || 0)));
    var base = round2(principalLeft + interestLeft);
    return {
      principalLeft: principalLeft, interestLeft: interestLeft, lateLeft: lateLeft,
      base: base, total: round2(base + lateLeft)
    };
  }

  function debtOf(uid, loans, now) {
    return round2((loans || []).reduce(function (s, l) {
      return (l.uid === uid && l.status === 'open') ? s + outstandingOf(l, now).total : s;
    }, 0));
  }

  /* ---------- 信用额度 ---------- */
  function creditLimitOf(uid, loans, settings) {
    var p = params(settings);
    var repaid = 0, overdue = 0;
    (loans || []).forEach(function (l) {
      if (l.uid !== uid) return;
      if (l.status === 'repaid') repaid++;
      else if (isOverdue(l)) overdue++;
    });
    var limit = p.credit_initial + repaid * p.credit_step - overdue * p.overdue_penalty;
    return Math.max(p.credit_min, Math.min(p.credit_max, limit));
  }

  /* 可借检查：amount 为空时只查状态 */
  function canBorrowOf(uid, amount, bets, loans, settings, now) {
    var p = params(settings);
    var limit = creditLimitOf(uid, loans, settings);
    var debt = debtOf(uid, loans, now);
    var available = round2(Math.max(0, limit - debt));
    var out = { ok: false, reason: '', limit: limit, debt: debt, available: available, interest: 0, dueDate: '' };
    if (!p.loan_enabled) { out.reason = '站长已关闭借贷功能'; return out; }
    if (amount == null || amount === '') return out;
    amount = Math.floor(Number(amount));
    if (!(amount >= p.min_loan)) { out.reason = '单笔借款最少 ' + p.min_loan + ' 分'; return out; }
    if (amount > available) { out.reason = '可用额度不足：当前可借 ' + Math.floor(available) + ' 分'; return out; }
    out.ok = true;
    out.interest = round2(amount * p.loan_rate);
    out.dueDate = addDaysStr(p.loan_term_days, now);
    return out;
  }

  /* ---------- 还款分配：罚息 → 利息 → 本金 ---------- */
  function repayPlan(loan, amount, now) {
    var o = outstandingOf(loan, now);
    amount = round2(Math.max(0, Number(amount)));
    var latePart = round2(Math.min(amount, o.lateLeft));
    var rest = round2(amount - latePart);
    var intPart = round2(Math.min(rest, o.interestLeft));
    var principalPart = round2(Math.min(round2(rest - intPart), o.principalLeft));
    return {
      late: latePart, interest: intPart, principal: principalPart,
      total: round2(latePart + intPart + principalPart),
      remaining: round2(o.total - (latePart + intPart + principalPart))
    };
  }

  /* 应用一笔还款到 loan 对象（改 status/repaid_*；closeAt 传 ISO 串） */
  function applyRepayment(loan, plan, closeAt) {
    loan.repaid_principal = round2(Number(loan.repaid_principal || 0) + plan.principal);
    loan.repaid_interest = round2(Number(loan.repaid_interest || 0) + plan.interest);
    loan.late_fee = round2(Number(loan.late_fee || 0) + plan.late);
    if (round2(Number(loan.principal) - loan.repaid_principal) <= 0 &&
        round2(dueInterestOf(loan) - loan.repaid_interest) <= 0) {
      loan.status = 'repaid';
      loan.closed_at = closeAt || new Date().toISOString();
    }
    return loan;
  }

  /* ---------- 资产 ---------- */
  /* 现金 = 初始赠送 + 投注盈亏 + 借款到手 − 已还款 */
  function cashOf(uid, bets, loans, payments, settings) {
    var s = (settings && settings.site) || settings || {};
    var bonus = isFinite(Number(s.opening_bonus)) ? Number(s.opening_bonus) : 1000;
    var v = bonus;
    (bets || []).forEach(function (b) {
      if (b.uid !== uid) return;
      v -= Number(b.stake);
      if (b.status === 'won') v += Number(b.payout);
    });
    (loans || []).forEach(function (l) { if (l.uid === uid) v += Number(l.principal); });
    (payments || []).forEach(function (p) { if (p.uid === uid) v -= Number(p.amount); });
    return round2(v);
  }
  function openStakeOf(uid, bets) {
    return round2((bets || []).reduce(function (s, b) {
      return (b.uid === uid && b.status === 'open') ? s + Number(b.stake) : s;
    }, 0));
  }
  function netWorthOf(uid, bets, loans, payments, settings, now) {
    return round2(cashOf(uid, bets, loans, payments, settings) +
      openStakeOf(uid, bets) - debtOf(uid, loans, now));
  }

  /* 强平线（负债侧）：负债 > 额度 × force_mult 时记强平标记（不再禁止投注，见破产保护） */
  function isLiquidated(uid, bets, loans, payments, settings, now) {
    var p = params(settings);
    var debt = debtOf(uid, loans, now);
    var limit = creditLimitOf(uid, loans, settings);
    return debt > limit * p.force_mult;
  }

  /* 破产保护：净资产跌破 force_min_net 时自动清零全部债务，从头再来 */
  function isBankrupt(uid, bets, loans, payments, settings, now) {
    var p = params(settings);
    return netWorthOf(uid, bets, loans, payments, settings, now) < p.force_min_net;
  }

  function summaryOf(uid, bets, loans, payments, settings, now) {
    var limit = creditLimitOf(uid, loans, settings);
    var debt = debtOf(uid, loans, now);
    var open = (loans || []).filter(function (l) { return l.uid === uid && l.status === 'open'; });
    var overdue = open.filter(function (l) { return isOverdue(l, now); }).length;
    var repaid = (loans || []).filter(function (l) { return l.uid === uid && l.status === 'repaid'; }).length;
    return {
      limit: limit, debt: debt,
      available: round2(Math.max(0, limit - debt)),
      openCount: open.length, overdueCount: overdue, repaidCount: repaid,
      liquidated: isLiquidated(uid, bets, loans, payments, settings, now),
      bankrupt: isBankrupt(uid, bets, loans, payments, settings, now),
      cash: cashOf(uid, bets, loans, payments, settings),
      netWorth: netWorthOf(uid, bets, loans, payments, settings, now)
    };
  }

  /* ---------- 利息池 ---------- */
  /* 利息池总额 = 全部已收利息 + 罚息 */
  function interestPoolOf(payments) {
    return round2((payments || []).reduce(function (s, p) {
      return s + Number(p.interest_part || 0) + Number(p.late_part || 0);
    }, 0));
  }
  /* 可分配余额 = 利息池 − 已划出（allocLog: [{qid, amount, ts, by}]） */
  function interestBalanceOf(payments, allocLog) {
    return round2(Math.max(0, interestPoolOf(payments) - (allocLog || []).reduce(function (s, a) {
      return s + Number(a.amount || 0);
    }, 0)));
  }

  /* ---------- 天梯榜（按净资产排名，含负债列） ---------- */
  function leaderboard(bets, loans, payments, settings, now) {
    var s = (settings && settings.site) || settings || {};
    var bonus = isFinite(Number(s.opening_bonus)) ? Number(s.opening_bonus) : 1000;
    var byUid = {};
    function player(uid, nickname, ts) {
      var p = byUid[uid];
      if (!p) {
        p = byUid[uid] = {
          uid: uid, nickname: nickname, staked: 0, recovered: 0, openStake: 0,
          won: 0, lost: 0, borrowed: 0, repaid: 0, lastAt: 0
        };
      }
      if (ts > p.lastAt) { p.lastAt = ts; p.nickname = nickname; }
      return p;
    }
    function tsOf(t) { var v = t ? new Date(t).getTime() : 0; return isFinite(v) ? v : 0; }
    (bets || []).forEach(function (b) {
      var p = player(b.uid, b.nickname, tsOf(b.placed_at));
      /* 奖励/差额补退（kind=bonus/adjust）：计入现金，不计胜场；
       * 质押（kind=stake）未结算：计入在押，让榜单净资产与玩家视角一致 */
      if (b.kind && b.kind !== 'bet') {
        if (b.status === 'won') { p.recovered += Number(b.payout); }
        else if (b.status === 'open') { p.openStake += Number(b.stake); }
        return;
      }
      p.staked += Number(b.stake);
      if (b.status === 'won') { p.recovered += Number(b.payout); p.won += 1; }
      else if (b.status === 'lost') { p.lost += 1; }
      else { p.openStake += Number(b.stake); }
    });
    (loans || []).forEach(function (l) {
      player(l.uid, l.nickname, tsOf(l.created_at));
      byUid[l.uid].borrowed += Number(l.principal);
    });
    (payments || []).forEach(function (pm) {
      var l = (loans || []).filter(function (x) { return x.lid === pm.lid; })[0];
      player(pm.uid, l ? l.nickname : '', tsOf(pm.paid_at));
      byUid[pm.uid].repaid += Number(pm.amount);
    });
    var list = Object.keys(byUid).map(function (k) {
      var p = byUid[k];
      p.betNet = round2(p.recovered - p.staked);
      p.cash = round2(bonus + p.betNet + p.borrowed - p.repaid);
      p.debt = debtOf(p.uid, loans, now);
      p.netWorth = round2(p.cash + p.openStake - p.debt);
      p.total = p.netWorth; /* 榜单口径 = 净资产 */
      p.settled = p.won + p.lost;
      p.winRate = p.settled ? Math.round(p.won / p.settled * 100) : 0;
      return p;
    });
    list.sort(function (a, b) { return b.total - a.total; });
    return list;
  }

  /* ---------- 流水（含借款/还款行，倒序） ---------- */
  function myLedger(uid, bets, questions, loans, payments, settings) {
    var s = (settings && settings.site) || settings || {};
    var bonus = isFinite(Number(s.opening_bonus)) ? Number(s.opening_bonus) : 1000;
    var qmap = {};
    (questions || []).forEach(function (q) { qmap[q.qid] = q; });
    var rows = [];
    function ts(t) { var v = t ? new Date(t).getTime() : 0; return isFinite(v) ? v : 0; }
    (bets || []).forEach(function (b) {
      if (b.uid !== uid) return;
      /* 对线房押注镜像行：qid=debate-<did>，outcome_id=a/b */
      if (b.qid && b.qid.indexOf('debate-') === 0) {
        var sideName = b.outcome_id === 'a' ? '甲方' : '乙方';
        rows.push({ ts: ts(b.placed_at), type: 'stake', amount: -Number(b.stake),
          note: '对线房押注 · ' + sideName + ' · ' + b.qid.slice(7) });
        if (b.status === 'won') {
          rows.push({ ts: ts(b.settled_at || b.placed_at), type: 'payout', amount: Number(b.payout),
            note: '对线房派彩 · ' + sideName + ' · ' + b.qid.slice(7) });
        }
        return;
      }
      /* 仲裁质押行：qid=dispute-<id>，outcome_id=agree/reject。
       * 质押时扣现金（不计在押展示外），结算时押对边分走押错边的质押 */
      if (b.qid && b.qid.indexOf('dispute-') === 0) {
        var did = b.qid.slice(8);
        rows.push({ ts: ts(b.placed_at), type: 'stake', amount: -Number(b.stake),
          note: '仲裁质押 · 争议 #' + did + ' · ' + (b.outcome_id === 'agree' ? '同意改判' : '维持原判') });
        if (b.status === 'won' && Number(b.payout) > Number(b.stake)) {
          rows.push({ ts: ts(b.settled_at || b.placed_at), type: 'payout',
            amount: round2(Number(b.payout) - Number(b.stake)),
            note: '仲裁派彩 · 争议 #' + did + ' · 押对边' });
        } else if (b.status === 'won') {
          rows.push({ ts: ts(b.settled_at || b.placed_at), type: 'payout', amount: 0,
            note: '仲裁质押退回 · 争议 #' + did });
        } else if (b.status === 'lost') {
          rows.push({ ts: ts(b.settled_at || b.placed_at), type: 'lost', amount: 0,
            note: '仲裁质押罚没 · 争议 #' + did + ' · 押错边' });
        }
        return;
      }
      var q = qmap[b.qid] || { title: b.qid };
      /* 奖励（证据命中）/ 差额补退（仲裁改判）/ 商城·VIP·奖池·月榜：
       * stake=0，只体现 payout 差额；文案按 qid 前缀区分来源 */
      if (b.kind === 'bonus' || b.kind === 'adjust' || b.kind === 'shop') {
        rows.push({ ts: ts(b.settled_at || b.placed_at), type: b.kind,
          amount: Number(b.payout) - Number(b.stake),
          note: ledgerLabelOf(b, q.title) });
        return;
      }
      rows.push({ ts: ts(b.placed_at), type: 'stake', amount: -Number(b.stake),
        note: '下注 · ' + q.title + ' → ' + outcomeLabelOf(q, b.outcome_id) });
      if (b.status === 'won') {
        rows.push({ ts: ts(b.settled_at || b.placed_at), type: 'payout', amount: Number(b.payout),
          note: '派彩 · ' + q.title + ' → ' + outcomeLabelOf(q, b.outcome_id) });
      }
    });
    (loans || []).forEach(function (l) {
      if (l.uid !== uid) return;
      rows.push({ ts: ts(l.created_at), type: 'loan', amount: Number(l.principal),
        note: '借款 · 到期 ' + l.due_date + ' · 利息 ' + dueInterestOf(l) +
          (l.status === 'written_off' ? ' · 破产保护已核销' : '') });
    });
    (payments || []).forEach(function (pm) {
      if (pm.uid !== uid) return;
      rows.push({ ts: ts(pm.paid_at), type: 'repay', amount: -Number(pm.amount),
        note: '还款 · 本金 ' + (pm.principal_part || 0) + ' / 利息 ' + (pm.interest_part || 0) +
          (Number(pm.late_part) ? ' / 罚息 ' + pm.late_part : '') });
    });
    rows.sort(function (a, b) { return b.ts - a.ts; });
    var running = bonus;
    rows.forEach(function (r) { running += r.amount; r.balanceAfter = round2(running); });
    return rows;
  }

  /* 非投注流水行的展示文案：平台行（商城/VIP/奖池/月榜）无题目，
   * 只显示来源，避免把内部 qid 暴露到流水里 */
  function ledgerLabelOf(b, title) {
    var qid = String(b.qid || '');
    if (qid.indexOf('store-') === 0) return '商城消费';
    if (qid.indexOf('vip-') === 0) return 'VIP 购买';
    if (qid.indexOf('pool-') === 0) return '奖池奖励';
    if (qid.indexOf('monthly-') === 0) return '月榜奖励';
    var label = b.kind === 'shop' ? '商城/VIP 消费'
      : b.kind === 'bonus' ? '奖励' : '差额补退';
    return title ? label + ' · ' + title : label;
  }

  function outcomeLabelOf(q, oid) {
    var o = (q.outcomes || []).filter(function (x) { return x.id === oid; })[0];
    return o ? o.label : oid;
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvOfLoans(loans, payments) {
    var lines = ['借款号,玩家,UID,本金,利率,期限天,到期日,状态,已还本金,已付利息,已付罚息,放款时间,结清时间'];
    (loans || []).forEach(function (l) {
      lines.push([l.lid, l.nickname, l.uid, l.principal, l.rate, l.term_days, l.due_date,
        l.status, l.repaid_principal || 0, l.repaid_interest || 0, l.late_fee || 0,
        l.created_at, l.closed_at || ''].map(csvCell).join(','));
    });
    lines.push('');
    lines.push('还款时间,借款号,UID,金额,本金部分,利息部分,罚息部分');
    (payments || []).forEach(function (p) {
      lines.push([p.paid_at, p.lid, p.uid, p.amount, p.principal_part || 0,
        p.interest_part || 0, p.late_part || 0].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\n');
  }

  return {
    DEFAULTS: DEFAULTS, params: params,
    todayStr: todayStr, addDaysStr: addDaysStr, daysBetween: daysBetween,
    isOverdue: isOverdue, daysOverdue: daysOverdue, dueInterestOf: dueInterestOf,
    outstandingOf: outstandingOf, debtOf: debtOf,
    creditLimitOf: creditLimitOf, canBorrowOf: canBorrowOf,
    repayPlan: repayPlan, applyRepayment: applyRepayment,
    cashOf: cashOf, openStakeOf: openStakeOf, netWorthOf: netWorthOf,
    isLiquidated: isLiquidated, isBankrupt: isBankrupt, summaryOf: summaryOf,
    interestPoolOf: interestPoolOf, interestBalanceOf: interestBalanceOf,
    leaderboard: leaderboard, myLedger: myLedger,
    csvOfLoans: csvOfLoans, round2: round2
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoanCore;
}
