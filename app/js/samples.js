/* 演示数据：虚构示例发言与预测问题，仅用于验证评分/投注引擎，非真实内容 */
var DEMO_POSTS = [
  {
    id: 'demo-1',
    event: '个税起征点调整讨论（示例）',
    context: '',
    content: '先说结论：起征点从5000提到8000对中等收入群体是实质性利好。根据国家统计局2023年数据，月收入在5000到8000之间的就业人口约1.2亿，占工薪阶层比重接近35%。财政部的测算也显示，这项调整每年减税约2100亿元，相当于去年全国税收收入的1.3%左右。当然，需要说明的是，我支持分步实施：第一步先扩大专项附加扣除范围，第二步再提高起征点，这样可以给地方财政留出缓冲。可能需要配套的租房租金扣除政策，否则北上广深的压力还是会集中体现在房租上。'
  },
  {
    id: 'demo-2',
    event: '地铁票价动态调价争议（示例）',
    context: '',
    content: '动态调价早晚高峰涨价这个事，我觉得方向是对的但执行会变形。一方面，价格杠杆确实能分流一部分非刚需乘客，香港地铁的分时计价验证过这个效果。但另一方面，一旦允许动态调价，涨价容易降价难，网约车动态加价的前车之鉴就在那摆着。所以关键不在于要不要调价，而在于调价规则由谁来定、多久评估一次。如果规则不透明，所谓平抑客流最后就变成运营方单方面定价。'
  },
  {
    id: 'demo-3',
    event: '评论区对线（示例）',
    context: '你说的这套方案根本不现实，纸上谈兵。',
    content: '你行你上。整天就知道指点江山，真让你去管你管得了吗？别站着说话不腰疼，闭嘴吧。'
  },
  {
    id: 'demo-4',
    event: '评论区对线（示例）',
    context: '调休就是形式主义，直接取消调休就好了。',
    content: '取消调休我同意，但直接取消之后春节和国庆的实际假期会缩水，这点需要说清楚。2019年之前五一只有3天，靠调休凑成长假；取消调休而不增加法定天数，结果是短假变多、长假消失。你说这是形式主义，我认同这个判断，但更可行的方案是把法定节假日从11天增加到13天，同时不再挪用周末，药方应该是加法而不是减法。'
  },
  {
    id: 'demo-5',
    event: '学生手机使用争议（示例）',
    context: '',
    content: '现在的孩子就是矫情，我们当年什么都没有不也照样考上大学？手机禁了正好，一个个抱着手机跟中了毒一样，禁得好！'
  }
];

var DEMO_QUESTIONS = [
  {
    id: 'q-demo-1',
    title: '年底前，会出台新的全国性个税优惠政策吗？',
    desc: '以财政部/国家税务总局正式文件为准；仅指普惠性新政（起征点或专项附加扣除标准调整）。',
    mode: 'pool', fee: 0.05, deadline: '2026-12-31', status: 'open',
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 12000, no: 8000 }, userPool: {},
    createdAt: Date.now() - 6 * 86400000
  },
  {
    id: 'q-demo-2',
    title: '上周演示问题：本轮寒潮蓝色预警是否如期发布？',
    desc: '已揭晓示例，展示结算后的卡片状态。结果：如期发布。',
    mode: 'pool', fee: 0.05, deadline: '2026-10-25', status: 'settled', result: 'yes',
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 6000, no: 6000 }, userPool: {},
    finalOdds: 1.88, settledAt: Date.now() - 2 * 86400000, createdAt: Date.now() - 9 * 86400000
  },
  {
    id: 'q-demo-3',
    title: '「学生手机使用」类话题，多数网友更支持哪种方案？',
    desc: '以公开讨论中的支持度粗略估计，仅供演示。',
    mode: 'fixed', fee: 0, deadline: '2026-12-15', status: 'open',
    outcomes: [
      { id: 'a', label: '全面禁止带入校园', fixedOdds: 2.8 },
      { id: 'b', label: '限制使用时段', fixedOdds: 1.9 },
      { id: 'c', label: '由学校自主决定', fixedOdds: 2.4 }
    ],
    pool: {}, userPool: {}, createdAt: Date.now() - 5 * 86400000
  },
  {
    id: 'q-demo-4',
    title: '下个月前，地铁动态调价会在更多城市试点吗？',
    desc: '以公开发布试点方案的城市数量增加为准。',
    mode: 'pool', fee: 0.05, deadline: '2026-12-15', status: 'open',
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 9000, no: 14000 }, userPool: {},
    createdAt: Date.now() - 4 * 86400000
  },
  {
    id: 'q-demo-5',
    title: '本月内，「调休」话题会再次登上热搜前十？',
    desc: '以热搜榜自然进入前十为限，广告位不计。',
    mode: 'pool', fee: 0.05, deadline: '2026-11-15', status: 'open',
    outcomes: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }],
    pool: { yes: 6500, no: 15500 }, userPool: {},
    createdAt: Date.now() - 3 * 86400000
  }
];

/* 演示用的历史投注（随演示数据一起载入，让战绩回顾有内容可看） */
var DEMO_BETS = [
  { questionId: 'q-demo-1', outcomeId: 'yes', stake: 50,  status: 'open', payout: 0 },
  { questionId: 'q-demo-2', outcomeId: 'yes', stake: 100, status: 'won',  payout: 188.4 },
  { questionId: 'q-demo-5', outcomeId: 'yes', stake: 50,  status: 'lost', payout: 0 }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEMO_POSTS: DEMO_POSTS, DEMO_QUESTIONS: DEMO_QUESTIONS, DEMO_BETS: DEMO_BETS };
}
