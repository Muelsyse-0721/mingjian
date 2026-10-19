// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title 明鉴 · 彩池制预测市场（Pari-mutuel Prediction Market）
/// @notice 所有下注进入同一池子；揭晓后赢家按各自投注占赢方池的比例瓜分
///         `总池 × (1 - 抽水)`。没有做市商、没有对手盘，冷门题也能开盘。
/// @dev 安全设计：拉取式提款（pull payment）+ 重入锁 + 争议期 + 整数向下取整，
///      保证「派彩总额 ≤ 可分配金额」，合约不会因舍入被抽干。
contract PariMutuelMarket {
    /* --------------------------------- 常量 --------------------------------- */

    uint16 public constant MAX_FEE_BPS = 500; // 抽水上限 5%
    uint8 public constant MIN_OUTCOMES = 2;
    uint8 public constant MAX_OUTCOMES = 8;
    uint64 public constant DEFAULT_DISPUTE_WINDOW = 1 days;

    /* --------------------------------- 状态 --------------------------------- */

    address public immutable arbiter; // 争议裁决人（对应网站站长改判）
    uint64 public immutable disputeWindow;

    uint256 public nextMarketId = 1;

    uint256 private _locked = 1;

    struct Market {
        address creator;
        uint64 closeAt; // 下注截止
        uint64 disputeDeadline; // 揭晓后的争议截止
        uint16 feeBps; // 抽水（基点）
        uint8 outcomeCount;
        uint8 pendingResult; // 待定结果
        uint8 result; // 最终结果
        bool pendingSet;
        bool disputed;
        bool finalized;
        uint256 totalPool;
        uint256 feeCollected;
        mapping(uint8 => uint256) poolOf; // 每个选项的池子
        mapping(address => mapping(uint8 => uint256)) stakeOf; // 谁押了什么
        mapping(address => uint256) totalStakeOf; // 某人在本题的总投入（用于无人押中时退款）
        mapping(address => bool) claimed;
    }

    mapping(uint256 => Market) private _markets;

    /* --------------------------------- 事件 --------------------------------- */

    event MarketCreated(uint256 indexed id, address indexed creator, uint8 outcomeCount, uint64 closeAt, uint16 feeBps);
    event BetPlaced(uint256 indexed id, address indexed bettor, uint8 outcome, uint256 amount);
    event MarketResolved(uint256 indexed id, uint8 pendingResult, uint64 disputeDeadline);
    event MarketDisputed(uint256 indexed id, address indexed by);
    event MarketFinalized(uint256 indexed id, uint8 result, uint256 totalPool, uint256 fee);
    event Claimed(uint256 indexed id, address indexed bettor, uint256 payout);
    event FeesWithdrawn(uint256 indexed id, address indexed creator, uint256 amount);

    /* --------------------------------- 错误 --------------------------------- */

    error NotCreator();
    error NotArbiter();
    error BadOutcomeCount();
    error BadFee();
    error BadCloseTime();
    error BadOutcome();
    error ZeroStake();
    error MarketClosed();
    error AlreadyResolved();
    error TooEarly();
    error DisputeWindowOpen();
    error DisputeWindowClosed();
    error NotFinalized();
    error AlreadyDisputed();
    error AlreadyClaimed();
    error NothingToClaim();
    error Reentrancy();
    error TransferFailed();

    constructor(address arbiter_, uint64 disputeWindow_) {
        require(arbiter_ != address(0), "arbiter=0");
        arbiter = arbiter_;
        disputeWindow = disputeWindow_ == 0 ? DEFAULT_DISPUTE_WINDOW : disputeWindow_;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier exists(uint256 id) {
        require(_markets[id].creator != address(0), "no market");
        _;
    }

    /* ------------------------------- 建题 / 下注 ------------------------------ */

    function createMarket(uint8 outcomeCount, uint64 closeAt, uint16 feeBps)
        external
        returns (uint256 id)
    {
        if (outcomeCount < MIN_OUTCOMES || outcomeCount > MAX_OUTCOMES) revert BadOutcomeCount();
        if (feeBps > MAX_FEE_BPS) revert BadFee();
        if (closeAt <= block.timestamp) revert BadCloseTime();

        id = nextMarketId++;
        Market storage m = _markets[id];
        m.creator = msg.sender;
        m.closeAt = closeAt;
        m.feeBps = feeBps;
        m.outcomeCount = outcomeCount;

        emit MarketCreated(id, msg.sender, outcomeCount, closeAt, feeBps);
    }

    function bet(uint256 id, uint8 outcome) external payable exists(id) nonReentrant {
        Market storage m = _markets[id];
        if (block.timestamp >= m.closeAt || m.pendingSet) revert MarketClosed();
        if (outcome >= m.outcomeCount) revert BadOutcome();
        if (msg.value == 0) revert ZeroStake();

        m.stakeOf[msg.sender][outcome] += msg.value;
        m.poolOf[outcome] += msg.value;
        m.totalStakeOf[msg.sender] += msg.value;
        m.totalPool += msg.value;

        emit BetPlaced(id, msg.sender, outcome, msg.value);
    }

    /* -------------------------------- 揭晓流程 ------------------------------- */

    /// @notice 建题人给出待定结果，进入争议期
    function resolve(uint256 id, uint8 result) external exists(id) {
        Market storage m = _markets[id];
        if (msg.sender != m.creator) revert NotCreator();
        if (block.timestamp < m.closeAt) revert TooEarly();
        if (m.pendingSet) revert AlreadyResolved();
        if (result >= m.outcomeCount) revert BadOutcome();

        m.pendingResult = result;
        m.pendingSet = true;
        m.disputeDeadline = uint64(block.timestamp) + disputeWindow;

        emit MarketResolved(id, result, m.disputeDeadline);
    }

    /// @notice 争议期内任何人都可以质疑（真实项目里这里要质押保证金防滥用）
    function dispute(uint256 id) external exists(id) {
        Market storage m = _markets[id];
        if (!m.pendingSet) revert NotFinalized();
        if (m.disputed) revert AlreadyDisputed();
        if (block.timestamp >= m.disputeDeadline) revert DisputeWindowClosed();
        m.disputed = true;
        emit MarketDisputed(id, msg.sender);
    }

    /// @notice 争议期结束、无人质疑 → 任何人可固化结果（无需信任建题人继续在线）
    function finalize(uint256 id) external exists(id) {
        Market storage m = _markets[id];
        if (!m.pendingSet || m.finalized) revert NotFinalized();
        if (block.timestamp < m.disputeDeadline) revert DisputeWindowOpen();
        if (m.disputed) revert AlreadyDisputed(); // 有争议必须走 arbiterResolve
        _settle(m, id, m.pendingResult);
    }

    /// @notice 裁决人改判并立即固化（对应网站「站长城主改判」）
    function arbiterResolve(uint256 id, uint8 result) external exists(id) {
        if (msg.sender != arbiter) revert NotArbiter();
        Market storage m = _markets[id];
        if (!m.pendingSet) revert NotFinalized();
        if (m.finalized) revert AlreadyResolved();
        if (result >= m.outcomeCount) revert BadOutcome();
        _settle(m, id, result);
    }

    function _settle(Market storage m, uint256 id, uint8 result) private {
        m.result = result;
        m.finalized = true;
        // 无人押中 → 不抽水，全额退款
        m.feeCollected = m.poolOf[result] == 0 ? 0 : (m.totalPool * m.feeBps) / 10_000;
        emit MarketFinalized(id, result, m.totalPool, m.feeCollected);
    }

    /* --------------------------------- 领取 --------------------------------- */

    function claim(uint256 id) external exists(id) nonReentrant {
        Market storage m = _markets[id];
        if (!m.finalized) revert NotFinalized();
        if (m.claimed[msg.sender]) revert AlreadyClaimed();

        uint256 winnerPool = m.poolOf[m.result];
        uint256 payout;

        if (winnerPool == 0) {
            // 冷门：没人押中 → 用「本题总投入」全额退款（不能只看赢方，那样人人都为 0）
            uint256 refund = m.totalStakeOf[msg.sender];
            if (refund == 0) revert NothingToClaim();
            payout = refund;
        } else {
            uint256 stake = m.stakeOf[msg.sender][m.result];
            if (stake == 0) revert NothingToClaim(); // 输家没有可领
            uint256 distributable = m.totalPool - m.feeCollected;
            payout = (stake * distributable) / winnerPool; // 向下取整，永不多付
        }

        m.claimed[msg.sender] = true;
        (bool ok, ) = payable(msg.sender).call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Claimed(id, msg.sender, payout);
    }

    function withdrawFees(uint256 id) external exists(id) nonReentrant {
        Market storage m = _markets[id];
        if (msg.sender != m.creator) revert NotCreator();
        if (!m.finalized) revert NotFinalized();
        uint256 amount = m.feeCollected;
        if (amount == 0) revert NothingToClaim();
        m.feeCollected = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(id, msg.sender, amount);
    }

    /* --------------------------------- 视图 --------------------------------- */

    function marketInfo(uint256 id)
        external
        view
        returns (
            address creator,
            uint64 closeAt,
            uint64 disputeDeadline,
            uint16 feeBps,
            uint8 outcomeCount,
            uint8 result,
            bool pendingSet,
            bool disputed,
            bool finalized,
            uint256 totalPool,
            uint256 feeCollected
        )
    {
        Market storage m = _markets[id];
        return (
            m.creator, m.closeAt, m.disputeDeadline, m.feeBps, m.outcomeCount,
            m.result, m.pendingSet, m.disputed, m.finalized, m.totalPool, m.feeCollected
        );
    }

    function poolOf(uint256 id, uint8 outcome) external view returns (uint256) {
        return _markets[id].poolOf[outcome];
    }

    function stakeOf(uint256 id, address who, uint8 outcome) external view returns (uint256) {
        return _markets[id].stakeOf[who][outcome];
    }

    function hasClaimed(uint256 id, address who) external view returns (bool) {
        return _markets[id].claimed[who];
    }

    /// @notice 预估派彩（前端展示用；实际以 claim 时为准）
    function previewPayout(uint256 id, address who) external view returns (uint256) {
        Market storage m = _markets[id];
        if (!m.finalized) return 0;
        uint256 winnerPool = m.poolOf[m.result];
        if (winnerPool == 0) return m.totalStakeOf[who]; // 无人押中 → 全额退款
        uint256 stake = m.stakeOf[who][m.result];
        if (stake == 0) return 0;
        return (stake * (m.totalPool - m.feeCollected)) / winnerPool;
    }
}
