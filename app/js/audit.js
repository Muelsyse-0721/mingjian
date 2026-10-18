/* ============================================================
 * 明鉴 · 通用审计日志客户端helper（无 DOM）
 * 依赖：全局 Auth（app/js/auth.js，可选；缺失时记 actor='guest'）
 *       以及调用方传入的 cloud.database（genie-baas SDK）。
 *
 * 设计要点：
 *  - 不直接操作 DOM，纯函数式 helper，便于在 settle / dispute / admin
 *    等写操作前后统一埋点。
 *  - 与 jp_disputes 的 6 个争议专用审计列分工明确：本模块只记录「通用
 *    动作事件」（谁对哪行做了什么），不重复记录争议前后字段级对照。
 *  - 失败优雅降级：Auth 缺失、cloud 未就绪、写入抛错都不会抛出未捕获
 *    异常，而是 resolve 一个 { error, skipped } 对象，由调用方决定
 *    是否提示（审计不应阻断主流程）。
 *
 * 暴露全局 Audit：
 *   ready(cloud?)           云数据库目标是否可用（Boolean）
 *   log(cloud, opts)        写入一条审计事件，返回 Promise<{data|error}>
 *     opts: { action, tbl, rowId, meta }
 * ============================================================ */
var Audit = (function () {
  'use strict';

  var TABLE = 'jp_audit_log';

  /* 解析动作执行者：优先用全局 Auth.getUid()，缺失/未登录则记 'guest' */
  function resolveActor() {
    try {
      if (typeof Auth !== 'undefined' && Auth && typeof Auth.getUid === 'function') {
        var u = Auth.getUid();
        if (u && u !== '') return u;
      }
    } catch (e) { /* Auth 异常不应影响审计记录 */ }
    return 'guest';
  }

  /* 云数据库目标是否可用（审计能否落地） */
  function ready(cloud) {
    var c = cloud;
    if (!c && typeof window !== 'undefined') c = window.WorkBuddyCloud;
    return !!(c && c.database && typeof c.database.from === 'function');
  }

  /* 构造待插入行（id / ts 由库默认值生成，这里不显式写入） */
  function buildRow(opts) {
    opts = opts || {};
    return {
      actor_uid: resolveActor(),
      action: opts.action != null ? String(opts.action) : '',
      tbl: opts.tbl != null ? String(opts.tbl) : '',
      row_id: opts.rowId != null ? String(opts.rowId) : '',
      meta: opts.meta != null ? opts.meta : null
    };
  }

  /* 写入一条审计事件。失败优雅降级，绝不抛未捕获异常。 */
  function log(cloud, opts) {
    if (!ready(cloud)) {
      return Promise.resolve({
        error: { message: '审计不可用：cloud.database 未就绪' },
        skipped: true
      });
    }
    var row = buildRow(opts);
    return Promise.resolve(
      cloud.database.from(TABLE).insert(row)
    ).then(function (r) {
      if (r && r.error) return { error: r.error, skipped: false, row: row };
      return { data: (r && r.data) || null, error: null, row: row };
    }).catch(function (err) {
      return {
        error: { message: (err && err.message) || '审计写入失败' },
        skipped: false,
        row: row
      };
    });
  }

  return {
    ready: ready,
    log: log,
    _buildRow: buildRow,   /* 暴露仅供测试：校验行构造形态 */
    _resolveActor: resolveActor
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Audit;
if (typeof window !== 'undefined') window.Audit = Audit;
