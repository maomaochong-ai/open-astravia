// 多轮任务固定开销的可复现测量。
// 用法：node docs/analysis/bench/turn-cost-bench.mjs
// 只做本机进程/序列化测量，不调用任何模型或付费 API。

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const run = promisify(execFile);
const REPO = process.cwd();
const ROUNDS = 5;

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

async function timeIt(fn) {
	const start = process.hrtime.bigint();
	await fn();
	return Number(process.hrtime.bigint() - start) / 1e6;
}

// A. 本地只读工具：串行 vs 并行。区分「全仓扫描」与「窄路径扫描」两种工作量。
const QUERIES = ["executeRuntimeToolCalls", "shouldCompact", "composeModelCallFrame", "truncateTail"];

async function grepOnce(query, scope) {
	try {
		await run("rg", ["-n", "--no-heading", "-m", "20", query, scope], { maxBuffer: 8 * 1024 * 1024 });
	} catch (error) {
		// rg 无匹配时退出码 1，与工具失败无关
		if (error.code !== 1) throw error;
	}
}

async function measureGrepBatch(scope) {
	const serial = [];
	const parallel = [];
	for (let round = 0; round < ROUNDS; round += 1) {
		serial.push(await timeIt(async () => {
			for (const q of QUERIES) await grepOnce(q, scope);
		}));
		parallel.push(await timeIt(() => Promise.all(QUERIES.map((q) => grepOnce(q, scope)))));
	}
	return {
		serialMs: +median(serial).toFixed(1),
		parallelMs: +median(parallel).toFixed(1),
		savingMs: +(median(serial) - median(parallel)).toFixed(1),
	};
}

const grepBatchWholeRepo = await measureGrepBatch(REPO);
const grepBatchNarrow = await measureGrepBatch(join(REPO, "packages/agent/src"));

// B. shell 启动：轻 rc vs 重 rc vs 快照预载。
// zsh -lc 是登录 shell，读 .zprofile；用 sleep 模拟 nvm/conda 级别的 rc 成本。
const scratch = mkdtempSync(join(tmpdir(), "astravia-bench-"));
const heavyRcDir = join(scratch, "heavy");
const snapshotPath = join(scratch, "snapshot.zsh");
mkdirSync(heavyRcDir, { recursive: true });
writeFileSync(snapshotPath, "# 预先生成一次的环境快照\nexport PRELOADED=1\n");
const sleepMs = 150;
writeFileSync(join(heavyRcDir, ".zprofile"), `sleep ${sleepMs / 1000}\n`);
const env = { ...process.env, ZDOTDIR: heavyRcDir };

const shellSamples = { light: [], heavy: [], snapshot: [] };
for (let round = 0; round < ROUNDS; round += 1) {
	shellSamples.light.push(await timeIt(() => run("zsh", ["-lc", "true"])));
	shellSamples.heavy.push(await timeIt(() => run("zsh", ["-lc", "true"], { env })));
	shellSamples.snapshot.push(
		await timeIt(() => run("zsh", ["-c", `source ${snapshotPath}; true`], { env })),
	);
}

// C. 每轮全量上传：10 万 token 会话的序列化与压缩体积。
// 用近似随机的标识符生成，避免重复文本把 gzip 压到不真实的比率。
const TOKENS = 100_000;
const CHARS_PER_TOKEN = 4;
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789_";
let seed = 42;
const rand = () => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
};
const randomChunk = (len) => {
	let out = "";
	for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(rand() * alphabet.length)];
	return out;
};

const blocks = [];
let producedChars = 0;
let index = 0;
while (producedChars < TOKENS * CHARS_PER_TOKEN) {
	const text = `// 片段 ${index}\n${randomChunk(180)}\n${randomChunk(180)}\n`;
	blocks.push({ type: "message", role: index % 3 === 0 ? "assistant" : "user", content: text });
	producedChars += text.length;
	index += 1;
}

let payloadBytes = 0;
let gzippedBytes = 0;
const uploadSamples = [];
for (let round = 0; round < ROUNDS; round += 1) {
	uploadSamples.push(await timeIt(async () => {
		const json = JSON.stringify({ model: "x", input: blocks });
		payloadBytes = Buffer.byteLength(json);
		gzippedBytes = gzipSync(json).byteLength;
	}));
}

console.log(JSON.stringify({
	rounds: ROUNDS,
	localTools: {
		wholeRepo: grepBatchWholeRepo,
		narrowPath: grepBatchNarrow,
	},
	shellStartup: {
		simulatedRcCostMs: sleepMs,
		loginShellMs: +median(shellSamples.light).toFixed(1),
		heavyRcLoginShellMs: +median(shellSamples.heavy).toFixed(1),
		snapshotSourceMs: +median(shellSamples.snapshot).toFixed(1),
		savingPerCommandMs: +(median(shellSamples.heavy) - median(shellSamples.snapshot)).toFixed(1),
	},
	fullHistoryUpload: {
		tokens: TOKENS,
		messages: blocks.length,
		jsonBytes: payloadBytes,
		gzipBytes: gzippedBytes,
		serializeMs: +median(uploadSamples).toFixed(1),
		uploadMsAt: {
			"5Mbps": Math.round(((gzippedBytes * 8) / 5e6) * 1000),
			"20Mbps": Math.round(((gzippedBytes * 8) / 20e6) * 1000),
			"100Mbps": Math.round(((gzippedBytes * 8) / 100e6) * 1000),
		},
	},
}, null, 2));

rmSync(scratch, { recursive: true, force: true });
