/* ============================================================
 * 明鉴 · 桌宠 LLM 直连（可选，默认关闭）
 *
 * 支持两种后端，配置只存本机 localStorage（jp-pet-llm），不上传：
 *   deepseek  —— 直连 https://api.deepseek.com/chat/completions（需 API Key）
 *   workbuddy —— 走平台云 SDK 的 cloud.llm（需 endpoint + publishableKey）
 * 任何失败都返回 null，由 pet.js 回退到内置脚本问答。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'jp-pet-llm';

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function setConfig(patch) {
    var c = Object.assign(getConfig(), patch || {});
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    return c;
  }

  function provider() {
    var c = getConfig();
    return c.provider || 'none';
  }

  function ready() {
    var c = getConfig();
    if (c.provider === 'deepseek') return !!c.deepseekKey;
    if (c.provider === 'workbuddy') return !!(c.wbEndpoint && c.wbKey);
    return false;
  }

  function askDeepSeek(c, text, persona) {
    return fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + c.deepseekKey
      },
      body: JSON.stringify({
        model: c.deepseekModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: persona },
          { role: 'user', content: text }
        ],
        max_tokens: 220,
        temperature: 0.8
      })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var m = j && j.choices && j.choices[0] && j.choices[0].message;
      return (m && m.content) ? String(m.content).trim() : null;
    });
  }

  var wbClient = null;

  function askWorkBuddy(c, text, persona) {
    if (!global.WorkBuddyCloud || !global.WorkBuddyCloud.createWorkBuddyCloud) {
      return Promise.resolve(null);
    }
    if (!wbClient) {
      wbClient = global.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: c.wbEndpoint,
        publishableKey: c.wbKey
      });
    }
    var model = c.wbModel || 'hunyuan-chat';
    return Promise.resolve(wbClient.llm.chat.completions.create({
      model: model,
      stream: false,
      max_tokens: 220,
      messages: [
        { role: 'system', content: persona },
        { role: 'user', content: text }
      ]
    })).then(function (res) {
      var m = res && res.choices && res.choices[0] && res.choices[0].message;
      return (m && m.content) ? String(m.content).trim() : null;
    });
  }

  function ask(text, persona) {
    var c = getConfig();
    if (!ready()) return Promise.resolve(null);
    var p;
    if (c.provider === 'deepseek') p = askDeepSeek(c, text, persona);
    else if (c.provider === 'workbuddy') p = askWorkBuddy(c, text, persona);
    else return Promise.resolve(null);
    return p.catch(function () { return null; });
  }

  global.PetLLM = {
    getConfig: getConfig,
    setConfig: setConfig,
    provider: provider,
    ready: ready,
    ask: ask
  };
})(window);
