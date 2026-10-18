/* ============================================================
 * 明鉴 · 热点题库 v1.0（100 题）
 * 由 AI 整理的公开论坛热议话题，均为「可验证的未来事件预测」，

 * 不涉及任何立场站队。来源链接指向平台搜索页（非抓取自特定页面）。
 * 单机版可一键导入；联机版由站长播种至云端题库。
 * ============================================================ */
var QUESTION_BANK = [
  {
    "id": "bank-1",
    "category": "科技",
    "title": "2027 年 2 月底前，苹果会发布折叠屏 iPhone 吗？",
    "desc": "以苹果官方发布为准；仅有供应链爆料不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-03-01",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=折叠屏iPhone"
    }
  },
  {
    "id": "bank-2",
    "category": "科技",
    "title": "2026 年底前，会有国产大模型产品宣布日活跃用户破亿吗？",
    "desc": "以官方或权威渠道公布的 DAU 数据为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=大模型日活"
    }
  },
  {
    "id": "bank-3",
    "category": "科技",
    "title": "2026 年 12 月底前，L3 级私家车自动驾驶会获得 3 个以上省市的规模化上路许可吗？",
    "desc": "以各地交管/工信部门公开的准入或通行试点名单为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=L3自动驾驶"
    }
  },
  {
    "id": "bank-4",
    "category": "财经",
    "title": "2026 年 12 月 31 日收盘，上证指数会站在 4000 点上方吗？",
    "desc": "以沪市当年最后一个交易日收盘点数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=上证指数4000点"
    }
  },
  {
    "id": "bank-5",
    "category": "财经",
    "title": "美联储 2026 年 12 月议息会议会宣布降息吗？",
    "desc": "以 FOMC 12 月会议声明为准。",
    "mode": "fixed",
    "fee": 0,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "降息",
        "fixedOdds": 1.55
      },
      {
        "id": "hold",
        "label": "按兵不动",
        "fixedOdds": 3.0
      },
      {
        "id": "hike",
        "label": "加息",
        "fixedOdds": 6.5
      }
    ],
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=美联储12月降息"
    }
  },
  {
    "id": "bank-6",
    "category": "民生",
    "title": "2027 年春运启动前，高铁动态折扣票价会扩大到 5 条以上线路吗？",
    "desc": "以国铁集团公布的执行动态折扣的线路数量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-01-15",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/高铁动态票价"
    }
  },
  {
    "id": "bank-7",
    "category": "社会",
    "title": "2026 年底前，「中小学春秋假」会在 5 个以上省份落地试点吗？",
    "desc": "以省级教育部门正式文件为准，仅个别学校尝试不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/春秋假"
    }
  },
  {
    "id": "bank-8",
    "category": "体育",
    "title": "2027 年亚洲杯开赛前，中国国家男子足球队会更换主教练吗？",
    "desc": "以中国足协正式公告为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-01-10",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=国足主教练"
    }
  },
  {
    "id": "bank-9",
    "category": "消费",
    "title": "2026 年双十一期间，全网成交额会超过去年同期吗？",
    "desc": "以第三方平台统计的全网 GMV 口径为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-11-11",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/双十一"
    }
  },
  {
    "id": "bank-10",
    "category": "科技",
    "title": "2027 年 3 月底前，SpaceX 星舰会完成一次载人飞行任务吗？",
    "desc": "以 NASA / SpaceX 官方确认的载人发射为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-03-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=星舰载人"
    }
  },
  {
    "id": "bank-11",
    "category": "科技",
    "title": "2027 年 6 月底前，特斯拉 FSD 会在中国获得全面上路批准吗？",
    "desc": "以工信部/公安部交通管理局公开准入文件为准；仅试点测试不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=特斯拉FSD中国"
    }
  },
  {
    "id": "bank-12",
    "category": "科技",
    "title": "2027 年 6 月底前，英伟达会正式发售 Rubin 架构显卡吗？",
    "desc": "以英伟达官网正式发售公告为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=英伟达Rubin"
    }
  },
  {
    "id": "bank-13",
    "category": "科技",
    "title": "2027 年 3 月底前，台积电 2nm 工艺月产能会突破 5 万片吗？",
    "desc": "以台积电法说会或供应链权威机构披露的产能数据为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-03-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=台积电2nm"
    }
  },
  {
    "id": "bank-14",
    "category": "科技",
    "title": "2027 年前，全球会有至少一家人形机器人公司宣布年产量破 1 万台吗？",
    "desc": "以公司官方公告或年报披露的产量口径为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=人形机器人量产"
    }
  },
  {
    "id": "bank-15",
    "category": "科技",
    "title": "2027 年前，苹果会发布搭载 M6 芯片的 Mac 电脑吗？",
    "desc": "以苹果官方发布会为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=苹果M6"
    }
  },
  {
    "id": "bank-16",
    "category": "科技",
    "title": "2027 年前，国产操作系统在中国个人电脑市场的份额会突破 10% 吗？",
    "desc": "以权威市场调研机构（如 Canalys/IDC）公开报告为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=国产操作系统"
    }
  },
  {
    "id": "bank-17",
    "category": "科技",
    "title": "2027 年 5 月底前，OpenAI 会发布 GPT-6 吗？",
    "desc": "以 OpenAI 官方发布为准，内部代号泄露不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-05-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=GPT6"
    }
  },
  {
    "id": "bank-18",
    "category": "科技",
    "title": "2027 年前，Anthropic 会发布 Claude 5 吗？",
    "desc": "以 Anthropic 官方发布为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=Claude5"
    }
  },
  {
    "id": "bank-19",
    "category": "科技",
    "title": "2026 年底前，百度萝卜快跑会在 30 个以上城市开展运营吗？",
    "desc": "以萝卜快跑官网/百度财报披露的运营城市数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=萝卜快跑"
    }
  },
  {
    "id": "bank-20",
    "category": "科技",
    "title": "2027 年 6 月底前，中国会开通首条 eVTOL（电动垂直起降飞行器）商业载人航线吗？",
    "desc": "以民航管理部门或运营企业官宣的载人商业航线为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=eVTOL载人"
    }
  },
  {
    "id": "bank-21",
    "category": "科技",
    "title": "2027 年前，SpaceX 星链全球用户数会突破 1000 万吗？",
    "desc": "以 SpaceX 官方或权威渠道公布的订户数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=星链用户"
    }
  },
  {
    "id": "bank-22",
    "category": "科技",
    "title": "2027 年 3 月底前，蓝箭航天朱雀三号可复用火箭会完成入轨发射吗？",
    "desc": "以蓝箭航天官方发布的发射结果为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-03-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=朱雀三号"
    }
  },
  {
    "id": "bank-23",
    "category": "科技",
    "title": "2026 年底前，国内会有车企宣布全固态电池量产装车吗？",
    "desc": "以车企官方公告的量产车型交付为准，仅发布未交付不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=全固态电池"
    }
  },
  {
    "id": "bank-24",
    "category": "科技",
    "title": "2027 年 6 月底前，本源量子会发布 1000 比特以上量子计算机吗？",
    "desc": "以本源量子官方发布的产品参数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=本源量子比特"
    }
  },
  {
    "id": "bank-25",
    "category": "科技",
    "title": "2027 年前，会有完全由 AI 生成的电影长片在主流流媒体平台上线吗？",
    "desc": "以主流平台（Netflix/爱奇艺/腾讯视频等）正式上线为准，短片/预告不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=AI生成电影"
    }
  },
  {
    "id": "bank-26",
    "category": "科技",
    "title": "2026 自然年，比亚迪全球销量会超过 450 万辆吗？",
    "desc": "以比亚迪官方产销快报年度合计为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=比亚迪销量"
    }
  },
  {
    "id": "bank-27",
    "category": "科技",
    "title": "CES 2027 上会有厂商发布可量产的消费级家用机器人吗？",
    "desc": "以 CES 官方参展商发布及公布的量产计划为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-01-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=CES2027机器人"
    }
  },
  {
    "id": "bank-28",
    "category": "科技",
    "title": "2027 年前，iPhone 17 系列全球累计出货量会突破 1 亿台吗？",
    "desc": "以权威供应链机构（如 IDC/ Counterpoint）披露的累计出货为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=iPhone17出货"
    }
  },
  {
    "id": "bank-29",
    "category": "财经",
    "title": "2026 年 12 月 31 日收盘，恒生科技指数会站上 6000 点吗？",
    "desc": "以港交所当年最后一个交易日收盘点数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=恒生科技指数"
    }
  },
  {
    "id": "bank-30",
    "category": "财经",
    "title": "2027 年 6 月底前，COMEX 黄金期货会触及 5000 美元/盎司吗？",
    "desc": "以 COMEX 黄金期货盘中价触及为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=黄金价格"
    }
  },
  {
    "id": "bank-31",
    "category": "财经",
    "title": "2027 年底前，布伦特原油价格会在什么区间？",
    "desc": "以 2027 年最后一个交易日收盘价落点为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "lo",
        "label": "低于 90 美元"
      },
      {
        "id": "mid",
        "label": "90-100 美元"
      },
      {
        "id": "hi",
        "label": "高于 100 美元"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=布伦特原油"
    }
  },
  {
    "id": "bank-32",
    "category": "财经",
    "title": "2026 年 12 月 31 日，离岸人民币兑美元会升破 6.90 吗？",
    "desc": "以当年最后一个交易日离岸收盘价为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=人民币汇率"
    }
  },
  {
    "id": "bank-33",
    "category": "财经",
    "title": "日本央行会在 2027 年 3 月底前加息吗？",
    "desc": "以日本央行政策会议决议公告为准。",
    "mode": "fixed",
    "fee": 0,
    "deadline": "2027-03-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "加息",
        "fixedOdds": 1.8
      },
      {
        "id": "hold",
        "label": "维持不变",
        "fixedOdds": 2.2
      }
    ],
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=日本央行加息"
    }
  },
  {
    "id": "bank-34",
    "category": "财经",
    "title": "2027 年前，英伟达市值会突破 6 万亿美元吗？",
    "desc": "以美股任意交易日收盘市值为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=英伟达市值"
    }
  },
  {
    "id": "bank-35",
    "category": "财经",
    "title": "2026 年底前，A 股上市公司总数会突破 6000 家吗？",
    "desc": "以沪深北三大交易所年末存量上市公司数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "lo",
        "label": "少于 5800 家"
      },
      {
        "id": "mid",
        "label": "5800-6000 家"
      },
      {
        "id": "hi",
        "label": "多于 6000 家"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=A股上市公司"
    }
  },
  {
    "id": "bank-36",
    "category": "财经",
    "title": "2027 年 1 月底前，1 年期 LPR 会较 2026 年末下调吗？",
    "desc": "以全国银行间同业拆借中心公布的 LPR 为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-01-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=LPR"
    }
  },
  {
    "id": "bank-37",
    "category": "财经",
    "title": "2026 年全年，全国 CPI 会同比上涨吗？",
    "desc": "以国家统计局公布的年度 CPI 涨跌幅为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=CPI"
    }
  },
  {
    "id": "bank-38",
    "category": "财经",
    "title": "2026 年全年，中国货物贸易顺差会超过 1.3 万亿美元吗？",
    "desc": "以海关总署公布的年度货物贸易顺差为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=贸易顺差"
    }
  },
  {
    "id": "bank-39",
    "category": "财经",
    "title": "2027 年 6 月底前，飞天茅台批发参考价会回到 1800 元/瓶上方吗？",
    "desc": "以当日主流酒类报价平台的散瓶批发均价为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=茅台批价"
    }
  },
  {
    "id": "bank-40",
    "category": "财经",
    "title": "2027 年底前，标普 500 指数会突破 8000 点吗？",
    "desc": "以任意交易日收盘点数为准。",
    "mode": "fixed",
    "fee": 0,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "lo",
        "label": "低于 7000 点",
        "fixedOdds": 2.2
      },
      {
        "id": "mid",
        "label": "7000-8000 点",
        "fixedOdds": 3.0
      },
      {
        "id": "hi",
        "label": "突破 8000 点",
        "fixedOdds": 5.0
      }
    ],
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=标普500"
    }
  },
  {
    "id": "bank-41",
    "category": "财经",
    "title": "2026 年全年，全国 300 城住宅用地成交面积会同比转正吗？",
    "desc": "以中指研究院/克而瑞等机构公布的年度同比数据为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=住宅用地成交"
    }
  },
  {
    "id": "bank-42",
    "category": "财经",
    "title": "2027 年 6 月底前，纳斯达克指数会突破 25000 点吗？",
    "desc": "以任意交易日收盘点数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=纳斯达克"
    }
  },
  {
    "id": "bank-43",
    "category": "体育",
    "title": "2027 年亚洲杯小组赛，中国男足能出线吗？",
    "desc": "以亚足联官方赛程的小组赛结果为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-01-25",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=亚洲杯国足"
    }
  },
  {
    "id": "bank-44",
    "category": "体育",
    "title": "2027 年亚洲杯，中国男足会晋级八强吗？",
    "desc": "以亚足联官方赛果为准，进入 1/4 决赛即算。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-05",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=亚洲杯八强"
    }
  },
  {
    "id": "bank-45",
    "category": "体育",
    "title": "CBA 2026-27 赛季总冠军会是辽宁队吗？",
    "desc": "以 CBA 官方总决赛结果为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-05-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=CBA冠军"
    }
  },
  {
    "id": "bank-46",
    "category": "体育",
    "title": "NBA 2026-27 赛季总冠军会是东部球队吗？",
    "desc": "以 NBA 官方总决赛结果为准。",
    "mode": "fixed",
    "fee": 0,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "east",
        "label": "东部球队",
        "fixedOdds": 1.75
      },
      {
        "id": "west",
        "label": "西部球队",
        "fixedOdds": 2.15
      }
    ],
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=NBA总冠军"
    }
  },
  {
    "id": "bank-47",
    "category": "体育",
    "title": "欧冠 2026-27 赛季冠军会是皇家马德里吗？",
    "desc": "以欧足联官方决赛结果为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-05-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=欧冠冠军"
    }
  },
  {
    "id": "bank-48",
    "category": "体育",
    "title": "英超 2026-27 赛季冠军会是利物浦吗？",
    "desc": "以英超官方积分榜最终结果为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-05-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=英超冠军"
    }
  },
  {
    "id": "bank-49",
    "category": "体育",
    "title": "F1 2027 赛季车手总冠军会是维斯塔潘吗？",
    "desc": "以 FIA 官方年度车手积分榜为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-05",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=F1冠军"
    }
  },
  {
    "id": "bank-50",
    "category": "体育",
    "title": "2027 年法网男单冠军会是阿尔卡拉斯吗？",
    "desc": "以法网组委会官方赛果为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-10",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=法网男单"
    }
  },
  {
    "id": "bank-51",
    "category": "体育",
    "title": "2027 年前，樊振东会重返国家队世界大赛参赛名单吗？",
    "desc": "以中国乒协/国家队公布的世乒赛或世界杯名单为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=樊振东"
    }
  },
  {
    "id": "bank-52",
    "category": "体育",
    "title": "2027 年世界乒乓球锦标赛，中国队会包揽全部 5 个单项冠军吗？",
    "desc": "以 ITTF 官方赛果的五个单项冠军归属为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-05-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=世乒赛"
    }
  },
  {
    "id": "bank-53",
    "category": "体育",
    "title": "2027 年亚洲杯金靴奖会由中国球员获得吗？",
    "desc": "以亚足联官方公布的金靴得主为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-05",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=亚洲杯金靴"
    }
  },
  {
    "id": "bank-54",
    "category": "体育",
    "title": "2028 洛杉矶奥运会，中国代表团金牌数会达到 45 枚以上吗？",
    "desc": "以国际奥委会官方金牌榜为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "lo",
        "label": "少于 35 枚"
      },
      {
        "id": "mid",
        "label": "35-45 枚"
      },
      {
        "id": "hi",
        "label": "45 枚以上"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=奥运金牌"
    }
  },
  {
    "id": "bank-55",
    "category": "娱乐",
    "title": "2027 年春节档总票房会超过 80 亿元吗？",
    "desc": "以国家电影专资办或灯塔/猫眼公布的春节档票房为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-10",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=春节档票房"
    }
  },
  {
    "id": "bank-56",
    "category": "娱乐",
    "title": "2027 年暑期档总票房会超过 150 亿元吗？",
    "desc": "以国家电影专资办或灯塔/猫眼公布的暑期档票房为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-09-01",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=暑期档票房"
    }
  },
  {
    "id": "bank-57",
    "category": "娱乐",
    "title": "2026 自然年，全国电影总票房会超过 2025 年吗？",
    "desc": "以国家电影专资办公布的年度总票房为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=年度票房"
    }
  },
  {
    "id": "bank-58",
    "category": "娱乐",
    "title": "第 99 届奥斯卡最佳影片会是非英语电影吗？",
    "desc": "以奥斯卡官方公布的 Best Picture 归属为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-03-15",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=奥斯卡最佳影片"
    }
  },
  {
    "id": "bank-59",
    "category": "娱乐",
    "title": "第 99 届奥斯卡，会有华人获得表演或导演类奖项吗？",
    "desc": "以奥斯卡官方公布的表演奖/导演奖归属为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-03-15",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=奥斯卡华人"
    }
  },
  {
    "id": "bank-60",
    "category": "娱乐",
    "title": "2027 年格莱美年度专辑奖会是说唱专辑吗？",
    "desc": "以 Recording Academy 官方公布的年度专辑归属为准。",
    "mode": "fixed",
    "fee": 0,
    "deadline": "2027-02-08",
    "outcomes": [
      {
        "id": "rap",
        "label": "是说唱专辑",
        "fixedOdds": 1.9
      },
      {
        "id": "other",
        "label": "不是说唱专辑",
        "fixedOdds": 2.0
      }
    ],
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=格莱美年度专辑"
    }
  },
  {
    "id": "bank-61",
    "category": "娱乐",
    "title": "2027 年央视春晚，会有语言类节目相关话题登上热搜总榜第一吗？",
    "desc": "以春晚播出当晚微博热搜总榜第一话题为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-20",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=春晚热搜"
    }
  },
  {
    "id": "bank-62",
    "category": "娱乐",
    "title": "2027 年前，周杰伦会举办新一轮世界巡演吗？",
    "desc": "以周杰伦或其公司官方公布的巡演场次为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=周杰伦巡演"
    }
  },
  {
    "id": "bank-63",
    "category": "娱乐",
    "title": "2027 年前，会有国产 3A 游戏发售首周销量破 500 万份吗？",
    "desc": "以发行商官方或权威第三方统计的首周销量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=国产3A销量"
    }
  },
  {
    "id": "bank-64",
    "category": "娱乐",
    "title": "2027 自然年，内地演唱会票房收入会超过 300 亿元吗？",
    "desc": "以中国演出行业协会公布的年度票房为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=演唱会票房"
    }
  },
  {
    "id": "bank-65",
    "category": "娱乐",
    "title": "2027 年五一档总票房会超过 2026 年同期吗？",
    "desc": "以灯塔/猫眼公布的五一档票房为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-05-08",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=五一档票房"
    }
  },
  {
    "id": "bank-66",
    "category": "娱乐",
    "title": "2027 年前，Taylor Swift 会官宣结婚吗？",
    "desc": "以本人或工作室的正式公开声明为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "微博",
      "url": "https://s.weibo.com/weibo?q=TaylorSwift"
    }
  },
  {
    "id": "bank-67",
    "category": "消费",
    "title": "2027 年 618 期间，全网成交额会超过 2026 年同期吗？",
    "desc": "以第三方平台统计的全网 GMV 口径为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-20",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/618成交额"
    }
  },
  {
    "id": "bank-68",
    "category": "消费",
    "title": "2027 年春节前，生猪出场均价会回到 20 元/公斤上方吗？",
    "desc": "以农业农村部公布的月度生猪出场均价为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-01",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/生猪价格"
    }
  },
  {
    "id": "bank-69",
    "category": "消费",
    "title": "2027 年前，瑞幸/库迪的 9.9 元咖啡活动会全面取消吗？",
    "desc": "以两大品牌官方门店活动同步下架为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/9.9咖啡"
    }
  },
  {
    "id": "bank-70",
    "category": "消费",
    "title": "2027 年前，周大福等品牌足金饰品零售价会突破 1500 元/克吗？",
    "desc": "以品牌官方公布的足金饰品挂牌价为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/金价周大福"
    }
  },
  {
    "id": "bank-71",
    "category": "消费",
    "title": "2026 自然年，全国快递业务量会超过 2000 亿件吗？",
    "desc": "以国家邮政局公布的年度业务量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/快递业务量"
    }
  },
  {
    "id": "bank-72",
    "category": "消费",
    "title": "2027 年春节假期，全国旅游收入会超过 7000 亿元吗？",
    "desc": "以文旅部公布的春节假期旅游收入为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-25",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/春节旅游收入"
    }
  },
  {
    "id": "bank-73",
    "category": "消费",
    "title": "2027 年前，国内新能源乘用车渗透率会出现连续 3 个月超过 60% 吗？",
    "desc": "以乘联会公布的月度新能源乘用车渗透率为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/新能源渗透率"
    }
  },
  {
    "id": "bank-74",
    "category": "消费",
    "title": "2027 年五一假期，全国国内出游人次会超过 3.5 亿吗？",
    "desc": "以文旅部公布的假期出游人次为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-05-08",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/五一出游"
    }
  },
  {
    "id": "bank-75",
    "category": "社会",
    "title": "2026 自然年，全国出生人口会超过 950 万人吗？",
    "desc": "以国家统计局公布的年度出生人口为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/出生人口"
    }
  },
  {
    "id": "bank-76",
    "category": "社会",
    "title": "2027 年国考报名人数会超过 350 万人吗？",
    "desc": "以国家公务员局公布的报名过审人数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-10-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/国考报名"
    }
  },
  {
    "id": "bank-77",
    "category": "社会",
    "title": "2027 年考研报名人数会高于 2026 年吗？",
    "desc": "以教育部公布的全国硕士研究生报考人数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-11-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/考研报名"
    }
  },
  {
    "id": "bank-78",
    "category": "社会",
    "title": "2027 年春运，全国铁路发送旅客会超过 5.5 亿人次吗？",
    "desc": "以国铁集团公布的春运发送旅客总量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-28",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/春运铁路"
    }
  },
  {
    "id": "bank-79",
    "category": "社会",
    "title": "2026 年国家医保谈判中，会有 20 种以上新药成功纳入医保目录吗？",
    "desc": "以国家医保局公布的调整名单为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/医保谈判"
    }
  },
  {
    "id": "bank-80",
    "category": "社会",
    "title": "2027 年前，个人养老金开户人数会突破 1 亿吗？",
    "desc": "以人社部或权威渠道披露的累计开户数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/个人养老金"
    }
  },
  {
    "id": "bank-81",
    "category": "社会",
    "title": "2027 年暑假前，全国会有 10 个以上省份推行中小学春秋假吗？",
    "desc": "以省级教育行政部门正式文件为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-09-01",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/春秋假"
    }
  },
  {
    "id": "bank-82",
    "category": "社会",
    "title": "2026/27 年冬季，中央气象台会发布最高级别寒潮预警吗？",
    "desc": "以中央气象台发布的寒潮红色预警记录为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-28",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/寒潮预警"
    }
  },
  {
    "id": "bank-83",
    "category": "交通",
    "title": "2027 年前，C919 大型客机年交付量会超过 50 架吗？",
    "desc": "以中国商飞或权威渠道披露的年度交付量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=C919交付"
    }
  },
  {
    "id": "bank-84",
    "category": "交通",
    "title": "2027 年前，C919 会开通首条国际（跨境）航线吗？",
    "desc": "以中国民航局或航空公司官宣的跨境航线为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=C919国际航线"
    }
  },
  {
    "id": "bank-85",
    "category": "交通",
    "title": "2027 年春运启动前，全国高铁运营里程会突破 5 万公里吗？",
    "desc": "以国铁集团公布的春运前里程数据为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-01-15",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=高铁里程"
    }
  },
  {
    "id": "bank-86",
    "category": "交通",
    "title": "2026 自然年，全国新能源汽车销量会达到什么量级？",
    "desc": "以乘联会或中汽协公布的年度销量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "lo",
        "label": "少于 1500 万辆"
      },
      {
        "id": "mid",
        "label": "1500-1700 万辆"
      },
      {
        "id": "hi",
        "label": "超过 1700 万辆"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=新能源汽车销量"
    }
  },
  {
    "id": "bank-87",
    "category": "交通",
    "title": "2027 年前，城市轨道交通运营里程破千公里的城市会达到 15 个吗？",
    "desc": "以交通运输部或各城市轨道交通协会年报为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=轨道交通里程"
    }
  },
  {
    "id": "bank-88",
    "category": "教育",
    "title": "2027 年高考报名人数会超过 1400 万人吗？",
    "desc": "以教育部公布的全国高考报名人数为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-07",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=高考报名"
    }
  },
  {
    "id": "bank-89",
    "category": "教育",
    "title": "2027 年，全国大学英语六级考试报考人次会超过 2500 万吗？",
    "desc": "以教育部教育考试院公布的报考人次为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=四六级报考"
    }
  },
  {
    "id": "bank-90",
    "category": "教育",
    "title": "2027 年秋季学期，全国会有 1000 所以上高校开设人工智能通识课吗？",
    "desc": "以教育部或高校公开发布的开课信息统计为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-09-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=AI通识课"
    }
  },
  {
    "id": "bank-91",
    "category": "教育",
    "title": "2027 年，全国会有 200 所以上高校新增人工智能本科专业吗？",
    "desc": "以教育部公布的本科专业备案审批名单为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-06-30",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=人工智能专业"
    }
  },
  {
    "id": "bank-92",
    "category": "游戏",
    "title": "《GTA 6》发售 30 天内销量会突破 3000 万份吗？",
    "desc": "以 Take-Two 官方或权威第三方统计的发售后 30 天销量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-01-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=GTA6销量"
    }
  },
  {
    "id": "bank-93",
    "category": "游戏",
    "title": "2027 年前，任天堂 Switch 2 全球销量会突破 4000 万台吗？",
    "desc": "以任天堂财报公布的累计销量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=Switch2销量"
    }
  },
  {
    "id": "bank-94",
    "category": "游戏",
    "title": "2026 自然年，国家新闻出版署发放的游戏版号会超过 1500 款吗？",
    "desc": "以新闻出版署公布的年度过审游戏数量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=游戏版号"
    }
  },
  {
    "id": "bank-95",
    "category": "游戏",
    "title": "2027 年前，米哈游会上映《原神》动画大电影吗？",
    "desc": "以官方公布的院线公映为准，仅 PV/剧集不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=原神动画"
    }
  },
  {
    "id": "bank-96",
    "category": "游戏",
    "title": "2027 年前，游戏科学会公布《黑神话》系列新作消息吗？",
    "desc": "以官方正式公布的预告或立项信息为准，招聘/传闻不计。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=黑神话新作"
    }
  },
  {
    "id": "bank-97",
    "category": "自然",
    "title": "2026 年，西北太平洋及南海会有 25 个以上台风生成吗？",
    "desc": "以中央气象台编制的年度台风编号数量为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2026-12-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/台风生成"
    }
  },
  {
    "id": "bank-98",
    "category": "自然",
    "title": "2026/27 年冬季，中央气象台会发布寒潮红色预警吗？",
    "desc": "以中央气象台官网预警记录为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-02-28",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/寒潮预警"
    }
  },
  {
    "id": "bank-99",
    "category": "自然",
    "title": "2027 年主汛期（6-8 月），长江流域会发生流域性大洪水吗？",
    "desc": "以水利部/长江委认定的流域性洪水等级为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2027-09-15",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "抖音",
      "url": "https://www.douyin.com/search/长江洪水"
    }
  },
  {
    "id": "bank-100",
    "category": "国际",
    "title": "2027 自然年，丰田汽车全球销量会连续第 6 年位居第一吗？",
    "desc": "以丰田及主要竞品集团官方年度销量数据为准。",
    "mode": "pool",
    "fee": 0.05,
    "deadline": "2028-01-31",
    "outcomes": [
      {
        "id": "yes",
        "label": "会"
      },
      {
        "id": "no",
        "label": "不会"
      }
    ],
    "simPool": 1000,
    "source": {
      "platform": "知乎",
      "url": "https://www.zhihu.com/search?type=content&q=丰田销量"
    }
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QUESTION_BANK: QUESTION_BANK };
}