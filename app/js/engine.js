/* ============================================================
 * 明鉴 · 评分引擎 v0.1（离线启发式，无需联网）
 * 原则：评「怎么辩」，不评「辩什么」。
 * 所有词库（含扣帽子标签）对不同立场对称使用，不做任何立场偏好判断。
 * 配套文档：docs/02-事件分级与评分体系.md
 * ============================================================ */
var Engine = (function () {
  'use strict';

  /* ---------- 事件分级（决定分数区间 R） ---------- */
  var EVENT_LEVELS = {
    S: { R: 100, name: '巨浪', desc: '全国性重大事件',
         keywords: ['宪法', '刑法', '民法典', '选举', '大选', '联合国', '贸易协定', '战争', '停火', '峰会', '两会', '全会', '税制', '起征点', '全国性'] },
    A: { R: 50, name: '大潮', desc: '行业/省级热点',
         keywords: ['新规', '征求意见', '部委', '央行', '降息', '房地产', '教育改革', '医保', '调价', '票价', '禁令', '条例', '政策'] },
    B: { R: 25, name: '涟漪', desc: '一般社会话题',
         keywords: ['新闻', '争议', '加班', '职场', '消费', '食品安全', '交通', '学校', '家长', '员工', '手机'] },
    C: { R: 10, name: '水花', desc: '日常对线', keywords: [] }
  };

  function classifyEvent(eventName, content) {
    var text = ((eventName || '') + ' ' + (content || '')).slice(0, 300);
    var order = ['S', 'A', 'B'];
    for (var i = 0; i < order.length; i++) {
      var lv = order[i];
      var kws = EVENT_LEVELS[lv].keywords;
      for (var j = 0; j < kws.length; j++) {
        if (text.indexOf(kws[j]) !== -1) {
          return { level: lv, R: EVENT_LEVELS[lv].R, confidence: 0.7,
                   reason: '命中关键词「' + kws[j] + '」，判定为 ' + lv + ' 级（' + EVENT_LEVELS[lv].name + '）' };
        }
      }
    }
    return { level: 'C', R: EVENT_LEVELS.C.R, confidence: 0.5,
             reason: '未命中高等级关键词，按日常对线处理，可手动调整' };
  }

  /* ---------- 词库（对称使用，无立场偏向） ---------- */
  var LEX = {
    sourcePhrases: ['据报道', '数据显示', '统计显示', '研究表明', '研究指出', '调查显示', '资料显示',
                    '白皮书', '实施细则', '测算', '年报', '财报'],
    institutions: ['国家统计局', '统计局', '央行', '财政部', '教育部', '卫健委', '人社部', '司法部',
                   '最高法院', '最高法', '国务院', '联合国', '世卫组织', 'WHO', 'IMF', '世界银行',
                   '发改委', '住建部', '交通部', '新华社', '央视'],
    caseWords: ['例如', '比如', '案例', '先例', '前车之鉴', '验证过', '实践中', '域外', '国外经验'],
    structureWords: ['首先', '其次', '再次', '最后', '一方面', '另一方面', '第一', '第二', '第三',
                     '综上', '总而言之', '换句话说', '换言之', '具体来说', '需要说明的是', '值得注意的是',
                     '第一步', '第二步', '第三步', '当然', '与此同时', '反过来看', '也就是说',
                     '实际上', '事实上', '本质上', '关键在于', '问题在于', '与其', '不如', '需要', '可行'],
    conclusionWords: ['因此', '所以', '可见', '总之', '结论是', '我的结论', '简而言之', '结论'],
    qualifierWords: ['可能', '或许', '在一定程度上', '大概率', '未必', '不一定', '某种程度上',
                     '有待观察', '视情况而定', '有待'],
    absoluteWords: ['所有人', '从来', '永远', '绝对', '必然', '注定', '无一例外', '百分之百', '百分百', '统统'],
    responseWords: ['你说', '按你的逻辑', '你提到', '你这句话', '回到你的观点', '针对你', '你的观点',
                    '楼上', '原帖', '对方认为', '如你所说'],
    attackWords: ['傻子', '傻逼', '蠢', '蠢货', '笨蛋', '弱智', '智障', '脑残', '脑瘫', '煞笔',
                  '垃圾', '恶心', '滚吧', '滚蛋', '闭嘴', '放屁', '有病', '进水', '贱人', '矫情',
                  '中了毒', '你行你上', '不行别哔哔', 'idiot', 'stupid'],
    labelWords: ['五毛', '美分', '小粉红', '公知', '带路党', '跪久了', '殖人', '恨国', '卖国',
                 '水军', '走狗', '汉奸'],
    fallacyPatterns: [
      { re: /(一旦[\s\S]{0,14}就[\s\S]{0,14}(完|毁|崩|糟|沦陷|可怕)|如果[\s\S]{0,10}那么[\s\S]{0,10}迟早)/,
        label: '滑坡谬误', penalty: 10 },
      { re: /(不是[\s\S]{1,10}就是|要么[\s\S]{1,14}否则|非黑即白|二极管)/,
        label: '非黑即白', penalty: 10 },
      { re: /(众所周知|地球人都知道|明眼人都看出来)/,
        label: '诉诸「公认」', penalty: 6 },
      { re: /(我身边|我朋友|我亲戚|我有个同事|我当年|我们当年|那时候)/,
        label: '个例偏差', penalty: 6 },
      { re: /(祖宗|老祖宗|自古以来[\s\S]{0,8}就是)/,
        label: '诉诸传统', penalty: 6 }
    ]
  };

  /* ---------- 工具 ---------- */
  function cap(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function hitsOf(text, arr) { return arr.filter(function (w) { return text.indexOf(w) !== -1; }); }

  function tokenSet(t) {
    var clean = t.replace(/[\s\p{P}\p{S}]/gu, '');
    var grams = {};
    for (var i = 0; i + 2 < clean.length; i++) grams[clean.slice(i, i + 3)] = true;
    return grams;
  }
  function jaccard(a, b) {
    var inter = 0, ka, kb;
    for (ka in a) if (b[ka]) inter++;
    var union = 0;
    for (ka in a) union++;
    for (kb in b) if (!a[kb]) union++;
    return union ? inter / union : 0;
  }

  /* ---------- 五维评分（每维 0-100） ---------- */
  function scoreEvidence(t) {
    var s = 30, hits = [];
    var nums = t.match(/\d+(\.\d+)?%?/g) || [];
    if (nums.length) { s += Math.min(24, nums.length * 6); hits.push('出现 ' + nums.length + ' 处数据/数字'); }
    var src = hitsOf(t, LEX.sourcePhrases);
    if (src.length) { s += Math.min(20, src.length * 10); hits.push('信源表述：' + src.slice(0, 2).join('、')); }
    var inst = hitsOf(t, LEX.institutions);
    if (inst.length) { s += Math.min(24, inst.length * 8); hits.push('提及权威机构：' + inst.slice(0, 2).join('、')); }
    var cs = hitsOf(t, LEX.caseWords);
    if (cs.length) { s += Math.min(10, cs.length * 5); hits.push('举例/案例论证：' + cs.slice(0, 2).join('、')); }
    if (/[「《"'][^」》"']{0,40}[」》"']/.test(t)) { s += 5; hits.push('使用引文标注'); }
    if (/https?:\/\//.test(t)) { s += 5; hits.push('附参考链接'); }
    s += Math.min(10, Math.floor(t.length / 100));
    return { score: Math.round(cap(s, 0, 100)), hits: hits };
  }

  function scoreLogic(t) {
    var s = 40, hits = [], drops = [];
    var st = hitsOf(t, LEX.structureWords).length;
    if (st) { s += Math.min(20, st * 4); hits.push('论证结构词 × ' + st); }
    var cc = hitsOf(t, LEX.conclusionWords).length;
    if (cc) { s += 6; hits.push('有明确结论句'); }
    var q = hitsOf(t, LEX.qualifierWords).length;
    if (q) { s += Math.min(9, q * 3); hits.push('使用限定语，表述严谨'); }
    var aw = hitsOf(t, LEX.absoluteWords).length;
    if (aw) { s -= Math.min(12, aw * 4); drops.push('绝对化表述 × ' + aw); }
    var fal = 0;
    LEX.fallacyPatterns.forEach(function (p) {
      if (p.re.test(t)) { fal += p.penalty; drops.push('检测到' + p.label); }
    });
    s -= Math.min(40, fal);
    return { score: Math.round(cap(s, 0, 100)), hits: hits, drops: drops };
  }

  function scoreRelevance(t, context) {
    if (!context || !context.trim()) {
      return { score: 55, hits: [], drops: ['缺少对线上下文，针对性按中性估计（建议填入对方观点）'] };
    }
    var s = 50, hits = [], drops = [];
    var rw = hitsOf(t, LEX.responseWords).length;
    if (rw) { s += Math.min(24, rw * 8); hits.push('直接回应对方表述 × ' + rw); }
    var sim = jaccard(tokenSet(t), tokenSet(context));
    s += Math.min(40, Math.round(sim * 100));
    if (sim < 0.05 && rw === 0) { s -= 15; drops.push('与对方观点重合度低，疑似自说自话'); }
    return { score: Math.round(cap(s, 0, 100)), hits: hits, drops: drops };
  }

  function scoreNovelty(t, others) {
    if (!others || !others.length) {
      return { score: 70, hits: ['库内无其他发言，增量暂按中性处理'] };
    }
    var me = tokenSet(t), maxSim = 0;
    others.forEach(function (o) { var s = jaccard(me, tokenSet(o)); if (s > maxSim) maxSim = s; });
    var pct = Math.round(maxSim * 100), score, note;
    if (maxSim > 0.6) { score = 25; note = '与其他发言高度重合（' + pct + '%），疑似复读'; }
    else if (maxSim > 0.4) { score = 45; note = '与其他发言部分重合（' + pct + '%）'; }
    else if (maxSim > 0.2) { score = 65; note = '有一定重合（' + pct + '%）'; }
    else { score = 82; note = '表述独立，重合度低（' + pct + '%）'; }
    return { score: score, hits: [note] };
  }

  function scoreCivility(t) {
    var s = 85, drops = [];
    var atk = hitsOf(t, LEX.attackWords);
    if (atk.length) { s -= Math.min(60, atk.length * 15); drops.push('人身攻击/辱骂：' + atk.join('、')); }
    var lab = hitsOf(t, LEX.labelWords);
    if (lab.length) { s -= Math.min(40, lab.length * 10); drops.push('扣帽子标签：' + lab.join('、')); }
    var exc = (t.match(/[!！]/g) || []).length;
    var excPer100 = exc / Math.max(1, t.length / 100);
    if (excPer100 > 1) { s -= Math.min(12, excPer100 * 2); drops.push('感叹号密度过高'); }
    if (/！！！/.test(t)) { s -= 6; drops.push('连续感叹号'); }
    return { score: Math.round(cap(s, 0, 100)), drops: drops };
  }

  /* ---------- 红线检测（造谣等需人工确认） ---------- */
  function checkRedLine(t) {
    var atk = hitsOf(t, LEX.attackWords);
    if (atk.length) {
      return { suspected: true, reasons: ['检测到人身攻击/辱骂：' + atk.join('、') + '（造谣等红线项需人工确认）'] };
    }
    return { suspected: false, reasons: [] };
  }

  /* ---------- 单条评分 ---------- */
  function scorePost(post, others) {
    var t = (post.content || '').trim();
    var ev = post.levelOverride
      ? { level: post.levelOverride, R: EVENT_LEVELS[post.levelOverride].R, confidence: 1, reason: '人工定级' }
      : classifyEvent(post.event, t);

    var evd = scoreEvidence(t);
    var lgc = scoreLogic(t);
    var rel = scoreRelevance(t, post.context);
    var nov = scoreNovelty(t, others || []);
    var civ = scoreCivility(t);
    var red = checkRedLine(t);

    var dims = { evidence: evd.score, logic: lgc.score, relevance: rel.score, novelty: nov.score, civility: civ.score };
    var weights = { evidence: 0.30, logic: 0.25, relevance: 0.20, novelty: 0.15, civility: 0.10 };
    var raw = dims.evidence * weights.evidence + dims.logic * weights.logic +
              dims.relevance * weights.relevance + dims.novelty * weights.novelty +
              dims.civility * weights.civility;

    var confidence = 0.75 + Math.min(0.15, t.length / 3000) + (evd.hits.length ? 0.05 : 0);
    confidence = round2(cap(confidence, 0.6, 0.95));
    if (red.suspected) confidence = Math.min(confidence, 0.85);

    var final, redConfirmed = !!post.redConfirmed;
    if (red.suspected && redConfirmed) {
      dims.logic = Math.min(dims.logic, 20);
      raw = Math.min(raw, 30);
      final = -ev.R * 0.6 * confidence;
    } else {
      final = (raw - 50) / 50 * ev.R * confidence;
    }

    var reasons = [];
    evd.hits.forEach(function (h) { reasons.push({ type: 'good', text: h + '（论据+）' }); });
    lgc.hits.forEach(function (h) { reasons.push({ type: 'good', text: h + '（逻辑+）' }); });
    rel.hits.forEach(function (h) { reasons.push({ type: 'good', text: h + '（针对性+）' }); });
    nov.hits.forEach(function (h) { reasons.push({ type: 'good', text: h + '（增量+）' }); });
    lgc.drops.forEach(function (h) { reasons.push({ type: 'bad', text: h + '（逻辑−）' }); });
    rel.drops.forEach(function (h) { reasons.push({ type: 'bad', text: h + '（针对性−）' }); });
    civ.drops.forEach(function (h) { reasons.push({ type: 'bad', text: h + '（礼仪−）' }); });
    if (red.suspected && redConfirmed) reasons.push({ type: 'bad', text: '红线确认：进入负分区' });

    return {
      post: post,
      event: ev,
      dims: dims,
      raw: round1(raw),
      confidence: confidence,
      final: round1(final),
      redLine: { suspected: red.suspected, confirmed: redConfirmed, reasons: red.reasons },
      reasons: reasons
    };
  }

  function scoreAll(posts) {
    var contents = posts.map(function (p) { return (p.content || '').trim(); });
    return posts.map(function (p, i) {
      var others = contents.filter(function (c, j) { return j !== i && c; });
      return scorePost(p, others);
    });
  }

  /* ---------- 天梯段位 ---------- */
  var TIERS = [
    { tier: 'I',    name: '围观群众',      min: -Infinity, max: 199 },
    { tier: 'II',   name: '气氛组',        min: 200,  max: 599 },
    { tier: 'III',  name: '键盘侠',        min: 600,  max: 1299 },
    { tier: 'IV',   name: '对线士兵',      min: 1300, max: 2199 },
    { tier: 'V',    name: '辩手',          min: 2200, max: 3399 },
    { tier: 'VI',   name: '策论人',        min: 3400, max: 5199 },
    { tier: 'VII',  name: '纵横家',        min: 5200, max: 6999 },
    { tier: 'VIII', name: '国师 · 传奇',   min: 7000, max: Infinity }
  ];
  function tierOf(points) {
    for (var i = 0; i < TIERS.length; i++) if (points >= TIERS[i].min && points <= TIERS[i].max) return TIERS[i];
    return TIERS[0];
  }
  function nextTier(points) {
    for (var i = 0; i < TIERS.length; i++) if (TIERS[i].min > points) return TIERS[i];
    return null;
  }

  /* ---------- LLM 评分 prompt（可选模式，见设置） ---------- */
  function buildPrompt(post) {
    var system = '你是辩论质量评审。你只评价论证质量（论据/逻辑/针对性/增量/礼仪五个维度），' +
      '不评价作者的政治立场，对立场本身持绝对中立。严格输出 JSON，不要输出任何其他文字。';
    var lines = [];
    if (post.event) lines.push('【事件/话题】' + post.event);
    if (post.context) lines.push('【对方观点】' + post.context);
    lines.push('【待评发言】' + (post.content || ''));
    lines.push('');
    lines.push('请按五个维度打分（每维 0-100）：evidence 论据质量、logic 逻辑严密、relevance 回应针对性、novelty 信息增量、civility 表达礼仪。');
    lines.push('并检测谬误（稻草人/滑坡/非黑即白/偷换概念/诉诸传统/个例偏差等）与红线（造谣/人身攻击/歧视）。');
    lines.push('输出 JSON：{"scores":{"evidence":0,"logic":0,"relevance":0,"novelty":0,"civility":0},"flags":["谬误名"],"reasons":["逐条点评，引用原文片段"],"red_line":false,"confidence":0.9}');
    return { system: system, user: lines.join('\n') };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EVENT_LEVELS: EVENT_LEVELS, TIERS: TIERS, LEX: LEX,
                       classifyEvent: classifyEvent, scorePost: scorePost, scoreAll: scoreAll,
                       tierOf: tierOf, nextTier: nextTier, buildPrompt: buildPrompt };
  }

  return { EVENT_LEVELS: EVENT_LEVELS, TIERS: TIERS, LEX: LEX,
           classifyEvent: classifyEvent, scorePost: scorePost, scoreAll: scoreAll,
           tierOf: tierOf, nextTier: nextTier, buildPrompt: buildPrompt };
})();
