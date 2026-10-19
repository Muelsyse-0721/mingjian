const api = require('../../utils/api.js');
const cfg = require('../../config.js');

const TABS = [
  { key: 'open', name: '进行中' },
  { key: 'search', name: '待检索' },
  { key: 'vote', name: '公投中' },
  { key: 'manual', name: '待人工' },
  { key: 'settled', name: '已揭晓' }
];

Page({
  data: { tabs: TABS, active: 'open', list: [], loading: true, updatedAt: '' },

  onLoad() { this.load(); },
  onShow() { this.load(); this.startPoll(); },
  onHide() { this.stopPoll(); },
  onUnload() { this.stopPoll(); },

  startPoll() {
    this.stopPoll();
    this.timer = setInterval(() => this.load(true), cfg.POLL_MS);
  },
  stopPoll() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.active) return;
    this.setData({ active: key, list: [], loading: true });
    this.load();
  },

  filter() {
    const k = this.data.active;
    if (k === 'open') return 'status=eq.open&settle_mode=eq.search&order=created_at.desc';
    if (k === 'search') return 'status=eq.open&settle_mode=eq.search&deadline=lt.' + today() + '&order=deadline.asc';
    if (k === 'vote') return 'status=eq.open&settle_mode=eq.vote&order=vote_end.asc';
    if (k === 'manual') return 'status=eq.open&settle_mode=eq.manual&order=deadline.asc';
    return 'status=eq.settled&order=settled_at.desc';
  },

  load(silent) {
    if (!silent) this.setData({ loading: true });
    const q = this.filter() + '&limit=50';
    return api.select('jp_questions', q)
      .then((rows) => {
        const list = (rows || []).map((r) => decorate(r));
        // 内容未变就不重绘，避免轮询导致闪烁
        const sig = JSON.stringify(list.map((x) => [x.qid, x.pool, x.status]));
        if (sig === this.sig) { this.setData({ loading: false }); return; }
        this.sig = sig;
        this.setData({ list, loading: false, updatedAt: nowTime() });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
        console.error(e);
      });
  },

  openDetail(e) {
    const qid = e.currentTarget.dataset.qid;
    wx.navigateTo({ url: '/pages/detail/detail?qid=' + encodeURIComponent(qid) });
  }
});

function decorate(r) {
  const pool = r.pool || {};
  const total = Object.keys(pool).reduce((s, k) => s + Number(pool[k] || 0), 0);
  const outs = (r.outcomes || []).map((o) => o.label).join(' / ');
  return {
    qid: r.qid, title: r.title, category: r.category || '综合',
    status: r.status, deadline: r.deadline || '', total, outs,
    result: r.result || ''
  };
}
function today() { return new Date().toISOString().slice(0, 10); }
function nowTime() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : n);
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
