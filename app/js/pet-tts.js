/* ============================================================
 * 明鉴 · 桌宠语音 v2（角色音色包）
 *
 * 优先级：
 *   1) 预渲染音色包 app/assets/pet/voice/<char>/<hash>.mp3（固定台词，音质最好）
 *   2) 未命中 → 退回 Web Speech，按角色传入不同 pitch / rate / 声音偏好
 *
 * 音色依据：对用户提供的参考片段实测（clipA=Claude / clipB=大肥鱼，F0 中位 ~327/340Hz）
 *   渲染参数见 tools/tts-build.py：Xiaoxiao +60Hz -15% / Xiaoyi +50Hz -10%
 *
 * 静音开关仍然由 PetVoice.isEnabled() 统一控制：默认不出声。
 * ============================================================ */
var PetTTS = (function () {
  'use strict';

  /* 音色包优先级：克隆版 → Edge 版 */
  var PACKS = ['assets/pet/voice-clone/', 'assets/pet/voice/'];
  var BASE = PACKS[PACKS.length - 1];
  var manifest = null;
  var loading = null;
  var current = null;

  /* Web Speech 兜底参数（voiceHint 用于在系统音色里挑最接近的） */
  var FALLBACK = {
    claude: { pitch: 1.55, rate: 0.86, voiceHint: ['Xiaoxiao', 'Meijia', 'Tingting', 'Huihui'] },
    fish:   { pitch: 1.40, rate: 0.92, voiceHint: ['Xiaoyi', 'Tingting', 'Xiaoxiao', 'Huihui'] },
    generic:{ pitch: 1.35, rate: 0.92, voiceHint: ['Tingting', 'Xiaoxiao', 'Huihui'] }
  };

  function enabled() {
    return typeof PetVoice !== 'undefined' && PetVoice.isEnabled && PetVoice.isEnabled();
  }

  function load() {
    if (loading) return loading;
    loading = (async function () {
      for (var i = 0; i < PACKS.length; i++) {
        try {
          var r = await fetch(PACKS[i] + 'manifest.json', { cache: 'force-cache' });
          if (r.ok) {
            manifest = await r.json();
            BASE = PACKS[i];
            return manifest;
          }
        } catch (e) { /* 试下一个 */ }
      }
      manifest = null;
      return null;
    })();
    return loading;
  }

  function charKey(char) {
    if (char === 'claude') return 'claude';
    return 'fish';
  }

  function play(src) {
    try {
      stop();
      var a = new Audio(src);
      a.volume = 1;
      current = a;
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* 自动播放被拦：静默失败，等下次点击 */ });
      a.onended = function () { if (current === a) current = null; };
    } catch (e) { /* ignore */ }
  }

  function speak(char, text) {
    if (!enabled()) return;
    if (!text) return;
    var key = charKey(char);

    if (manifest && manifest.profiles && manifest.profiles[key]) {
      var file = manifest.profiles[key].files && manifest.profiles[key].files[text];
      if (file) { play(BASE + file); return; }
    }

    // 未命中音色包：退回系统语音，但按角色区分音高/语速
    var p = FALLBACK[key] || FALLBACK.generic;
    if (typeof PetVoice !== 'undefined' && PetVoice.speak) {
      PetVoice.speak(text, { pitch: p.pitch, rate: p.rate, voiceHint: p.voiceHint });
    }
  }

  function stop() {
    if (current) {
      try { current.pause(); } catch (e) {}
      current = null;
    }
    if (typeof PetVoice !== 'undefined' && PetVoice.stop) PetVoice.stop();
  }

  load();

  return {
    speak: speak,
    stop: stop,
    load: load,
    ready: function () { return !!manifest; },
    manifest: function () { return manifest; },
    pack: function () { return BASE; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PetTTS;
