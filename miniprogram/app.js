const auth = require('./utils/auth.js');

App({
  globalData: {
    session: null
  },
  onLaunch() {
    this.globalData.session = auth.getSession();
    if (wx.cloud) {
      try {
        // 使用云开发代理时才会用到；未开通也不影响直连
        wx.cloud.init({ traceUser: false });
      } catch (e) { /* ignore */ }
    }
  },
  session() {
    if (!this.globalData.session) this.globalData.session = auth.getSession();
    return this.globalData.session;
  },
  refreshSession() {
    this.globalData.session = auth.getSession();
    return this.globalData.session;
  }
});
