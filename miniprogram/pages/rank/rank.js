const api = require('../../utils/api.js');
const cfg = require('../../config.js');

Page({
  data: { list: [], loading: true, note: '' },

  onShow() { this.load(); this.startPoll(); },
  onHide() { this.stopPoll(); },
  onUnload() { this.stopPoll(); },
  startPoll() { this.stopPoll(); this.timer = setInterval(() => this.load(true), cfg.POLL_MS * 3); },
  stopPoll() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  load(silent) {
    if (!silent) this.setData({ loading: true });
    // 按已结算投注计算收益率（网站按净资产排，这里用可公开核验的口径）
    return Promise.all([
      api.select('jp_bets', 'select=uid,nickname,stake,payout,status&limit=2000'),
      api.select('jp_profiles', 'select=uid,nickname&limit=500').catch(() => [])
    ]).then(([bets, profiles]) => {
      const nameMap = {};
      (profiles || []).forEach((p) => { if (p.uid) nameMap[String(p.uid)] = p.nickname; });
      const acc = {};
      (bets || []).forEach((b) => {
        if (b.status !== 'won' && b.status !== 'lost') return;
        const k = String(b.uid || '');
        if (!k) return;
        acc[k] = acc[k] || { uid: k, nick: nameMap[k] || b.nickname || '匿名', stake: 0, payout: 0, n: 0 };
        acc[k].stake += Number(b.stake || 0);
        acc[k].payout += Number(b.payout || 0);
        acc[k].n += 1;
      });
      const list = Object.values(acc)
        .filter((x) => x.stake > 0 && x.n >= 3)
        .map((x) => Object.assign(x, { roi: Math.round((x.payout - x.stake) / x.stake * 1000) / 10 }))
        .sort((a, b) => b.roi - a.roi)
        .slice(0, 30);
      const sig = JSON.stringify(list.map((x) => [x.uid, x.roi]));
      if (sig !== this.sig) { this.sig = sig; this.setData({ list }); }
      this.setData({ loading: false, note: '口径：已结算投注（≥3 笔）的收益率' });
    }).catch(() => this.setData({ loading: false }));
  }
});
