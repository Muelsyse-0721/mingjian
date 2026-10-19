/* 全局配置：与网站共用同一套云端 */
module.exports = {
  // 站点域名（数据面挂在 /.cloud/database/rest 下）
  BASE: 'https://jp-ladder.app.workbuddy.host',
  // 与网页同一个 publishable key（只读公开表；写入仍需登录 token）
  ACCESS_KEY: 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK',
  // 小程序无法直接请求未备案域名时，改走云函数代理
  USE_PROXY: false,
  PROXY_NAME: 'api',
  // 轮询间隔（毫秒）—— 网站写入后最迟这么久同步过来
  POLL_MS: 5000
};
