/* ============================================================
 * 明鉴 · 大肥鱼桌宠语音 v1.0
 *
 * 用浏览器原生 Web Speech API（window.speechSynthesis）让桌宠开口：
 *   · 中文（zh-CN）、音调偏萌、语速略慢
 *   · 自动优选中文女声（Xiaoxiao / Tingting / Meijia / Google 普通话 …）
 *   · 同一时刻只播一句：新句打断旧句
 *   · 不依赖任何外部服务 / 密钥 / 音频文件
 *
 * 加载方式：<script src="js/pet-voice.js"></script> → window.PetVoice
 *           node 下 module.exports = PetVoice（仅用于语法 / 单测校验）
 *
 * ★ 浏览器自动播放限制（重要）★
 *   Chrome / Safari / iOS 都禁止「无用户手势」的自动朗读。
 *   首次必须由用户点击 / 触摸触发：在点击回调里先调 PetVoice.prime() 解锁，
 *   之后在任何时机（包括定时器里）speak() 才会真正出声。
 *   prime() 是幂等的，重复调用无副作用。
 *
 * 无障碍 / 打扰控制：
 *   - ★ 默认静音（enabled = false），必须用户手动 setEnabled(true) 才出声
 *   - 开关状态记在 localStorage（jp-pet-voice：'1' 开 / '0' 关）
 *   - setEnabled(false) 会立即停止当前朗读
 *   - 页面卸载 / 切后台时由调用方自行 stop() 即可（不自动绑事件）
 * ============================================================ */
var PetVoice = (function () {
  'use strict';

  var STORE_KEY = 'jp-pet-voice';

  /* 默认音色：音调偏高（萌）、语速略慢、音量正常 */
  var DEFAULTS = {
    lang: 'zh-CN',
    rate: 0.92,
    pitch: 1.35,
    volume: 1
  };

  /* 台词：与 pet.html 的桌宠语气一致（蠢萌、贪吃、爱白饭、不许叫胖鱼）
   * 全部为可直接朗读的纯文本，不含括号舞台提示 / emoji（TTS 会读出来，很怪） */
  var LINES = {
    normal: [
      '今天也来押一注？',
      '我在看池子呢～',
      '鱼片，你好呀！',
      '别叫我胖鱼，我叫大肥鱼！',
      '啊，你刚才说啥？我在发呆。',
      '池子好大，我想在里面游泳。',
      '有事找大哥大姐，我先躺一会儿。',
      '押哪边好呢，好难选哦。'
    ],
    happy: [
      '中了！分我一半白饭！',
      '嘿嘿，我就说会赢吧～',
      '开心！尾巴摇起来了！',
      '这波稳了！',
      '发财了发财了！',
      '鱼片最好了！',
      '端出我的大钢盆，白饭真好吃～',
      '电饭煲开盖，好香啊！'
    ],
    sad: [
      '呜，输光了…',
      '鱼片，别难过嘛…',
      '没分了好惨，借我一点？',
      '我躲到角落里去一会儿。',
      '含着眼泪扒饭，越吃越难过。',
      '大哥大姐不在，没人罩我了…'
    ],
    confused: [
      '嗯？你说啥？',
      '这条题我看不太懂…',
      '让我想想…想不出来…',
      '你确定吗？',
      '呆毛立起来了，表示疑惑。',
      '这超出了本鱼的算力…'
    ],
    sleepy: [
      '啊…吃饱了想睡…',
      '我去吃饭了，溜了溜了。',
      '困…别吵我…',
      '打个哈欠，眼睛睁不开了。',
      '吃饱了就困，是鱼的生理结构。',
      '白饭…在梦里…'
    ]
  };

  /* 女声 / 中文 / 男声 关键词（全部小写匹配） */
  var HINT_FEMALE = [
    'xiaoxiao', 'xiaoyi', 'xiaomeng', 'xiaohan', 'xiaoshuang',
    'tingting', 'ting-ting', 'meijia', 'mei-jia', 'huihui', 'yaoyao', 'hanhan', 'sinji',
    'female', 'woman',
    '晓晓', '晓伊', '晓梦', '晓涵', '晓双', '婷婷', '美佳', '慧慧', '瑶瑶', '涵涵', '女'
  ];
  var HINT_ZH = ['zh', 'cmn', 'chinese', 'mandarin', '中文', '普通话', '国语', '國語'];
  /* 注意不要用 'man'：会误伤 'Mandarin'，只认 'male' 和已知男声名 */
  var HINT_MALE = [
    'male', 'yunjian', 'yunxi', 'yunyang', 'kangkang', 'liang', '男'
  ];
  /* 系统里公认好听的中文神经女声，优先一档 */
  var HINT_PREFERRED = ['xiaoxiao', 'xiaoyi', 'tingting', 'meijia'];

  /* ---------- 运行状态 ---------- */
  var state = {
    seq: 0,         // 语音序号：用来丢弃被新句打断的旧回调
    current: null,  // 当前 utterance
    resolve: null,  // 当前 Promise 的 resolve
    timer: null,    // cancel → speak 之间的缓冲定时器
    speaking: false,
    unlocked: false // 是否已在用户手势里 prime 过
  };

  var enabled = readEnabled();

  /* ---------- 基础工具 ---------- */

  function getSynth() {
    if (typeof window === 'undefined') return null;
    return window.speechSynthesis || null;
  }

  function supported() {
    return !!(
      typeof window !== 'undefined' &&
      window.speechSynthesis &&
      typeof window.SpeechSynthesisUtterance === 'function'
    );
  }

  function storage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_) { /* 隐私模式 / file:// 下可能抛错 */ }
    return null;
  }

  function readEnabled() {
    /* 默认静音：只有明确存过 '1' 才开启，没存过 / 存了 '0' 一律静音 */
    var st = storage();
    if (!st) return false;
    try {
      return st.getItem(STORE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function writeEnabled(flag) {
    var st = storage();
    if (!st) return;
    try { st.setItem(STORE_KEY, flag ? '1' : '0'); } catch (_) {}
  }

  function clamp(n, min, max) {
    if (typeof n !== 'number' || isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function hasAny(name, words) {
    for (var i = 0; i < words.length; i++) {
      if (name.indexOf(words[i]) >= 0) return true;
    }
    return false;
  }

  function normalizeText(text) {
    if (text == null) return '';
    return String(text).replace(/\s+/g, ' ').trim();
  }

  function safeGetVoices(synth) {
    try {
      var list = synth.getVoices();
      return list && list.length ? list : [];
    } catch (_) {
      return [];
    }
  }

  /* ---------- 选声 ----------
   * 打分思路：
   *   中文语言 +60；zh-CN +12；中文名 +45
   *   女声关键词 +30；Google 引擎 +10；Xiaoxiao 等首选 +8
   *   localService +4（本地声更稳、无网络延迟）
   *   明确男声 −35（注意 female 里含 male、woman 里含 man，先判女声）
   *   voiceHint 命中名字或语言 +120（调用方强制指定时最高优先）
   * 最高分 < 20 视为「没有合适的中文声」，返回 null 交给浏览器默认。
   */
  function scoreVoice(voice, hint) {
    var name = String(voice.name || '').toLowerCase();
    var lang = String(voice.lang || '').toLowerCase().replace(/_/g, '-');
    var female = hasAny(name, HINT_FEMALE);
    var score = 0;

    if (lang.indexOf('zh') === 0 || lang.indexOf('cmn') === 0) score += 60;
    else if (hasAny(name, HINT_ZH)) score += 45;

    if (lang === 'zh-cn') score += 12;
    else if (lang.indexOf('zh') === 0) score += 5;

    if (female) score += 30;
    if (name.indexOf('google') >= 0) score += 10;
    if (hasAny(name, HINT_PREFERRED)) score += 8;
    if (voice.localService) score += 4;
    if (!female && hasAny(name, HINT_MALE)) score -= 35;

    if (hint) {
      var h = String(hint).toLowerCase();
      if (name.indexOf(h) >= 0 || lang.indexOf(h) >= 0) score += 120;
    }
    return score;
  }

  function chooseVoice(voices, hint) {
    if (!voices || !voices.length) return null;
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < voices.length; i++) {
      var s = scoreVoice(voices[i], hint);
      if (s > bestScore) { bestScore = s; best = voices[i]; }
    }
    return bestScore >= 20 ? best : null;
  }

  /* ---------- 等 voices 就绪 ----------
   * Chrome 首次 getVoices() 返回空数组，要等 voiceschanged。
   * 最多等 1.5s，等不到就用浏览器默认声音，绝不把 Promise 卡死。 */
  function ensureVoices(cb) {
    var synth = getSynth();
    if (!synth) return cb([]);

    var voices = safeGetVoices(synth);
    if (voices.length) return cb(voices);

    var done = false;
    var timer = null;

    function cleanup() {
      if (timer) { clearTimeout(timer); timer = null; }
      try { synth.removeEventListener('voiceschanged', onchange); } catch (_) {}
    }
    function fire() {
      if (done) return;
      done = true;
      cleanup();
      cb(safeGetVoices(synth));
    }
    function onchange() { fire(); }

    try { synth.addEventListener('voiceschanged', onchange); } catch (_) {}
    timer = setTimeout(fire, 1500);
  }

  /* ---------- 播放控制 ---------- */

  function finish(id, ok) {
    if (state.seq !== id) return;      // 已被新句 / stop 接管
    state.speaking = false;
    state.current = null;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    var resolve = state.resolve;
    state.resolve = null;
    if (resolve) resolve(!!ok);
  }

  /* 停止当前朗读（未完成的 Promise 以 false 结束） */
  function stop() {
    state.seq++;
    state.speaking = false;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }

    var utt = state.current;
    state.current = null;
    if (utt) { utt.onend = null; utt.onerror = null; }

    var synth = getSynth();
    if (synth) { try { synth.cancel(); } catch (_) {} }

    var resolve = state.resolve;
    state.resolve = null;
    if (resolve) resolve(false);
  }

  /* ---------- 对外：朗读一句 ----------
   * text       要读的文字
   * opts       { rate, pitch, volume, voiceHint, lang }
   * 返回       Promise<boolean>：读完 true；被新句打断 / 关掉 / 不支持 / 出错 false
   * 语义       立即打断上一句，永远只播最新一句
   */
  function speak(text, opts) {
    return new Promise(function (resolve) {
      var line = normalizeText(text);
      if (!line) return resolve(false);
      if (!enabled) return resolve(false);
      if (!supported()) return resolve(false);

      var synth = getSynth();
      if (!synth) return resolve(false);

      var o = opts || {};
      var busy = !!(state.current || state.speaking || synth.speaking || synth.pending);

      stop();                       // 打断旧句（旧 Promise 以 false 结束）
      var id = state.seq;

      var utt = new window.SpeechSynthesisUtterance(line);
      utt.lang = o.lang || DEFAULTS.lang;
      utt.rate = clamp(num(o.rate, DEFAULTS.rate), 0.1, 10);
      utt.pitch = clamp(num(o.pitch, DEFAULTS.pitch), 0, 2);
      utt.volume = clamp(num(o.volume, DEFAULTS.volume), 0, 1);

      state.current = utt;
      state.resolve = resolve;
      utt.onend = function () { finish(id, true); };
      utt.onerror = function () { finish(id, false); };

      function start() {
        ensureVoices(function (voices) {
          if (state.seq !== id) return;         // 等声期间被新句抢占
          var voice = chooseVoice(voices, o.voiceHint);
          if (voice) utt.voice = voice;
          try {
            synth.speak(utt);
            state.speaking = true;
          } catch (_) {
            finish(id, false);
          }
        });
      }

      /* Chrome 的坑：cancel() 之后同一个 tick 立刻 speak() 偶发无声，
       * 只有在真的打断了旧句时才让出一小段，正常连播不额外延迟。 */
      if (busy) {
        state.timer = setTimeout(function () {
          state.timer = null;
          start();
        }, 90);
      } else {
        start();
      }
    });
  }

  /* ---------- 自动播放解锁 ----------
   * 必须在首次「用户手势」回调里调用（click / touchend / keydown）。
   * 用一个零音量、空白文本的 utterance 把语音通道打开；无声、不打断正式台词。 */
  function prime() {
    if (!supported()) return false;
    if (state.unlocked) return true;

    var synth = getSynth();
    if (!synth) return false;

    try {
      var utt = new window.SpeechSynthesisUtterance(' ');
      utt.lang = DEFAULTS.lang;
      utt.rate = 1;
      utt.pitch = 1;
      utt.volume = 0;
      if (!synth.speaking && !synth.pending) synth.speak(utt);
      state.unlocked = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ---------- 开关 ---------- */
  function setEnabled(flag) {
    enabled = !!flag;
    writeEnabled(enabled);
    if (!enabled) stop();
    return enabled;
  }

  function isEnabled() {
    return enabled;
  }

  /* ---------- 随机台词 ---------- */
  function pick(mood) {
    var arr = LINES[mood] || LINES.normal;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  return {
    LINES: LINES,
    supported: supported,
    speak: speak,
    stop: stop,
    prime: prime,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    pick: pick
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PetVoice;
}
