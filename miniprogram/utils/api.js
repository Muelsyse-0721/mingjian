const cfg = require('./config.js');

function headers(token) {
  const h = { 'x-wb-webapp-access-key': cfg.ACCESS_KEY };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

/* 统一请求：直连 或 云函数代理 */
function request(path, opts) {
  const o = opts || {};
  const method = o.method || 'GET';
  const token = o.token || (wx.getStorageSync('mj_token') || '');
  const body = o.body;

  if (cfg.USE_PROXY) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: cfg.PROXY_NAME,
        data: { path, method, body, token },
        success: (r) => {
          const d = r.result || {};
          if (d.status >= 200 && d.status < 300) resolve(d.data);
          else reject({ status: d.status, data: d.data });
        },
        fail: reject
      });
    });
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: cfg.BASE + path,
      method,
      data: body,
      header: Object.assign({ 'Content-Type': 'application/json' }, headers(token)),
      success: (r) => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data);
        else reject({ status: r.statusCode, data: r.data });
      },
      fail: reject
    });
  });
}

/* 数据面：/.cloud/database/rest/<table>?<query> */
function select(table, query, opts) {
  const q = query ? ('?' + query) : '';
  return request('/.cloud/database/rest/' + table + q, opts);
}

function insert(table, row, opts) {
  return request('/.cloud/database/rest/' + table, Object.assign({ method: 'POST', body: row }, opts));
}

function patch(table, filter, row, opts) {
  return request('/.cloud/database/rest/' + table + '?' + filter, Object.assign({ method: 'PATCH', body: row }, opts));
}

module.exports = { request, select, insert, patch };
