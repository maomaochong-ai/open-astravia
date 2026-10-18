// 用真实编译产物量化「读盘 → 解析 → 还原文档」一次操作的耗时与内存。
// 用法：node --expose-gc docs/analysis/bench/conversation-load-bench.mjs <file.jsonl> [轮次]
import { readFile } from "node:fs/promises";

const file = process.argv[2];
const rounds = Number(process.argv[3] ?? 3);
if (!file) throw new Error("usage: conversation-load-bench.mjs <file.jsonl> [rounds]");

const codec = await import("../../../packages/runtime-node/dist/conversation/conversation-file-codec.js");
const encoded = file.split("/").pop().replace(/\.conversation\.jsonl$/, "");
const sessionId = Buffer.from(encoded, "base64url").toString("utf8");

const samples = [];
for (let round = 0; round < rounds; round += 1) {
	globalThis.gc?.();
	const before = process.memoryUsage().rss;
	const startedAt = performance.now();
	const text = await readFile(file, "utf8");
	const parsed = codec.parseConversationFile(text, sessionId);
	const conversation = codec.conversationFromFile(sessionId, parsed);
	const parseMs = performance.now() - startedAt;
	const docStartedAt = performance.now();
	const document = codec.documentFromFile(sessionId, parsed);
	const docMs = performance.now() - docStartedAt;
	const peak = process.memoryUsage().rss;
	samples.push({
		parseMs,
		docMs,
		entries: document.entries.length,
		events: conversation.events.length,
		rssMb: peak / 1024 / 1024,
		allocMb: (peak - before) / 1024 / 1024,
	});
}

const avg = (pick) => samples.reduce((total, sample) => total + pick(sample), 0) / samples.length;
console.log(`session=${sessionId}`);
console.log(`entries=${samples[0].entries} events=${samples[0].events}`);
console.log(`parse+conversation=${avg((s) => s.parseMs).toFixed(0)}ms document=${avg((s) => s.docMs).toFixed(0)}ms`);
console.log(
	`per-op total=${avg((s) => s.parseMs + s.docMs).toFixed(0)}ms rss=${avg((s) => s.rssMb).toFixed(0)}MiB allocDelta=${avg((s) => s.allocMb).toFixed(0)}MiB`,
);
