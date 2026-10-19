/* ============================================================
 * profile-test.js —— 独立验证 ProfileCore（app/js/profile.js）
 * 纯函数、无 DOM、无云依赖；不需要任何环境变量。
 * 运行：node app/test/profile-test.js
 * 退出码：0 全绿 / 1 有失败
 * ============================================================ */
'use strict';

var P = require('../js/profile.js');

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, a, b) {
  var same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.log('       期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
  ok(name, same);
}
/* 断言 fn 不抛异常 */
function noThrow(name, fn) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(name, !threw);
}

console.log('=== ProfileCore 单元测试 ===');

/* ---------------- validatePassword ---------------- */
console.log('\n[validatePassword]');
eq('空密码被拒', P.validatePassword('').ok, false);
eq('空密码原因是「请输入密码」', P.validatePassword('').reason, '请输入密码');
eq('非字符串输入被拒', P.validatePassword(null).ok, false);
eq('5 位过短被拒', P.validatePassword('ab123').ok, false);
eq('5 位强度为 0', P.validatePassword('ab123').strength, 0);
eq('6 位纯数字被拒', P.validatePassword('123456').ok, false);
eq('纯数字原因含「字母」', /字母/.test(P.validatePassword('123456').reason), true);
eq('8 位纯字母被拒', P.validatePassword('abcdefgh').ok, false);
eq('合法密码通过', P.validatePassword('abc123').ok, true);
eq('合法密码 reason 为空', P.validatePassword('abc123').reason, '');
eq('65 位超长被拒', P.validatePassword(new Array(66).join('a') + '1').ok, false);
ok('长密码强度 > 短密码', P.validatePassword('Abc12345!xyz').strength > P.validatePassword('abc123').strength);
ok('强度上限为 4', P.validatePassword('Abc12345!xyzQ').strength <= 4);

/* ---------------- maskPhone ---------------- */
console.log('\n[maskPhone]');
eq('11 位手机号脱敏', P.maskPhone('13800138000'), '138****8000');
eq('中间带空格也能脱敏', P.maskPhone('138 0013 8000'), '138****8000');
eq('非法号码返回空串', P.maskPhone('123'), '');
eq('非字符串返回空串', P.maskPhone(null), '');
eq('PHONE_RE 对合法号码为真', P.PHONE_RE.test('13800138000'), true);
eq('PHONE_RE 对 10 位为假', P.PHONE_RE.test('1380013800'), false);

/* ---------------- composeProfilePatch ---------------- */
console.log('\n[composeProfilePatch]');
eq('只保留白名单字段',
  P.composeProfilePatch({ nickname: '小明', bio: '爱看国际新闻', uid: 'u1', is_admin: true, password_set: true }),
  { nickname: '小明', bio: '爱看国际新闻' });
eq('首尾空格被去掉',
  P.composeProfilePatch({ nickname: '  小明  ', bio: '  简介  ' }),
  { nickname: '小明', bio: '简介' });
eq('昵称 1 字被丢弃（不写坏数据）', P.composeProfilePatch({ nickname: '甲' }), {});
eq('昵称 13 字被丢弃', P.composeProfilePatch({ nickname: '一二三四五六七八九十甲乙丙' }), {});
eq('昵称 2 字边界通过', P.composeProfilePatch({ nickname: '甲乙' }), { nickname: '甲乙' });
eq('昵称 12 字边界通过',
  P.composeProfilePatch({ nickname: '一二三四五六七八九十甲乙' }),
  { nickname: '一二三四五六七八九十甲乙' });
eq('bio 截断到 80 字', P.composeProfilePatch({ bio: new Array(121).join('字') }).bio.length, 80);
eq('空 bio 保留（用于清空简介）', P.composeProfilePatch({ bio: '' }), { bio: '' });
eq('空对象得到空补丁', P.composeProfilePatch({}), {});
noThrow('null 输入不抛错', function () { P.composeProfilePatch(null); });
eq('null 输入得到空补丁', P.composeProfilePatch(null), {});

/* ---------------- profileStats ---------------- */
console.log('\n[profileStats]');
var NOW = new Date('2026-10-19T12:00:00').getTime();
var DATA = {
  bets: [
    { uid: 'u1', stake: 100, status: 'won', payout: 250, kind: 'bet' },
    { uid: 'u1', stake: 50, status: 'lost', kind: 'bet' },
    { uid: 'u1', stake: 30, status: 'open', kind: 'bet' },
    { uid: 'u1', stake: 20, status: 'open', kind: 'bonus' },  /* 奖励行：计入在押，不计笔数 */
    { uid: 'u2', stake: 999, status: 'won', payout: 1999, kind: 'bet' }
  ],
  loans: [
    { uid: 'u1', lid: 'l1', principal: 200, rate: 0.05, status: 'open', due_date: '2026-10-26' },
    { uid: 'u1', lid: 'l2', principal: 100, rate: 0.05, status: 'repaid',
      repaid_principal: 100, repaid_interest: 5 }
  ],
  payments: [{ uid: 'u1', lid: 'l2', amount: 105 }],
  evidence: [{ uid: 'u1' }, { uid: 'u1' }, { uid: 'u2' }],
  debates: [{ creator_uid: 'u1' }, { creator_uid: 'u2' }]
};
var st = P.profileStats(DATA, 'u1', { now: NOW });
/* 现金 = 1000 + (150 - 50 - 30 - 20) + 300 - 105 = 1245
 * 在押 = 30 + 20 = 50；负债 = 200 + 200*0.05 = 210
 * 净资产 = 1245 + 50 - 210 = 1085 */
eq('投注笔数（不含奖励行）', st.bets, 3);
eq('胜率 = 1 胜 1 负 → 50', st.winRate, 50);
eq('在押 = 30 + 20', st.openStake, 50);
eq('负债 = 本金 200 + 利息 10', st.debt, 210);
eq('净资产 = 现金 1245 + 在押 50 − 负债 210', st.netWorth, 1085);
eq('证据数只算本人', st.evidence, 2);
eq('发言数认 creator_uid 列', st.debates, 1);

var overdue = P.profileStats({
  loans: [{ uid: 'u1', principal: 200, rate: 0.05, status: 'open', due_date: '2026-10-09' }]
}, 'u1', { now: NOW });
/* 逾期 10 天：200 + 10 + 200*0.01*10 = 230 */
eq('逾期罚息计入负债', overdue.debt, 230);

var bonusCfg = P.profileStats({ bets: [] }, 'u1', { now: NOW, settings: { site: { opening_bonus: 500 } } });
eq('自定义开局赠送生效', bonusCfg.netWorth, 500);

var nobody = P.profileStats(DATA, 'nobody', { now: NOW });
eq('无数据用户净资产 = 开局赠送', nobody.netWorth, 1000);
eq('无数据用户胜率为 0', nobody.winRate, 0);

noThrow('空对象不抛错', function () { P.profileStats({}, 'u1'); });
noThrow('null data 不抛错', function () { P.profileStats(null, 'u1'); });
noThrow('uid 为 undefined 不抛错', function () { P.profileStats({ bets: [{ uid: 'u1', stake: 10 }] }); });
eq('undefined uid 统计为 0', P.profileStats({ bets: [{ uid: 'u1', stake: 10 }] }).bets, 0);

/* ---------------- accountBadges ---------------- */
console.log('\n[accountBadges]');
eq('站长 + 已设密码',
  P.accountBadges({ uid: 'u1', nickname: '站长', passwordSet: true }, { isAdmin: true }),
  ['站长', '已设密码']);
eq('未设密码 + 新用户',
  P.accountBadges({ uid: 'u1', nickname: '' }, { isAdmin: false }),
  ['未设密码', '新用户']);
eq('档案字段 password_set 也认',
  P.accountBadges({ nickname: '老玩家', password_set: true }, {}),
  ['已设密码']);
eq('ctx 覆盖档案字段',
  P.accountBadges({ nickname: '老玩家', passwordSet: true }, { passwordSet: false }),
  ['未设密码']);
noThrow('空 profile 不抛错', function () { P.accountBadges(); });
eq('空 profile 默认未设密码 + 新用户', P.accountBadges(), ['未设密码', '新用户']);

/* ---------------- composePasswordHint ---------------- */
console.log('\n[composePasswordHint]');
ok('已设密码文案提到密码登录', /密码.*登录/.test(P.composePasswordHint(true)));
eq('已设密码文案不出现「无法补设」', /无法补设/.test(P.composePasswordHint(true)), false);
ok('未设密码文案提到验证码', /验证码/.test(P.composePasswordHint(false)));
ok('未设密码文案说明可用短信验证补设', /短信验证/.test(P.composePasswordHint(false)) && /设置/.test(P.composePasswordHint(false)));
eq('undefined 按未设密码处理', P.composePasswordHint(undefined), P.composePasswordHint(false));

/* ============================================================
 * 追加：auth.js 的密码通路（同一份测试文件，避免新增测试入口）
 * 用 mock cloud.auth，按 app/test/vendor/wbcloud.js 的真实契约造响应：
 *   - signInWithPassword / signUp 只认 {phone}，传 {username} 会失败
 *   - verifyOtp 新号分支把 password 透传给内部 signUp
 * ============================================================ */
function shimStorage() {
  var m = {};
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    clear: function () { m = {}; }
  };
}

function makeCloudAuth(opts) {
  opts = opts || {};
  var calls = { signIn: [], verifyOtp: [] };
  return {
    _calls: calls,
    signInWithPassword: function (p) {
      calls.signIn.push(p);
      if (opts.signInError) return Promise.resolve({ data: null, error: opts.signInError });
      return Promise.resolve({ data: { user: { id: 'uid-pwd' } } });
    },
    sendOtp: function (p) {
      return Promise.resolve({
        data: { verificationId: 'vid-' + p.phone, isExistingUser: !!opts.isExisting }
      });
    },
    verifyOtp: function (p) {
      calls.verifyOtp.push(p);
      if (opts.verifyError) return Promise.resolve({ data: null, error: opts.verifyError });
      return Promise.resolve({ data: { user: { id: opts.uid || 'uid-otp' } } });
    },
    getSession: function () {
      if (opts.noSession) return Promise.resolve({ data: null });
      return Promise.resolve({ data: { user: { id: opts.uid || 'uid-otp' } } });
    },
    onAuthStateChange: function () {},
    signOut: function () { return Promise.resolve({}); }
  };
}

function authSection() {
  shimStorage();
  var Auth = require('../js/auth.js');
  var chain = Promise.resolve();

  console.log('\n[auth: 密码登录]');

  chain = chain.then(function () {
    var a = makeCloudAuth({});
    Auth.init({ auth: a, database: null });
    return Auth.signInWithPassword('139', 'abc123').then(function (r) {
      eq('非法手机号被拒', r.ok, false);
      return Auth.signInWithPassword('13800138000', 'ab1');
    }).then(function (r) {
      eq('过短密码被拒', r.ok, false);
      return Auth.signInWithPassword('13800138000', 'abc123');
    }).then(function (r) {
      eq('密码登录成功', r.ok, true);
      eq('登录后建立会话', Auth.isAuthed(), true);
      eq('SDK 收到 phone 参数', a._calls.signIn[0].phone, '13800138000');
      eq('SDK 未收到 username 参数', a._calls.signIn[0].username, undefined);
      eq('已设密码账号也可重置（allowed=true）', Auth.canSetPassword().allowed, true);
      eq('已设密码账号状态为 set', Auth.canSetPassword().state, 'set');
    });
  });

  chain = chain.then(function () {
    var a = makeCloudAuth({ noSession: true, signInError: { kind: 'unauthenticated', message: 'invalid_grant' } });
    Auth.init({ auth: a, database: null });
    return Auth.signInWithPassword('13800138000', 'wrong123').then(function (r) {
      eq('密码错误返回 ok:false', r.ok, false);
      eq('密码错误被翻译成中文', r.error.message, '手机号或密码错误');
      eq('密码错误不破坏登录态', Auth.isAuthed(), false);
    });
  });

  chain = chain.then(function () {
    Auth.init({ database: null });   /* 无 auth 字段 */
    return Auth.signInWithPassword('13800138000', 'abc123').then(function (r) {
      eq('无 SDK 支持时友好报错', r.ok, false);
    });
  });

  console.log('\n[auth: 注册设密码]');

  chain = chain.then(function () {
    var a = makeCloudAuth({ isExisting: false, uid: 'uid-new' });
    Auth.init({ auth: a, database: null });
    return Auth.sendCode('13700137000').then(function () {
      /* 未发码的号码不能直接设密码 */
      return Auth.signUpWithPassword('13600136000', 'abc123', '123456');
    }).then(function (r) {
      eq('未获取验证码被拒', r.ok, false);
      return Auth.signUpWithPassword('13700137000', '123456', '123456');
    }).then(function (r) {
      eq('纯数字密码在注册侧被拒', r.ok, false);
      return Auth.signUpWithPassword('13700137000', 'abc123', '123456');
    }).then(function (r) {
      eq('新号注册设密码成功', r.ok, true);
      eq('新号 passwordSet 为 true', r.passwordSet, true);
      eq('密码透传给 verifyOtp', a._calls.verifyOtp[0].password, 'abc123');
      eq('注册后已登录', Auth.isAuthed(), true);
    });
  });

  chain = chain.then(function () {
    var a = makeCloudAuth({ isExisting: true, uid: 'uid-old' });
    Auth.init({ auth: a, database: null });
    return Auth.sendCode('13500135000').then(function () {
      return Auth.signUpWithPassword('13500135000', 'abc123', '654321');
    }).then(function (r) {
      eq('老号回退验证码登录仍成功', r.ok, true);
      eq('老号 passwordSet 为 false', r.passwordSet, false);
      eq('老号回退原因 exists', r.reason, 'exists');
      eq('老号回退不提交密码', a._calls.verifyOtp[0].password, undefined);
      eq('老号也可用短信验证设密码', Auth.canSetPassword().allowed, true);
      ok('老号提示文案说明可短信重置', /短信验证/.test(Auth.canSetPassword().reason));
    });
  });

  chain = chain.then(function () {
    return Auth.signOut().then(function () {
      eq('登出后 canSetPassword 回到匿名态', Auth.canSetPassword().state, 'anonymous');
    });
  });

  return chain;
}

authSection().then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('测试异常:', e);
  process.exit(2);
});
