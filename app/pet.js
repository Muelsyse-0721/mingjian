/* ============================================================
 * 明鉴 · 大肥鱼桌宠 v5 行为层
 *
 * 1) 真动画：CSS 呼吸 / 浮动 / 尾巴轻摆 + JS 随机眨眼
 *            + 空闲表情帧序列（calm → happy → calm → confused）
 * 2) 静音优先：默认不发声，只有用户点「开启声音」才出声
 * 3) 可拖动 / 可隐藏：独立页拖动定位；iframe 浮层把拖动交给父页面
 * 4) 皮肤：?skin=xxx 或 localStorage jp-pet-skin，缺图回退 face-calm
 * ============================================================ */
(function () {
  'use strict';

  var pet = document.getElementById('pet');
  if (!pet) return;

  var docEl = document.documentElement;
  var isMini = docEl.classList.contains('mini');
  var embedded = !!(window.parent && window.parent !== window);
  var dragToParent = isMini && embedded; // mini 浮层：拖动整只 iframe，由父页面执行
  var hasDesktopBridge = !!(window.desktopPet && typeof window.desktopPet.toggle === 'function');

  var bubble = document.getElementById('pet-bubble');
  var closeBtn = document.getElementById('pet-close');
  var restore = document.getElementById('pet-restore');
  var skinImg = document.getElementById('pet-skin');
  var skinPick = document.getElementById('skin-pick');
  var muteBtn = document.getElementById('btn-mute');

  var POS_KEY = 'jp-pet-pos-v2';
  var HIDDEN_KEY = 'jp-pet-hidden';
  var SKIN_KEY = 'jp-pet-skin';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var MOODS = ['normal', 'happy', 'confused', 'sad', 'sleepy'];
  var LINES = {
    normal: ['今天也来押一注？', '我在看池子呢～', '鱼片，你好呀！', '别叫我胖鱼，我叫大肥鱼！', '（发呆）…啊，你说啥？', '偷懒中，勿扰～', '有事找大哥大姐，我先躺会。', '这盆白饭，我先干为敬。'],
    happy: ['中了！分我一半白饭！', '嘿嘿，我就说会赢吧～', '开心！（尾巴狂摇）', '这波稳了！', '今天又是被大家爱着的一天～', '电饭盆才是我的真身！'],
    confused: ['嗯？你说啥？', '（歪头）这条题我看不太懂…', '让我想想…想不出来…', '你确定吗？', '呆毛立起来＝我在思考（其实在发呆）。'],
    sad: ['呜…输光了…', '鱼片，别难过嘛…', '没分了好惨…借点？', '（躲到角落扒饭）', '大哥大姐不在，没人罩我了…'],
    sleepy: ['啊…吃饱了想睡…', '我去吃饭了（溜）', '困…别吵我…', '（打哈欠）吃饱就困，是鱼的生理结构。']
  };
  var RICE = {
    bowl: ['端出我的大钢盆！白饭真好吃～', '咣！钢盆白饭，管够！', '这一盆，我三秒吃完！'],
    cooker: ['电饭煲开盖——香！', '从电饭煲盛一大碗，绝了～', '冒热气了，趁热吃！']
  };

  /* ---------------- 皮肤 ---------------- */
  var SKIN_IDS = [
    'skin-claude-normal', 'skin-claude-mini',
    'skin-gpt-normal', 'skin-gpt-mini',
    'skin-gemini', 'skin-grok', 'skin-kimi', 'skin-glm', 'skin-qwen'
  ];

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function writeStore(key, val) {
    try { localStorage.setItem(key, val); } catch (_) {}
  }

  function normalizeSkin(id) {
    if (!id) return '';
    return SKIN_IDS.indexOf(id) >= 0 ? id : '';
  }

  function applySkin(id, persist) {
    var sid = normalizeSkin(id);
    if (!sid) {
      pet.classList.remove('has-skin');
      skinImg.removeAttribute('src');
      skinImg.style.display = 'none';
      if (skinPick) skinPick.value = '';
      if (persist) writeStore(SKIN_KEY, '');
      return;
    }
    pet.classList.add('has-skin');
    skinImg.style.display = 'block';
    skinImg.onerror = function () {
      // 找不到皮肤图 → 回退到 5 张表情图（默认 face-calm）
      skinImg.onerror = null;
      pet.classList.remove('has-skin');
      skinImg.removeAttribute('src');
      skinImg.style.display = 'none';
      pet.setAttribute('data-face', 'calm');
      if (persist) writeStore(SKIN_KEY, '');
    };
    skinImg.src = 'assets/pet/' + sid + '.png?v=2';
    if (skinPick) skinPick.value = sid;
    if (persist) writeStore(SKIN_KEY, sid);
  }

  function initSkin() {
    var param = '';
    try {
      param = new URLSearchParams(location.search).get('skin') || '';
    } catch (_) {}
    var stored = readStore(SKIN_KEY) || '';
    var chosen = normalizeSkin(param) || normalizeSkin(stored);
    applySkin(chosen, !!normalizeSkin(param));
    if (skinPick) {
      skinPick.value = chosen;
      skinPick.addEventListener('change', function () {
        applySkin(this.value, true);
      });
    }  }

  /* ---------------- 表情 / 台词 ---------------- */
  var MOOD_FACE = { normal: 'calm', happy: 'happy', confused: 'confused', sad: 'sad', sleepy: 'sleepy' };
  var moodTimer = null;
  var faceTimer = null;

  function setFace(face) {
    pet.setAttribute('data-face', face);
  }

  function setMood(mood) {
    pet.setAttribute('data-mood', mood);
    setFace(MOOD_FACE[mood] || 'calm');
    clearTimeout(moodTimer);
    moodTimer = setTimeout(function () {
      pet.setAttribute('data-mood', 'normal');
      if (!pet.classList.contains('has-skin')) setFace('calm');
    }, 1800);
  }

  function react(mood) {
    if (reduceMotion) return;
    var layer = pet.querySelector('.react');
    if (!layer || !layer.animate) return;
    var frames = null;
    var duration = 700;
    if (mood === 'happy') {
      frames = [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-16px) scale(1.04)', offset: 0.3 },
        { transform: 'translateY(0) scale(.98)', offset: 0.62 },
        { transform: 'translateY(0) scale(1)' }
      ];
    } else if (mood === 'confused') {
      frames = [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-8deg)', offset: 0.3 },
        { transform: 'rotate(6deg)', offset: 0.65 },
        { transform: 'rotate(0deg)' }
      ];
    } else if (mood === 'sad') {
      duration = 1100;
      frames = [{ transform: 'translateY(0)' }, { transform: 'translateY(6px)' }];
    } else if (mood === 'sleepy') {
      duration = 2600;
      frames = [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-2deg)', offset: 0.5 },
        { transform: 'rotate(0deg)' }
      ];
    }
    if (!frames) return;
    try {
      layer.animate(frames, { duration: duration, easing: 'ease-in-out', fill: 'none' });
    } catch (_) {}
  }

  function say(text) {
    if (!bubble || isMini) return;
    bubble.textContent = text;
    bubble.classList.add('show');
    positionBubble();
    clearTimeout(bubble._t);
    bubble._t = setTimeout(function () { bubble.classList.remove('show'); }, 3600);
    speak(text);
  }

  function positionBubble() {
    if (!bubble) return;
    var r = pet.getBoundingClientRect();
    bubble.style.left = Math.min(r.left, window.innerWidth - 250) + 'px';
    bubble.style.top = Math.max(8, r.top - 52) + 'px';
  }

  function speak(text) {
    if (typeof PetVoice === 'undefined') return;
    if (!PetVoice.isEnabled()) return; // 默认静音：没手动开启就一句话都不读
    PetVoice.speak(text);
  }

  function interact() {
    var mood = MOODS[Math.floor(Math.random() * MOODS.length)];
    setMood(mood);
    react(mood);
    var arr = LINES[mood] || LINES.normal;
    say(arr[Math.floor(Math.random() * arr.length)]);

    // 点击时插入第二个表情帧：happy ↔ sad 快速切换，形成完整的情绪反应
    if (!reduceMotion && (mood === 'happy' || mood === 'sad') && Math.random() < 0.5) {
      setTimeout(function () {
        var next = mood === 'happy' ? 'sad' : 'happy';
        setMood(next);
        react(next);
      }, 780);
    }
  }

  function showProp(kind) {
    var el = pet.querySelector('.prop-' + kind);
    if (el) {
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
    setMood('happy');
    react('happy');
    var arr = RICE[kind] || RICE.bowl;
    say(arr[Math.floor(Math.random() * arr.length)]);
  }

  /* ---------------- 真动画：眨眼 + 空闲表情帧 ---------------- */
  var blinkEl = pet.querySelector('.blink');

  function blink() {
    if (reduceMotion || !blinkEl || !blinkEl.animate) return;
    try {
      blinkEl.animate(
        [
          { transform: 'scaleY(1)' },
          { transform: 'scaleY(.94)', offset: 0.45 },
          { transform: 'scaleY(1)' }
        ],
        { duration: 190, easing: 'ease-in-out' }
      );
    } catch (_) {}
  }

  function scheduleBlink() {
    if (reduceMotion) return;
    setTimeout(function () {
      blink();
      scheduleBlink();
    }, 4000 + Math.random() * 3000); // 每 4–7 秒一次
  }

  var IDLE_FRAMES = ['calm', 'happy', 'calm', 'confused'];
  var idleIndex = 0;

  function idleTick() {
    if (reduceMotion) return;
    if (!pet.classList.contains('has-skin')) {
      idleIndex = (idleIndex + 1) % IDLE_FRAMES.length;
      setFace(IDLE_FRAMES[idleIndex]);
    }
    faceTimer = setTimeout(idleTick, 1600 + Math.random() * 800); // 1.6–2.4s 一帧
  }

  /* ---------------- 拖动 ---------------- */
  var dragging = false;
  var moved = false;
  var startX = 0, startY = 0, originLeft = 0, originTop = 0;
  var tapTimer = null;
  var lastTap = 0;

  function postParent(payload) {
    if (!embedded) return;
    try { window.parent.postMessage(payload, '*'); } catch (_) {}
  }

  function savePos() {
    writeStore(POS_KEY, JSON.stringify({ left: pet.style.left, top: pet.style.top }));
  }

  function initPos() {
    var w = window.innerWidth, h = window.innerHeight;
    if (embedded) {
      // full 模式 iframe：固定在右上角，避开底部问答面板
      pet.style.left = Math.max(12, w - 190) + 'px';
      pet.style.top = '16px';
      return;
    }
    var p = null;
    try { p = JSON.parse(readStore(POS_KEY) || 'null'); } catch (_) {}
    if (p && p.left && p.top) {
      pet.style.left = p.left;
      pet.style.top = p.top;
      return;
    }
    pet.style.left = Math.max(12, w - 200) + 'px';
    pet.style.top = Math.max(12, h - 260) + 'px';
  }

  pet.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    if (e.target === closeBtn) return;
    dragging = true;
    moved = false;
    pet.classList.add('dragging');
    var r = pet.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    originLeft = r.left;
    originTop = r.top;
    try { pet.setPointerCapture(e.pointerId); } catch (_) {}
    if (dragToParent) {
      postParent({ source: 'jp-pet', type: 'drag', phase: 'start', x: e.screenX, y: e.screenY });
    }
  });

  pet.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    if (!moved) return;
    if (dragToParent) {
      postParent({ source: 'jp-pet', type: 'drag', phase: 'move', x: e.screenX, y: e.screenY });
      return;
    }
    var nl = Math.min(Math.max(0, originLeft + dx), window.innerWidth - 160);
    var nt = Math.min(Math.max(0, originTop + dy), window.innerHeight - 160);
    pet.style.left = nl + 'px';
    pet.style.top = nt + 'px';
    positionBubble();
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    pet.classList.remove('dragging');
    try { pet.releasePointerCapture(e.pointerId); } catch (_) {}
    if (moved) {
      if (dragToParent) {
        postParent({ source: 'jp-pet', type: 'drag', phase: 'end', x: e.screenX, y: e.screenY });
      } else {
        savePos();
      }
      return;
    }

    // 单击：延迟 260ms，给双击留出判定窗口
    var now = Date.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      clearTimeout(tapTimer);
      hidePet();
      return;
    }
    lastTap = now;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () {
      lastTap = 0;
      if (typeof PetVoice !== 'undefined') PetVoice.prime();
      interact();
    }, 260);
  }

  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', function (e) {
    if (!dragging) return;
    dragging = false;
    pet.classList.remove('dragging');
    if (dragToParent) {
      postParent({ source: 'jp-pet', type: 'drag', phase: 'end', x: e.screenX, y: e.screenY });
    }
  });

  /* ---------------- 隐藏 / 叫回 ---------------- */
  function hidePet() {
    if (bubble) bubble.classList.remove('show');

    if (embedded) {
      postParent({ source: 'jp-pet', type: 'hide' });
      return;
    }
    if (hasDesktopBridge) {
      say('我先躲起来～按 Ctrl+Shift+F 叫我');
      setTimeout(function () {
        if (window.desktopPet && window.desktopPet.toggle) window.desktopPet.toggle();
      }, 900);
      return;
    }
    pet.setAttribute('hidden', '');
    writeStore(HIDDEN_KEY, '1');
    if (restore) restore.classList.add('show');
  }

  function showPet() {
    pet.removeAttribute('hidden');
    writeStore(HIDDEN_KEY, '0');
    if (restore) restore.classList.remove('show');
    positionBubble();
    if (typeof PetVoice !== 'undefined') PetVoice.prime();
    say('我回来啦～');
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      hidePet();
    });
    closeBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  }
  if (restore) restore.addEventListener('click', showPet);

  /* ---------------- 声音（默认静音） ---------------- */
  var voiceOn = (typeof PetVoice !== 'undefined') ? PetVoice.isEnabled() : false;

  function refreshMute() {
    if (!muteBtn) return;
    muteBtn.textContent = voiceOn ? '🔊 声音开（点击静音）' : '🔇 开启声音（默认静音）';
    muteBtn.title = voiceOn ? '当前有声，点击静音' : '默认静音，点击开启声音';
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', function () {
      if (typeof PetVoice === 'undefined') return;
      if (!voiceOn) {
        PetVoice.prime();          // 必须在用户手势里解锁
        voiceOn = PetVoice.setEnabled(true);
        say('好啦，我说话了～');
      } else {
        voiceOn = PetVoice.setEnabled(false);
      }
      refreshMute();
    });
  }
  refreshMute();

  /* ---------------- 问答 ---------------- */
  function answer(q) {
    q = (q || '').trim();
    if (!q) return '你想问啥呀？';
    if (/下注|押注|怎么玩|买|押/.test(q)) return '先去「下注大厅」挑一道题，选选项、填积分，点下注就行～注意赔率和截止时间哦。';
    if (/积分|分从哪|怎么得|怎么赚/.test(q)) return '新用户送 1000 分；押中能赢；也能「借款」周转；发优质证据、上榜还有奖励。分不能换钱哦。';
    if (/奖池|抽水|池子/.test(q)) return '彩池 = 大家押的总分，抽水 5%；其中 60% 抽水会进「公共奖池」办比赛、发月榜奖励～';
    if (/天梯|排名|榜|段位/.test(q)) return '天梯按「净资产」（现金+在押−负债）排，还有收益率/胜率榜更能看技术～';
    if (/借|贷款|额度|还/.test(q)) return '能借！初始额度 300，还清加、逾期减；有利息和逾期罚息，量力而借～';
    if (/是谁|名字|大肥鱼|胖鱼/.test(q)) return '我是大肥鱼（鲸鱼娘）！被大家用爱养大的～不许叫我胖鱼！';
    if (/吃|饭|白饭|电饭煲|钢盆|电饭盆/.test(q)) return '干饭第一名！白饭最好吃，我去吃饭了（溜）～';
    if (/哈基米|豆姐/.test(q)) return '哈基米和豆姐是我的活宝搭档！我们一起卖萌～';
    if (/尾巴/.test(q)) return '这是更大更壮更 q 弹的尾巴！还能藏零食哦～';
    if (/你好|hi|hello|嗨/i.test(q)) return '鱼片你好呀！今天押哪题？';
    if (/谢谢|多谢/.test(q)) return '不客气～自己判断哦！';
    return '唔…这个我还不太会，等我升级了再答你～（先问：下注 / 积分 / 奖池 / 天梯 / 借分）';
  }

  function ask(q) {
    setMood('normal');
    say(answer(q));
  }

  var qaSend = document.getElementById('qa-send');
  var qaInput = document.getElementById('qa-input');
  if (qaSend) qaSend.addEventListener('click', function () {
    if (typeof PetVoice !== 'undefined') PetVoice.prime();
    ask(qaInput ? qaInput.value : '');
    if (qaInput) qaInput.value = '';
  });
  if (qaInput) qaInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      if (typeof PetVoice !== 'undefined') PetVoice.prime();
      ask(this.value);
      this.value = '';
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.addEventListener('click', function () {
      if (typeof PetVoice !== 'undefined') PetVoice.prime();
      ask(c.getAttribute('data-q'));
    });
  });

  var actBowl = document.getElementById('act-bowl');
  var actCooker = document.getElementById('act-cooker');
  if (actBowl) actBowl.addEventListener('click', function () {
    if (typeof PetVoice !== 'undefined') PetVoice.prime();
    showProp('bowl');
  });
  if (actCooker) actCooker.addEventListener('click', function () {
    if (typeof PetVoice !== 'undefined') PetVoice.prime();
    showProp('cooker');
  });

  /* ---------------- 初始化 ---------------- */
  window.addEventListener('resize', function () {
    positionBubble();
  });

  initSkin();
  if (!isMini) initPos();
  if (!isMini && !embedded) {
    if (readStore(HIDDEN_KEY) === '1') {
      pet.setAttribute('hidden', '');
      if (restore) restore.classList.add('show');
    }
    setTimeout(function () { say('咦，有人来了～点我一下试试！'); }, 600);
  }

  // 帧动画启动
  scheduleBlink();
  setTimeout(idleTick, 1200);
})();
