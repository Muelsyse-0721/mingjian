// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

contract AnchorRegistryTest is Test {
    AnchorRegistry internal reg;

    address internal publisher = address(0xBEEF);
    address internal stranger = address(0xDEAD);


    function setUp() public {
        vm.warp(1_700_000_000);
        reg = new AnchorRegistry(publisher);
    }

    /* ------------------------------- 基础 ------------------------------- */

    function test_Anchor_StoresAndEmits() public {
        bytes32 root = keccak256("batch-1");

        vm.expectEmit(true, true, false, true, address(reg));
        emit AnchorRegistry.Anchored(1, root, 3, 100, 200, publisher);

        vm.prank(publisher);
        uint256 id = reg.anchor(root, 3, 100, 200);

        assertEq(id, 1);
        assertEq(reg.anchorCount(), 1);

        AnchorRegistry.Anchor memory a = reg.getAnchor(id);
        assertEq(a.root, root);
        assertEq(a.count, 3);
        assertEq(a.fromTs, 100);
        assertEq(a.toTs, 200);
        assertEq(a.publisher, publisher);
    }

    function test_AnchorCountIncrements() public {
        vm.startPrank(publisher);
        reg.anchor(keccak256("a"), 1, 1, 1);
        reg.anchor(keccak256("b"), 2, 2, 2);
        reg.anchor(keccak256("c"), 3, 3, 3);
        vm.stopPrank();
        assertEq(reg.anchorCount(), 3);
    }

    /* ------------------------------- 权限 ------------------------------- */

    function test_Revert_NonPublisher() public {
        vm.prank(stranger);
        vm.expectRevert(AnchorRegistry.NotPublisher.selector);
        reg.anchor(keccak256("x"), 1, 1, 1);
    }

    function test_SetPublisher_OnlyOwner_Rotates() public {
        address next = address(0xCAFE);

        vm.prank(stranger);
        vm.expectRevert(AnchorRegistry.NotOwner.selector);
        reg.setPublisher(next);

        reg.setPublisher(next);
        assertEq(reg.publisher(), next);

        vm.prank(publisher);
        vm.expectRevert(AnchorRegistry.NotPublisher.selector);
        reg.anchor(keccak256("y"), 1, 1, 1);
    }

    function test_TransferOwnership() public {
        reg.transferOwnership(stranger);
        assertEq(reg.owner(), stranger);

        vm.prank(address(0));
        vm.expectRevert(AnchorRegistry.NotOwner.selector);
        reg.setPublisher(address(1));
    }

    /* ------------------------------- 入参校验 ----------------------------- */

    function test_Revert_BadRange() public {
        vm.startPrank(publisher);

        vm.expectRevert(AnchorRegistry.BadRange.selector);
        reg.anchor(keccak256("a"), 0, 1, 2);

        vm.expectRevert(AnchorRegistry.BadRange.selector);
        reg.anchor(keccak256("b"), 2, 5, 4);

        vm.expectRevert(AnchorRegistry.BadRoot.selector);
        reg.anchor(bytes32(0), 2, 4, 5);

        vm.stopPrank();
    }

    /* ------------------------------- 验证 ------------------------------- */

    function test_Verify_SingleLeaf() public {
        bytes32 leaf = keccak256(abi.encode("bank-1", "yes", uint64(1_700_000_000)));

        vm.prank(publisher);
        uint256 id = reg.anchor(leaf, 1, 1_700_000_000, 1_700_000_000);

        bytes32[] memory proof = new bytes32[](0);
        assertTrue(reg.verify(id, leaf, proof));
        assertFalse(reg.verify(id, keccak256("forged"), proof));
    }

    function test_Verify_FourLeaves_AllProofs() public {
        bytes32[4] memory leaves;
        leaves[0] = keccak256(abi.encode("q-1", "yes", uint64(1700000000)));
        leaves[1] = keccak256(abi.encode("q-2", "no", uint64(1700000100)));
        leaves[2] = keccak256(abi.encode("q-3", "no", uint64(1700000200)));
        leaves[3] = keccak256(abi.encode("q-4", "yes", uint64(1700000300)));

        bytes32 n0 = _pair(leaves[0], leaves[1]);
        bytes32 n1 = _pair(leaves[2], leaves[3]);
        bytes32 root = _pair(n0, n1);

        vm.prank(publisher);
        uint256 id = reg.anchor(root, 4, 1700000000, 1700000300);

        assertTrue(reg.verify(id, leaves[0], _proof(leaves[1], n1)));
        assertTrue(reg.verify(id, leaves[1], _proof(leaves[0], n1)));
        assertTrue(reg.verify(id, leaves[2], _proof(leaves[3], n0)));
        assertTrue(reg.verify(id, leaves[3], _proof(leaves[2], n0)));

        // 篡改任意一题的结果，证明失效
        bytes32 forged = keccak256(abi.encode("q-1", "no", uint64(1700000000)));
        assertFalse(reg.verify(id, forged, _proof(leaves[1], n1)));
    }

    function test_Verify_UnknownId_False() public {
        bytes32[] memory proof = new bytes32[](0);
        assertFalse(reg.verify(0, keccak256("x"), proof));
        assertFalse(reg.verify(99, keccak256("x"), proof));
    }

    function test_LeafOf_MatchesConvention() public {
        bytes32 onchain = reg.leafOf("bank-42", "yes", 1_700_000_000);
        bytes32 offchain = keccak256(abi.encode("bank-42", "yes", uint64(1_700_000_000)));
        assertEq(onchain, offchain);
    }

    function testFuzz_SingleLeaf_RoundTrip(bool isYes, uint64 settledAt) public {
        string memory result = isYes ? "yes" : "no";
        bytes32 leaf = keccak256(abi.encode("fuzz-q", result, settledAt));
        vm.prank(publisher);
        uint256 id = reg.anchor(leaf, 1, settledAt, settledAt);

        bytes32[] memory proof = new bytes32[](0);
        assertTrue(reg.verify(id, leaf, proof));

        // 改结果或改时间都必须失效
        bytes32 tampered = keccak256(abi.encode("fuzz-q", isYes ? "no" : "yes", settledAt));
        assertFalse(reg.verify(id, tampered, proof));
    }

    /* ------------------------------- 工具 ------------------------------- */

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _proof(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = a;
        p[1] = b;
    }
}
