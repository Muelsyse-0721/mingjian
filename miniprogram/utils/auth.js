const api = require('./api.js');
const cfg = require('../config.js');

const PHONE_RE = /^1\d{10}$/;

function getSession() {
  return {
    token: wx.getStorageSync('mj_token') || '',
    uid: wx.getStorageSync('mj_uid') || '',
    phone: wx.getStorageSync('mj_phone') || '',
    nickname: wx.getStorageSync('mj_nick') || ''
  };
}

function saveSession(d) {
  if (d.access_token) wx.setStorageSync('mj_token', d.access_token);
  const u = d.user || {};
  if (u.id) wx.setStorageSync('mj_uid', String(u.id));
  if (u.phone) wx.setStorageSync('mj_phone', String(u.phone));
  if (u.nickname) wx.setStorageSync('mj_nick', u.nickname);
  return getSession();
}

function clearSession() {
  ['mj_token', 'mj_uid', 'mj_phone', 'mj_nick', 'mj_vid'].forEach((k) => wx.removeStorageSync(k));
}

/* 发送登录验证码（与网站同一套短信通道） */
function sendCode(phone) {
  if (!PHONE_RE.test(phone)) return Promise.reject(new Error('请输入正确的 11 位手机号'));
  return api.request('/v1/verification', {
    method: 'POST',
    body: { phone_number: '+86 ' + phone, target: 'ANY' }
  }).then((r) => {
    const vid = r && (r.verification_id || (r.data && r.data.verification_id));
    if (!vid) throw new Error('未拿到验证标识');
    wx.setStorageSync('mj_vid', String(vid));
    return String(vid);
  });
}

/* 校验验证码并建立会话 */
function verify(phone, code) {
  const vid = wx.getStorageSync('mj_vid');
  if (!vid) return Promise.reject(new Error('请先获取验证码'));
  return api.request('/v1/verification/verify', {
    method: 'POST',
    body: { verification_id: vid, verification_code: String(code) }
  }).then((r) => {
    const d = r && (r.data ? r.data : r);
    if (!d || !d.access_token) throw new Error('登录失败，请重试');
    if (!d.user || !d.user.phone) d.user = Object.assign({}, d.user, { phone: '+86 ' + phone });
    return saveSession(d);
  });
}

module.exports = { getSession, saveSession, clearSession, sendCode, verify, PHONE_RE };
