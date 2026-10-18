/* 明鉴 · 单机版 UI 逻辑（v1.0：辩论评分 + 预测下注 + 信用借贷 + 个人中心） */
var App = (function () {
  'use strict';

  var STORE_KEY = 'jp-ladder-v1';
  var SETTINGS_KEY = 'jp-ladder-settings-v1';
  var ME = 'me';   /* 单机版唯一玩家 uid（借贷记录用） */

  var state = {
    posts: [],          // {id, event, context, content, levelOverride, redConfirmed}
    results: [],        // Engine.scoreAll 的输出
    drafts: [],         // 待加入评分的草稿
    questions: [],      // 预测问题 {id,title,desc,mode,fee,deadline,status,result,outcomes,pool,userPool,finalOdds}
    bets: [],           // 投注 {id,questionId,outcomeId,stake,oddsAtBet,status,payout}
    loans: [],          // 借款 {lid,principal,rate,term_days,due_date,status,repaid_principal,repaid_interest,late_fee}
    loanPayments: [],   // 还款 {lid,amount,principal_part,interest_part,late_part,paidAt}
    ledger: [],         // 积分流水 {id,ts,type,amount,note,refId,balanceAfter}
    view: 'debate',
    settings: { llm: { enabled: false, base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat' } }
  };

  /* ---------- 存储 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        state.posts = data.posts || [];
        state.results = data.results || [];
        state.questions = data.questions || [];
        state.bets = data.bets || [];
        state.loans = data.loans || [];
        state.loanPayments = data.loanPayments || [];
        state.ledger = data.ledger || [];
        if (!state.ledger.length && state.results.length) {
          state.results.forEach(function (r) {
            state.ledger.push({ id: uid(), ts: Date.now(), type: 'debate', amount: r.final,
              note: '历史辩论评分导入 · ' + (r.post.event || '未命名事件'), refId: r.post.id, balanceAfter: 0 });
          });
          recomputeBalances();
          save();
        }
      }
      var s = localStorage.getItem(SETTINGS_KEY);
      if (s) state.settings = JSON.parse(s);
    } catch (e) { /* 忽略损坏的本地数据 */ }
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      posts: state.posts, results: state.results,
      questions: state.questions, bets: state.bets,
      loans: state.loans, loanPayments: state.loanPayments, ledger: state.ledger
    }));
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  /* ---------- 积分与流水账 ---------- */
  function debatePoints() {
    return state.results.reduce(function (s, r) { return s + r.final; }, 0);
  }
  function bettingPoints() {
    return state.ledger.reduce(function (s, e) { return e.type === 'debate' ? s : s + e.amount; }, 0);
  }
  function totalPoints() { return debatePoints() + bettingPoints(); }

  function appendLedger(type, amount, note, refId) {
    state.ledger.push({
      id: uid(), ts: Date.now(), type: type,
      amount: Math.round(amount * 10) / 10,
      note: note, refId: refId || '', balanceAfter: 0
    });
    recomputeBalances();
  }
  function recomputeBalances() {
    state.ledger.sort(function (a, b) { return a.ts - b.ts; });
    var running = 0;
    state.ledger.forEach(function (e) {
      running += e.amount;
      e.balanceAfter = Math.round(running * 10) / 10;
    });
  }
  /* 评分后同步流水：新增/更新对应 debate 条目，清理已删除帖子的条目 */
  function syncDebateLedger() {
    var live = {};
    state.posts.forEach(function (p) { live[p.id] = true; });
    state.results.forEach(function (r) {
      var entry = null;
      for (var i = 0; i < state.ledger.length; i++) {
        if (state.ledger[i].type === 'debate' && state.ledger[i].refId === r.post.id) { entry = state.ledger[i]; break; }
      }
      if (entry) {
        entry.amount = r.final;
        entry.note = '辩论评分 · ' + (r.post.event || '未命名事件');
      } else {
        state.ledger.push({ id: uid(), ts: Date.now(), type: 'debate', amount: r.final,
          note: '辩论评分 · ' + (r.post.event || '未命名事件'), refId: r.post.id, balanceAfter: 0 });
      }
    });
    state.ledger = state.ledger.filter(function (e) { return e.type !== 'debate' || live[e.refId]; });
    recomputeBalances();
  }

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function on(id, ev, fn) {
    var el = $(id);
    if (el) { el.addEventListener(ev, fn); return true; }
    if (typeof console !== 'undefined') console.warn('绑定失败：页面中不存在 #' + id);
    return false;
  }
  function uid() { return 'p-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v) { return (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1); }
  function scoreColor(v) { return v > 0 ? '#A32D2D' : (v < 0 ? '#3B6D11' : '#5F5E5A'); }
  function fmtTs(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function levelStyle(lv) {
    return ({
      S: { bg: '#FAEEDA', fg: '#854F0B', name: '巨浪' },
      A: { bg: '#FAECE7', fg: '#993C1D', name: '大潮' },
      B: { bg: '#E6F1FB', fg: '#185FA5', name: '涟漪' },
      C: { bg: '#F1EFE8', fg: '#5F5E5A', name: '水花' }
    })[lv] || { bg: '#F1EFE8', fg: '#5F5E5A', name: lv };
  }
  function findQuestion(qid) {
    for (var i = 0; i < state.questions.length; i++) if (state.questions[i].id === qid) return state.questions[i];
    return null;
  }
  function outcomeLabel(q, oid) {
    var o = q.outcomes.filter(function (x) { return x.id === oid; })[0];
    return o ? o.label : oid;
  }
  function betOf(qid) {
    return state.bets.filter(function (b) { return b.questionId === qid && b.status === 'open'; })[0] || null;
  }

  /* ---------- 导入（辩论） ---------- */
  function addDraft() {
    var event = $('draft-event').value.trim();
    var content = $('draft-content').value.trim();
    var context = $('draft-context').value.trim();
    if (!content) { alert('请先填写发言内容'); return; }
    state.drafts.push({ id: uid(), event: event, context: context, content: content });
    $('draft-event').value = '';
    $('draft-content').value = '';
    $('draft-context').value = '';
    renderDrafts();
  }

  function removeDraft(id) {
    state.drafts = state.drafts.filter(function (d) { return d.id !== id; });
    renderDrafts();
  }

  function renderDrafts() {
    var box = $('draft-list');
    if (!box) return;
    if (!state.drafts.length) {
      box.innerHTML = '<div class="empty-tip">草稿为空。填写上方表单，或切换到「JSON 导入 / 演示数据」。</div>';
    } else {
      box.innerHTML = state.drafts.map(function (d) {
        return '<div class="draft-item">' +
          '<div class="draft-meta">' + esc(d.event || '未命名事件') + ' · ' + d.content.length + ' 字</div>' +
          '<div class="draft-text">' + esc(d.content.slice(0, 40)) + (d.content.length > 40 ? '…' : '') + '</div>' +
          '<button class="btn-link" data-del="' + d.id + '">移除</button>' +
          '</div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (btn) {
        btn.addEventListener('click', function () { removeDraft(btn.getAttribute('data-del')); });
      });
    }
    $('btn-score').textContent = '开始评分（' + state.drafts.length + ' 条）';
    $('btn-score').disabled = !state.drafts.length;
  }

  function commitDrafts() {
    if (!state.drafts.length) return;
    state.drafts.forEach(function (d) {
      state.posts.push({ id: d.id, event: d.event, context: d.context, content: d.content, levelOverride: '', redConfirmed: false });
    });
    state.drafts = [];
    runScoring();
  }

  function loadDemo() {
    state.posts = DEMO_POSTS.map(function (p) {
      return { id: p.id, event: p.event, context: p.context, content: p.content, levelOverride: '', redConfirmed: p.id === 'demo-3' };
    });
    state.questions = JSON.parse(JSON.stringify(DEMO_QUESTIONS));
    state.bets = DEMO_BETS.map(function (b, i) {
      return { id: 'bet-demo-' + i, questionId: b.questionId, outcomeId: b.outcomeId, stake: b.stake,
               oddsAtBet: 1.9, placedAt: Date.now() - (3 - i) * 86400000, status: b.status, payout: b.payout };
    });
    /* 同步演示投注到各问题的 userPool，保证赔率自洽 */
    state.questions.forEach(function (q) {
      q.userPool = {};
      state.bets.forEach(function (b) {
        if (b.questionId === q.id && b.status !== 'lost') q.userPool[b.outcomeId] = (q.userPool[b.outcomeId] || 0) + b.stake;
      });
    });
    state.drafts = [];
    state.ledger = [];
    runScoring();
    /* 演示投注的流水账 */
    state.bets.forEach(function (b) {
      var q = findQuestion(b.questionId);
      if (!q) return;
      appendLedger('stake', -b.stake, '下注 · ' + q.title + ' → ' + outcomeLabel(q, b.outcomeId));
      if (b.status === 'won') appendLedger('payout', b.payout, '派彩 · ' + q.title + ' → ' + outcomeLabel(q, b.outcomeId));
    });
    save();
    renderAll();
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var list = Array.isArray(data) ? data : data.posts;
        if (!Array.isArray(list)) throw new Error('格式不正确');
        list.forEach(function (p) {
          state.posts.push({
            id: uid(),
            event: p.event || '',
            context: p.context || '',
            content: String(p.content || '').trim(),
            levelOverride: p.levelOverride || '',
            redConfirmed: !!p.redConfirmed
          });
        });
        runScoring();
      } catch (e) {
        alert('JSON 解析失败：' + e.message + '\n\n期望格式：{"posts":[{"content":"发言内容","event":"事件名","context":"对方观点"}]}');
      }
    };
    reader.readAsText(file);
  }

  function exportJSON() {
    var data = {
      exported_at: new Date().toISOString(),
      posts: state.posts,
      results: state.results.map(function (r) {
        return { event: r.event, dims: r.dims, raw: r.raw, confidence: r.confidence, final: r.final };
      }),
      questions: state.questions,
      bets: state.bets,
      ledger: state.ledger
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jp-ladder-export-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearAll() {
    if (!confirm('确定清空所有发言、评分、预测问题和投注记录？此操作不可恢复。')) return;
    state.posts = [];
    state.results = [];
    state.drafts = [];
    state.questions = [];
    state.bets = [];
    state.ledger = [];
    save();
    renderAll();
  }

  /* ---------- 评分 ---------- */
  function runScoring() {
    state.results = Engine.scoreAll(state.posts);
    syncDebateLedger();
    save();
    renderAll();
  }

  function rerunWithLLM() {
    var s = state.settings.llm;
    if (!s.key) { alert('请先在「设置」中填写 LLM API Key'); return; }
    if (!state.posts.length) { alert('暂无发言数据'); return; }
    var btn = $('btn-llm');
    if (btn) { btn.disabled = true; btn.textContent = 'LLM 评分中…'; }

    var chain = Promise.resolve();
    state.posts.forEach(function (post, i) {
      chain = chain.then(function () {
        var p = Engine.buildPrompt(post);
        return fetch(s.base.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
          body: JSON.stringify({
            model: s.model,
            messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
            temperature: 0.2,
            response_format: { type: 'json_object' }
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d.choices || !d.choices[0]) throw new Error(d.error ? d.error.message : '接口返回异常');
          var obj = JSON.parse(d.choices[0].message.content);
          var ev = post.levelOverride
            ? { level: post.levelOverride, R: Engine.EVENT_LEVELS[post.levelOverride].R }
            : Engine.classifyEvent(post.event, post.content);
          var dims = {
            evidence: cap100(obj.scores.evidence), logic: cap100(obj.scores.logic),
            relevance: cap100(obj.scores.relevance), novelty: cap100(obj.scores.novelty),
            civility: cap100(obj.scores.civility)
          };
          var raw = dims.evidence * 0.30 + dims.logic * 0.25 + dims.relevance * 0.20 + dims.novelty * 0.15 + dims.civility * 0.10;
          var confidence = Math.min(0.95, Math.max(0.6, obj.confidence || 0.85));
          var final;
          if (obj.red_line) {
            dims.logic = Math.min(dims.logic, 20);
            raw = Math.min(raw, 30);
            final = -ev.R * 0.6 * confidence;
          } else {
            final = (raw - 50) / 50 * ev.R * confidence;
          }
          state.results[i] = {
            post: post, event: ev, dims: dims,
            raw: Math.round(raw * 10) / 10, confidence: confidence,
            final: Math.round(final * 10) / 10,
            redLine: { suspected: !!obj.red_line, confirmed: !!obj.red_line, reasons: obj.flags || [] },
            reasons: (obj.reasons || []).map(function (t) { return { type: 'info', text: String(t) }; }),
            llm: true
          };
        });
      }).catch(function (e) {
        state.results[i] = state.results[i] || {};
        state.results[i].llmError = e.message;
      });
    });

    chain.then(function () {
      syncDebateLedger();
      save();
      renderAll();
      if (btn) { btn.disabled = false; btn.textContent = 'LLM 重新评分'; }
    });
  }
  function cap100(v) { v = Number(v); return isNaN(v) ? 50 : Math.max(0, Math.min(100, Math.round(v))); }

  /* ---------- 渲染：辩论战报 ---------- */
  function renderReport() {
    var panel = $('report');
    if (!panel) return;
    if (!state.results.length) {
      panel.innerHTML = '<div class="empty-state">' +
        '<div class="empty-title">还没有评分数据</div>' +
        '<div class="empty-tip">在左侧粘贴发言、导入 JSON，或直接载入演示数据，然后点击「开始评分」。</div>' +
        '</div>';
      return;
    }

    var total = debatePoints();
    var positive = state.results.filter(function (r) { return r.final > 0; }).length;
    var avgDims = { evidence: 0, logic: 0, relevance: 0, novelty: 0, civility: 0 };
    state.results.forEach(function (r) {
      for (var k in avgDims) avgDims[k] += r.dims[k];
    });
    for (var k in avgDims) avgDims[k] = Math.round(avgDims[k] / state.results.length);

    var tier = Engine.tierOf(total);
    var next = Engine.nextTier(total);
    var progress = next
      ? Math.max(0, Math.min(100, (total - tier.min) / (next.min - tier.min) * 100))
      : 100;

    var html = '';
    html += '<div class="stat-row">' +
      statCard('辩论积分', '<span style="color:' + scoreColor(total) + '">' + fmt(total) + '</span>') +
      statCard('当前段位', '<span class="tier-badge">' + tier.tier + ' · ' + esc(tier.name) + '</span>') +
      statCard('正分率', positive + '/' + state.results.length) +
      statCard('评分条数', state.results.length + ' 条') +
      '</div>';

    html += '<div class="card"><div class="card-title">段位进度</div>' +
      '<div class="tier-progress"><div class="tier-progress-fill" style="width:' + progress.toFixed(1) + '%"></div></div>' +
      '<div class="tier-progress-text">' +
      (next ? '距离下一段位「' + next.tier + ' · ' + esc(next.name) + '」还需 ' + fmt(next.min - total) + ' 分'
            : '已达最高段位') +
      '</div></div>';

    html += '<div class="card"><div class="card-title">五维画像（全部发言均值）</div>' +
      '<div class="radar-wrap"><svg id="radar" width="100%"></svg></div></div>';

    html += '<div class="card"><div class="card-title">逐条点评</div><div class="post-list">';
    state.results.forEach(function (r, i) { html += postCard(r, i); });
    html += '</div></div>';

    html += '<div class="report-actions">' +
      '<button class="btn" id="btn-export">导出 JSON</button>' +
      '<button class="btn btn-danger" id="btn-clear">清空数据</button>' +
      '</div>';

    panel.innerHTML = html;

    if ($('radar')) renderRadar($('radar'), avgDims);
    on('btn-export', 'click', exportJSON);
    on('btn-clear', 'click', clearAll);
    Array.prototype.forEach.call(panel.querySelectorAll('[data-level]'), function (sel) {
      sel.addEventListener('change', function () {
        var i = Number(sel.getAttribute('data-level'));
        state.posts[i].levelOverride = sel.value;
        runScoring();
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-red]'), function (cb) {
      cb.addEventListener('change', function () {
        var i = Number(cb.getAttribute('data-red'));
        state.posts[i].redConfirmed = cb.checked;
        runScoring();
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-delpost]'), function (btn) {
      btn.addEventListener('click', function () {
        var i = Number(btn.getAttribute('data-delpost'));
        state.posts.splice(i, 1);
        runScoring();
      });
    });
  }

  function statCard(label, value) {
    return '<div class="stat-card"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div></div>';
  }

  function postCard(r, i) {
    var ls = levelStyle(r.event.level);
    var dimNames = { evidence: '论据', logic: '逻辑', relevance: '针对性', novelty: '增量', civility: '礼仪' };
    var bars = '';
    for (var k in dimNames) {
      bars += '<div class="dim-row"><span class="dim-name">' + dimNames[k] + '</span>' +
        '<span class="dim-bar"><span class="dim-fill" style="width:' + r.dims[k] + '%"></span></span>' +
        '<span class="dim-val">' + r.dims[k] + '</span></div>';
    }

    var reasons = r.reasons.map(function (x) {
      return '<li class="reason-' + x.type + '">' + esc(x.text) + '</li>';
    }).join('');
    if (r.llmError) reasons += '<li class="reason-bad">LLM 调用失败：' + esc(r.llmError) + '（沿用离线评分）</li>';
    if (r.redLine.suspected && !r.redLine.confirmed) {
      reasons += '<li class="reason-bad">疑似命中红线但未确认，得分未进入负分区</li>';
    }

    var levelOptions = ['S', 'A', 'B', 'C'].map(function (lv) {
      return '<option value="' + lv + '"' + (r.event.level === lv ? ' selected' : '') + '>' + lv + '（' + levelStyle(lv).name + ' ±' + Engine.EVENT_LEVELS[lv].R + '）</option>';
    }).join('');

    return '<div class="post-card">' +
      '<div class="post-head">' +
        '<span class="level-badge" style="background:' + ls.bg + ';color:' + ls.fg + '">' + r.event.level + ' ' + ls.name + '</span>' +
        '<span class="post-event">' + esc(r.post.event || '未命名事件') + '</span>' +
        '<span class="post-final" style="color:' + scoreColor(r.final) + '">' + fmt(r.final) + '</span>' +
      '</div>' +
      '<div class="post-content">' + esc(r.post.content) + '</div>' +
      (r.post.context ? '<div class="post-context">对线上下文：' + esc(r.post.context) + '</div>' : '') +
      '<div class="dims">' + bars + '</div>' +
      '<div class="post-meta">原始分 ' + r.raw + ' · 置信度 ' + r.confidence + ' · R = ±' + r.event.R + (r.llm ? ' · LLM 评分' : ' · 离线评分') + '</div>' +
      '<ul class="reasons">' + reasons + '</ul>' +
      '<div class="post-controls">' +
        '<label>定级 <select data-level="' + i + '">' + levelOptions + '</select></label>' +
        (r.redLine.suspected ? '<label class="redline-check"><input type="checkbox" data-red="' + i + '"' + (r.redLine.confirmed ? ' checked' : '') + '> 确认红线（造谣/人身攻击）</label>' : '') +
        '<button class="btn-link" data-delpost="' + i + '">删除</button>' +
      '</div>' +
      '</div>';
  }

  /* ---------- 渲染：预测下注 ---------- */
  function renderBetting() {
    renderBank();
    var list = $('question-list');
    if (list) {
      if (!state.questions.length) {
        list.innerHTML = '<div class="card"><div class="q-empty">暂无问题。在下方「新建问题」创建一个，或到「辩论评分 → JSON / 演示」载入完整演示数据。</div></div>';
      } else {
        list.innerHTML = state.questions.map(questionCard).join('');
        bindQuestionEvents();
      }
    }
    renderMyBets();
    renderLoans();
  }

  /* ---------- 渲染：热点题库 ---------- */
  function renderBank() {
    var box = $('bank-list');
    if (!box) return;
    var titles = {};
    state.questions.forEach(function (q) { titles[q.title] = true; });

    box.innerHTML = QUESTION_BANK.map(function (b) {
      var imported = !!titles[b.title];
      var modeTxt = b.mode === 'fixed'
        ? '固定赔率 ' + b.outcomes.map(function (o) { return o.fixedOdds.toFixed(2); }).join(' / ')
        : '彩池赔率';
      return '<div class="bank-item">' +
        '<div class="bank-main">' +
        '<span class="bank-cat">' + esc(b.category) + '</span>' +
        '<span class="bank-title">' + esc(b.title) + '</span>' +
        '<div class="bank-meta">截止 ' + esc(b.deadline) + ' · ' + modeTxt +
        ' · <a href="' + esc(b.source.url) + '" target="_blank" rel="noopener">来源：' + esc(b.source.platform) + '热议</a></div>' +
        '</div>' +
        (imported
          ? '<button class="btn" disabled>已加入</button>'
          : '<button class="btn" data-bank-add="' + b.id + '">加入</button>') +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-bank-add]'), function (btn) {
      btn.addEventListener('click', function () { importBankQuestion(btn.getAttribute('data-bank-add')); });
    });
  }

  function importBankQuestion(bankId) {
    var b = null;
    for (var i = 0; i < QUESTION_BANK.length; i++) {
      if (QUESTION_BANK[i].id === bankId) { b = QUESTION_BANK[i]; break; }
    }
    if (!b) return;
    if (state.questions.some(function (q) { return q.title === b.title; })) {
      alert('这个问题已经在你的列表里了');
      return;
    }
    var outcomes = b.outcomes.map(function (o) {
      var out = { id: o.id + '-' + Date.now().toString(36), label: o.label };
      if (o.fixedOdds) out.fixedOdds = o.fixedOdds;
      return out;
    });
    var pool = {};
    if (b.mode === 'pool' && b.simPool) {
      outcomes.forEach(function (o) { pool[o.id] = b.simPool; });
    }
    state.questions.unshift({
      id: uid(), title: b.title, desc: b.desc, mode: b.mode,
      fee: b.mode === 'pool' ? b.fee : 0,
      deadline: b.deadline, status: 'open',
      outcomes: outcomes, pool: pool, userPool: {},
      createdAt: Date.now(), fromBank: b.id
    });
    save();
    renderBetting();
  }

  function questionCard(q) {
    var total = totalPoints();
    var cur = Betting.currentOdds(q);
    var settled = q.status === 'settled';
    var openBet = betOf(q.id);
    var openStake = state.bets.filter(function (b) { return b.questionId === q.id && b.status === 'open'; })
      .reduce(function (s, b) { return s + b.stake; }, 0);
    /* 已揭晓的问题展示最近一笔任意状态的投注；进行中的问题只认未结算投注 */
    var myBet = settled
      ? state.bets.filter(function (b) { return b.questionId === q.id; })
          .sort(function (a, b) { return b.placedAt - a.placedAt; })[0] || null
      : openBet;
    var canBet = !settled && total >= 10;

    var head = '<div class="q-head">' +
      '<span class="q-status ' + (settled ? 'settled' : 'open') + '">' + (settled ? '已揭晓' : '进行中') + '</span>' +
      '<span class="q-mode">' + (q.mode === 'fixed' ? '固定赔率' : '彩池赔率 · 抽水 ' + Math.round(q.fee * 100) + '%') + '</span>' +
      (q.deadline ? '<span class="q-deadline">截止 ' + esc(q.deadline) + '</span>' : '') +
      (openStake ? '<span class="q-status open">已下注 ' + openStake + ' 分</span>' : '') +
      '</div>';

    var outcomes = '<div class="q-outcomes">' + q.outcomes.map(function (o) {
      var cls = settled ? (o.id === q.result ? 'win' : 'dim') : '';
      var oddsTxt = settled && o.id === q.result
        ? '最终 ' + Betting.fmtOdds(q.finalOdds)
        : Betting.fmtOdds(cur.odds[o.id]);
      var poolTxt = cur.pools ? '池 ' + Math.round(cur.pools[o.id]).toLocaleString() : '';
      var radio = settled ? '' :
        '<input type="radio" name="q-' + q.id + '" value="' + o.id + '"' + (myBet && myBet.outcomeId === o.id ? ' checked' : '') + '>';
      return '<label class="outcome-row ' + cls + '">' + radio +
        '<span class="outcome-label">' + esc(o.label) + '</span>' +
        '<span class="outcome-odds">' + oddsTxt + '</span>' +
        '<span class="outcome-pool">' + poolTxt + '</span></label>';
    }).join('') + '</div>';

    var betRow = '';
    if (settled) {
      if (myBet) {
        var won = myBet.status === 'won';
        betRow = '<div class="bet-row"><span>我的投注：' + esc(outcomeLabel(q, myBet.outcomeId)) +
          ' · ' + myBet.stake + ' 分（赔率 ' + myBet.oddsAtBet.toFixed(2) + '）→ </span>' +
          '<span class="pot">' + (won ? '派彩 +' + myBet.payout + ' 分' : '未中，−' + myBet.stake + ' 分') + '</span></div>';
      } else {
        betRow = '<div class="bet-row"><span>你没有投注这个问题。</span></div>';
      }
    } else if (canBet) {
      betRow = '<div class="bet-row">' +
        '<span>投注</span><input type="number" min="10" step="10" value="50" data-stake="' + q.id + '">' +
        '<span>预计赔付 <b class="pot" data-pot="' + q.id + '">—</b></span>' +
        '<button class="btn btn-primary" data-bet="' + q.id + '" style="width:auto;padding:5px 14px">确认下注</button>' +
        '</div>';
    } else if (!settled) {
      betRow = '<div class="bet-row"><span>可用积分不足 10 分，先去「辩论评分」赚点积分。</span></div>';
    }

    var hostRow = settled ? '' :
      '<div class="host-row"><span>主办方（演示）：</span>' +
      '<select data-resolve="' + q.id + '">' + q.outcomes.map(function (o) {
        return '<option value="' + o.id + '">揭晓为：' + esc(o.label) + '</option>';
      }).join('') + '</select>' +
      '<button class="btn" data-settle="' + q.id + '">揭晓结算</button></div>';

    return '<div class="q-card">' + head +
      '<div class="q-title">' + esc(q.title) + '</div>' +
      (q.desc ? '<div class="q-desc">' + esc(q.desc) + '</div>' : '') +
      outcomes + betRow + hostRow + '</div>';
  }

  function bindQuestionEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-stake]'), function (input) {
      function update() {
        var q = findQuestion(input.getAttribute('data-stake'));
        if (!q) return;
        var sel = document.querySelector('input[name="q-' + q.id + '"]:checked');
        var pot = document.querySelector('[data-pot="' + q.id + '"]');
        if (!sel || !pot) return;
        var stake = Math.floor(Number(input.value) || 0);
        pot.textContent = stake >= 10 ? Betting.potentialPayout(q, sel.value, stake).toFixed(1) + ' 分' : '—';
      }
      input.addEventListener('input', update);
      update();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bet]'), function (btn) {
      btn.addEventListener('click', function () {
        var q = findQuestion(btn.getAttribute('data-bet'));
        if (!q) return;
        var sel = document.querySelector('input[name="q-' + q.id + '"]:checked');
        if (!sel) { alert('先选择一个选项'); return; }
        var input = document.querySelector('[data-stake="' + q.id + '"]');
        placeBet(q.id, sel.value, input ? input.value : 0);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-settle]'), function (btn) {
      btn.addEventListener('click', function () {
        var q = findQuestion(btn.getAttribute('data-settle'));
        if (!q) return;
        var sel = document.querySelector('[data-resolve="' + q.id + '"]');
        var label = sel ? outcomeLabel(q, sel.value) : '';
        if (!confirm('确认揭晓「' + q.title + '」？\n结果：' + label + '\n揭晓后相关投注将立即结算，不可撤销。')) return;
        settleQuestion(q.id, sel ? sel.value : '');
      });
    });
  }

  function placeBet(qid, oid, stake) {
    var q = findQuestion(qid);
    if (!q || q.status !== 'open') return;
    stake = Math.floor(Number(stake));
    var total = totalPoints();
    if (!(stake >= 10)) { alert('投注额最少 10 分'); return; }
    if (stake > Math.floor(total)) { alert('积分不足：当前可用 ' + Math.floor(total) + ' 分'); return; }
    var odds = Betting.currentOdds(q).odds[oid];
    state.bets.push({
      id: uid(), questionId: qid, outcomeId: oid, stake: stake,
      oddsAtBet: Math.round(odds * 100) / 100,
      placedAt: Date.now(), status: 'open', payout: 0
    });
    q.userPool = q.userPool || {};
    q.userPool[oid] = (q.userPool[oid] || 0) + stake;
    appendLedger('stake', -stake, '下注 · ' + q.title + ' → ' + outcomeLabel(q, oid) + '（赔率 ' + odds.toFixed(2) + '）');
    save();
    renderAll();
  }

  function settleQuestion(qid, resultOid) {
    var q = findQuestion(qid);
    if (!q || q.status !== 'open' || !resultOid) return;
    q.status = 'settled';
    q.result = resultOid;
    q.settledAt = Date.now();
    var finalOdds = Betting.settleOdds(q);
    q.finalOdds = Math.round(finalOdds * 100) / 100;
    state.bets.forEach(function (b) {
      if (b.questionId !== qid || b.status !== 'open') return;
      if (b.outcomeId === resultOid) {
        b.status = 'won';
        b.payout = Math.round(b.stake * finalOdds * 10) / 10;
        appendLedger('payout', b.payout, '派彩 · ' + q.title + ' → ' + outcomeLabel(q, resultOid) + '（赔率 ' + q.finalOdds.toFixed(2) + '）');
      } else {
        b.status = 'lost';
      }
    });
    save();
    renderAll();
  }

  function renderMyBets() {
    var box = $('my-bets');
    if (!box) return;
    if (!state.bets.length) {
      box.innerHTML = '<div class="card"><div class="card-title">我的投注</div><div class="q-empty">还没有投注记录。</div></div>';
      return;
    }
    var rows = state.bets.slice().sort(function (a, b) { return b.placedAt - a.placedAt; }).map(function (b) {
      var q = findQuestion(b.questionId);
      if (!q) return '';
      var statusTxt = { open: '进行中', won: '已派彩', lost: '未中' }[b.status];
      var resultTxt = b.status === 'won' ? '<span class="amt-gain">+' + b.payout + '</span>'
        : (b.status === 'lost' ? '<span class="amt-loss">−' + b.stake + '</span>' : '<span style="color:var(--text-3)">待揭晓</span>');
      return '<div class="bet-item">' +
        '<span class="bet-status ' + b.status + '">' + statusTxt + '</span>' +
        '<span class="bet-q">' + esc(q.title) + ' → ' + esc(outcomeLabel(q, b.outcomeId)) + '</span>' +
        '<span>' + b.stake + ' 分 @ ' + b.oddsAtBet.toFixed(2) + '</span>' +
        '<span>' + resultTxt + '</span>' +
        '</div>';
    }).join('');
    box.innerHTML = '<div class="card"><div class="card-title">我的投注</div>' + rows + '</div>';
  }

  function createQuestion() {
    var title = $('q-title').value.trim();
    var desc = $('q-desc').value.trim();
    var mode = $('q-mode').value;
    var deadline = $('q-deadline').value;
    var lines = $('q-outcomes').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var simpool = $('q-simpool').checked;

    if (!title) { alert('请填写问题标题'); return; }
    if (lines.length < 2 || lines.length > 4) { alert('选项需 2-4 个，每行一个'); return; }

    var outcomes = lines.map(function (label, i) {
      return { id: 'o' + i + '-' + Date.now().toString(36), label: label };
    });
    if (mode === 'fixed') {
      var oddsList = $('q-odds').value.split(/[,，]/).map(function (s) { return Number(s.trim()); });
      if (oddsList.length !== outcomes.length || oddsList.some(function (v) { return !(v >= 1.01); })) {
        alert('固定赔率需为 ' + outcomes.length + ' 个不小于 1.01 的数字，逗号分隔');
        return;
      }
      outcomes.forEach(function (o, i) { o.fixedOdds = oddsList[i]; });
    }

    var pool = {};
    if (mode === 'pool' && simpool) {
      outcomes.forEach(function (o) { pool[o.id] = 1000; });
    }
    state.questions.unshift({
      id: uid(), title: title, desc: desc, mode: mode,
      fee: mode === 'pool' ? 0.05 : 0,
      deadline: deadline, status: 'open',
      outcomes: outcomes, pool: pool, userPool: {},
      createdAt: Date.now()
    });
    save();
    renderAll();
    $('q-title').value = '';
    $('q-desc').value = '';
    $('q-outcomes').value = '';
    $('q-odds').value = '';
  }

  /* ---------- 借贷（LoanCore 纯函数，单机唯一玩家 uid=me） ---------- */
  function soloLoanSettings() { return { site: {} }; }
  function loanSummary() {
    var sum = LoanCore.summaryOf(ME, state.bets.map(function (b) {
      return { uid: ME, stake: b.stake, status: b.status, payout: b.payout };
    }), state.loans, state.loanPayments, soloLoanSettings());
    /* 单机版现金口径 = 天梯总积分（含辩论分），覆盖 cashOf 的 bonus 口径 */
    var openStake = state.bets.filter(function (b) { return b.status === 'open'; })
      .reduce(function (s, b) { return s + Number(b.stake); }, 0);
    sum.cash = totalPoints();
    sum.netWorth = LoanCore.round2(totalPoints() + openStake - sum.debt);
    sum.bankrupt = sum.netWorth < LoanCore.DEFAULTS.force_min_net;
    return sum;
  }
  /* 破产保护：净资产跌破破产线 → 自动核销全部未清借款（记录留存，本金仍计现金） */
  function checkBankruptcy() {
    var open = state.loans.filter(function (l) { return l.status === 'open'; });
    if (!open.length) return;
    if (!loanSummary().bankrupt) return;
    open.forEach(function (l) { l.status = 'written_off'; l.closed_at = new Date().toISOString(); });
    save();
    alert('已触发破产保护：全部负债已核销清零，从头再来。\n信用额度重置为 ' +
      LoanCore.creditLimitOf(ME, state.loans, soloLoanSettings()) + ' 分。');
  }
  function borrow(amount) {
    var chk = LoanCore.canBorrowOf(ME, amount, [], state.loans, soloLoanSettings());
    if (!chk.ok) { alert(chk.reason); return; }
    var p = LoanCore.DEFAULTS;
    if (!confirm('确认借款 ' + amount + ' 分？\n期限 ' + p.loan_term_days + ' 天，到期利息 ' +
      chk.interest + ' 分，到期日 ' + chk.dueDate + '。\n逾期每天按本金 ' +
      Math.round(p.loan_late_rate * 100) + '% 计罚息。\n\n这是游戏内信用额度，与真实货币无关。')) return;
    state.loans.unshift({
      lid: 'l-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36),
      uid: ME, principal: Math.floor(Number(amount)),
      rate: p.loan_rate, term_days: p.loan_term_days,
      due_date: chk.dueDate, status: 'open',
      repaid_principal: 0, repaid_interest: 0, late_fee: 0,
      created_at: new Date().toISOString()
    });
    appendLedger('loan', Number(amount), '借款 · 到期 ' + chk.dueDate + ' · 利息 ' + chk.interest);
    save();
    renderAll();
  }
  function repay(lid) {
    var loan = state.loans.filter(function (l) { return l.lid === lid; })[0];
    if (!loan || loan.status !== 'open') { alert('借款不存在或已结清'); return; }
    var input = document.querySelector('[data-repay="' + lid + '"]');
    var amount = input ? Math.floor(Number(input.value) || 0) : 0;
    var o = LoanCore.outstandingOf(loan);
    if (!(amount > 0)) { alert('请输入还款金额'); return; }
    var plan = LoanCore.repayPlan(loan, amount);
    if (plan.total <= 0) { alert('当前无需还款'); return; }
    if (plan.total > Math.floor(totalPoints())) {
      alert('可用积分不足：需还 ' + plan.total + ' 分，当前可用 ' + Math.floor(totalPoints()) + ' 分');
      return;
    }
    LoanCore.applyRepayment(loan, plan, new Date().toISOString());
    state.loanPayments.push({
      lid: lid, uid: ME, amount: plan.total,
      principal_part: plan.principal, interest_part: plan.interest, late_part: plan.late,
      paidAt: Date.now()
    });
    appendLedger('repay', -plan.total, '还款 · 本金 ' + plan.principal + ' / 利息 ' + plan.interest +
      (plan.late ? ' / 罚息 ' + plan.late : ''));
    save();
    renderAll();
  }

  /* 渲染：借贷卡片（放在下注视图） */
  function renderLoans() {
    var box = $('loan-card');
    if (!box) return;
    var sum = loanSummary();
    var p = LoanCore.DEFAULTS;
    var statusHtml = sum.bankrupt
      ? '<span class="q-status expired">破产保护触发中</span>'
      : (sum.overdueCount ? '<span class="q-status expired">' + sum.overdueCount + ' 笔逾期</span>'
        : '<span class="q-status open">正常</span>');
    var html = '<div class="card-title">信用借贷</div>' +
      '<div class="stat-row">' +
      '<div class="stat-card"><div class="stat-label">信用额度</div><div class="stat-value">' + sum.limit + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">当前负债</div><div class="stat-value">' + sum.debt + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">可借</div><div class="stat-value">' + sum.available + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">状态</div><div class="stat-value" style="font-size:14px">' + statusHtml + '</div></div>' +
      '</div>' +
      '<p class="hint">规则：初始额度 ' + p.credit_initial + ' 分，每还清一笔 +' + p.credit_step +
      '，每笔逾期 −' + p.overdue_penalty + '（上限 ' + p.credit_max + '）。借款期限 ' + p.loan_term_days +
      ' 天、利率 ' + Math.round(p.loan_rate * 100) + '%，逾期每天按本金 ' + Math.round(p.loan_late_rate * 100) +
      '% 计罚息，还款顺序：罚息 → 利息 → 本金。净资产跌破 ' + p.force_min_net +
      ' 时触发破产保护：全部借款自动核销、从头再来（记录留存可查）。</p>' +
      '<p class="hint">⚠ 游戏内信用额度，不是真实借贷：不可充值、提现、转让，与真实货币无关。</p>' +
      '<div class="field"><label>借款金额（最少 ' + p.min_loan + ' 分，即时到账）</label>' +
      '<div class="form-row">' +
      '<div class="field" style="margin:0"><input type="number" id="loan-amount" min="' + p.min_loan + '" step="10" value="' +
      Math.min(100, Math.max(p.min_loan, Math.floor(sum.available))) + '" ' + (sum.available < p.min_loan ? 'disabled' : '') + '></div>' +
      '<div class="field" style="margin:0"><span class="hint">到期需还本息 ≈ <b id="loan-due">—</b> 分</span></div>' +
      '</div></div>' +
      '<button class="btn btn-primary" id="btn-borrow" style="width:auto" ' + (sum.available < p.min_loan ? 'disabled' : '') + '>确认借款</button>' +
      '<div class="card-title" style="margin-top:18px">我的借款</div>';
    if (!state.loans.length) {
      html += '<div class="q-empty">还没有借款记录。</div>';
    } else {
      html += state.loans.map(function (l) {
        var o = LoanCore.outstandingOf(l);
        var overdue = LoanCore.isOverdue(l);
        var badge = l.status === 'repaid' ? '<span class="q-status settled">已结清</span>'
          : (l.status === 'written_off' ? '<span class="q-status expired">已核销</span>'
            : (overdue ? '<span class="q-status expired">逾期 ' + LoanCore.daysOverdue(l) + ' 天</span>'
              : '<span class="q-status open">' + l.due_date + ' 到期</span>'));
        var detail = l.status === 'repaid' ? '已全额结清'
          : (l.status === 'written_off' ? '破产保护已核销：债务清零，记录留存'
            : '应还 ' + o.total + ' 分（本金 ' + o.principalLeft + (o.interestLeft ? ' + 利息 ' + o.interestLeft : '') +
              (o.lateLeft ? ' + 罚息 ' + o.lateLeft : '') + '）');
        var actions = l.status === 'open'
          ? '<div class="form-row" style="margin-top:6px;align-items:flex-end">' +
            '<div class="field" style="margin:0"><label>还款金额</label>' +
            '<input type="number" min="1" step="1" value="' + Math.ceil(o.total) + '" data-repay="' + l.lid + '" style="width:120px"></div>' +
            '<button class="btn btn-primary" data-do-repay="' + l.lid + '" style="width:auto">还款</button></div>'
          : '';
        return '<div class="loan-item' + (overdue ? ' loan-overdue' : '') + '">' +
          '<div class="loan-head"><span>借 ' + l.principal + ' 分 · 利率 ' + Math.round(Number(l.rate) * 100) + '% · ' + l.term_days + ' 天期</span>' + badge + '</div>' +
          '<div class="loan-detail">' + detail + '</div>' + actions + '</div>';
      }).join('');
    }
    box.innerHTML = html;
    on('btn-borrow', 'click', function () { borrow($('loan-amount').value); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-do-repay]'), function (btn) {
      btn.addEventListener('click', function () { repay(btn.getAttribute('data-do-repay')); });
    });
    var amt = $('loan-amount'), due = $('loan-due');
    if (amt && due) {
      function upd() {
        var v = Math.floor(Number(amt.value) || 0);
        due.textContent = v >= p.min_loan ? (v + Math.round(v * p.loan_rate * 100) / 100).toFixed(1) : '—';
      }
      amt.addEventListener('input', upd);
      upd();
    }
  }

  /* ---------- 渲染：个人中心 ---------- */
  /* ---------- 赛季徽章与战报（BadgeCore 纯函数） ---------- */
  function badgeData() {
    var qmap = {};
    state.questions.forEach(function (q) { qmap[q.id] = q; });
    return {
      bets: state.bets.map(function (b) {
        var q = qmap[b.questionId] || {};
        return {
          uid: ME, qid: b.questionId, outcome_id: b.outcomeId, stake: b.stake,
          odds_at_bet: b.oddsAtBet, status: b.status, payout: b.payout,
          placed_at: new Date(b.placedAt || Date.now()).toISOString(),
          settled_at: (b.status !== 'open' && q.settledAt) ? new Date(q.settledAt).toISOString() : '',
          kind: 'bet'
        };
      }),
      questions: state.questions.map(function (q) {
        return { qid: q.id, title: q.title, outcomes: q.outcomes || [] };
      }),
      loans: state.loans, payments: state.loanPayments,
      evidence: [], disputeVotes: [], debatePosts: []
    };
  }
  function renderSeasonCard() {
    var box = $('season-card');
    if (!box || typeof BadgeCore === 'undefined') return;
    var cfg = BadgeCore.seasonCfgOf({ season: state.settings.season || BadgeCore.DEFAULT_SEASON });
    var st = BadgeCore.seasonStats(ME, badgeData(), cfg);
    var html = '<div class="card-title">赛季战报 · ' + esc(st.season.name) +
      '（' + esc(st.season.start) + ' ~ ' + esc(st.season.end) + '）</div>' +
      '<div class="stat-row">' +
      statCard('本赛季战绩', st.won + ' 胜 / ' + st.lost + ' 负' + (st.settledCount ? '（' + st.winRate + '%）' : '')) +
      statCard('赛季净积分', '<span style="color:' + scoreColor(st.net) + '">' + fmt(st.net) + '</span>') +
      statCard('投注笔数', String(st.betCount)) +
      statCard('获得徽章', String(st.badges)) +
      '</div>';
    html += st.best
      ? '<p class="hint">最得意的一场：<b>' + esc(st.best.title) + '</b> ' + fmt(st.best.delta) + ' 分' +
        (st.worst ? '　·　最大败笔：<b>' + esc(st.worst.title) + '</b> ' + fmt(st.worst.delta) + ' 分' : '') + '</p>'
      : '<p class="hint">本赛季还没有投注。押下第一笔后，这里会生成完整战报。</p>';
    box.innerHTML = html;
  }
  function renderBadgeWall() {
    var box = $('badge-card');
    if (!box || typeof BadgeCore === 'undefined') return;
    var all = BadgeCore.allBadges(ME, badgeData());
    var earned = all.filter(function (b) { return b.earned; }).length;
    var html = '<div class="card-title">徽章墙（' + earned + ' / ' + all.length + '）</div>' +
      '<div class="badge-grid">' +
      all.map(function (b) {
        var pct = Math.round(b.progress * 100);
        return '<div class="badge-item' + (b.earned ? ' earned' : '') + '" title="' + esc(b.desc) + '">' +
          '<div class="badge-icon">' + (b.earned ? b.icon : '🔒') + '</div>' +
          '<div class="badge-name">' + esc(b.name) + '</div>' +
          '<div class="badge-desc">' + esc(b.desc) + '</div>' +
          (b.earned ? '<div class="badge-state">已获得</div>'
            : '<div class="badge-bar"><i style="width:' + pct + '%"></i></div>' +
              '<div class="badge-state">' + esc(b.progressText || '未获得') + '</div>') +
          '</div>';
      }).join('') + '</div>';
    box.innerHTML = html;
  }

  function renderProfile() {
    var box = $('profile-stats');
    if (box) {
      var total = totalPoints();
      var lsum = loanSummary();
      var dp = debatePoints();
      var bp = bettingPoints();
      var settledBets = state.bets.filter(function (b) { return b.status !== 'open'; });
      var won = settledBets.filter(function (b) { return b.status === 'won'; }).length;
      var staked = state.ledger.filter(function (e) { return e.type === 'stake'; }).reduce(function (s, e) { return s - e.amount; }, 0);
      var recovered = state.ledger.filter(function (e) { return e.type === 'payout'; }).reduce(function (s, e) { return s + e.amount; }, 0);
      var tier = Engine.tierOf(total);
      var next = Engine.nextTier(total);
      var progress = next
        ? Math.max(0, Math.min(100, (total - tier.min) / (next.min - tier.min) * 100))
        : 100;

      box.innerHTML =
        '<div class="stat-row">' +
          statCard('总积分', '<span style="color:' + scoreColor(total) + '">' + fmt(total) + '</span>') +
          statCard('当前段位', '<span class="tier-badge">' + tier.tier + ' · ' + esc(tier.name) + '</span>') +
          statCard('辩论积分', '<span style="color:' + scoreColor(dp) + '">' + fmt(dp) + '</span>') +
          statCard('投注净盈亏', '<span style="color:' + scoreColor(bp) + '">' + fmt(bp) + '</span>') +
        '</div>' +
        '<div class="stat-row">' +
          statCard('当前负债', '<span style="color:' + (lsum.debt > 0 ? 'var(--green)' : 'inherit') + '">' + (lsum.debt ? lsum.debt + ' 分' : '无') + '</span>') +
          statCard('净资产', '<span style="color:' + scoreColor(lsum.netWorth) + '">' + fmt(lsum.netWorth) + '</span>') +
          statCard('信用额度', lsum.limit + '（可借 ' + lsum.available + '）') +
          statCard('借贷状态', lsum.bankrupt ? '破产保护触发' : (lsum.overdueCount ? lsum.overdueCount + ' 笔逾期' : '正常')) +
        '</div>' +
        '<div class="stat-row">' +
          statCard('投注战绩', won + ' 胜 / ' + (settledBets.length - won) + ' 负') +
          statCard('累计投入', staked + ' 分') +
          statCard('累计回收', recovered + ' 分') +
          statCard('可投注积分', Math.max(0, Math.floor(total)) + ' 分') +
        '</div>' +
        '<div class="card"><div class="card-title">段位进度</div>' +
        '<div class="tier-progress"><div class="tier-progress-fill" style="width:' + progress.toFixed(1) + '%"></div></div>' +
        '<div class="tier-progress-text">' +
        (next ? '距离下一段位「' + next.tier + ' · ' + esc(next.name) + '」还需 ' + fmt(next.min - total) + ' 分' : '已达最高段位') +
        '</div></div>';
    }

    renderSeasonCard();
    renderBadgeWall();

    var ledger = $('ledger');
    if (ledger) {
      if (!state.ledger.length) {
        ledger.innerHTML = '<div class="q-empty">暂无流水记录。评分发言或参与投注后，这里会显示每一笔积分的得与失。</div>';
      } else {
        var typeName = { debate: '辩论', stake: '下注', payout: '派彩', loan: '借款', repay: '还款' };
        var rows = state.ledger.slice().reverse().map(function (e) {
          var amtClass = e.amount > 0 ? 'amt-gain' : (e.amount < 0 ? 'amt-loss' : '');
          return '<tr>' +
            '<td>' + fmtTs(e.ts) + '</td>' +
            '<td><span class="ledger-type ' + e.type + '">' + typeName[e.type] + '</span></td>' +
            '<td class="amt ' + amtClass + '">' + fmt(e.amount) + '</td>' +
            '<td class="bal">' + e.balanceAfter.toFixed(1) + '</td>' +
            '<td class="ledger-note" title="' + esc(e.note) + '">' + esc(e.note) + '</td>' +
            '</tr>';
        }).join('');
        ledger.innerHTML = '<table class="ledger-table"><thead><tr>' +
          '<th>时间</th><th>类型</th><th style="text-align:right">变动</th><th style="text-align:right">结余</th><th>说明</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>';
      }
    }
    on('btn-export2', 'click', exportJSON);
    on('btn-clear2', 'click', clearAll);
  }

  /* ---------- 视图切换 ---------- */
  function switchView(name) {
    state.view = name;
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('active', v.id === 'view-' + name);
    });
    if (name === 'betting') renderBetting();
    if (name === 'profile') renderProfile();
  }

  function renderAll() {
    checkBankruptcy();
    renderDrafts();
    renderReport();
    renderBetting();
    renderProfile();
  }

  /* ---------- 设置 ---------- */
  function openSettings() {
    var s = state.settings.llm;
    $('set-llm-base').value = s.base;
    $('set-llm-key').value = s.key;
    $('set-llm-model').value = s.model;
    $('set-llm-enabled').checked = s.enabled;
    $('modal-mask').classList.add('open');
  }
  function closeSettings() { $('modal-mask').classList.remove('open'); }
  function saveSettingsFromForm() {
    state.settings.llm = {
      enabled: $('set-llm-enabled').checked,
      base: $('set-llm-base').value.trim(),
      key: $('set-llm-key').value.trim(),
      model: $('set-llm-model').value.trim()
    };
    saveSettings();
    updateEngineBadge();
    closeSettings();
  }
  function updateEngineBadge() {
    var badge = $('engine-badge');
    var llmBtn = $('btn-llm');
    var ready = !!(state.settings.llm.enabled && state.settings.llm.key);
    if (badge) {
      badge.textContent = ready ? '引擎：LLM（' + state.settings.llm.model + '）' : '引擎：离线启发式';
      badge.className = 'engine-badge' + (ready ? ' llm' : '');
    }
    if (llmBtn) llmBtn.style.display = ready ? '' : 'none';
  }

  /* ---------- Tab ---------- */
  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-pane'), function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    load();
    updateEngineBadge();
    renderAll();

    on('btn-add-draft', 'click', addDraft);
    on('btn-score', 'click', commitDrafts);
    on('btn-demo', 'click', loadDemo);
    on('btn-llm', 'click', rerunWithLLM);
    on('btn-create-q', 'click', createQuestion);
    on('json-file', 'change', function (e) {
      if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    on('btn-settings', 'click', openSettings);
    on('btn-close-modal', 'click', closeSettings);
    on('btn-save-settings', 'click', saveSettingsFromForm);
    on('q-mode', 'change', function () {
      $('q-odds-field').style.display = $('q-mode').value === 'fixed' ? '' : 'none';
    });

    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });
    var mask = $('modal-mask');
    if (mask) {
      mask.addEventListener('click', function (e) {
        if (e.target === mask) closeSettings();
      });
    }
  }

  return { init: init };
})();
document.addEventListener('DOMContentLoaded', App.init);
