// 量化 FileConversationRepository 在真实长会话上的读取成本。
// 用法：node --expose-gc docs/analysis/bench/conversation-repository-bench.mjs <会话文件> <轮数>
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { FileConversationRepository } from "../../../packages/runtime-node/dist/conversation/index.js";

const source = process.argv[2];
const rounds = Number(process.argv[3] ?? "3");
if (!source) {
	console.error("usage: node conversation-repository-bench.mjs <conversation.jsonl> [rounds]");
	process.exit(1);
}

const encoded = basename(source, ".conversation.jsonl");
const sessionId = Buffer.from(encoded, "base64url").toString("utf8");
const rootDir = join("/tmp", "astravia-conv-repo-bench", encoded.slice(0, 12));
await rm(rootDir, { force: true, recursive: true });
await mkdir(rootDir, { recursive: true });
await copyFile(source, join(rootDir, basename(source)));

const bytes = (await stat(source)).size;
const repository = new FileConversationRepository({ rootDir });
const timings = [];
const measure = async (label, action) => {
	const started = process.hrtime.bigint();
	const value = await action();
	const ms = Number(process.hrtime.bigint() - started) / 1e6;
	timings.push({ label, ms });
	return { value, ms };
};

const cold = await measure("cold load", () => repository.load(sessionId));
const warmLoad = await measure("warm load", () => repository.load(sessionId));
const warmDocument = await measure("warm readDocument", () => repository.readDocument(sessionId));

console.log(
	`session=${sessionId} size=${(bytes / 1024 / 1024).toFixed(1)}MiB entries=${warmDocument.value.entries.length} events=${warmLoad.value.version}`,
);
console.log(`cold load            ${cold.ms.toFixed(1)}ms`);
console.log(`warm load            ${warmLoad.ms.toFixed(1)}ms`);
console.log(`warm readDocument    ${warmDocument.ms.toFixed(1)}ms`);

let version = cold.value.version;
for (let round = 0; round < rounds; round += 1) {
	const turnId = `bench-turn-${round}`;
	await repository.append(sessionId, version, [
		{ type: "turn.started", sessionId, turnId, snapshotId: `bench-${round}`, timestamp: Date.now() },
		{ type: "turn.completed", sessionId, turnId, stopReason: "stop", timestamp: Date.now() },
	]);
	version += 2;
	const loaded = await measure("incremental load", () => repository.load(sessionId));
	const document = await measure("incremental readDocument", () => repository.readDocument(sessionId));
	console.log(
		`round ${round + 1}: append+load ${loaded.ms.toFixed(1)}ms, readDocument ${document.ms.toFixed(1)}ms, entries=${document.value.entries.length}`,
	);
}

const total = timings
	.filter(({ label }) => label !== "cold load")
	.reduce((sum, { label, ms }) => sum + ms, 0);
console.log(`warm total (${timings.length - 1} ops) ${total.toFixed(1)}ms`);
if (global.gc) global.gc();
console.log(`rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MiB`);
await repository.close();
await rm(rootDir, { force: true, recursive: true });
