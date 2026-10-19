const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');
const cfg = require('../../config.js');

Page({
  data: {
    qid: '', q: null, outcomes: [], pick: '', stake: '',
    odds: '', total: 0, busy: false, isOpen: false
  },

  onLoad(opt) {
    this.setData({ qid: opt.qid || '' });
    this.load();
  },
  onShow() { this.load(); this.startPoll(); },
  onHide() { this.stopPoll(); },
  onUnload() { this.stopPoll(); },
  startPoll() {
    this.stopPoll();
    this.timer = setInterval(() => this.load(true), cfg.POLL_MS);
  },
  stopPoll() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  load(silent) {
    return api.select('jp_questions', 'qid=eq.' + encodeURIComponent(this.data.qid) + '&limit=1')
      .then((rows) => {
        const q = (rows || [])[0];
        if (!q) { wx.showToast({ title: '题目不存在', icon: 'none' }); return; }
        const pool = q.pool || {};
        const total = Object.keys(pool).reduce((s, k) => s + Number(pool[k] || 0), 0);
        const fee = Number(q.fee || 0.05);
        const outcomes = (q.outcomes || []).map((o) => {
          const p = Number(pool[o.id] || 0);
          const odds = p > 0 ? Math.round((total * (1 - fee) / p) * 100) / 100 : 0;
          return { id: o.id, label: o.label, pool: p, odds };
        });
        this.setData({
          q, outcomes, total,
          isOpen: q.status === 'open' && (!q.deadline || q.deadline >= today())
        });
        this.recalc();
      })
      .catch(() => { if (!silent) wx.showToast({ title: '加载失败', icon: 'none' }); });
  },

  pick(e) {
    this.setData({ pick: e.currentTarget.dataset.id });
    this.recalc();
  },
  input(e) { this.setData({ stake: e.detail.value }); this.recalc(); },

  recalc() {
    const o = this.data.outcomes.find((x) => x.id === this.data.pick);
    const stake = Number(this.data.stake || 0);
    this.setData({ odds: o ? o.odds : '', expect: o && stake > 0 ? Math.round(stake * o.odds) : 0 });
  },

  bet() {
    const s = auth.getSession();
    if (!s.token) {
      wx.showModal({ title: '需要登录', content: '下注前请先用手机号登录', confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/mine/mine' }); } });
      return;
    }
    const stake = Number(this.data.stake || 0);
    if (!this.data.pick) return wx.showToast({ title: '先选一个选项', icon: 'none' });
    if (!(stake > 0)) return wx.showToast({ title: '请输入积分', icon: 'none' });
    if (this.data.busy) return;
    this.setData({ busy: true });
    const o = this.data.outcomes.find((x) => x.id === this.data.pick);
    api.insert('jp_bets', {
      qid: this.data.qid,
      uid: s.uid,
      nickname: s.nickname || '小程序用户',
      outcome_id: this.data.pick,
      stake: stake,
      odds_at_bet: o ? o.odds : 1,
      note: ''
    }).then(() => {
      wx.showToast({ title: '下注成功', icon: 'success' });
      this.setData({ stake: '', busy: false });
      this.load();
    }).catch((e) => {
      this.setData({ busy: false });
      wx.showModal({ title: '下注失败', content: (e && e.data && (e.data.message || e.data.error)) || '请稍后重试', showCancel: false });
    });
  }
});

function today() { return new Date().toISOString().slice(0, 10); }
