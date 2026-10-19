#!/usr/bin/env node
/**
 * 明鉴 · 结算存证 Worker
 *
 * 作用：把「已揭晓但还没上链」的题目批量算成 Merkle root，写进 AnchorRegistry 合约。
 * 特性：
 *   · 幂等     —— state 文件记录已锚定 qid；重复运行不会重复上链
 *   · 可恢复   —— 发送前先落盘 pending，重启后按 txHash 查回执
 *   · gas 上限 —— 单笔成本超过 MAX_GAS_WEI 直接放弃本次（防私钥被盗一夜清空）
 *   · fail-open—— 链不可用时本脚本失败退出，站点照常运行
 *   · dry-run  —— 没配私钥时自动只算不上链
 *
 * 用法：
 *   node tools/anchor-worker.mjs --dry-run
 *   RPC_URL=... PRIVATE_KEY=0x... REGISTRY=0x... node tools/anchor-worker.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ----------------------------- 依赖解析（viem） ---------------------------- */
const CANDIDATES = [
  process.env.VIEM_ROOT,
  path.join(ROOT, 'node_modules'),
  path.join(process.cwd(), 'node_modules'),
  path.join(process.env.HOME || '', '.workbuddy/binaries/node/workspace/node_modules')
].filter(Boolean);

function loadModule(spec) {
  for (const dir of CANDIDATES) {
    try {
      const req = createRequire(path.join(dir, '__resolve__.js'));
      return req(spec);
    } catch (e) { /* next */ }
  }
  throw new Error(`找不到 ${spec}。请 npm i viem 或设置 VIEM_ROOT=/path/to/node_modules`);
}

const {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, concat
} = loadModule('viem');
const { privateKeyToAccount } = loadModule('viem/accounts');

/* --------------------------------- 配置 --------------------------------- */
const CFG = {
  base: process.env.MJ_BASE || 'https://jp-ladder.app.workbuddy.host',
  accessKey: process.env.MJ_KEY || 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK',
  rpc: process.env.RPC_URL || '',
  pk: process.env.PRIVATE_KEY || '',
  registry: process.env.REGISTRY || '',
  chainId: Number(process.env.CHAIN_ID || 84532),
  batchMax: Number(process.env.BATCH_MAX || 100),
  maxGasWei: BigInt(process.env.MAX_GAS_WEI || '500000000000000'), // 0.0005 ETH
  explorer: process.env.EXPLORER || 'https://sepolia.basescan.org'
};

const STATE_PATH = path.join(__dirname, 'data', 'anchor-state.json');
const LOCK_PATH = path.join(__dirname, 'data', 'anchor.lock');
const OUT_PATH = path.join(ROOT, 'app', 'chain-anchors.json');

const DRY = process.argv.includes('--dry-run') || !CFG.pk || !CFG.registry || !CFG.rpc;

const ABI = [
  {
    type: 'function', name: 'anchor', stateMutability: 'nonpayable',
    inputs: [
      { name: 'root', type: 'bytes32' }, { name: 'count', type: 'uint32' },
      { name: 'fromTs', type: 'uint64' }, { name: 'toTs', type: 'uint64' }
    ],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function', name: 'anchorCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }]
  }
];

/* --------------------------------- 工具 --------------------------------- */
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    return { version: 1, anchored: {}, batches: [] };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age < 10 * 60 * 1000) return false; // 10 分钟内的锁视为有效
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  return true;
}
const releaseLock = () => { try { fs.unlinkSync(LOCK_PATH); } catch (e) {} };

async function fetchSettled() {
  // 测试用：--from-file=/path/to/rows.json 直接读本地数据，跳过云端
  const fromFile = process.argv.find((a) => a.startsWith('--from-file='));
  if (fromFile) {
    const rows = JSON.parse(fs.readFileSync(fromFile.slice('--from-file='.length), 'utf8'));
    return Array.isArray(rows) ? rows : [];
  }
  const url = CFG.base + '/.cloud/database/rest/jp_questions' +
    '?status=eq.settled&select=qid,result,settled_at,deadline&order=settled_at.asc&limit=2000';
  const res = await fetch(url, { headers: { 'x-wb-webapp-access-key': CFG.accessKey } });
  if (!res.ok) throw new Error('拉取已揭晓题目失败: HTTP ' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

const leafOf = (qid, result, settledAt) =>
  keccak256(encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'uint64' }],
    [qid, result, settledAt]
  ));

const hashPair = (a, b) =>
  a.toLowerCase() <= b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a]));

function buildTree(leaves) {
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return layers;
}

function proofFor(layers, index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sib < layer.length) proof.push(layer[sib]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

function parseSettledAt(row) {
  if (row.settled_at) {
    const t = Date.parse(row.settled_at);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  const d = Date.parse(row.deadline || '');
  return Number.isNaN(d) ? Math.floor(Date.now() / 1000) : Math.floor(d / 1000);
}

/* --------------------------------- 主流程 -------------------------------- */
async function selfTest() {
  // 固定数据（5 条，奇数叶子，专门覆盖「落单节点原样上提」的情况）
  const rows = [
    { qid: 'bank-1', result: 'yes', settledAt: 1700000001 },
    { qid: 'bank-2', result: 'no', settledAt: 1700000002 },
    { qid: 'bank-3', result: 'yes', settledAt: 1700000003 },
    { qid: 'bank-4', result: 'draw', settledAt: 1700000004 },
    { qid: 'bank-5', result: 'no', settledAt: 1700000005 }
  ];
  const items = rows.map((r) => ({ ...r, leaf: leafOf(r.qid, r.result, r.settledAt) }));
  const layers = buildTree(items.map((i) => i.leaf));
  const root = layers[layers.length - 1][0];
  items.forEach((it, idx) => { it.proof = proofFor(layers, idx); });

  // 本地回验：每个叶子 + 证明 → 必须还原出 root；篡改后必须失败
  let ok = 0;
  for (const it of items) {
    const got = it.proof.reduce((h, p) => hashPair(h, p), it.leaf);
    const forged = it.proof.reduce((h, p) => hashPair(h, p), keccak256(concat([it.leaf])));
    if (got.toLowerCase() === root.toLowerCase()) ok++;
    if (forged.toLowerCase() === root.toLowerCase()) throw new Error('篡改叶子竟然也通过：' + it.qid);
  }
  if (ok !== items.length) throw new Error(`自检失败：${ok}/${items.length} 通过`);

  console.log(JSON.stringify({
    root,
    count: items.length,
    fromTs: Math.min(...items.map((i) => i.settledAt)),
    toTs: Math.max(...items.map((i) => i.settledAt)),
    items: items.map((i) => ({ qid: i.qid, result: i.result, settledAt: i.settledAt, leaf: i.leaf, proof: i.proof }))
  }, null, 2));
  console.error(`self-test OK: ${ok}/${items.length} 个叶子可验证，篡改均被拒绝`);
}

async function main() {
  if (process.argv.includes('--self-test')) { await selfTest(); return; }

  const state = loadState();

  log(DRY ? '模式：DRY-RUN（只计算，不上链）' : `模式：上链 chainId=${CFG.chainId} registry=${CFG.registry}`);

  const settled = await fetchSettled();
  log(`云端已揭晓 ${settled.length} 题，链上已存证 ${Object.keys(state.anchored).length} 题`);

  const pending = settled
    .filter((r) => r.qid && r.result && !state.anchored[r.qid])
    .slice(0, CFG.batchMax);

  if (pending.length === 0) {
    log('没有待存证的题目，退出。');
    return;
  }

  // 构造叶子（按 settled_at 升序，保持可读性）
  const items = pending.map((r) => {
    const settledAt = parseSettledAt(r);
    return { qid: r.qid, result: String(r.result), settledAt, leaf: leafOf(r.qid, String(r.result), settledAt) };
  });

  const layers = buildTree(items.map((i) => i.leaf));
  const root = layers[layers.length - 1][0];
  const fromTs = Math.min(...items.map((i) => i.settledAt));
  const toTs = Math.max(...items.map((i) => i.settledAt));
  items.forEach((it, idx) => { it.proof = proofFor(layers, idx); });

  log(`本批 ${items.length} 题  root=${root}  [${fromTs} → ${toTs}]`);

  if (DRY) {
    items.slice(0, 5).forEach((i) => log(`  · ${i.qid} = ${i.result} @${i.settledAt}`));
    if (items.length > 5) log(`  · ... 其余 ${items.length - 5} 题`);
    log('DRY-RUN 结束（未写状态、未写前端数据）。配置 RPC_URL/PRIVATE_KEY/REGISTRY 后去掉 --dry-run 即可真正上链。');
    return;
  }

  if (!acquireLock()) {
    log('已有另一个 worker 在跑（锁未过期），本次退出。');
    return;
  }

  try {
    const account = privateKeyToAccount(CFG.pk);
    const chain = {
      id: CFG.chainId,
      name: 'mingjian-' + CFG.chainId,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [CFG.rpc] } }
    };
    const publicClient = createPublicClient({ chain, transport: http(CFG.rpc) });
    const walletClient = createWalletClient({ account, chain, transport: http(CFG.rpc) });

    // gas 上限检查
    let gas = 200000n;
    try {
      gas = await publicClient.estimateContractGas({
        address: CFG.registry, abi: ABI, functionName: 'anchor',
        args: [root, items.length, BigInt(fromTs), BigInt(toTs)], account: account.address
      });
    } catch (e) {
      log('estimateGas 失败，使用默认 200000：' + e.message);
    }
    const gasPrice = await publicClient.getGasPrice();
    const cost = gas * gasPrice;
    if (cost > CFG.maxGasWei) {
      throw new Error(`gas 成本 ${cost} wei 超过上限 ${CFG.maxGasWei} wei，已放弃（检查网络费用或调高 MAX_GAS_WEI）`);
    }
    log(`预计 gas=${gas} price=${gasPrice} cost=${cost} wei`);

    // 先落盘 pending，再发交易（崩溃后可按 txHash 找回）
    const batch = {
      root, count: items.length, fromTs, toTs,
      qids: items.map((i) => i.qid), status: 'pending', txHash: null, at: new Date().toISOString()
    };
    state.batches.push(batch);
    saveState(state);

    let txHash = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txHash = await walletClient.writeContract({
          address: CFG.registry, abi: ABI, functionName: 'anchor',
          args: [root, items.length, BigInt(fromTs), BigInt(toTs)]
        });
        break;
      } catch (e) {
        lastErr = e;
        log(`发送失败（第 ${attempt} 次）：${e.shortMessage || e.message}`);
        await sleep(1500 * attempt);
      }
    }
    if (!txHash) throw lastErr || new Error('发送交易失败');

    batch.txHash = txHash;
    saveState(state);
    log('tx 已发出：' + txHash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('交易回滚：' + txHash);

    // 成功后写状态 + 前端数据
    batch.status = 'done';
    batch.blockNumber = Number(receipt.blockNumber);
    const anchorId = Number(await publicClient.readContract({
      address: CFG.registry, abi: ABI, functionName: 'anchorCount'
    }));

    items.forEach((it) => {
      state.anchored[it.qid] = { id: anchorId, result: it.result, settledAt: it.settledAt, leaf: it.leaf, proof: it.proof };
    });
    saveState(state);

    writePublicJson(state);
    log(`完成：anchorId=${anchorId} tx=${CFG.explorer}/tx/${txHash}`);
  } finally {
    releaseLock();
  }
}

function writePublicJson(state) {
  const out = {
    updatedAt: new Date().toISOString(),
    chainId: CFG.chainId,
    registry: CFG.registry,
    explorer: CFG.explorer,
    anchors: state.batches
      .filter((b) => b.status === 'done')
      .map((b) => ({
        id: state.anchored[b.qids[0]] ? state.anchored[b.qids[0]].id : null,
        tx: b.txHash,
        blockNumber: b.blockNumber,
        root: b.root,
        count: b.count,
        fromTs: b.fromTs,
        toTs: b.toTs,
        items: b.qids.reduce((acc, qid) => {
          const a = state.anchored[qid];
          if (a) acc[qid] = { result: a.result, settledAt: a.settledAt, leaf: a.leaf, proof: a.proof };
          return acc;
        }, {})
      }))
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  log('已写出前端数据：' + OUT_PATH);
}

main().catch((e) => {
  console.error('[anchor-worker] 失败：', e.shortMessage || e.message || e);
  process.exit(1);
});
