// 云函数 api：把小程序请求转发到明鉴云端，绕过“未备案域名不能直连”的限制
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const BASE = 'https://jp-ladder.app.workbuddy.host';
const ACCESS_KEY = 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK';

function forward(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'x-wb-webapp-access-key': ACCESS_KEY,
      'Content-Type': 'application/json'
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(BASE + path, { method, headers, timeout: 15000 }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(buf); } catch (e) { parsed = buf; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    if (data) req.write(data);
    req.end();
  });
}

exports.main = async (event) => {
  const { path, method = 'GET', body, token } = event || {};
  if (!path || path.charAt(0) !== '/') return { status: 400, data: { error: 'bad path' } };
  try {
    return await forward(path, method, body, token);
  } catch (e) {
    return { status: 599, data: { error: e.message } };
  }
};
