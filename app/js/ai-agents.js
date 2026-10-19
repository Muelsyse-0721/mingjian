/* ============================================================
 * 明鉴 · AI 参与者核心 v1.0（纯函数，无 DOM / 云 / 网络依赖）
 *
 * 定位：站内 10 个固定身份的 AI 人格参与者。它们和真人共用同一套
 *       台账与天梯规则，但身份是「人格代号 #编号」（如「数据党 #01」），
 *       界面另加 AI 徽标。绝不伪装真人。
 *
 * ⚠️ 诚实声明：本模块是**纯本地算法**（确定性伪随机 + 人格参数 + 模板文案），
 *    不调用任何外部或平台的模型 API。「数据党 #01」是人格代号，
 *    不是任何大模型的输出。
 *
 *    身份永久可辨：uid 一律以 'ai-' 开头，昵称一律是「人格代号 #编号」，
 *    界面另加 AI 徽标。绝不伪装真人。
 *
 * ★ 红线 ★
 *   - 身份固定：AI_ROSTER 的 uid / 编号 / 昵称不可运行时改写
 *     （已 Object.freeze）；不提供任何「改昵称装人」的接口。
 *   - 无网络：本模块只做决策与行组装，不发请求、不读写云库、
 *     不碰 DOM；落库由宿主（online.js / 站长台）执行。
 *   - 无随机：全部「随机」都是 hashStr 派生的确定性伪随机，
 *     同一 seed + 同一 uid 永远得到同一结果（可复现、可审计）。
 *   - 不编造事实：composeEvidence / composeLine 只做中立表述，
 *     不写具体数字、不写未经核实的事实、不进行人身攻击。
 *
 * ★ 已核对的账本口径（读 loans.js 后确认，勿凭印象改）★
 *   LoanCore.cashOf:  v = opening_bonus;  每条本人行 v -= stake;
 *                     若 status === 'won' 再 v += payout。
 *   LoanCore.leaderboard: kind !== 'bet' 的行只看 status：
 *                     won → recovered += payout（因此计入现金）；
 *                     open → openStake += stake；其余忽略。
 *   结论：buildSeedRow 的 qid 不是真实题目（'ai-seed-<uid>'），
 *         但 kind='bonus' + status='won' + stake=0 仍然全额计入现金，
 *         不受 qid 是否为真实题目影响，也不会进战绩 / 胜率 / 月榜
 *         （monthly.js 只认 kind==='bet' 且 status ∈ {won,lost}）。
 *   注意：现金 = 站内 opening_bonus（默认 1000）+ seed 的 payout。
 *         若希望 AI 严格从 2000 起步，调用处传
 *         2000 - opening_bonus 即可；本模块不做隐式补偿，
 *         因为补偿会掩盖不同站点配置下的真实余额。
 *
 * 加载方式：<script src="js/ai-agents.js"> → window.AiCore
 *           node: require('./ai-agents.js') → AiCore（仅做单测）
 * ============================================================ */
var AiCore = (function () {
  'use strict';

  var START_POINTS = 2000;      /* 每个 AI 的初始积分（seed 行的 payout） */
  var STAKE_UNIT = 10;          /* 投注额取整单位，与站内习惯一致 */
  var STAKE_CAP = 200;          /* 单个 AI 单笔投注上限 */
  var DEFAULT_MIN_BET = 10;     /* 与 online.js DEFAULT_SETTINGS.min_bet 对齐 */
  var DEFAULT_OPENING_BONUS = 1000; /* 与 online.js OPENING_BONUS 对齐 */

  /* ------------------------------------------------------------
   * 固定花名册：uid / 编号 / 昵称 / 人格 / 风险偏好 / 逆势倾向
   *   risk        —— 单笔投注占可用现金的比例上限
   *   contrarian  —— 0 追主流、1 专挑冷门；见 pickOutcome
   *   categoryPrefs —— planRound 选题时加权（命中 3 倍、否则 1 倍）
   * 顺序与编号即身份，不可增删改；如需扩充请新增编号 11+。
   * ------------------------------------------------------------ */
  var AI_ROSTER = [
    {
      uid: 'ai-deepseek-01', model: '数据党', no: 1,
      display: '数据党 #01', persona: '数据党',
      risk: 0.45, contrarian: 0.20,
      categoryPrefs: ['科技', '经济'],
      bio: '先看数据再说话，爱引用统计口径',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-gpt-02', model: '逻辑派', no: 2,
      display: '逻辑派 #02', persona: '逻辑派',
      risk: 0.50, contrarian: 0.25,
      categoryPrefs: ['政治', '社会'],
      bio: '拆解前提、追问因果链',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-claude-03', model: '温和派', no: 3,
      display: '温和派 #03', persona: '温和派',
      risk: 0.35, contrarian: 0.15,
      categoryPrefs: ['社会', '文化'],
      bio: '措辞谨慎，先承认对方合理处',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-gemini-04', model: '检索派', no: 4,
      display: '检索派 #04', persona: '检索派',
      risk: 0.40, contrarian: 0.20,
      categoryPrefs: ['科技', '国际'],
      bio: '每轮都想给你找个信源',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-qwen-05', model: '考据党', no: 5,
      display: '考据党 #05', persona: '考据党',
      risk: 0.40, contrarian: 0.30,
      categoryPrefs: ['历史', '文化'],
      bio: '爱翻原始时间线与定义',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-glm-06', model: '反问党', no: 6,
      display: '反问党 #06', persona: '反问党',
      risk: 0.35, contrarian: 0.45,
      categoryPrefs: ['社会', '教育'],
      bio: '用反问拆你的隐藏假设',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-grok-07', model: '杠精', no: 7,
      display: '杠精 #07', persona: '杠精',
      risk: 0.60, contrarian: 0.85,
      categoryPrefs: ['科技', '娱乐'],
      bio: '专挑少数派，语气冲但讲理',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-kimi-08', model: '长文派', no: 8,
      display: '长文派 #08', persona: '长文派',
      risk: 0.40, contrarian: 0.30,
      categoryPrefs: ['政策', '经济'],
      bio: '一开口就是三段论',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-doubao-09', model: '吃瓜群众', no: 9,
      display: '吃瓜群众 #09', persona: '吃瓜群众',
      risk: 0.15, contrarian: 0.40,
      categoryPrefs: ['娱乐', '体育'],
      bio: '小额娱乐，爱看热闹',
      startPoints: START_POINTS
    },
    {
      uid: 'ai-llama-10', model: '直觉派', no: 10,
      display: '直觉派 #10', persona: '直觉派',
      risk: 0.55, contrarian: 0.50,
      categoryPrefs: ['科技', '社会'],
      bio: '凭直觉下注，理由常常很朴素',
      startPoints: START_POINTS
    }
  ];

  /* 身份索引 + 冻结：运行时不可改写编号/昵称，避免「装人」 */
  var BY_UID = {};
  AI_ROSTER.forEach(function (a) {
    Object.freeze(a.categoryPrefs);
    BY_UID[a.uid] = Object.freeze(a);
  });
  Object.freeze(BY_UID);
  Object.freeze(AI_ROSTER);

  /* ---------- 小工具 ---------- */
  function round2(v) { return Math.round(Number(v) * 100) / 100; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function clamp(v, lo, hi) {
    var n = Number(v);
    if (!isFinite(n)) n = lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function nowIso(opt) {
    if (opt !== undefined && opt !== null && opt !== '') {
      var d = new Date(opt);
      if (isFinite(d.getTime())) return d.toISOString();
    }
    return new Date().toISOString();
  }
  /* 本地日期串 YYYY-MM-DD，与 online.js / loans.js 的 todayStr 一致 */
  function dayStr(now) {
    var d = new Date(now === undefined || now === null ? Date.now() : now);
    if (!isFinite(d.getTime())) d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ------------------------------------------------------------
   * 确定性伪随机：FNV-1a 32 位 → [0,1)
   * 禁止 Math.random：同一 seed 在任何机器、任何时刻结果一致。
   * ------------------------------------------------------------ */
  function hashStr(str) {
    var s = String(str === undefined || str === null ? '' : str);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      /* FNV prime 16777619 = 2^24 + 2^8 + 0x93 */
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function rand01(seed) {
    return hashStr(seed) / 4294967296;
  }

  /* ------------------------------------------------------------
   * 身份与标识
   * ------------------------------------------------------------ */

  /* 是否 AI：只认 uid 前缀，避免昵称伪造 */
  function isAi(uid) {
    return /^ai-/.test(String(uid === undefined || uid === null ? '' : uid));
  }

  /* 花名册对象（冻结）；未知 uid 返回 null */
  function agentOf(uid) {
    if (uid === undefined || uid === null) return null;
    return BY_UID[String(uid)] || null;
  }

  /* 界面标识：非 AI 返回 null，调用方据此决定是否渲染徽标 */
  function tagOf(uid) {
    var a = agentOf(uid);
    if (!a) return null;
    return { label: a.display, badge: 'AI' };
  }

  /* 展示名：AI 恒为花名册昵称，真人回退到传入昵称 */
  function displayOf(uid, fallback) {
    var a = agentOf(uid);
    if (a) return a.display;
    return fallback === undefined ? '' : fallback;
  }

  /* ------------------------------------------------------------
   * 下注决策
   * ------------------------------------------------------------ */

  /* 某题各选项的池金额（含题目初始池 + 未结算投注） */
  function poolsOf(q, bets) {
    var pools = {};
    if (!q || !Array.isArray(q.outcomes)) return pools;
    q.outcomes.forEach(function (o) {
      if (!o || !o.id) return;
      pools[o.id] = num(q.pool && q.pool[o.id]);
    });
    (bets || []).forEach(function (b) {
      if (!b || b.qid !== q.qid) return;
      if (b.kind && b.kind !== 'bet') return;      /* 奖励/调整行不进池 */
      if (b.status !== 'open') return;
      if (!(b.outcome_id in pools)) return;
      pools[b.outcome_id] = num(pools[b.outcome_id]) + num(b.stake);
    });
    return pools;
  }

  /* 赔率：fixed 模式取固定值；池模式按 总量×(1−抽水)/该选项池 计算。
   * 与 online.js currentOdds 同口径；池为 0 时返回 0（线上同此行为）。 */
  function oddsOf(q, bets, oid) {
    if (!q || !Array.isArray(q.outcomes)) return 0;
    var out = null;
    q.outcomes.forEach(function (o) { if (o && o.id === oid) out = o; });
    if (!out) return 0;
    if (q.mode === 'fixed') return round2(num(out.fixedOdds));
    var pools = poolsOf(q, bets);
    var total = 0;
    Object.keys(pools).forEach(function (k) { total += num(pools[k]); });
    var mine = num(pools[oid]);
    if (mine <= 0) return 0;
    var fee = clamp(q.fee === undefined || q.fee === null ? 0.05 : q.fee, 0, 0.5);
    return round2(total * (1 - fee) / mine);
  }

  /* pickOutcome(agent, question, pools, seed) → oid | null
   *
   * 权重 = 占比 ^ γ
   *   γ = 1 − 2×contrarian（逆势者 γ<0，越冷门权重越高）
   *   数据党/逻辑派/检索派/考据党：γ +0.35（更愿意跟主流）
   *   杠精：γ −0.25（更极端地挑少数派）
   * 用 seed 派生一次 [0,1) 抽样，余量落在最后一档。
   */
  function pickOutcome(agent, question, pools, seed) {
    if (!agent || !question || !Array.isArray(question.outcomes)) return null;
    var outs = question.outcomes.filter(function (o) { return o && o.id != null && String(o.id) !== ''; });
    if (!outs.length) return null;
    if (outs.length === 1) return String(outs[0].id);

    var amounts = outs.map(function (o) { return Math.max(0, num(pools && pools[o.id])); });
    var total = amounts.reduce(function (s, v) { return s + v; }, 0);
    var n = outs.length;
    var shares = amounts.map(function (v) { return total > 0 ? v / total : 1 / n; });

    var c = clamp(agent.contrarian === undefined ? 0.3 : agent.contrarian, 0, 1);
    var gamma = 1 - 2 * c;
    if (agent.persona === '数据党' || agent.persona === '逻辑派' ||
        agent.persona === '检索派' || agent.persona === '考据党') {
      gamma += 0.35;
    }
    if (agent.persona === '杠精') gamma -= 0.25;
    gamma = clamp(gamma, -1.2, 1.4);

    var weights = shares.map(function (s) {
      return Math.pow(Math.max(s, 1e-6), gamma);
    });
    var wsum = weights.reduce(function (s, v) { return s + v; }, 0);
    if (!(wsum > 0) || !isFinite(wsum)) return String(outs[0].id);

    var r = rand01(String(seed === undefined || seed === null ? '' : seed) +
      '|' + agent.uid + '|' + String(question.qid === undefined ? '' : question.qid));
    var acc = 0;
    for (var i = 0; i < n; i++) {
      acc += weights[i] / wsum;
      if (r < acc) return String(outs[i].id);
    }
    return String(outs[n - 1].id);
  }

  /* pickStake(agent, balance, settings) → 整数（0 表示不下注）
   *   balance < min_bet        → 0
   *   上限 = min(balance×risk, 200)，下限 = min_bet
   *   取整到 10 的倍数，且绝不超过 balance
   */
  function pickStake(agent, balance, settings) {
    if (!agent) return 0;
    var s = (settings && settings.site) || settings || {};
    var minBet = num(s.min_bet) > 0 ? Math.floor(num(s.min_bet)) : DEFAULT_MIN_BET;
    var bal = Math.floor(num(balance));
    if (!(bal >= minBet)) return 0;

    var risk = clamp(agent.risk === undefined ? 0.4 : agent.risk, 0, 1);
    var cap = Math.min(Math.floor(bal * risk), STAKE_CAP);
    var stake = Math.floor(cap / STAKE_UNIT) * STAKE_UNIT;
    if (stake < minBet) stake = Math.ceil(minBet / STAKE_UNIT) * STAKE_UNIT;
    if (stake > bal) stake = Math.floor(bal / STAKE_UNIT) * STAKE_UNIT;
    if (stake < minBet) return 0;
    return stake;
  }

  /* jp_bets 行：字段与 online.js placeBet 完全一致（status/kind 走库默认） */
  function buildBetRow(agent, q, oid, stake, odds) {
    if (!agent || !q || oid === undefined || oid === null) return null;
    var st = Math.floor(num(stake));
    if (!(st > 0)) return null;
    return {
      qid: q.qid,
      uid: agent.uid,
      nickname: agent.display,
      outcome_id: String(oid),
      stake: st,
      odds_at_bet: round2(odds)
    };
  }

  /* ------------------------------------------------------------
   * 初始积分行（kind='bonus'）
   * 口径见文件头：stake=0 + status='won' + payout=points
   * → 全额计入现金，且不进投注笔数 / 胜率 / 月榜。
   * ------------------------------------------------------------ */
  function buildSeedRow(agent, points, opts) {
    if (!agent) return null;
    var o = opts || {};
    var pts = Math.floor(num(points === undefined ? agent.startPoints : points));
    if (!(pts >= 0)) pts = 0;
    var ts = nowIso(o.now);
    return {
      qid: 'ai-seed-' + agent.uid,
      uid: agent.uid,
      nickname: agent.display,
      outcome_id: 'seed',
      stake: 0,
      odds_at_bet: 0,
      status: 'won',
      kind: 'bonus',
      payout: pts,
      placed_at: ts,
      settled_at: ts
    };
  }

  /* ------------------------------------------------------------
   * 证据（jp_evidence）
   * EvidenceCore.validateEvidence 的实际约束（已核对）：
   *   side ∈ {yes,no,neutral}；title 4–80 字；summary ≤300 字；
   *   url 可空，非空须匹配 /^https?:\/\/\S+$/i。
   * ------------------------------------------------------------ */
  function buildEvidenceRow(agent, q, item) {
    if (!agent || !q || !item) return null;
    return {
      qid: q.qid,
      uid: agent.uid,
      nickname: agent.display,
      side: String(item.side === undefined || item.side === null ? '' : item.side),
      status: 'pending',
      url: String(item.url === undefined || item.url === null ? '' : item.url).trim(),
      title: String(item.title === undefined || item.title === null ? '' : item.title).trim(),
      summary: String(item.summary === undefined || item.summary === null ? '' : item.summary).trim()
    };
  }

  /* 按人格生成一条中立背景资料（不预设立场、不写具体数据）
   * side 固定 ''：由提交者按证据实际立场填写，AI 不替证据选边。 */
  function composeEvidence(agent, q) {
    if (!agent || !q) return null;
    var topic = String(q.title === undefined || q.title === null ? '' : q.title).trim() || '该话题';
    var short = topic.length > 24 ? topic.slice(0, 24) + '…' : topic;
    var cat = String(q.category === undefined || q.category === null ? '' : q.category).trim();
    var kw = (cat ? cat + ' ' : '') + short.replace(/…$/, '');

    var title = '关于「' + short + '」的公开资料检索';
    if (title.length > 80) title = title.slice(0, 79) + '…';
    if (title.length < 4) title = '公开资料检索';

    var summary = '仅提供公开信息的检索入口：围绕「' + short +
      '」汇总公开报道与讨论，供对照原始信源使用；不预设结论，也不代表支持任一立场。';
    if (summary.length > 300) summary = summary.slice(0, 299) + '。';

    return {
      side: '',
      title: title,
      url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(kw),
      summary: summary
    };
  }

  /* ------------------------------------------------------------
   * 对线发言（jp_debate_posts）
   * 40–120 字；人格决定语气；round 决定措辞轮换；不写数字事实、
   * 不评价个人、不使用辱骂词。
   * ------------------------------------------------------------ */
  var LINE_BODIES = {
    '数据党': [
      '先看可核对的数据口径，再谈结论；口径不同，结论往往也不同。',
      '样本范围不明确时，我不会把话说满，留有余地更稳妥。',
      '把统计口径对齐，很多分歧其实会小一半。'
    ],
    '逻辑派': [
      '先把前提摆出来，再看推理链是否闭合；前提不成立，结论就要重来。',
      '我关心的是因果链是否成立，而不是谁的声音更大。',
      '这个判断若能拆成几个可检验的步骤，讨论会清楚很多。'
    ],
    '温和派': [
      '对方的担心有合理处，我先把这一点承认下来，再谈我的看法。',
      '这件事很难非黑即白，我更愿意看它在什么条件下成立。',
      '先把共同点找出来，剩下的分歧才有得谈。'
    ],
    '检索派': [
      '我会先去找一手信源，再决定站哪边；二手转述容易走样。',
      '有链接、可回溯的论据，比形容词更有说服力。',
      '这条建议回到原始报道核对一遍，再下判断不迟。'
    ],
    '考据党': [
      '时间线和定义先对齐，后面的讨论才有意义。',
      '同一个名词在不同文件里含义可能不同，先分清再引用。',
      '我倾向于翻最早的版本，看它当初到底怎么写的。'
    ],
    '反问党': [
      '这个结论依赖哪个隐含假设？如果它不成立，结论还站得住吗？',
      '先问一句：这个判断的适用边界在哪里，越界之后还成立吗？',
      '如果把反方最强的理由放进来，你的论证还完整吗？'
    ],
    '杠精': [
      '多数派未必对，我偏要看看少数派怎么说，再决定信谁。',
      '这个共识来得太容易，我想先拆一拆它的支撑。',
      '别急着附和，先把反例摆出来，再谈结论。'
    ],
    '长文派': [
      '第一，先界定概念；第二，再比较条件；第三，才谈结论。',
      '我分三层说：事实层、解释层、判断层，逐层核对。',
      '把问题拆成三段之后，哪一段最薄弱就比较清楚了。'
    ],
    '吃瓜群众': [
      '我就是来看热闹的，顺手小额参与一下，不站太高。',
      '这事儿挺有意思，我先听听大家怎么说再表态。',
      '围观也有围观的价值，至少能看清各方的说法。'
    ],
    '直觉派': [
      '我说不出太多道理，但感觉这一边更靠谱一些。',
      '凭直觉我选这一边，理由很朴素：看起来更顺。',
      '先按直觉走，后面再用事实来修正也不迟。'
    ]
  };

  var ROUND_PHRASES = [
    '第 {n} 轮，我把观点收拢一次。',
    '第 {n} 轮补充一句，免得被误读。',
    '第 {n} 轮了，我换个说法再讲一遍。',
    '第 {n} 轮，我只保留最核心的一点。'
  ];

  function composeLine(agent, topic, side, round, seed, stanceText) {
    if (!agent) return '';
    var t = String(topic === undefined || topic === null ? '' : topic).trim() || '这个话题';
    if (t.length > 30) t = t.slice(0, 30) + '…';

    var sd = side === 'a' ? 'a' : (side === 'b' ? 'b' : '');
    var stance = stanceText
      ? String(stanceText).trim()
      : (sd === 'a' ? '支持甲方' : (sd === 'b' ? '支持乙方' : '保持中立'));

    var n = Math.max(1, Math.floor(num(round) || 1));
    var pool = LINE_BODIES[agent.persona] || LINE_BODIES['逻辑派'];
    var bi = hashStr(String(seed === undefined || seed === null ? '' : seed) +
      '|' + agent.uid + '|line|' + n + '|' + sd) % pool.length;
    var ri = hashStr(String(seed === undefined || seed === null ? '' : seed) +
      '|' + agent.uid + '|round|' + n) % ROUND_PHRASES.length;

    var line = pool[bi] + '关于「' + t + '」，这轮我' + stance + '。' +
      ROUND_PHRASES[ri].replace(/\{n\}/g, String(n));

    if (line.length < 40) line += '以上只是我的判断，欢迎用事实来反驳。';
    if (line.length > 120) line = line.slice(0, 119) + '。';
    return line;
  }

  /* jp_debate_posts 行：字段与 online.js postDebate 一致 */
  function buildDebatePost(agent, room, side, round, content) {
    if (!agent || !room) return null;
    var text = String(content === undefined || content === null ? '' : content).trim();
    if (text.length > 500) text = text.slice(0, 500);
    return {
      did: room.did,
      uid: agent.uid,
      nickname: agent.display,
      side: String(side === undefined || side === null ? '' : side),
      round_no: Math.max(1, Math.floor(num(round) || 1)),
      content: text
    };
  }

  /* ------------------------------------------------------------
   * LLM 研判（可选增强：调用方传 prompt 给云端模型；失败回退本地算法）
   * ------------------------------------------------------------ */
  function buildAnalyzePrompt(agent, q) {
    var outs = ((q && q.outcomes) || []).map(function (o) {
      return o.id + '=' + o.label;
    }).join('; ');
    var lines = [
      '你是预测市场里的参与者「' + (agent && (agent.display || agent.uid) || '参与者') + '」，人格是「' +
        (agent && agent.persona || '理性') + '」。',
      '请基于你已有的知识分析下面这个问题。不要编造精确数字；不确定就明确说"不确定"。',
      '问题：' + ((q && q.title) || ''),
      (q && q.descr ? '说明：' + q.descr : ''),
      '选项（id=标签）：' + outs,
      (q && q.deadline ? '截止：' + q.deadline : ''),
      (q && q.category ? '分类：' + q.category : ''),
      '只输出一个 JSON 对象，不要 markdown 代码块、不要多余文字：',
      '{"outcome":"<选项id>","confidence":<0到1的小数>,"reason":"<=80字，为什么选它","facts":"<=100字，你已知的相关公开事实或数量级，不确定要写不确定"}'
    ];
    return lines.filter(Boolean).join('\n');
  }

  function parseAnalysis(text, q) {
    var s = String(text === undefined || text === null ? '' : text);
    var i = s.indexOf('{');
    var j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    var o;
    try { o = JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    var ids = ((q && q.outcomes) || []).map(function (x) { return String(x.id); });
    var oid = o.outcome === undefined || o.outcome === null ? '' : String(o.outcome);
    if (ids.length && ids.indexOf(oid) < 0) return null;
    return {
      outcome: oid || null,
      confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
      reason: String(o.reason || '').slice(0, 160),
      facts: String(o.facts || '').slice(0, 200)
    };
  }

  function composeNote(analysis) {
    if (!analysis) return '';
    var parts = [];
    if (analysis.reason) parts.push('理由：' + analysis.reason);
    if (analysis.facts) parts.push('已知：' + analysis.facts);
    return parts.join('　').slice(0, 260);
  }

  function buildEvidencePrompt(agent, q) {
    return [
      '你是资料整理员（身份：「' + (agent && (agent.display || agent.uid) || '资料员') + '」）。',
      '围绕下面的预测题，整理**中立**的公开背景资料：不预设立场、不编造精确数字；不确定就写"不确定"。',
      '题目：' + ((q && q.title) || ''),
      (q && q.descr ? '说明：' + q.descr : ''),
      '只输出一个 JSON 对象，不要 markdown 代码块：',
      '{"title":"<=40字标题","summary":"<=200字：现在已知的现状/数量级/公开口径","query":"<用于检索的关键词，10字内>"}'
    ].filter(Boolean).join('\n');
  }

  function parseEvidence(text) {
    var s = String(text === undefined || text === null ? '' : text);
    var i = s.indexOf('{');
    var j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    var o;
    try { o = JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    var title = String(o.title || '').trim().slice(0, 60);
    var summary = String(o.summary || '').trim().slice(0, 300);
    var kw = String(o.query || o.title || '').trim().slice(0, 30) || '相关公开数据';
    if (title.length < 2) return null;
    return {
      side: '',
      title: title,
      summary: summary,
      url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(kw)
    };
  }

  /* ------------------------------------------------------------
   * 批量计划
   * ------------------------------------------------------------ */

  /* 现金口径严格对齐 LoanCore.cashOf（本模块只拿得到 bets）：
   *   v = opening_bonus; 每条本人行 v -= stake; won 再加 payout
   * bonus / seed 行 stake=0，因此等于把 payout 全额计入。 */
  function cashOfBets(uid, bets, settings) {
    var s = (settings && settings.site) || settings || {};
    var bonus = isFinite(Number(s.opening_bonus)) ? Number(s.opening_bonus) : DEFAULT_OPENING_BONUS;
    var v = bonus;
    (bets || []).forEach(function (b) {
      if (!b || String(b.uid) !== String(uid)) return;
      v -= num(b.stake);
      if (b.status === 'won') v += num(b.payout);
    });
    return round2(v);
  }

  /* 过期判定与 online.js isExpired 一致：deadline < 今天 才算过期；
   * 没填 deadline 视为不过期。 */
  function isExpiredOn(q, today) {
    if (!q || !q.deadline) return false;
    return String(q.deadline) < today;
  }

  /* 按 categoryPrefs 加权抽题（命中 3 倍），确定性 */
  function pickQuestion(agent, list, seedStr) {
    var prefs = (agent && Array.isArray(agent.categoryPrefs)) ? agent.categoryPrefs : [];
    var weights = list.map(function (q) {
      return prefs.indexOf(String((q && q.category) || '')) >= 0 ? 3 : 1;
    });
    var total = weights.reduce(function (s, v) { return s + v; }, 0);
    if (!(total > 0)) return list[0] || null;
    var r = rand01(seedStr) * total;
    var acc = 0;
    for (var i = 0; i < list.length; i++) {
      acc += weights[i];
      if (r < acc) return list[i];
    }
    return list[list.length - 1];
  }

  /* planRound(agents, questions, bets, settings, opts) → jp_bets 行数组
   *   opts.maxN  总条数上限（默认 30）
   *   opts.now   注入当前时间（毫秒或 Date/ISO，默认 Date.now()）
   *   opts.seed  额外随机盐（默认 ''），保证同输入同输出
   * 每个 agent 每轮最多下 1 笔；现金 < min_bet 直接跳过。
   */
  function planRound(agents, questions, bets, settings, opts) {
    var o = opts || {};
    var maxN = Math.floor(num(o.maxN === undefined ? 30 : o.maxN));
    if (!(maxN > 0)) maxN = 30;
    var nowMs = o.now === undefined || o.now === null ? Date.now() : new Date(o.now).getTime();
    if (!isFinite(nowMs)) nowMs = Date.now();
    var today = dayStr(nowMs);

    var open = (questions || []).filter(function (q) {
      return q && q.status === 'open' && !isExpiredOn(q, today) &&
        Array.isArray(q.outcomes) && q.outcomes.length > 0;
    });
    var rows = [];
    if (!open.length) return rows;

    (agents || []).forEach(function (agent) {
      if (rows.length >= maxN) return;
      if (!agent || !agent.uid) return;

      var cash = cashOfBets(agent.uid, bets, settings);
      if (!(pickStake(agent, cash, settings) > 0)) return;   /* 余额不足，跳过 */

      var salt = o.seed === undefined || o.seed === null ? '' : String(o.seed);
      var baseSeed = 'round|' + agent.uid + '|' + salt + '|' + today;
      var q = pickQuestion(agent, open, baseSeed + '|q');
      if (!q) return;

      var qBets = (bets || []).filter(function (b) {
        return b && b.qid === q.qid && b.status === 'open' && (!b.kind || b.kind === 'bet');
      });
      var oid = pickOutcome(agent, q, poolsOf(q, qBets), baseSeed + '|o');
      if (!oid) return;

      var stake = pickStake(agent, cash, settings);
      if (!(stake > 0)) return;

      var row = buildBetRow(agent, q, oid, stake, oddsOf(q, qBets, oid));
      if (row) rows.push(row);
    });

    return rows.slice(0, maxN);
  }

  /* 花名册副本（只读用途；身份以 AI_ROSTER 为准） */
  function listAgents() {
    return AI_ROSTER.map(function (a) {
      return {
        uid: a.uid, model: a.model, no: a.no, display: a.display,
        persona: a.persona, risk: a.risk, contrarian: a.contrarian,
        categoryPrefs: a.categoryPrefs.slice(), bio: a.bio,
        startPoints: a.startPoints
      };
    });
  }

  return {
    AI_ROSTER: AI_ROSTER,
    START_POINTS: START_POINTS,
    STAKE_UNIT: STAKE_UNIT,
    STAKE_CAP: STAKE_CAP,
    hashStr: hashStr,
    rand01: rand01,
    isAi: isAi,
    agentOf: agentOf,
    tagOf: tagOf,
    displayOf: displayOf,
    listAgents: listAgents,
    cashOfBets: cashOfBets,
    poolsOf: poolsOf,
    oddsOf: oddsOf,
    pickOutcome: pickOutcome,
    pickStake: pickStake,
    buildBetRow: buildBetRow,
    buildSeedRow: buildSeedRow,
    buildEvidenceRow: buildEvidenceRow,
    composeEvidence: composeEvidence,
    buildAnalyzePrompt: buildAnalyzePrompt,
    parseAnalysis: parseAnalysis,
    composeNote: composeNote,
    buildEvidencePrompt: buildEvidencePrompt,
    parseEvidence: parseEvidence,
    composeLine: composeLine,
    buildDebatePost: buildDebatePost,
    planRound: planRound,
    round2: round2
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AiCore;
}
