// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PariMutuelMarket} from "../src/PariMutuelMarket.sol";

/// @dev 重入攻击者：领奖时在 receive 里再次调用 claim
contract ReentrantClaimer {
    PariMutuelMarket public market;
    uint256 public id;
    uint8 public outcome;
    bool private attacking;

    constructor(PariMutuelMarket m) {
        market = m;
    }

    function placeBet(uint256 _id, uint8 _outcome) external payable {
        id = _id;
        outcome = _outcome;
        market.bet{value: msg.value}(_id, _outcome);
    }

    function attack() external {
        attacking = true;
        market.claim(id);
    }

    receive() external payable {
        if (attacking) {
            attacking = false;
            market.claim(id); // 试图再领一次
        }
    }
}

contract PariMutuelMarketTest is Test {
    PariMutuelMarket internal m;

    address internal arbiter = address(0xA11CE);
    address internal creator = address(0xC0FFEE);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);
    address internal attacker = address(0xBAD);

    uint16 internal constant FEE = 500; // 5%

    function setUp() public {
        vm.warp(1_000_000);
        m = new PariMutuelMarket(arbiter, 1 days);
        vm.deal(creator, 100 ether);
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
        vm.deal(carol, 10_000 ether);
        vm.deal(attacker, 10_000 ether);
    }

    function _newMarket(uint8 outcomes, uint16 fee) internal returns (uint256 id) {
        vm.prank(creator);
        id = m.createMarket(outcomes, uint64(block.timestamp + 1 days), fee);
    }

    /// 押注 → 截止 → 揭晓 → 争议期结束 → 固化
    function _openAndSettle(uint256 id, uint8 result) internal {
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(creator);
        m.resolve(id, result);
        vm.warp(block.timestamp + 1 days + 1);
        m.finalize(id);
    }

    /* ------------------------------ 正常流程 ------------------------------ */

    function test_FullFlow_WinnerTakesLosingPool() public {
        uint256 id = _newMarket(2, FEE);

        vm.prank(alice);
        m.bet{value: 30 ether}(id, 0);
        vm.prank(bob);
        m.bet{value: 70 ether}(id, 1);

        (,,, uint16 feeBps,,,,,, uint256 totalPool,) = m.marketInfo(id);
        assertEq(feeBps, FEE);
        assertEq(totalPool, 100 ether);

        _openAndSettle(id, 0); // 「会」赢

        uint256 before = alice.balance;
        vm.prank(alice);
        m.claim(id);
        // 可分配 = 100 × 95% = 95；alice 独占赢方池 → 拿 95
        assertEq(alice.balance - before, 95 ether);
    }

    function test_SplitPayout_ProRata() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: 30 ether}(id, 0);
        vm.prank(carol);
        m.bet{value: 20 ether}(id, 0);
        vm.prank(bob);
        m.bet{value: 50 ether}(id, 1);

        _openAndSettle(id, 0);

        // 可分配 95；赢方池 50；alice 占 60% → 57
        assertEq(m.previewPayout(id, alice), 57 ether);
        assertEq(m.previewPayout(id, carol), 38 ether);
    }

    /* ------------------------------ 攻击面：下注 ------------------------------ */

    function test_Revert_BetAfterClose() public {
        uint256 id = _newMarket(2, FEE);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.MarketClosed.selector);
        m.bet{value: 1 ether}(id, 0);
    }

    function test_Revert_BetAfterResolve() public {
        uint256 id = _newMarket(2, FEE);
        _openAndSettle(id, 0);
        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.MarketClosed.selector);
        m.bet{value: 1 ether}(id, 0);
    }

    function test_Revert_BetInvalidOutcome() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.BadOutcome.selector);
        m.bet{value: 1 ether}(id, 2);
    }

    function test_Revert_ZeroStake() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.ZeroStake.selector);
        m.bet{value: 0}(id, 0);
    }

    function test_Revert_FeeAboveCap() public {
        vm.prank(creator);
        vm.expectRevert(PariMutuelMarket.BadFee.selector);
        m.createMarket(2, uint64(block.timestamp + 1 days), 501);
    }

    function test_Revert_CloseTimeInPast() public {
        vm.prank(creator);
        vm.expectRevert(PariMutuelMarket.BadCloseTime.selector);
        m.createMarket(2, uint64(block.timestamp), 100);
    }

    /* ------------------------------ 攻击面：揭晓 ------------------------------ */

    function test_Revert_ResolveBeforeClose() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(creator);
        vm.expectRevert(PariMutuelMarket.TooEarly.selector);
        m.resolve(id, 0);
    }

    function test_Revert_ResolveTwice() public {
        uint256 id = _newMarket(2, FEE);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(creator);
        m.resolve(id, 0);
        vm.prank(creator);
        vm.expectRevert(PariMutuelMarket.AlreadyResolved.selector);
        m.resolve(id, 1);
    }

    function test_Revert_NonCreatorResolve() public {
        uint256 id = _newMarket(2, FEE);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.NotCreator.selector);
        m.resolve(id, 0);
    }

    /* ------------------------------ 攻击面：争议 ------------------------------ */

    function test_Dispute_BlocksFinalize_ArbiterOverrides() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: 10 ether}(id, 0);
        vm.prank(bob);
        m.bet{value: 10 ether}(id, 1);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(creator);
        m.resolve(id, 0); // 建题人说「会」

        vm.prank(carol);
        m.dispute(id); // 有人不服

        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(PariMutuelMarket.AlreadyDisputed.selector);
        m.finalize(id); // 不能在争议状态下直接固化

        vm.prank(arbiter);
        m.arbiterResolve(id, 1); // 裁决人改判「不会」

        (, , , , , uint8 result, , , bool finalized, , ) = m.marketInfo(id);
        assertEq(result, 1);
        assertTrue(finalized);

        uint256 before = bob.balance;
        vm.prank(bob);
        m.claim(id);
        assertGt(bob.balance, before);
    }

    function test_Revert_NonArbiterOverrides() public {
        uint256 id = _newMarket(2, FEE);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(creator);
        m.resolve(id, 0);
        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.NotArbiter.selector);
        m.arbiterResolve(id, 1);
    }

    function test_Revert_DisputeAfterWindow() public {
        uint256 id = _newMarket(2, FEE);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(creator);
        m.resolve(id, 0);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(PariMutuelMarket.DisputeWindowClosed.selector);
        m.dispute(id);
    }

    /* ------------------------------ 攻击面：领取 ------------------------------ */

    function test_Revert_ClaimBeforeFinalize() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: 1 ether}(id, 0);
        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.NotFinalized.selector);
        m.claim(id);
    }

    function test_Revert_LoserCannotClaim() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: 10 ether}(id, 0);
        vm.prank(bob);
        m.bet{value: 10 ether}(id, 1);
        _openAndSettle(id, 0);
        vm.prank(bob);
        vm.expectRevert(PariMutuelMarket.NothingToClaim.selector);
        m.claim(id);
    }

    function test_Revert_DoubleClaim() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: 10 ether}(id, 0);
        _openAndSettle(id, 0);
        vm.startPrank(alice);
        m.claim(id);
        vm.expectRevert(PariMutuelMarket.AlreadyClaimed.selector);
        m.claim(id);
        vm.stopPrank();
    }

    function test_Revert_ReentrancyOnClaim() public {
        ReentrantClaimer bad = new ReentrantClaimer(m);
        vm.deal(address(bad), 10 ether);

        uint256 id = _newMarket(2, FEE);
        bad.placeBet{value: 10 ether}(id, 0);

        _openAndSettle(id, 0);

        vm.expectRevert(); // 重入必须失败（Reentrancy 或 TransferFailed）
        bad.attack();
    }

    function testFuzz_TotalPayoutNeverExceedsPool(uint96 a, uint96 b, uint96 c) public {
        uint256 stakeA = bound(a, 1, 1000 ether);
        uint256 stakeB = bound(b, 1, 1000 ether);
        uint256 stakeC = bound(c, 1, 1000 ether);

        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: stakeA}(id, 0);
        vm.prank(bob);
        m.bet{value: stakeB}(id, 0);
        vm.prank(carol);
        m.bet{value: stakeC}(id, 0);

        _openAndSettle(id, 0);

        uint256 pa = m.previewPayout(id, alice);
        uint256 pb = m.previewPayout(id, bob);
        uint256 pc = m.previewPayout(id, carol);
        uint256 total = stakeA + stakeB + stakeC;
        uint256 fee = (total * FEE) / 10_000;

        // 核心不变量：总派彩 ≤ 可分配，舍入永不多付
        assertLe(pa + pb + pc, total - fee);
    }

    function test_NoWinner_FullRefund_NoFee() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: 10 ether}(id, 0);
        vm.prank(bob);
        m.bet{value: 5 ether}(id, 0);

        _openAndSettle(id, 1); // 没人押「不会」

        (, , , , , , , , , , uint256 feeCollected) = m.marketInfo(id);
        assertEq(feeCollected, 0, "no winner => no fee");

        uint256 before = alice.balance;
        vm.prank(alice);
        m.claim(id);
        assertEq(alice.balance - before, 10 ether, "full refund");
    }

    /* ------------------------------ 手续费 ------------------------------ */

    function test_WithdrawFees_OnlyCreatorOnce() public {
        uint256 id = _newMarket(2, FEE);
        vm.prank(alice);
        m.bet{value: 30 ether}(id, 0);
        vm.prank(bob);
        m.bet{value: 70 ether}(id, 1);
        _openAndSettle(id, 0);

        vm.prank(alice);
        vm.expectRevert(PariMutuelMarket.NotCreator.selector);
        m.withdrawFees(id);

        uint256 before = creator.balance;
        vm.prank(creator);
        m.withdrawFees(id);
        assertEq(creator.balance - before, 5 ether);

        vm.prank(creator);
        vm.expectRevert(PariMutuelMarket.NothingToClaim.selector);
        m.withdrawFees(id);
    }
}
