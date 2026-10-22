/* ============================================================
 * auth-test.js —— 独立验证 Auth 模块（app/js/auth.js）
 * 使用 mock cloud.auth + mock database，不依赖真实云服务 / jsdom。
 * 运行：node app/test/auth-test.js
 * ============================================================ */
'use strict';

/* ---- localStorage 垫片（node 无原生 localStorage） ---- */
global.localStorage = (function () {
  var m = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    clear: function () { m = {}; }
  };
})();

var Auth = require('../js/auth.js');

/* ---- 测试计数 ---- */
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', a === b); }

/* ---- mock 构造 ---- */
function makeDb(opts) {
  opts = opts || {};
  return {
    from: function (t) {
      return {
        upsert: function (o) { return Promise.resolve({ data: [o] }); },
        update: function (o) { return { eq: function () { return Promise.resolve({ data: [] }); } }; },
        select: function () {
          return {
            eq: function () {
              return {
                limit: function () {
                  return Promise.resolve({ data: opts.nickname ? [{ nickname: opts.nickname }] : [] });
                }
              };
            }
          };
        }
      };
    }
  };
}

function makeAuth(state) {
  /* state: { hasSession, isExisting, sessionId } */
  state = state || {};
  var sessionId = state.sessionId || 'auth-uid-1';
  return {
    _calls: { sendOtp: 0, verifyOtp: 0, getSession: 0, signOut: 0 },
    sendOtp: function (p) {
      this._calls.sendOtp++;
      return Promise.resolve({ data: { verificationId: 'vid-' + p.phone, isExistingUser: !!state.isExisting } });
    },
    verifyOtp: function (p) {
      this._calls.verifyOtp++;
      return Promise.resolve({ data: { user: { id: sessionId, name: 'svc' } } });
    },
    getSession: function () {
      this._calls.getSession++;
      return Promise.resolve(state.hasSession ? { data: { user: { id: sessionId, name: 'svc' } } } : { data: null });
    },
    onAuthStateChange: function (cb) { this._changeCb = cb; },
    signOut: function () { this._calls.signOut++; return Promise.resolve({}); }
  };
}

function makeCloud(auth, db) { return { auth: auth, database: db || makeDb() }; }

/* ---- 测试主流程 ---- */
(async function () {
  console.log('=== Auth 模块单元测试 ===');

  /* T1：init 无会话 → 未登录 */
  (function () {
    var a = makeAuth({ hasSession: false });
    Auth.init(makeCloud(a));
    ok('T1 init 无会话时未登录', Auth.isAuthed() === false);
    ok('T1 init 后 uid 为空', Auth.getUid() === '');
  })();

  /* T2：手机号校验 */
  (function () {
    var a = makeAuth({});
    Auth.init(makeCloud(a));
    return Auth.sendCode('123').then(function (r) {
      ok('T2 非法手机号被拒', !!(r && r.error) && Auth.getPending() === null);
      return Auth.sendCode('1380013800').then(function (r2) {
        ok('T2 长度不足手机号被拒', !!(r2 && r2.error));
        return Auth.sendCode('13800138000').then(function (r3) {
          ok('T2 合法手机号进入 pending', !!(r3 && r3.data && Auth.getPending()));
          eq('T2 pending.phone 正确', Auth.getPending().phone, '13800138000');
        });
      });
    });
  })().then(function () {

  /* T3：新用户路径：isExistingUser=false → 登录后需 ensureNickname */
  return (function () {
    var a = makeAuth({ isExisting: false });
    Auth.init(makeCloud(a));
    return Auth.sendCode('13800138000').then(function () {
      return Auth.verify('13800138000', '123456').then(function (r) {
        ok('T3 校验成功建立会话', Auth.isAuthed() && Auth.getUid() === 'auth-uid-1');
        ok('T3 新用户初始昵称为空', Auth.getNickname() === '');
        return Auth.ensureNickname('测试名号').then(function (er) {
          ok('T3 合法昵称写入成功', !!(er && !er.error));
          eq('T3 昵称已设置', Auth.getNickname(), '测试名号');
          ok('T3 昵称缓存入 localStorage', localStorage.getItem('jp-auth-nick') === '测试名号');
          return Auth.ensureNickname('x').then(function (er2) {
            ok('T3 过短昵称被拒', !!(er2 && er2.error));
          });
        });
      });
    });
  })();

  }).then(function () {

  /* T4：已存在用户路径：isExistingUser=true → loadServerNickname 拉取 */
  return (function () {
    var a = makeAuth({ isExisting: true });
    Auth.init(makeCloud(a, makeDb({ nickname: '老玩家' })));
    return Auth.sendCode('13900139000').then(function () {
      return Auth.verify('13900139000', '654321').then(function () {
        ok('T4 已存在用户登录成功', Auth.isAuthed());
        return Auth.loadServerNickname().then(function () {
          eq('T4 昵称来自服务端', Auth.getNickname(), '老玩家');
        });
      });
    });
  })();

  }).then(function () {

  /* T5：verify 前置校验 */
  return (function () {
    var a = makeAuth({});
    Auth.init(makeCloud(a));
    return Auth.verify('13800138000', '123456').then(function (r) {
      ok('T5 未发验证码直接校验被拒', !!(r && r.error));
      return Auth.sendCode('13800138000').then(function () {
        return Auth.verify('13800138000', 'ab').then(function (r2) {
          ok('T5 非法验证码格式被拒', !!(r2 && r2.error));
        });
      });
    });
  })();

  }).then(function () {

  /* T6：旧 uid 迁移：把本机旧免登录战绩改写为新 auth uid */
  return (function () {
    var a = makeAuth({ isExisting: false });
    Auth.init(makeCloud(a));
    localStorage.setItem('jp-online-uid', 'old-local-uid');
    return Auth.sendCode('13700137000').then(function () {
      return Auth.verify('13700137000', '111111').then(function () {
        ok('T6 登录后 uid 为新 auth uid', Auth.getUid() === 'auth-uid-1');
        return Auth.migrateOldUid().then(function (res) {
          ok('T6 迁移标记成功', !!(res && res.migrated === true));
          eq('T6 迁移来源为旧 uid', res.from, 'old-local-uid');
          eq('T6 迁移目标为新 uid', res.to, 'auth-uid-1');
          ok('T6 旧 uid 本地键已清除', localStorage.getItem('jp-online-uid') === null);
        });
      });
    });
  })();

  }).then(function () {

  /* T7：无旧 uid 时不触发迁移 */
  (function () {
    localStorage.removeItem('jp-online-uid');
    return Auth.migrateOldUid().then(function (res) {
      ok('T7 无旧 uid 时跳过迁移', !!(res && res.migrated === false));
    });
  })();

  }).then(function () {

  /* T8：登出清空状态 */
  return (function () {
    return Auth.signOut().then(function () {
      ok('T8 登出后未登录', Auth.isAuthed() === false);
      eq('T8 uid 清空', Auth.getUid(), '');
      ok('T8 本地凭据已清', localStorage.getItem('jp-auth-phone') === null && localStorage.getItem('jp-auth-nick') === null);
    });
  })();

  }).then(function () {

  /* T9：云服务未就绪时优雅降级 */
  (function () {
    Auth.init({ database: makeDb() }); /* 无 auth 字段 */
    return Auth.sendCode('13800138000').then(function (r) {
      ok('T9 无 auth 时 sendCode 报错不崩溃', !!(r && r.error));
    });
  })();

  }).then(function () {

  /* T10：会话恢复时本地缓存为空 → 必须回读 jp_profiles（2026-10-22 线上「昵称未设置」回归） */
  return (function () {
    localStorage.clear();                     /* 模拟换浏览器 / 清缓存 */
    var a = makeAuth({ hasSession: true, sessionId: 'auth-uid-9' });
    return Promise.resolve(Auth.init(makeCloud(a, makeDb({ nickname: '管理员' }))))
      .then(function () { return new Promise(function (r) { setTimeout(r, 30); }); })
      .then(function () {
        eq('T10 恢复会话后昵称从服务端补齐', Auth.getNickname(), '管理员');
        ok('T10 已登录', Auth.isAuthed() === true);
      });
  })();

  }).then(function () {
    console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  }).catch(function (e) {
    console.error('测试异常:', e);
    process.exit(2);
  });
})();
