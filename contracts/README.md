# 明鉴 · 彩池制预测市场合约（Pari-mutuel）

把明鉴网站的「彩池下注 + 揭晓 + 争议改判」搬到链上，作为 Web3 结算层的最小可行切片。

## 一句话机制

所有人把钱投进一个池子；揭晓后，赢家按各自投注占**赢方池**的比例瓜分 `总池 × (1 − 抽水)`。
没有做市商、没有对手盘——冷门题也能开盘，赔率完全由资金投票决定。

```
可分配 = 总池 × (1 − feeBps/10000)
我的派彩 = 我的投注 × 可分配 ÷ 赢方池
```

## 与网站的映射

| 网站（Web2） | 合约 |
|---|---|
| `彩池赔率 = 总池×(1−5%)÷选项池` | `claim()` 里同一套公式 |
| 到期由站长/公投揭晓 | `resolve()` → 争议期 → `finalize()` |
| 社区仲裁 + 站长改判 | `dispute()` → `arbiterResolve()` |
| 结算记录不可篡改 | 链上事件 `MarketFinalized` |
| 积分只记账、不可提现 | 用测试网 ETH，仅用于演示清结算 |

## 关键设计取舍（面试要讲的就是这些）

**1. 为什么是彩池，不是 AMM / 订单簿？**
AMM（LMSR）需要一个资金雄厚的做市方承担库存风险；订单簿在冷门题上根本没有对手盘。
彩池制只要求「有人下注」，赔率自然形成，适合长尾政治/事件市场。代价是**下注期间赔率会滑点**，
且早期下注者与后期下注者收益不同——这是可接受的产品取舍。

**2. 为什么用拉取式提款（pull payment）？**
不在 `finalize` 里循环给所有赢家转账：赢家数量未知，循环会触发 gas 上限，还会把失败风险绑在结算上。
改成每人自己 `claim()`，结算只写状态，永不失败。

**3. 为什么要有争议期？**
`resolve` 不直接终局，而是设一个 `disputeDeadline`。窗口内任何人可 `dispute`，
一旦有争议，只有 `arbiter` 能改判。这对应网站上的「仲裁/改判」，
也是链上预言机（UMA 乐观预言机）的标准形态：**先给结果，给一段可挑战期，挑战不过才终局**。

**4. 舍入方向**
派彩一律向下取整，且有 fuzz 测试保证 `Σ派彩 ≤ 总池 − 抽水`。
合约永远不会因为舍入被多抽走一分钱——**dust 留在合约里，不会变成资不抵债**。

**5. 没人押中怎么办？**
赢方池为 0 时，抽水置 0，所有人原路全额退款。避免「结果冷门 → 池子被建题人吃掉」的作恶空间。

## 威胁模型与测试覆盖

| 攻击 | 防御 | 测试 |
|---|---|---|
| 结算后继续下注，白嫖已知结果 | `block.timestamp >= closeAt \|\| pendingSet` 拦截 | `test_Revert_BetAfterResolve` |
| 截止后下注 | `closeAt` 检查 | `test_Revert_BetAfterClose` |
| 重复领取 | `claimed` 标记 | `test_Revert_DoubleClaim` |
| 重入领取（The DAO 式） | `nonReentrant` + 先改状态后转账 | `test_Revert_ReentrancyOnClaim` |
| 输家领奖 | 赢方注额为 0 直接 revert | `test_Revert_LoserCannotClaim` |
| 争议状态下强行固化 | `finalize` 遇 `disputed` 直接拒绝 | `test_Dispute_BlocksFinalize_ArbiterOverrides` |
| 截止前抢跑揭晓 | `resolve` 要求 `now >= closeAt` | `test_Revert_ResolveBeforeClose` |
| 二次揭晓 / 篡改结果 | `pendingSet` 只能置一次 | `test_Revert_ResolveTwice` |
| 抽水被人为调高 | `feeBps ≤ 500`（5%） | `test_Revert_FeeAboveCap` |
| 舍入导致超额派彩 | 向下取整 + fuzz 不变量 | `testFuzz_TotalPayoutNeverExceedsPool` |

共 16 个用例（含 1 个 fuzz），覆盖正常流程、争议流程与 9 类攻击。

## 运行

```bash
# 1. 安装 Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# 2. 拉依赖
cd contracts
forge install foundry-rs/forge-std

# 3. 跑测试
forge test -vv

# 4. 本地链演练
anvil
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# 5. 部署到测试网（Base Sepolia / Polygon Amoy）
export RPC_URL=https://sepolia.base.org
export PK=0x...
forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PK --broadcast
```

## 已知局限（如实写，别藏着）

1. **争议无成本**：任何人可免费 `dispute`，容易被 griefing。生产版需要质押保证金（挑战者押钱，败诉没收）。
2. **裁决人中心化**：`arbiter` 是单地址，应改为多签或「乐观预言机 + 上诉期」。
3. **揭晓靠人工**：没有接自动化预言机（Chainlink / UMA），到期需要人触发。
4. **未审计**：这是学习/作品集代码，未经第三方审计，不要上主网放真钱。
5. **无 LP 激励**：彩池制没有流动性提供者角色，也就没有 LP 手续费分成。

## 目录

```
contracts/
├── src/PariMutuelMarket.sol     # 合约（~230 行）
├── test/PariMutuelMarket.t.sol  # 测试 + 重入攻击者合约
├── script/Deploy.s.sol          # 部署脚本
└── foundry.toml
```
