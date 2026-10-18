/* ============================================================
 * 明鉴 · 反作弊 / 投票资格前置校验模块（antifraud.js）
 * ------------------------------------------------------------
 * 定位：本文件是一个【独立】模块，只做「客户端前置校验」与
 *       「可选的 Turnstile 人机验证接入缝」。它不负责真正的数据
 *       写入，也不实现或调用任何外部验证码服务（默认关闭）。
 *
 * 架构现实（务必理解）：
 *   - 没有自定义后端服务器。云端数据库（genie-baas）+ 行级安全
 *     (RLS) 就是「服务器」。
 *   - 电话登录（cloud.auth）为每一个真实手机号提供一个稳定的
 *     auth.uid。这正是「一人一票」的主身份锚点：
 *         一个手机号  →  一个 auth.uid  →  一票
 *   - 真正的「一人一票」硬保证在数据库层：agent B 会在
 *     jp_public_votes 和 jp_dispute_votes 上建立
 *     UNIQUE(uid, qid) 唯一约束。重复投票会在写入时由数据库
 *     直接拒绝。
 *   - 本模块的 enforceVoteEligibility 是「客户端前置门禁」：
 *     在真正发起写请求之前，先把「匿名/游客」挡在门外，避免
 *     无意义的请求与糟糕的 UX，同时给出清晰的中文提示。它
 *     *不* 自行实现唯一性——那是服务端（RLS/DB）的职责。
 *
 * 关于验证码（CAPTCHA / Turnstile）：
 *   - 默认【关闭】。不要为了防作弊而匆忙上通用验证码——它会
 *     伤害正常用户的体验（UX）。
 *   - 仅当在「高滥用面」上观察到真实滥用后，才应打开 Turnstile：
 *       高滥用面 = createQuestion（出题）、createDispute（发起争议）、
 *                  publicVote（公众投票）、disputeVote（争议投票）
 *   - 本模块只暴露接入缝（needsChallenge / verifyChallenge），
 *     默认 enabled:false，绝不主动发起任何外部验证码网络请求。
 *     verifyChallenge 的真正校验必须由服务端（verifyUrl）完成，
 *     且只有在滥用确实出现时才去接线。
 *
 * 与 online.js 的关系：Phase 2 由 online.js 在写库前调用本模块。
 *   本文件【不】修改 online.js 或其它现存文件。
 *
 * 暴露全局 AntiFraud：
 *   configure(options)              配置（含 turnstile 开关）
 *   getConfig()                     读取当前配置
 *   resolveUid(uid)                 解析当前操作身份（param > Auth）
 *   enforceVoteEligibility(uid,ctx) 投票/出题资格前置校验 → {ok,error?}
 *   needsChallenge(surface)         该面是否需要人机验证（默认 false）
 *   verifyChallenge(token,surface)  验证缝（默认跳过，不联网）
 * ============================================================ */
var AntiFraud = (function () {
  'use strict';

  /* 通过 typeof 守卫引用全局 Auth，避免未加载时报错。 */
  var AuthModule = (typeof Auth !== 'undefined') ? Auth : null;

  /* 模块级配置（默认状态即「安全且对正常用户无感的」）。 */
  var cfg = {
    turnstile: {
      sitekey: '',        /* 占位；只有 enabled:true 且确有滥用时才填 */
      enabled: false,     /* ★ 默认关闭：不调用任何外部验证码 */
      verifyUrl: ''       /* 服务端校验端点（接线责任在后端/agent B） */
    },
    /* 被视为「高滥用面」、在 Turnstile 开启时才有资格被挑战的表面。 */
    challengeSurfaces: ['createQuestion', 'createDispute', 'publicVote', 'disputeVote']
  };

  /* ---------- 配置 ---------- */
  function configure(options) {
    if (options && options.turnstile) {
      var t = options.turnstile;
      if (typeof t.sitekey === 'string') cfg.turnstile.sitekey = t.sitekey;
      if (typeof t.enabled === 'boolean') cfg.turnstile.enabled = t.enabled;
      if (typeof t.verifyUrl === 'string') cfg.turnstile.verifyUrl = t.verifyUrl;
    }
    return getConfig();
  }

  function getConfig() {
    return {
      turnstile: {
        sitekey: cfg.turnstile.sitekey,
        enabled: cfg.turnstile.enabled,
        verifyUrl: cfg.turnstile.verifyUrl
      },
      challengeSurfaces: cfg.challengeSurfaces.slice()
    };
  }

  /* ---------- 身份解析 ----------
   * 优先使用显式传入的 uid；否则回退到全局 Auth.getUid()。
   * 任一来源都没有有效 uid 时，视为「匿名/游客」返回空串。 */
  function resolveUid(uid) {
    if (uid && typeof uid === 'string' && uid.length > 0) return uid;
    if (AuthModule && typeof AuthModule.getUid === 'function') {
      var u = AuthModule.getUid();
      return (u && typeof u === 'string' && u.length > 0) ? u : '';
    }
    return '';
  }

  /* ---------- 核心：投票/出题资格前置校验 ----------
   * 入参：
   *   uid  显式身份（可空，回退到 Auth）
   *   ctx  { surface?: string, turnstileToken?: string }
   * 返回：
   *   { ok:true, uid }                      通过
   *   { ok:false, error, code, reason }    拒绝（含中文提示）
   *
   * 规则：
   *   1) 匿名/游客（无有效 uid）一律禁止投票或出题——
   *      这是「一手机号一票」的客户端第一道门禁，提示语：
   *      「请先登录（绑定手机号）」。
   *   2) 可选的 Turnstile 挑战缝：仅当 enabled 且表面属于
   *      高滥用面、且调用方未提供 token 时，才返回
   *      CHALLENGE_REQUIRED。默认 enabled:false → 永不触发。
   *
   * 注意：唯一性（一人一票）的硬保证不在本函数内，而在数据库
   * 层 UNIQUE(uid, qid)。本函数只做「能否发起」的前置拦截。 */
  function enforceVoteEligibility(uid, ctx) {
    ctx = ctx || {};
    var actingUid = resolveUid(uid);

    /* 规则 1：匿名禁止投票 / 出题（核心一手机号一票保证）。 */
    if (!actingUid) {
      return {
        ok: false,
        error: '请先登录（绑定手机号）',
        code: 'ANON_BLOCKED',
        reason: 'anonymous'
      };
    }

    /* 规则 2：可选的人机验证缝（默认关闭，不触发）。 */
    if (ctx.surface && needsChallenge(ctx.surface)) {
      if (!ctx.turnstileToken) {
        return {
          ok: false,
          error: '请完成人机验证',
          code: 'CHALLENGE_REQUIRED',
          reason: 'challenge',
          surface: ctx.surface
        };
      }
    }

    return { ok: true, uid: actingUid };
  }

  /* ---------- 是否需要人机验证（默认 false） ----------
   * 仅在 Turnstile 显式开启、且 surface 属于高滥用面时返回 true。
   * 默认配置下恒定返回 false，因此永远不会弹出或要求验证码。 */
  function needsChallenge(surface) {
    if (!cfg.turnstile.enabled) return false;
    if (!surface || typeof surface !== 'string') return false;
    return cfg.challengeSurfaces.indexOf(surface) !== -1;
  }

  /* ---------- 验证缝（默认跳过，绝不联网） ----------
   * 这是为「未来打开 Turnstile」预留的集成点：
   *   - enabled:false 时：直接视作通过（skipped），不发起任何请求。
   *   - enabled:true 时：本函数【故意不实现】前端直连第三方——
   *     真正校验必须走服务端 verifyUrl（由 agent B / 后端接线）。
   *     在 verifyUrl 未就绪前，返回 CHALLENGE_UNWIRED 以阻止误开。
   * 设计意图：默认零外部依赖、零网络调用。 */
  function verifyChallenge(token, surface) {
    if (!cfg.turnstile.enabled) {
      return { ok: true, skipped: true };
    }
    /* 启用但服务端校验端点未接线：明确报错，避免「看似开启实则裸奔」。 */
    if (!cfg.turnstile.verifyUrl) {
      return {
        ok: false,
        error: 'Turnstile 已开启但 verifyUrl 未接线；在具备服务端校验前请勿启用。',
        code: 'CHALLENGE_UNWIRED'
      };
    }
    /* 真正的 token 校验交给服务端；此处仅做前置存在性检查。 */
    if (!token) {
      return { ok: false, error: '缺少 Turnstile token', code: 'CHALLENGE_MISSING_TOKEN' };
    }
    /* 注意：不在此处发网络请求。调用方应把 token 连同写请求发往
     * 服务端，由服务端用 verifyUrl 向 Turnstile 校验。 */
    return { ok: true, delegated: true, surface: surface || null };
  }

  return {
    configure: configure,
    getConfig: getConfig,
    resolveUid: resolveUid,
    enforceVoteEligibility: enforceVoteEligibility,
    needsChallenge: needsChallenge,
    verifyChallenge: verifyChallenge
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AntiFraud;
