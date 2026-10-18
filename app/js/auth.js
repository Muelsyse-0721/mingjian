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
 *   signOut()              登出
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

  /* ---------- 登出 ---------- */
  function signOut() {
    var p = (cloud && cloud.auth && cloud.auth.signOut)
      ? Promise.resolve(cloud.auth.signOut()) : Promise.resolve({});
    return Promise.resolve(p).then(function () {
      session = null; uid = ''; nickname = ''; pending = null;
      try { localStorage.removeItem(LS_PHONE); localStorage.removeItem(LS_NICK); } catch (e) {}
      emit();
      return { error: null };
    }).catch(function () {
      session = null; uid = ''; nickname = ''; pending = null;
      try { localStorage.removeItem(LS_PHONE); localStorage.removeItem(LS_NICK); } catch (e) {}
      emit();
      return { error: null };
    });
  }

  return {
    init: init, isAuthed: isAuthed, getUid: getUid, getNickname: getNickname,
    getPending: getPending, onChange: onChange, sendCode: sendCode, verify: verify,
    ensureNickname: ensureNickname, loadServerNickname: loadServerNickname,
    migrateOldUid: migrateOldUid, signOut: signOut
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Auth;
