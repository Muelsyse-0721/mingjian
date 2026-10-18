/* ============================================================
 * 明鉴 · 月榜发放核心 v1.0（纯函数，无 DOM / 云依赖）
 *
 * 口径（详见各函数注释）：
 * - 榜单只统计「本月已结算」的投注行：
 *   kind 缺省或 ==='bet'，status ∈ {won, lost}，
 *   且 settled_at 落在当月的自然月（本地时区，与全站 todayStr 一致）；
 *   settled_at 缺失的历史行退化为 placed_at，避免旧数据漏榜。
 * - 盈亏 profit = Σ(payout − stake)；平局退款 status='won' 但 payout=stake，profit=0，不进榜。
 * - 奖励行（kind='bonus'）、调整行（kind='adjust'）、未结算行（open）一律忽略。
 * - 只保留 profit > 0 的玩家（默认），按 profit 降序。
 *
 * 发放：
 * - buildPayoutPlan 把站长给定的 totalAmount 按名次权重分给前 N 名；
 *   权重表 DEFAULT_WEIGHTS 按名次递减并归一化，各名次先向下取整，
 *   全部余数（含取整为 0 的名次）并入第 1 名 → 总和恰好等于 totalAmount。
 * - 积分仅为站内游戏分，不可充值 / 提现 / 转让 / 兑换真实货币。
 * ============================================================ */
var MonthlyCore = (function () {
  'use strict';

  /* 名次权重（第 1 名最高，依次递减）；超出表长的名次按 1 计 */
  var DEFAULT_WEIGHTS = [30, 20, 14, 10, 7, 5, 4, 3, 2, 1];
  var DEFAULT_TOP_N = 10;
  var POOL_REASON = 'monthly_reward';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function tsOf(v) {
    if (v == null || v === '') return NaN;
    var t = v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : new Date(v).getTime());
    return isFinite(t) ? t : NaN;
  }

  /* ---------- 月份 ---------- */
  /* monthKey(now) → '2026-10'（本地时区） */
  function monthKey(now) {
    var d = now == null ? new Date() : new Date(now);
    if (!isFinite(d.getTime())) d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  /* 时间戳是否落在 monthKey 指定的自然月内（本地时区） */
  function inMonth(ts, key) {
    var t = tsOf(ts);
    if (!isFinite(t)) return false;
    return monthKey(t) === key;
  }

  /* 上个月的 key（用于「上月榜」查看 / 月初补发） */
  function prevMonthKey(now) {
    var d = now == null ? new Date() : new Date(now);
    if (!isFinite(d.getTime())) d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  /* 该行是否算「已结算的正经投注」 */
  function isSettledBetRow(b) {
    if (!b || !b.uid) return false;
    if (b.kind && b.kind !== 'bet') return false;      /* bonus / adjust / 其它镜像行 */
    if (b.status !== 'won' && b.status !== 'lost') return false;
    return true;
  }

  /* 结算时间：settled_at 优先；缺失时退化到 placed_at（旧数据兼容） */
  function settleTimeOf(b) {
    var t = tsOf(b && b.settled_at);
    return isFinite(t) ? t : tsOf(b && b.placed_at);
  }

  /* ---------- 本月榜单 ---------- */
  /* monthlyRanking(bets, now, opts) →
   *   [{ uid, nickname, profit, bets, won, lost, staked, returned }]，profit 降序
   * opts.key          指定月份（默认 monthKey(now)）
   * opts.includeAll   true 时保留 profit ≤ 0 的玩家（默认 false）
   * opts.minBets      至少结算过几笔才进榜（默认 0） */
  function monthlyRanking(bets, now, opts) {
    opts = opts || {};
    var key = opts.key || monthKey(now);
    var minBets = Math.max(0, Math.floor(num(opts.minBets)));
    var byUid = {};

    (bets || []).forEach(function (b) {
      if (!isSettledBetRow(b)) return;
      var t = settleTimeOf(b);
      if (!inMonth(t, key)) return;
      var p = byUid[b.uid];
      if (!p) {
        p = byUid[b.uid] = {
          uid: b.uid, nickname: '', profit: 0, bets: 0, won: 0, lost: 0,
          staked: 0, returned: 0, lastAt: -Infinity
        };
      }
      var stake = num(b.stake);
      var payout = num(b.payout);
      p.profit += payout - stake;
      p.staked += stake;
      p.returned += payout;
      p.bets += 1;
      if (b.status === 'won') p.won += 1; else p.lost += 1;
      if (t >= p.lastAt && b.nickname) { p.lastAt = t; p.nickname = b.nickname; }
    });

    var list = Object.keys(byUid).map(function (k) {
      var p = byUid[k];
      delete p.lastAt;
      p.profit = Math.round(p.profit * 100) / 100;   /* 分是整数，双精度兜底 */
      p.staked = Math.round(p.staked * 100) / 100;
      p.returned = Math.round(p.returned * 100) / 100;
      return p;
    }).filter(function (p) {
      if (p.bets < minBets) return false;
      return opts.includeAll ? true : p.profit > 0;
    });

    list.sort(function (a, b) {
      if (b.profit !== a.profit) return b.profit - a.profit;
      if (b.bets !== a.bets) return b.bets - a.bets;
      return String(a.uid) < String(b.uid) ? -1 : 1;
    });
    list.forEach(function (p, i) { p.rank = i + 1; });
    return list;
  }

  /* ---------- 分钱 ---------- */
  /* buildPayoutPlan(ranking, totalAmount, opts) →
   *   [{ uid, nickname, rank, amount, profit }]
   * 规则：只取 profit > 0 的前 topN 名；权重归一化后按比例分，向下取整，
   *       余数并入第 1 名；金额为 0 的名次丢弃。合计 = floor(totalAmount)。
   * opts.topN    获奖人数上限（默认 10）
   * opts.weights 自定义名次权重数组（默认 DEFAULT_WEIGHTS）
   * opts.key     冗余挂在结果上的月份标记（可选，便于宿主回显） */
  function buildPayoutPlan(ranking, totalAmount, opts) {
    opts = opts || {};
    var total = Math.floor(num(totalAmount));
    var plan = [];
    if (!(total > 0)) return plan;

    var topN = Math.floor(num(opts.topN));
    if (!(topN > 0)) topN = DEFAULT_TOP_N;
    var weights = (opts.weights && opts.weights.length) ? opts.weights : DEFAULT_WEIGHTS;

    var winners = (ranking || []).filter(function (p) {
      return p && p.uid && num(p.profit) > 0;
    }).slice(0, topN);
    if (!winners.length) return plan;

    var w = winners.map(function (p, i) {
      var v = num(weights[i]);
      return v > 0 ? v : 1;
    });
    var sumW = w.reduce(function (s, x) { return s + x; }, 0);

    var used = 0;
    winners.forEach(function (p, i) {
      var amount = Math.floor(total * w[i] / sumW);
      if (amount <= 0) return;
      used += amount;
      plan.push({
        uid: p.uid,
        nickname: p.nickname || '',
        rank: i + 1,
        amount: amount,
        profit: num(p.profit)
      });
    });

    /* 余数（取整损耗 + 被丢弃的 0 元名次）全部给第一名 */
    if (plan.length) {
      plan[0].amount += total - used;
    }
    return plan;
  }

  /* planTotal(plan) → 计划发放总额 */
  function planTotal(plan) {
    return (plan || []).reduce(function (s, p) { return s + Math.floor(num(p && p.amount)); }, 0);
  }

  /* ---------- 校验 ---------- */
  /* validatePlan(plan, balance) → { ok, error, total, balance }
   * 硬约束：发行总额不得超过公共奖池余额；单项金额必须为正整数。 */
  function validatePlan(plan, balance) {
    var bal = Math.floor(num(balance));
    var total = planTotal(plan);
    var out = { ok: false, error: '', total: total, balance: bal };

    if (!plan || !plan.length) { out.error = '没有可发放的获奖记录'; return out; }
    for (var i = 0; i < plan.length; i++) {
      var p = plan[i] || {};
      if (!p.uid) { out.error = '第 ' + (i + 1) + ' 条缺少 uid'; return out; }
      var amt = num(p.amount);
      if (!(amt > 0)) { out.error = '第 ' + (i + 1) + ' 条金额需大于 0'; return out; }
      if (Math.floor(amt) !== amt) { out.error = '第 ' + (i + 1) + ' 条金额需为整数分'; return out; }
    }
    if (total > bal) {
      out.error = '发放总额 ' + total + ' 分超过奖池余额 ' + bal + ' 分';
      return out;
    }
    out.ok = true;
    return out;
  }

  /* ---------- 组装写库行 ---------- */
  /* composeRewardRows(plan, key, now, opts) → [{ bonusRow, poolRow }]
   * bonusRow → insert 到 jp_bets（kind='bonus'，stake=0，payout=奖励分）
   * poolRow  → insert 到 jp_prize_pool_log（amount 为负数=出池）
   * 宿主须「先 bonusRow 再 poolRow」，与既有 grantPoolReward 的写法一致。
   * opts.actorUid 记入奖池流水的操作人（站长 uid） */
  function composeRewardRows(plan, key, now, opts) {
    opts = opts || {};
    var month = key || monthKey(now);
    var at = (function () {
      var t = tsOf(now);
      return new Date(isFinite(t) ? t : Date.now()).toISOString();
    })();
    var qid = 'monthly-' + month;
    var rows = [];

    (plan || []).forEach(function (p) {
      var amount = Math.floor(num(p && p.amount));
      if (!p || !p.uid || !(amount > 0)) return;
      rows.push({
        bonusRow: {
          qid: qid,
          uid: p.uid,
          nickname: p.nickname || '',
          outcome_id: 'monthly',
          stake: 0,
          odds_at_bet: 0,
          status: 'won',
          kind: 'bonus',
          payout: amount,
          placed_at: at,
          settled_at: at
        },
        poolRow: {
          amount: -amount,
          reason: POOL_REASON,
          ref_event: month,
          actor_uid: opts.actorUid || '',
          meta: {
            month: month,
            uid: p.uid,
            rank: num(p.rank),
            amount: amount,
            profit: num(p.profit)
          }
        }
      });
    });
    return rows;
  }

  /* ---------- 月初待发放判定（只读提示，不触发任何写操作） ---------- */
  /* alreadyDistributed(logs, key) → boolean
   * logs：jp_prize_pool_log 的行（至少含 reason / ref_event）。
   * 判定口径与 composeRewardRows 落库的 poolRow 严格一致：
   *   reason === 'monthly_reward' && ref_event === key
   * 同月发放多人会留下多行，只要存在一行即视为「该月已发」。 */
  function alreadyDistributed(logs, key) {
    var k = (key == null) ? '' : String(key);
    if (!k) return false;
    return (logs || []).some(function (r) {
      return !!r && r.reason === POOL_REASON && String(r.ref_event) === k;
    });
  }

  /* autoHint(logs, now) → { due, key }
   * key = 上月 key；due = 上月榜尚未发放。
   * 仅用于站长台「上月榜待发放」提示与按钮高亮，
   * 是否真的发钱仍由站长手动确认后调用既有发放流程。 */
  function autoHint(logs, now) {
    var key = prevMonthKey(now);
    return { due: !alreadyDistributed(logs, key), key: key };
  }

  return {
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
    DEFAULT_TOP_N: DEFAULT_TOP_N,
    POOL_REASON: POOL_REASON,
    monthKey: monthKey,
    prevMonthKey: prevMonthKey,
    inMonth: inMonth,
    isSettledBetRow: isSettledBetRow,
    monthlyRanking: monthlyRanking,
    buildPayoutPlan: buildPayoutPlan,
    planTotal: planTotal,
    validatePlan: validatePlan,
    composeRewardRows: composeRewardRows,
    alreadyDistributed: alreadyDistributed,
    autoHint: autoHint
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MonthlyCore;
}
