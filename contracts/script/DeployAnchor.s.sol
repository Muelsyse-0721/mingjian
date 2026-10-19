// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

/// @notice 部署存证合约：
///   forge script script/DeployAnchor.s.sol --rpc-url $RPC_URL --private-key $PK --broadcast --verify
/// 说明：publisher 是 worker 的地址（只允许它写锚定）；owner 是部署者（可轮换 publisher）。
contract DeployAnchor is Script {
    function run() external returns (AnchorRegistry reg) {
        address publisher = vm.envOr("PUBLISHER", msg.sender);
        vm.startBroadcast();
        reg = new AnchorRegistry(publisher);
        vm.stopBroadcast();
        console.log("AnchorRegistry:", address(reg));
        console.log("publisher:", publisher);
    }
}
