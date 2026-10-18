/* ============================================================
 * 明鉴 · 站长鉴权模块（admin.js）
 * ------------------------------------------------------------
 * 取代 online.js 中“前端从 jp_settings 读出 admin_token_hash 并
 * 直接挂到全局 state、再在客户端比对”的做法（该做法会把哈希暴露
 * 给任何打开控制台的访客）。
 *
 * 设计要点
 * 1) 口令哈希只保存在本模块「私有闭包」中，对外无 getter、不挂
 *    state、不进 DOM，最大程度降低泄露面。
 * 2) 优先走云端安全校验（cloud function / edge function）：此时哈希
 *    永不下发前端；若该端点尚不存在，则退化为「客户端哈希比对」，
 *    并于下方 TODO 明确标注其安全局限与推荐改造。
 * 3) localStorage 仅持久化一个布尔解锁标记（非口令、非哈希），刷新
 *    后保持解锁态但不泄露任何敏感信息。
 *
 * TODO（安全加固，需后端 / 云函数，agent B 配合 RLS）：
 *   当前客户端比对方案下，admin_token_hash 仍需经 RLS 下发给前端，
 *   攻击者可将其抓出做离线暴力破解。推荐改造：
 *   (1) 部署 edge function：POST /admin/verify { token } →
 *       服务端用「仅服务端持有的 pepper」加盐后哈希，与 DB 中哈希
 *       比对，只返回 { ok: true/false }；DB 行 admin_token_hash 的
 *       读权限应收回（RLS 仅允许 service_role 读取）。
 *   (2) 口令存储改为「哈希 + 服务端随机 salt/pepper」，杜绝离线破解。
 *   (3) 解锁后签发短期会话令牌（如 15min TTL），替代前端布尔标记，
 *       降低重放与长期解锁风险。
 *   在 endpoint 就绪前，把 Admin.init({ cloud, secureVerify }) 传入
 *   secureVerify 即可无缝切换到安全路径，无需改动调用方。
 * ============================================================ */
var Admin = (function () {
  'use strict';

  var STORAGE_KEY = 'mj_admin_unlocked';   // 只存布尔标记，绝不存口令/哈希
  var DEFAULT_ROLE = '站长';

  // —— 私有状态：哈希仅闭包内可见 ——
  var _cloud = null;
  var _tokenHash = '';
  var _secureVerify = null;   // 可选：async (token) => Promise<boolean>
  var _unlocked = false;

  function _loadFlag() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }
  function _saveFlag(v) {
    try {
      if (v) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 隐私模式下静默失败 */ }
  }

  // 同步哈希：优先用全局 SHA256 模块（与 sha256.js 一致），缺失则报错。
  function _sha256(s) {
    if (typeof SHA256 !== 'undefined' && SHA256 && typeof SHA256.sha256 === 'function') {
      return SHA256.sha256(s);
    }
    throw new Error('缺少 SHA256 模块，无法在客户端校验口令（请先加载 sha256.js）');
  }

  /* init(cloud, opts)
   *  cloud: WorkBuddyCloud 实例（供未来 secureVerify 使用）
   *  opts.tokenHash: 服务端下发（经 RLS 受限）的哈希；用 setTokenHash 注入亦可
   *  opts.secureVerify: 可选 async(token)=>Promise<boolean>，存在即走安全校验
   *  opts.persist: 是否从 localStorage 恢复解锁态（默认 true） */
  function init(cloud, opts) {
    opts = opts || {};
    _cloud = cloud || null;
    if (typeof opts.tokenHash === 'string') _tokenHash = opts.tokenHash;
    if (typeof opts.secureVerify === 'function') _secureVerify = opts.secureVerify;
    if (opts.persist !== false) _unlocked = _loadFlag();
    return Admin;
  }

  /* setTokenHash(hash)：online.js 加载 jp_settings 后注入最新哈希，
   * 避免哈希进入全局 state / 被广播。 */
  function setTokenHash(hash) {
    _tokenHash = typeof hash === 'string' ? hash : '';
    return Admin;
  }

  function isUnlocked() { return _unlocked; }

  /* verify(token)：纯同步校验（客户端退化路径），不触碰 localStorage。
   * 返回 { ok, error? }；用户可在提交前做即时提示。 */
  function verify(token) {
    token = (token || '').trim();
    if (!token) return { ok: false, error: '请输入站长口令' };
    if (!_tokenHash) return { ok: false, error: '云端尚未设置站长口令哈希，请先在数据管理中初始化' };
    var ok = false;
    try { ok = _sha256(token) === _tokenHash; } catch (e) { return { ok: false, error: e.message }; }
    return ok ? { ok: true } : { ok: false, error: '口令不正确' };
  }

  /* unlock(token)：尝试解锁。
   *  - 存在 secureVerify 时走安全云端校验（哈希不下发前端）；
   *  - 否则退化为客户端哈希比对（已知局限，见文件顶部 TODO）。
   * 返回 Promise<{ok, error?}> 以兼容未来异步云校验。 */
  function unlock(token) {
    token = (token || '').trim();
    if (!token) return Promise.resolve({ ok: false, error: '请输入站长口令' });

    // 路径 A：安全云端校验（推荐，哈希不下发前端）
    if (typeof _secureVerify === 'function') {
      return Promise.resolve()
        .then(function () { return _secureVerify(token); })
        .then(function (ok) {
          if (ok) { _unlocked = true; _saveFlag(true); return { ok: true }; }
          return { ok: false, error: '口令不正确' };
        });
    }

    // 路径 B：客户端哈希比对（已知局限，见文件顶部 TODO）
    var r = verify(token);
    if (r.ok) { _unlocked = true; _saveFlag(true); }
    return Promise.resolve(r);
  }

  function lock() {
    _unlocked = false;
    _saveFlag(false);
    return Admin;
  }

  return {
    init: init,
    setTokenHash: setTokenHash,
    isUnlocked: isUnlocked,
    verify: verify,
    unlock: unlock,
    lock: lock,
    ROLE: DEFAULT_ROLE
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Admin;
