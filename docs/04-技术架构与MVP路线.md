# 技术架构与 MVP 路线

## 一、总体架构（五层）

```
采集层 → 清洗存储 → 事件分级 → AI 评分 → 天梯展示
```

- **采集层**：M1 只做「手动导入（粘贴 / JSON）」；M3 再评估爬虫方案（RSSHub 自建 / Cookie 自用）
- **清洗**：去重、按话题聚类成「事件」、合并同帖多楼对线
- **事件分级**：有热度数据按量级映射；无数据走 LLM 语义判定（S/A/B/C）
- **评分**：LLM API 批量异步任务（队列 + 重试 + 缓存 + 模型版本管理）
- **展示**：个人战报页（雷达图 + 逐条点评）→ 排行榜 → 赛季结算

**预测下注模块（v0.2 起）**：与评分模块共用积分，独立成「问题 / 投注 / 流水账」三张表，赔率引擎为纯函数（app/js/betting.js），详见 docs/05。

## 二、数据模型（核心表）

| 表 | 关键字段 |
|---|---|
| users | id, zhihu_id, display_name（可匿名化）, points, tier, season_id |
| events | id, title, level(S/A/B/C), heat_metrics, source |
| posts | id, user_id, event_id, type(answer/comment), content, url, status |
| scores | id, post_id, dims(JSON), raw, confidence, final, model_version, reviewed |
| appeals | id, score_id, reason, result, created_at |
| seasons | id, name, start_at, end_at |

## 三、MVP 三阶段

### M1 单机 Demo（1–2 周）— 验证评分引擎 ✅ 已完成（2026-10-17）

- 形态：纯静态网页（`app/index.html`，双击即用，数据存 localStorage，无后端）
- 输入：粘贴导入（事件名/内容/对线上下文）、JSON 导入、5 条虚构演示数据
- 输出：事件分级 + 五维评分 + 个人战报（总积分、段位进度、五维雷达图、逐条点评）
- 引擎：离线启发式（词库 + 结构检测 + 复读检测），另预留 LLM 接口（设置中配置 OpenAI 兼容 API）
- 验收：评分结果人工看着靠谱；立场中立测试通过
- 引擎自测结果（演示数据）：S 级高分发言 +45.8，A 级 +7.4，C 级优质对线 +2.0，C 级人身攻击 −4.6，B 级纯情绪 −1.4

### M2 小圈子版（2–4 周）— 验证游戏化

- 本地/邀请制部署，多用户，排行榜，申诉入口
- 数据：手动导入为主 + RSSHub 试验
- 验收：朋友愿意天天来看自己的分

### M3 公开版（法务评估后）

- 自动采集、ICP 备案、内容审核、社区功能
- 前置：docs/01 的合规清单全部打勾

## 四、成本估算（量级）

- LLM 评分（以 DeepSeek 为例）：一条 500 字回答 ≈ 1.5k tokens，1 万条 ≈ ¥20–40
- 同量级用 GPT-4o：约 ¥700–2000
- **结论：LLM 成本不是瓶颈，冷启动的标注和校准才是**
- 基础设施：单台云服务器 + PostgreSQL，起步约 ¥100–200/月

## 五、技术选型建议

- 后端：Node.js 或 Python（评分 prompt 工程 + 后续爬虫都顺手）
- 数据库：PostgreSQL（关系型够用）
- 队列：任意轻量任务队列（BullMQ / Celery）
- 前端：任意现代框架，先做战报页和排行榜两个页面
