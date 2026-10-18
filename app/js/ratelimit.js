/*
 * ratelimit.js — 客户端节流 / 冷却（无 DOM 依赖，纯 JS）
 * ---------------------------------------------------------------------------
 * 重要架构说明：
 *   本应用没有自建后端服务器（云端 DB 是唯一的「服务端」），因此**真正的边缘
 *   限流是云服务商的责任**。本模块是「客户端防御性节流」——用来防止用户手滑
 *   连点、或降低明显的前端滥用。它**可被绕过**（改本地存储 / 直接打云端 API），
 *   所以绝不能当作安全边界，只能作为体验与减载的第一道缓冲。
 *
 * 实现：令牌桶（Token Bucket）。每个 key 一个桶，按时间均匀补充令牌；
 *   取用 1 个令牌即算一次动作。桶容量为 1、补充窗口 = windowMs 时，语义等价于
 *   「距上次成功动作 windowMs 内不可重复」的固定冷却。
 *
 * 运行环境：浏览器（window.RateLimit）与 Node（module.exports），二者皆可。
 */
(function (root) {
  'use strict';

  /* key -> bucket 状态。内存存储，刷新页面即重置（符合「前端节流」定位）。 */
  var buckets = {};

  function now() {
    return (typeof Date !== 'undefined' && Date.now) ? Date.now() : (new Date()).getTime();
  }

  /* 按时间把令牌补满到 max（线性补充）。 */
  function refill(b) {
    var t = now();
    var elapsed = t - b.last;
    if (elapsed > 0) {
      b.tokens = Math.min(b.max, b.tokens + elapsed * b.refillPerMs);
      b.last = t;
    }
  }

  /* 把内部桶包装成对外句柄。 */
  function makeHandle(b) {
    return {
      key: b.key,
      max: b.max,
      windowMs: b.windowMs,
      /**
       * allow — 尝试消费一个令牌。
       * @returns {{ok:boolean, retryAfterMs:number, remaining:number}}
       *   ok: 本次是否放行；retryAfterMs: 还需等待毫秒（ok 时为 0）；
       *   remaining: 当前剩余令牌（向下取整）。
       */
      allow: function () {
        refill(b);
        if (b.tokens >= 1) {
          b.tokens -= 1;
          return { ok: true, retryAfterMs: 0, remaining: Math.floor(b.tokens) };
        }
        var deficit = 1 - b.tokens;                 // 距 1 个令牌还差多少
        var retryAfterMs = Math.ceil(deficit / b.refillPerMs);
        return { ok: false, retryAfterMs: retryAfterMs, remaining: 0 };
      },
      /* 立即重置（测试 / 管理员强制放行用）。 */
      reset: function () {
        b.tokens = b.max;
        b.last = now();
      }
    };
  }

  var RateLimit = {
    /**
     * create — 创建一个限流器（或取回同名 key 的已有限流器）。
     * @param {string} key 唯一标识（如 'sendCode'、'bet:uid-123'）
     * @param {object} opts {max:number, windowMs:number}
     *   max 默认 1；windowMs 默认 1000。补充速率 = max / windowMs 令牌/毫秒。
     * @returns {handle} 含 allow() / reset()
     */
    create: function (key, opts) {
      if (buckets[key]) return makeHandle(buckets[key]);
      opts = opts || {};
      var max = (typeof opts.max === 'number' && opts.max > 0) ? opts.max : 1;
      var windowMs = (typeof opts.windowMs === 'number' && opts.windowMs > 0) ? opts.windowMs : 1000;
      var b = {
        key: key,
        max: max,
        windowMs: windowMs,
        tokens: max,
        last: now(),
        refillPerMs: max / windowMs
      };
      buckets[key] = b;
      return makeHandle(b);
    },

    /* 预置的敏感动作冷却（单例）。Phase 2 在对应动作前调用 RateLimit.preset('bet').allow()。 */
    PRESETS: {
      sendCode:       { max: 1, windowMs: 60000 }, // 发验证码：60s 冷却
      createQuestion: { max: 1, windowMs: 10000 }, // 出题：10s 冷却
      vote:           { max: 1, windowMs: 2000 },   // 投票：2s 冷却
      bet:            { max: 1, windowMs: 1000 },   // 下注：1s 冷却
      disputeFile:    { max: 1, windowMs: 30000 }   // 发起仲裁：30s 冷却
    },

    /**
     * preset — 取预置冷却器的单例。
     * @param {string} name 见 PRESETS 的键
     * @returns {handle}
     */
    preset: function (name) {
      if (!this.PRESETS[name]) throw new Error('Unknown rate-limit preset: ' + name);
      var k = 'preset:' + name;
      if (!buckets[k]) this.create(k, this.PRESETS[name]);
      return makeHandle(buckets[k]);
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RateLimit;
  }
  root.RateLimit = RateLimit;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
