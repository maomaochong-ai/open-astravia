// 量化会话文件读盘 + 逐行 JSON 解析的实测量级。
// 用法：node --expose-gc docs/analysis/bench/conversation-parse-bench.mjs <file.jsonl> [轮次]
import { readFile, stat } from "node:fs/promises";

const file = process.argv[2];
const rounds = Number(process.argv[3] ?? 3);
if (!file) throw new Error("usage: conversation-parse-bench.mjs <file.jsonl> [rounds]");

const info = await stat(file);
const sizeMb = info.size / 1024 / 1024;

function parseLikeProduction(text) {
	const lines = text.slice(0, -1).split(/\r?\n/);
	let entries = 0;
	for (const line of lines) {
		const record = JSON.parse(line);
		// 生产实现会继续把 record 投影成文档条目/事件对象，这里只统计条数。
		if (record && typeof record === "object") entries += 1;
	}
	return entries;
}

const samples = [];
for (let round = 0; round < rounds; round += 1) {
	globalThis.gc?.();
	const beforeRss = process.memoryUsage().rss;
	const startedAt = performance.now();
	const text = await readFile(file, "utf8");
	const readMs = performance.now() - startedAt;
	const parseStartedAt = performance.now();
	const entries = parseLikeProduction(text);
	const parseMs = performance.now() - parseStartedAt;
	const peakRss = process.memoryUsage().rss;
	samples.push({ readMs, parseMs, entries, rssMb: peakRss / 1024 / 1024, allocMb: (peakRss - beforeRss) / 1024 / 1024 });
}

const avg = (pick) => samples.reduce((total, sample) => total + pick(sample), 0) / samples.length;
console.log(`file=${file}`);
console.log(`size=${sizeMb.toFixed(1)}MiB records=${samples[0].entries}`);
console.log(`read=${avg((s) => s.readMs).toFixed(0)}ms parse=${avg((s) => s.parseMs).toFixed(0)}ms`);
console.log(`rss=${avg((s) => s.rssMb).toFixed(0)}MiB allocDelta=${avg((s) => s.allocMb).toFixed(0)}MiB`);
