/* ============================================================
 * 明鉴 · 电话登录模块（cloud.auth 短信验证码）
 * 依赖：window.WorkBuddyCloud 全局 SDK（与 online.js 共用同一 cloud 实例）
 *
 * 流程：sendOtp({phone}) → 保存 {verificationId, isExistingUser}
 *      → verifyOtp({phone, verificationId, isExistingUser, token}) 建立会话
 *      → getSession() 取规范会话（含 user.id）
 *
 * 暴露全局 Auth：
 *   init(cloud)            恢复已有会话，并订阅 onAuthStateChange
 *   isAuthed()             是否已登录
 *   getUid()               云认证 uid（行级身份）
 *   getNickname()          展示用昵称
 *   getPending()           当前验证码会话（含 isExistingUser）
 *   onChange(cb)           登录态变化回调
 *   sendCode(phone)        发送短信验证码
 *   verify(phone, code)    校验并登录
 *   ensureNickname(nick)   新用户设置昵称（写入 jp_profiles + 本地缓存）
 *   loadServerNickname()   从 jp_profiles 拉取昵称（已存在用户）
 *   migrateOldUid()        把本机旧免登录 uid 的战绩改写到新 auth uid
 *   signInWithPassword(phone, password)  手机号 + 密码登录
 *   signUpWithPassword(phone, password, code)  新号注册时设密码（老号自动回退验证码登录）
 *   canSetPassword()       当前账号能否设置密码（UI 提示用）
 *   signOut()              登出
 *
 * ★ 密码能力边界（由 SDK 契约决定，不是产品选择）★
 *   - 密码只能在 signUp 时随 verificationToken 一起提交，因此只有
 *     「新号注册」可以设密码。老账号（历史验证码注册）没有密码字段，
 *     SDK 也没有通用的 updateUser({password})；
 *     resetPasswordForEmail 只支持 email，本项目账号是手机号用不了。
 *   - 结论：老账号无法补设密码，只能继续用验证码登录。UI 必须如实说明。
 *   - 参数名坑：SDK 的 signInWithPassword / signUp 只读 {phone} / {email}，
 *     传 {username} 会被判为「requires exactly one of email or phone」直接失败
 *     （app/test/vendor/wbcloud.js: resolveAuthIdentifier）。
 * ============================================================ */
var Auth = (function () {
  'use strict';

  var LS_PHONE = 'jp-auth-phone';
  var LS_NICK = 'jp-auth-nick';     /* 登录态昵称缓存（服务端 jp_profiles 为准） */
  var LS_OLD_UID = 'jp-online-uid'; /* 旧免登录 uid，用于首次迁移 */

  var cloud = null;
  var pending = null;               /* {phone, verificationId, isExistingUser} */
  var session = null;
  var uid = '';
  var nickname = '';
  var listeners = [];
  /* 密码态（内存标记，不落盘）：'set' 已确认有密码 / '' 未知（老号无法探知） */
  var passwordState = '';

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](!!(session && session.user && uid)); } catch (e) {}
    }
  }

  /* 旧免登录 uid（迁移用） */
  function oldLocalUid() {
    try { return localStorage.getItem(LS_OLD_UID) || ''; } catch (e) { return ''; }
  }

  /* 统一归一化会话：兼容 {user} / {data:{user}} / {data:{session:{user}}} / {session:{user}} 等形态
   * 返回 {user:<userObj>} 或 null。集中处理 getSession 契约形态，避免散落多处不一致判断。 */
  function normalizeSession(raw) {
    if (!raw) return null;
    var u = null;
    if (raw.user) u = raw.user;
    else if (raw.data && raw.data.user) u = raw.data.user;
    else if (raw.data && raw.data.session && raw.data.session.user) u = raw.data.session.user;
    else if (raw.session && raw.session.user) u = raw.session.user;
    return u ? { user: u } : null;
  }

  function applySession(s) {
    session = normalizeSession(s);
    if (session && session.user) {
      uid = session.user.id || '';
      nickname = localNick() || '';
    } else {
      uid = '';
      nickname = '';
    }
    emit();
    return session;
  }

  function localNick() {
    try { return localStorage.getItem(LS_NICK) || ''; } catch (e) { return ''; }
  }

  function isAuthed() { return !!(session && session.user && uid); }
  function getUid() { return uid; }
  function getNickname() { return nickname; }
  function getPending() { return pending; }
  function onChange(cb) { if (typeof cb === 'function') listeners.push(cb); }

  /* ---------- 会话恢复 ---------- */
  function init(c) {
    cloud = c;
    if (cloud && cloud.auth && cloud.auth.onAuthStateChange) {
      cloud.auth.onAuthStateChange(function (ev, s) { applySession(normalizeSession(s)); });
    }
    if (!cloud || !cloud.auth || !cloud.auth.getSession) return Promise.resolve(applySession(null));
    return Promise.resolve(cloud.auth.getSession()).then(function (res) {
      return applySession(normalizeSession(res));
    }).catch(function () { return applySession(null); });
  }

  /* ---------- 发送验证码 ---------- */
  function sendCode(phone) {
    if (!/^1\d{10}$/.test(phone || '')) {
      return Promise.resolve({ error: { message: '请输入正确的 11 位手机号' } });
    }
    if (!cloud || !cloud.auth || !cloud.auth.sendOtp) {
      return Promise.resolve({ error: { message: '云服务未就绪' } });
    }
    return Promise.resolve(cloud.auth.sendOtp({ phone: phone })).then(function (res) {
      if (res && res.error) return res;
      pending = {
        phone: phone,
        verificationId: res && res.data && res.data.verificationId,
        isExistingUser: !!(res && res.data && res.data.isExistingUser)
      };
      try { localStorage.setItem(LS_PHONE, phone); } catch (e) {}
      return res;
    });
  }

  /* ---------- 校验并登录 ---------- */
  function verify(phone, code) {
    if (!pending || pending.phone !== phone) {
      return Promise.resolve({ error: { message: '请先获取验证码' } });
    }
    if (!/^\d{4,8}$/.test(code || '')) {
      return Promise.resolve({ error: { message: '请输入正确的验证码' } });
    }
    var payload = {
      phone: pending.phone,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code
    };
    if (!cloud || !cloud.auth || !cloud.auth.verifyOtp) {
      return Promise.resolve({ error: { message: '云服务未就绪' } });
    }
    return Promise.resolve(cloud.auth.verifyOtp(payload)).then(function (res) {
      if (res && res.error) return res;
      pending = null;
      var local = normalizeSession(res && res.data);
      return Promise.resolve(
        cloud.auth.getSession ? cloud.auth.getSession() : { data: local }
      ).then(function (gs) {
        var s = normalizeSession(gs) || local;
        applySession(s);
        return { data: s, error: null };
      }).catch(function () {
        applySession(local);
        return { data: local, error: null };
      });
    });
  }

  /* ---------- 昵称（新用户设置 / 已存在用户拉取） ---------- */
  function ensureNickname(nick) {
    nick = (nick || '').trim();
    if (nick.length < 2 || nick.length > 12) {
      return Promise.resolve({ error: { message: '昵称需 2-12 个字符' } });
    }
    nickname = nick;
    try { localStorage.setItem(LS_NICK, nick); } catch (e) {}
    if (uid && cloud && cloud.database) {
      /* jp_profiles 由 RLS 收紧 SQL 一并建表；若尚未存在则失败，忽略不影响主流程 */
      return Promise.resolve(
        cloud.database.from('jp_profiles').upsert({ uid: uid, nickname: nick }).then(function () {
          return { error: null };
        }).catch(function () { return { error: null }; })
      );
    }
    return Promise.resolve({ error: null });
  }

  function loadServerNickname() {
    if (!uid || !cloud || !cloud.database) return Promise.resolve();
    return Promise.resolve(
      cloud.database.from('jp_profiles').select('nickname').eq('uid', uid).limit(1)
    ).then(function (r) {
      if (r && r.data && r.data[0] && r.data[0].nickname) {
        nickname = r.data[0].nickname;
        try { localStorage.setItem(LS_NICK, nickname); } catch (e) {}
        emit();
      }
    }).catch(function () { /* 表未建或读不到，用本地缓存 */ });
  }

  /* ---------- 首次登录迁移：本机旧免登录 uid 战绩 → 新 auth uid ---------- */
  /* 优先走 SECURITY DEFINER RPC migrate_legacy_uid（绕过 RLS，受 new_uid=auth.uid() 自锁）；
     若 RPC 不可用（未部署 / 无该 SDK 方法），回退到逐表直接 .update()（过渡期 RLS 未生效时仍可用）。 */
  function migrateOldUid() {
    var old = oldLocalUid();
    if (!old || old === uid) return Promise.resolve({ migrated: false });
    if (!cloud || !cloud.database) return Promise.resolve({ migrated: false });

    var clearKey = function () { try { localStorage.removeItem(LS_OLD_UID); } catch (e) {} };

    if (cloud.database.rpc) {
      return Promise.resolve(
        cloud.database.rpc('migrate_legacy_uid', { old_uid: old, new_uid: uid })
      ).then(function (r) {
        if (r && r.data && r.data.ok) { clearKey(); return { migrated: true, from: old, to: uid, via: 'rpc' }; }
        if (r && r.data && r.data.ok === false) return { migrated: false, reason: r.data.reason, from: old, to: uid };
        return fallbackDirect(old, uid, clearKey);
      }).catch(function () { return fallbackDirect(old, uid, clearKey); });
    }
    return fallbackDirect(old, uid, clearKey);
  }

  function fallbackDirect(old, newUid, clearKey) {
    var tables = ['jp_bets', 'jp_loans', 'jp_loan_payments', 'jp_debate_posts',
                  'jp_debate_bets', 'jp_evidence', 'jp_disputes', 'jp_dispute_votes',
                  'jp_public_votes'];
    var errors = [];
    var chain = Promise.resolve();
    tables.forEach(function (t) {
      chain = chain.then(function () {
        return Promise.resolve(
          cloud.database.from(t).update({ uid: newUid }).eq('uid', old)
        ).then(function (r) {
          if (r && r.error) errors.push({ table: t, error: r.error.message || 'write error' });
        }).catch(function (e) {
          errors.push({ table: t, error: (e && e.message) || 'write error' });
        });
      });
    });
    return chain.then(function () {
      if (errors.length) {
        /* 存在失败：保留旧 uid 键，便于接入 RLS 后由服务端 RPC 重试；
           返回 errors / partial 供上层诊断（不破坏既有 migrated 语义） */
        return { migrated: true, from: old, to: newUid, errors: errors, partial: true, via: 'direct' };
      }
      clearKey();
      return { migrated: true, from: old, to: newUid, errors: [], via: 'direct' };
    });
  }

  /* ============================================================
   * 密码登录 / 注册设密码
   * ------------------------------------------------------------
   * 只能在新号注册（signUp）时设密码：SDK 的 signUp 必须带
   * verificationToken，而 verificationToken 只在 verifyOtp 内部流转，
   * 不会返回给调用方。因此这里的做法是「把密码交给 verifyOtp，
   * 由它在新用户分支拼进 signUp」（SDK 的 verifyOtp 支持 password 透传）。
   * ============================================================ */

  var PHONE_RE = /^1\d{10}$/;

  /* 登录侧只校验长度（存量密码的组合规则不受当前策略约束） */
  function loginPasswordError(pw) {
    if (typeof pw !== 'string' || pw.length === 0) return '请输入密码';
    if (pw.length < 6) return '密码至少 6 位';
    if (pw.length > 64) return '密码最多 64 位';
    return '';
  }

  /* 注册侧要求字母 + 数字混合，避免 6 位纯数字被撞库 */
  function signupPasswordError(pw) {
    var e = loginPasswordError(pw);
    if (e) return e;
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '密码需同时包含字母和数字';
    return '';
  }

  /* provider 错误 → 中文。绝不回显原始报文（可能含内部细节）。 */
  function translateAuthError(err) {
    if (!err) return '登录失败，请稍后重试';
    var kind = err.kind || '';
    var raw = String(err.message || '');
    if (kind === 'unauthenticated' || /invalid_grant|invalid password|wrong password/i.test(raw)) {
      return '手机号或密码错误';
    }
    if (kind === 'rate-limited') return '尝试过于频繁，请稍后再试';
    if (kind === 'network' || kind === 'backend-unavailable') return '网络或服务异常，请稍后重试';
    if (/already|exist|registered|duplicate/i.test(raw)) return '该手机号已注册，请直接登录';
    if (kind === 'invalid-request') return '手机号或密码不正确';
    return '登录失败，请稍后重试';
  }

  /* 登录成功后统一收口：优先 getSession 取规范会话，失败则用响应里的本地会话 */
  function finishLogin(localSession) {
    var local = localSession || null;
    var gs = (cloud && cloud.auth && cloud.auth.getSession)
      ? cloud.auth.getSession() : Promise.resolve({ data: local });
    return Promise.resolve(gs).then(function (r) {
      var s = normalizeSession(r) || local;
      applySession(s);
      return { ok: true, data: s };
    }).catch(function () {
      applySession(local);
      return { ok: true, data: local };
    });
  }

  /* ---------- 手机号 + 密码登录 ---------- */
  function signInWithPassword(phone, password) {
    phone = typeof phone === 'string' ? phone.replace(/\s/g, '') : '';
    if (!PHONE_RE.test(phone)) {
      return Promise.resolve({ ok: false, error: { message: '请输入正确的 11 位手机号' } });
    }
    var pwErr = loginPasswordError(password);
    if (pwErr) return Promise.resolve({ ok: false, error: { message: pwErr } });
    if (!cloud || !cloud.auth || !cloud.auth.signInWithPassword) {
      return Promise.resolve({ ok: false, error: { message: '该环境暂不支持密码登录，请使用验证码登录' } });
    }
    return Promise.resolve(
      /* 注意：只传 phone，不能传 username（SDK 不认） */
      cloud.auth.signInWithPassword({ phone: phone, password: password })
    ).then(function (res) {
      if (!res || res.error) {
        return { ok: false, error: { message: translateAuthError(res && res.error) } };
      }
      pending = null;
      passwordState = 'set';   /* 能密码登录成功 ⇒ 该账号一定有密码 */
      return finishLogin(normalizeSession(res.data));
    }).catch(function (e) {
      return { ok: false, error: { message: translateAuthError(e) } };
    });
  }

  /* ---------- 注册时设密码（老号自动回退为验证码登录） ---------- */
  function signUpWithPassword(phone, password, code) {
    phone = typeof phone === 'string' ? phone.replace(/\s/g, '') : '';
    if (!PHONE_RE.test(phone)) {
      return Promise.resolve({ ok: false, error: { message: '请输入正确的 11 位手机号' } });
    }
    var pwErr = signupPasswordError(password);
    if (pwErr) return Promise.resolve({ ok: false, error: { message: pwErr } });
    if (!/^\d{4,8}$/.test(typeof code === 'string' ? code : '')) {
      return Promise.resolve({ ok: false, error: { message: '请输入正确的验证码' } });
    }
    if (!pending || pending.phone !== phone) {
      return Promise.resolve({ ok: false, error: { message: '请先获取验证码' } });
    }
    if (!cloud || !cloud.auth || !cloud.auth.verifyOtp) {
      return Promise.resolve({ ok: false, error: { message: '云服务未就绪' } });
    }

    var base = {
      phone: pending.phone,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code
    };

    /* 已知老号：不尝试设密码，直接验证码登录 */
    if (pending.isExistingUser) return otpOnlyLogin(base, 'exists');

    /* 新号：password 透传给 SDK，由其内部 signUp 一并提交 */
    var withPw = {
      phone: base.phone, verificationId: base.verificationId,
      isExistingUser: false, token: base.token, password: password
    };
    return Promise.resolve(cloud.auth.verifyOtp(withPw)).then(function (res) {
      if (res && res.error) {
        /* 竞态：precheck 说新号，但服务端已有此号 → 回退验证码登录 */
        if (looksLikeExists(res.error)) return otpOnlyLogin(base, 'exists');
        return { ok: false, error: { message: translateAuthError(res.error) } };
      }
      pending = null;
      passwordState = 'set';
      return finishLogin(normalizeSession(res.data)).then(function (r) {
        return { ok: true, data: r.data, passwordSet: true };
      });
    }).catch(function (e) {
      if (looksLikeExists(e)) return otpOnlyLogin(base, 'exists');
      return { ok: false, error: { message: translateAuthError(e) } };
    });
  }

  function looksLikeExists(err) {
    var raw = String((err && (err.code || err.message)) || '');
    return /exist|already|registered|duplicate|conflict/i.test(raw);
  }

  /* 老号回退路径：走既有 verify 同款 OTP 登录，不碰密码 */
  function otpOnlyLogin(base, reason) {
    return Promise.resolve(cloud.auth.verifyOtp(base)).then(function (res) {
      if (res && res.error) {
        return { ok: false, error: { message: translateAuthError(res.error) } };
      }
      pending = null;
      /* 老号是否已有密码无法从 SDK 探知，保持「未知」不臆断 */
      passwordState = '';
      return finishLogin(normalizeSession(res.data)).then(function (r) {
        return { ok: true, data: r.data, passwordSet: false, reason: reason };
      });
    }).catch(function (e) {
      return { ok: false, error: { message: translateAuthError(e) } };
    });
  }

  /* ---------- 当前账号能否设置密码（仅 UI 提示，不作授权判断） ---------- */
  function canSetPassword() {
    if (pending && pending.phone && pending.isExistingUser === false) {
      return { allowed: true, state: 'pending-signup', reason: '新号注册可同时设置密码' };
    }
    if (passwordState === 'set') {
      return { allowed: false, state: 'set', reason: '本账号已设置密码，可直接用密码登录' };
    }
    if (isAuthed()) {
      return {
        allowed: false, state: 'unknown',
        reason: '密码只能在新号注册时设置，老账号无法补设；请继续用验证码登录'
      };
    }
    return { allowed: false, state: 'anonymous', reason: '请先验证手机号；新号注册时可设置密码' };
  }

  /* ---------- 登出 ---------- */
  function signOut() {
    var p = (cloud && cloud.auth && cloud.auth.signOut)
      ? Promise.resolve(cloud.auth.signOut()) : Promise.resolve({});
    return Promise.resolve(p).then(function () {
      session = null; uid = ''; nickname = ''; pending = null; passwordState = '';
      try { localStorage.removeItem(LS_PHONE); localStorage.removeItem(LS_NICK); } catch (e) {}
      emit();
      return { error: null };
    }).catch(function () {
      session = null; uid = ''; nickname = ''; pending = null; passwordState = '';
      try { localStorage.removeItem(LS_PHONE); localStorage.removeItem(LS_NICK); } catch (e) {}
      emit();
      return { error: null };
    });
  }

  return {
    init: init, isAuthed: isAuthed, getUid: getUid, getNickname: getNickname,
    getPending: getPending, onChange: onChange, sendCode: sendCode, verify: verify,
    ensureNickname: ensureNickname, loadServerNickname: loadServerNickname,
    migrateOldUid: migrateOldUid, signOut: signOut,
    signInWithPassword: signInWithPassword, signUpWithPassword: signUpWithPassword,
    canSetPassword: canSetPassword
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Auth;
