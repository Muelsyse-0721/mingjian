// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title 明鉴 · 结算存证（Anchor Registry）
/// @notice 把每一批已揭晓题目的结果算成 Merkle root 写到链上。
///         不托管任何资金、不做下注、不发代币——只提供「这批结果在某时刻存在且之后未被修改」的证明。
/// @dev 叶子约定（必须与后端 worker 完全一致）：
///      leaf = keccak256(abi.encode(qid, result, settledAt))  // result 为字符串
///      树采用「排序对」拼接：h = keccak256(abi.encodePacked(min, max))，
///      与 OpenZeppelin MerkleProof 的 StandardMerkleTree 兼容。
contract AnchorRegistry {
    struct Anchor {
        bytes32 root;
        uint64 fromTs;
        uint64 toTs;
        uint32 count;
        address publisher;
    }

    address public owner;
    address public publisher;

    Anchor[] private _anchors; // 下标即 anchorId，从 1 开始（0 号空占位）

    event Anchored(
        uint256 indexed id,
        bytes32 root,
        uint32 count,
        uint64 fromTs,
        uint64 toTs,
        address indexed publisher
    );
    event PublisherChanged(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);

    error NotOwner();
    error NotPublisher();
    error BadRange();
    error BadRoot();
    error EmptyProofRoot();

    constructor(address publisher_) {
        owner = msg.sender;
        publisher = publisher_;
        _anchors.push(Anchor(bytes32(0), 0, 0, 0, address(0))); // 占位，anchorId 从 1 开始
        emit OwnershipTransferred(address(0), msg.sender);
        emit PublisherChanged(address(0), publisher_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert NotPublisher();
        _;
    }

    /// @notice 轮换发布者（worker 私钥轮换时用）
    function setPublisher(address next) external onlyOwner {
        emit PublisherChanged(publisher, next);
        publisher = next;
    }

    function transferOwnership(address next) external onlyOwner {
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    /// @notice 锚定一批结果。root 为整棵 Merkle 树的根，count 为该批叶子数。
    /// @param fromTs 本批最早结算时间（UTC 秒）
    /// @param toTs   本批最晚结算时间
    function anchor(bytes32 root, uint32 count, uint64 fromTs, uint64 toTs)
        external
        onlyPublisher
        returns (uint256 id)
    {
        if (root == bytes32(0)) revert BadRoot();
        if (toTs < fromTs) revert BadRange();
        if (count == 0) revert BadRange();

        id = _anchors.length;
        _anchors.push(Anchor(root, fromTs, toTs, count, msg.sender));
        emit Anchored(id, root, count, fromTs, toTs, msg.sender);
    }

    /* --------------------------------- 视图 --------------------------------- */

    function anchorCount() external view returns (uint256) {
        return _anchors.length - 1; // 去掉占位
    }

    function getAnchor(uint256 id) external view returns (Anchor memory) {
        require(id > 0 && id < _anchors.length, "no anchor");
        return _anchors[id];
    }

    /// @notice 链上验证明：某个叶子是否属于某次锚定
    function verify(uint256 id, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        if (id == 0 || id >= _anchors.length) return false;
        return _verify(leaf, proof, _anchors[id].root);
    }

    /// @notice 叶子约定（供链上/链下对齐用）。result 用字符串（站点结果是 yes/no/draw 等）
    function leafOf(string calldata qid, string calldata result, uint64 settledAt)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(qid, result, settledAt));
    }

    function _verify(bytes32 leaf, bytes32[] calldata proof, bytes32 root) internal pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h <= p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
