// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PariMutuelMarket} from "../src/PariMutuelMarket.sol";

/// @notice 部署到测试网：
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PK --broadcast
/// 本地演练（不广播）：forge script script/Deploy.s.sol
contract Deploy is Script {
    function run() external returns (PariMutuelMarket market) {
        address arbiter = vm.envOr("ARBITER", msg.sender);
        uint64 window = uint64(vm.envOr("DISPUTE_WINDOW", uint256(1 days)));

        vm.startBroadcast();
        market = new PariMutuelMarket(arbiter, window);
        vm.stopBroadcast();

        console.log("PariMutuelMarket deployed at:", address(market));
        console.log("arbiter:", arbiter);
        console.log("disputeWindow(seconds):", window);
    }
}
