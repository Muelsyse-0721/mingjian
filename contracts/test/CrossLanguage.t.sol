// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

/// @notice 交叉验证：root/leaf/proof 全部由 tools/anchor-worker.mjs --self-test 生成，
///         这里在链上逐个验证，确保 JS 组树与 Solidity 验证器完全一致。
///         本文件由脚本生成，data 变更后请重新生成。
contract CrossLanguageTest is Test {
    AnchorRegistry internal reg;
    address internal publisher = address(0xBEEF);

    function setUp() public {
        reg = new AnchorRegistry(publisher);
    }

    function test_WorkerProofsVerifyOnChain() public {
        vm.prank(publisher);
        uint256 id = reg.anchor(0x2e4aef26ee7a302b6625bddffe76e10aba97e57c685365ec40d5b2b98337f4d9, 5, 1700000001, 1700000005);

        // bank-1 = yes @1700000001
        assertEq(reg.leafOf("bank-1", "yes", 1700000001), 0xace3b862d15aaa5b0dcf675d71b24af8d10deb70e2a5ff62aef5e0935a2ea2bc);
        bytes32[] memory p_bank_1 = new bytes32[](3);
        p_bank_1[0] = 0x438e9023f58dc9411a2fc754f8a6eb636f303cacec55ae39e0bd7bf3c44bb695;
        p_bank_1[1] = 0x8459fde67944069c710b131489e45f043dc119db95bcd547d3aa7111e5c5364c;
        p_bank_1[2] = 0xd0d26c8f41a130ca094935334705b74cb05adee1e52aa79a75f128270cc5d675;
        assertTrue(reg.verify(id, 0xace3b862d15aaa5b0dcf675d71b24af8d10deb70e2a5ff62aef5e0935a2ea2bc, p_bank_1));

        // bank-2 = no @1700000002
        assertEq(reg.leafOf("bank-2", "no", 1700000002), 0x438e9023f58dc9411a2fc754f8a6eb636f303cacec55ae39e0bd7bf3c44bb695);
        bytes32[] memory p_bank_2 = new bytes32[](3);
        p_bank_2[0] = 0xace3b862d15aaa5b0dcf675d71b24af8d10deb70e2a5ff62aef5e0935a2ea2bc;
        p_bank_2[1] = 0x8459fde67944069c710b131489e45f043dc119db95bcd547d3aa7111e5c5364c;
        p_bank_2[2] = 0xd0d26c8f41a130ca094935334705b74cb05adee1e52aa79a75f128270cc5d675;
        assertTrue(reg.verify(id, 0x438e9023f58dc9411a2fc754f8a6eb636f303cacec55ae39e0bd7bf3c44bb695, p_bank_2));

        // bank-3 = yes @1700000003
        assertEq(reg.leafOf("bank-3", "yes", 1700000003), 0xaea7baa0d32599aece4cf3997a661cad1a4c30e78837117b2053db8a5b3f6ea3);
        bytes32[] memory p_bank_3 = new bytes32[](3);
        p_bank_3[0] = 0xfdd0aac3b4450bc993eed0f42854c952ee7b3791f3a90f6fda599c0a7ddf5a12;
        p_bank_3[1] = 0xf5d5e27e81cf0e4065ec67b6a8ad229a10eac6b130ec67be36910c11248cc540;
        p_bank_3[2] = 0xd0d26c8f41a130ca094935334705b74cb05adee1e52aa79a75f128270cc5d675;
        assertTrue(reg.verify(id, 0xaea7baa0d32599aece4cf3997a661cad1a4c30e78837117b2053db8a5b3f6ea3, p_bank_3));

        // bank-4 = draw @1700000004
        assertEq(reg.leafOf("bank-4", "draw", 1700000004), 0xfdd0aac3b4450bc993eed0f42854c952ee7b3791f3a90f6fda599c0a7ddf5a12);
        bytes32[] memory p_bank_4 = new bytes32[](3);
        p_bank_4[0] = 0xaea7baa0d32599aece4cf3997a661cad1a4c30e78837117b2053db8a5b3f6ea3;
        p_bank_4[1] = 0xf5d5e27e81cf0e4065ec67b6a8ad229a10eac6b130ec67be36910c11248cc540;
        p_bank_4[2] = 0xd0d26c8f41a130ca094935334705b74cb05adee1e52aa79a75f128270cc5d675;
        assertTrue(reg.verify(id, 0xfdd0aac3b4450bc993eed0f42854c952ee7b3791f3a90f6fda599c0a7ddf5a12, p_bank_4));

        // bank-5 = no @1700000005
        assertEq(reg.leafOf("bank-5", "no", 1700000005), 0xd0d26c8f41a130ca094935334705b74cb05adee1e52aa79a75f128270cc5d675);
        bytes32[] memory p_bank_5 = new bytes32[](1);
        p_bank_5[0] = 0xc5b5cf618e0cfacea72f9c8b60fc069eb54b438fe9c15af6976c0a7c8b35bcf6;
        assertTrue(reg.verify(id, 0xd0d26c8f41a130ca094935334705b74cb05adee1e52aa79a75f128270cc5d675, p_bank_5));

        // 篡改任意一条结果都必须失败
        bytes32 forged = keccak256(abi.encode("bank-1", "tampered", uint64(1700000001)));
        assertFalse(reg.verify(id, forged, p_bank_1));
    }
}
