/* ============================================================
 * 明鉴 · 个人中心核心 v1.0（纯函数，无 DOM / 无云依赖）
 *
 * 定位：把「个人中心」需要的校验与统计从页面渲染里剥出来，
 *       让 online.js 只负责取数与画界面，口径计算可单测。
 *
 * 与其它模块的关系：
 *   - 资产口径**完全对齐** app/js/loans.js：
 *       cash    = opening_bonus + 投注盈亏 + 借款本金 − 已还款（cashOf）
 *       openStake = status=open 的投注质押合计（openStakeOf）
 *       debt    = status=open 的借款应还合计（debtOf / outstandingOf）
 *       netWorth = cash + openStake − debt（netWorthOf，天梯榜排序口径）
 *     为保持本文件零依赖，这三条公式在此重写了一份；改动时必须同步
 *     loans.js，否则个人中心的净资产会与天梯榜对不上。
 *   - 密码能力边界见 app/js/auth.js 顶部注释：密码只能在新号注册时设置。
 *
 * 加载方式：<script src="js/profile.js"> → window.ProfileCore
 *           node: require('./profile.js') → ProfileCore（仅做语法/单测）
 * ============================================================ */
var ProfileCore = (function () {
  'use strict';

  var PHONE_RE = /^1\d{10}$/;

  /* 与 auth.js / jp_profiles 的字段约束保持一致 */
  var NICK_MIN = 2;
  var NICK_MAX = 12;
  var BIO_MAX = 80;
  var PWD_MIN = 6;
  var PWD_MAX = 64;

  /* 与 loans.js 的默认值保持一致（未传 settings 时使用） */
  var OPENING_BONUS = 1000;
  var LATE_RATE = 0.01;

  /* 投注行里允许出现的 kind：非 'bet' 的是奖励/差额补退行（不计胜场） */
  var BET_KIND = 'bet';

  function round2(v) { return Math.round(v * 100) / 100; }
  function num(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : (dflt || 0);
  }
  function arr(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------
   * 密码强度
   * 返回 { ok, reason, strength }
   *   ok        —— 是否满足注册策略（6-64 位且字母+数字混合）
   *   reason    —— 不通过时的中文原因（通过时为 ''）
   *   strength  —— 0-4，仅用于进度条，不参与放行判断
   * 注意：登录侧不调用本函数（存量密码的组合规则不受当前策略约束），
   *       登录侧只校验长度，见 auth.js#loginPasswordError。
   * ------------------------------------------------------------ */
  function validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length === 0) {
      return { ok: false, reason: '请输入密码', strength: 0 };
    }
    var strength = strengthOf(pw);
    if (pw.length < PWD_MIN) {
      return { ok: false, reason: '密码至少 ' + PWD_MIN + ' 位', strength: strength };
    }
    if (pw.length > PWD_MAX) {
      return { ok: false, reason: '密码最多 ' + PWD_MAX + ' 位', strength: strength };
    }
    /* 纯数字 / 纯字母都拒绝：6 位纯数字（生日、手机尾号）撞库成本极低 */
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
      return { ok: false, reason: '密码需同时包含字母和数字', strength: strength };
    }
    return { ok: true, reason: '', strength: strength };
  }

  function strengthOf(pw) {
    var s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    var classes = 0;
    if (/[a-z]/.test(pw)) classes++;
    if (/[A-Z]/.test(pw)) classes++;
    if (/[0-9]/.test(pw)) classes++;
    if (/[^A-Za-z0-9]/.test(pw)) classes++;
    if (classes >= 3) s++;
    if (classes >= 4) s++;
    return Math.min(4, s);
  }

  /* ------------------------------------------------------------
   * 手机号脱敏：13800138000 → 138****8000
   * 非法输入返回 ''（调用方据此隐藏整行，而不是显示半截号码）
   * ------------------------------------------------------------ */
  function maskPhone(phone) {
    var p = str(phone).replace(/\s/g, '');
    if (!PHONE_RE.test(p)) return '';
    return p.slice(0, 3) + '****' + p.slice(7);
  }

  /* ------------------------------------------------------------
   * 档案补丁：只保留白名单字段（nickname / bio）
   *   - 其它键（uid、password_set、is_admin…）一律丢弃，防越权写
   *   - 去首尾空格；nickname 超界**丢弃该键**（不写坏数据，也不清空原值）
   *   - bio 超 80 字截断（简介是软性内容，截断比拒绝更友好）
   *   - 空字符串 bio 会被保留，用于「清空简介」
   * 返回的形状可直接喂给 cloud.database.from('jp_profiles').update(patch)
   * ------------------------------------------------------------ */
  function composeProfilePatch(src) {
    var patch = {};
    if (!src || typeof src !== 'object') return patch;

    if (typeof src.nickname === 'string') {
      var nick = src.nickname.trim();
      if (nick.length >= NICK_MIN && nick.length <= NICK_MAX) patch.nickname = nick;
    }
    if (typeof src.bio === 'string') {
      patch.bio = src.bio.trim().slice(0, BIO_MAX);
    }
    return patch;
  }

  /* ------------------------------------------------------------
   * 资产与战绩统计
   * @param data {bets, loans, payments, evidence, debates}
   * @param uid  本人 uid（与行上的 uid 字段比对）
   * @param opts {settings, now} —— 可选；settings 支持 {site:{...}} 或平铺
   * 返回 {bets, winRate, netWorth, openStake, debt, evidence, debates}
   * ------------------------------------------------------------ */
  function profileStats(data, uid, opts) {
    data = data || {};
    opts = opts || {};
    var now = opts.now == null ? Date.now() : opts.now;
    var cfg = (opts.settings && opts.settings.site) || opts.settings || {};
    var bonus = isFinite(Number(cfg.opening_bonus)) ? Number(cfg.opening_bonus) : OPENING_BONUS;
    var lateRate = isFinite(Number(cfg.loan_late_rate)) ? Number(cfg.loan_late_rate) : LATE_RATE;

    var me = uid == null ? '' : String(uid);

    var bets = arr(data.bets);
    var loans = arr(data.loans);
    var payments = arr(data.payments);

    var betCount = 0;
    var won = 0;
    var lost = 0;
    var openStake = 0;
    var betCash = 0;      /* 投注侧对现金的净影响（同 cashOf 的逐行累加） */

    bets.forEach(function (b) {
      if (!b || String(b.uid) !== me) return;
      var stake = num(b.stake);
      var status = b.status;
      /* cashOf 对所有行都扣 stake，won 再加 payout —— 逐行照抄 */
      betCash -= stake;
      if (status === 'won') betCash += num(b.payout);

      if (b.kind && b.kind !== BET_KIND) {
        /* 奖励/差额补退行：计入现金与在押，不计胜场 */
        if (status === 'open') openStake += stake;
        return;
      }
      betCount++;
      if (status === 'won') { won++; }
      else if (status === 'lost') { lost++; }
      else { openStake += stake; }
    });

    var borrowed = 0;
    loans.forEach(function (l) {
      if (!l || String(l.uid) !== me) return;
      borrowed += num(l.principal);   /* cashOf：借款到手，所有状态都算 */
    });

    var repaid = 0;
    payments.forEach(function (p) {
      if (!p || String(p.uid) !== me) return;
      repaid += num(p.amount);
    });

    var debt = 0;
    loans.forEach(function (l) {
      if (!l || String(l.uid) !== me) return;
      debt += outstandingOf(l, now, lateRate);
    });

    var cash = round2(bonus + betCash + borrowed - repaid);
    var settled = won + lost;

    return {
      bets: betCount,
      winRate: settled ? Math.round(won / settled * 100) : 0,
      netWorth: round2(cash + round2(openStake) - round2(debt)),
      openStake: round2(openStake),
      debt: round2(debt),
      evidence: countOwner(data.evidence, me),
      debates: countOwner(data.debates, me, true)
    };
  }

  /* 单笔借款的当前应还（principalLeft + interestLeft + lateLeft）
   * 对齐 loans.js#outstandingOf：罚息按本金 × 日罚率 × 逾期天数，已付罚息可抵 */
  function outstandingOf(loan, now, lateRate) {
    if (!loan || loan.status !== 'open') return 0;
    var principal = num(loan.principal);
    var principalLeft = Math.max(0, round2(principal - num(loan.repaid_principal)));
    var interestLeft = Math.max(0, round2(principal * num(loan.rate) - num(loan.repaid_interest)));
    var lateLeft = 0;
    if (loan.due_date) {
      var today = dateStr(now);
      var due = String(loan.due_date).slice(0, 10);
      var days = Math.round((new Date(today) - new Date(due)) / 86400000);
      if (days > 0) {
        var rate = num(loan.late_rate, lateRate) || lateRate;
        lateLeft = Math.max(0, round2(principal * rate * days - num(loan.late_fee)));
      }
    }
    return round2(principalLeft + interestLeft + lateLeft);
  }

  function dateStr(now) {
    var d = new Date(now);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* 证据/发言计数。jp_debates 的拥有者列是 creator_uid（见 02-rls-tighten.sql:106），
   * jp_evidence 是 uid；两个都认，避免因列名差异把统计算成 0。 */
  function countOwner(rows, me, preferCreator) {
    var list = arr(rows);
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) continue;
      var owner = preferCreator
        ? (r.creator_uid != null ? r.creator_uid : r.uid)
        : (r.uid != null ? r.uid : r.creator_uid);
      if (String(owner) === me) n++;
    }
    return n;
  }

  /* ------------------------------------------------------------
   * 账号徽标
   * @param profile {uid, nickname, phone, passwordSet?/password_set?}
   * @param ctx     {isAdmin, passwordSet}  —— 运行时状态优先于档案字段
   * 返回数组，顺序：站长 → 密码态 → 新用户
   * 「新用户」判定 = 昵称未设置（档案未完善）。不猜注册时间。
   * ------------------------------------------------------------ */
  function accountBadges(profile, ctx) {
    profile = profile || {};
    ctx = ctx || {};
    var out = [];

    if (ctx.isAdmin === true) out.push('站长');

    var pwdSet = ctx.passwordSet;
    if (pwdSet === undefined) pwdSet = profile.passwordSet;
    if (pwdSet === undefined) pwdSet = profile.password_set;
    out.push(pwdSet === true ? '已设密码' : '未设密码');

    if (!str(profile.nickname).trim()) out.push('新用户');
    return out;
  }

  /* ------------------------------------------------------------
   * 密码提示文案：必须如实区分两种情况。
   * 老账号无法补设密码是 SDK 契约的硬限制，不能写成「去设置里改」。
   * ------------------------------------------------------------ */
  function composePasswordHint(passwordSet) {
    if (passwordSet === true) {
      return '已设置密码：可用「手机号 + 密码」直接登录，也可以继续用短信验证码登录。';
    }
    return '未设置密码：本账号只能用短信验证码登录。密码仅能在注册新账号时设置，'
      + '老账号无法补设；如需密码登录，请用新手机号注册。';
  }

  return {
    PHONE_RE: PHONE_RE,
    NICK_MIN: NICK_MIN, NICK_MAX: NICK_MAX, BIO_MAX: BIO_MAX,
    PWD_MIN: PWD_MIN, PWD_MAX: PWD_MAX,
    validatePassword: validatePassword,
    maskPhone: maskPhone,
    composeProfilePatch: composeProfilePatch,
    profileStats: profileStats,
    accountBadges: accountBadges,
    composePasswordHint: composePasswordHint
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ProfileCore;
