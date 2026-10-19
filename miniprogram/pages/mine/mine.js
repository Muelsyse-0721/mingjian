const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    session: null, phone: '', code: '', pwHint: '',
    myBets: [], loading: false, countdown: 0
  },

  onShow() {
    this.setData({ session: auth.getSession() });
    this.loadMine();
  },

  inputPhone(e) { this.setData({ phone: e.detail.value }); },
  inputCode(e) { this.setData({ code: e.detail.value }); },

  sendCode() {
    const p = (this.data.phone || '').trim();
    if (!auth.PHONE_RE.test(p)) return wx.showToast({ title: '手机号不正确', icon: 'none' });
    if (this.data.countdown > 0) return;
    auth.sendCode(p).then(() => {
      wx.showToast({ title: '验证码已发送', icon: 'success' });
      this.tick(60);
    }).catch((e) => wx.showToast({ title: (e && e.message) || '发送失败', icon: 'none' }));
  },

  tick(n) {
    this.setData({ countdown: n });
    if (n <= 0) return;
    setTimeout(() => this.tick(n - 1), 1000);
  },

  login() {
    const p = (this.data.phone || '').trim();
    const c = (this.data.code || '').trim();
    if (!c) return wx.showToast({ title: '请输入验证码', icon: 'none' });
    this.setData({ loading: true });
    auth.verify(p, c).then((s) => {
      getApp().refreshSession();
      this.setData({ session: s, loading: false, code: '' });
      wx.showToast({ title: '登录成功', icon: 'success' });
      this.loadMine();
    }).catch((e) => {
      this.setData({ loading: false });
      wx.showModal({ title: '登录失败', content: (e && e.message) || '请稍后重试', showCancel: false });
    });
  },

  logout() {
    auth.clearSession();
    getApp().refreshSession();
    this.setData({ session: auth.getSession(), myBets: [] });
  },

  loadMine() {
    const s = this.data.session || auth.getSession();
    if (!s || !s.uid) return;
    api.select('jp_bets', 'uid=eq.' + encodeURIComponent(s.uid) + '&order=created_at.desc&limit=50')
      .then((rows) => this.setData({ myBets: rows || [] }))
      .catch(() => {});
  },

  openDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?qid=' + encodeURIComponent(e.currentTarget.dataset.qid) });
  }
});
