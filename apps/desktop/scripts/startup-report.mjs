#!/usr/bin/env node
/**
 * 启动取证：把 Desktop 主进程日志里的启动阶段、会话创建耗时、崩溃信号整理成一段能直接读的报告。
 *
 * 用途（Windows「启动后无响应 / 闪退」、切会话慢）：
 *   node apps/desktop/scripts/startup-report.mjs
 *   node apps/desktop/scripts/startup-report.mjs --dir "%USERPROFILE%\.astravia\desktop-app\logs\main"
 *   node apps/desktop/scripts/startup-report.mjs --startups 5 --slowest 10 --json
 *
 * 数据来源只有本地日志文件，除了读盘没有任何副作用；不启动应用、不联网。
 */

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
const MARK_PATTERN = /\[startup\] (\S+) at=([\d.]+)ms delta=([\d.]+)ms/;
const LINE_PATTERN = /^\[([^\]]+)\] \[(error|warn|info|log|debug)\] (?:\[([^\]]+)\] )?(.*)$/;
const CRASH_HINTS = [
	"render-process-gone",
	"child-process-gone",
	"uncaughtException",
	"unhandledRejection",
	"single instance lock not acquired",
	"FATAL",
	"GPU process isn't usable",
	"gpu-process-crashed",
];

export function defaultLogDir() {
	return join(homedir(), ".astravia", "desktop-app", "logs", "main");
}

/** 按 mtime 取最新的日志文件（含轮转出来的 `*.size.log`）。 */
export function listLogFiles(dir, limit = 3) {
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".log"))
		.map((name) => {
			const path = join(dir, name);
			return { path, mtimeMs: statSync(path).mtimeMs, name };
		})
		.sort((left, right) => right.mtimeMs - left.mtimeMs)
		.slice(0, limit);
	// 报告按时间顺序读，所以返回时 oldest-first。
	return files.reverse();
}

export async function readLogFiles(files) {
	const chunks = [];
	for (const file of files) {
		chunks.push(await readText(file.path));
	}
	return chunks.join("");
}

function readText(path) {
	return new Promise((resolve, reject) => {
		const stream = createReadStream(path, { encoding: "utf8" });
		const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
		const lines = [];
		reader.on("line", (line) => lines.push(line));
		reader.on("close", () => resolve(`${lines.join("\n")}\n`));
		reader.on("error", reject);
	});
}

/** 抽取所有 `[startup] <label> at=…ms delta=…ms` 记录。 */
export function parseStartupMarks(text) {
	const marks = [];
	for (const line of text.split("\n")) {
		const match = MARK_PATTERN.exec(line);
		if (!match) continue;
		const header = LINE_PATTERN.exec(line);
		marks.push({
			label: match[1],
			atMs: Number(match[2]),
			deltaMs: Number(match[3]),
			timestamp: header ? header[1] : undefined,
			level: header ? header[2] : undefined,
		});
	}
	return marks;
}

/** `main-module-loaded` 视为一次启动的起点；之后的 mark 归到这次启动。 */
export function splitStartupSessions(marks) {
	const sessions = [];
	let current;
	for (const mark of marks) {
		if (!current || mark.label === "main-module-loaded") {
			current = { startTimestamp: mark.timestamp, marks: [] };
			sessions.push(current);
		}
		current.marks.push(mark);
	}
	return sessions;
}

/** `renderer content frame visible` 之类阶段性的关键进度，用来和 mark 对齐。 */
export function summarizeSession(session) {
	const marks = session.marks;
	const last = marks[marks.length - 1];
	const slowest = marks.reduce(
		(worst, mark) => (worst === undefined || mark.deltaMs > worst.deltaMs ? mark : worst),
		undefined,
	);
	return {
		startTimestamp: session.startTimestamp,
		totalMs: last ? last.atMs : 0,
		slowest: slowest ? { label: slowest.label, deltaMs: slowest.deltaMs } : undefined,
		reached: last ? last.label : undefined,
		marks,
	};
}

/** `session creation trace` 的字段是 electron-log 的多行 inspect 输出，按块取值。 */
export function parseSessionCreationTraces(text) {
	const lines = text.split("\n");
	const traces = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (!lines[index].includes("session creation trace")) continue;
		const header = LINE_PATTERN.exec(lines[index]);
		const block = [];
		let cursor = index + 1;
		// 块尾是顶格的 `}`；嵌套的 stages 对象以缩进结束，不能当作块尾。
		while (cursor < lines.length && !/^\}/.test(lines[cursor])) {
			block.push(lines[cursor]);
			cursor += 1;
		}
		const body = block.join("\n");
		const total = /totalDurationMs:\s*([\d.]+)/.exec(body);
		const status = /status:\s*'(\w+)'/.exec(body);
		traces.push({
			timestamp: header ? header[1] : undefined,
			level: header ? header[2] : undefined,
			status: status ? status[1] : undefined,
			totalDurationMs: total ? Number(total[1]) : undefined,
			stages: parseStageBlock(body),
		});
		index = cursor;
	}
	return traces;
}

function parseStageBlock(body) {
	const stages = {};
	const match = /stages:\s*\{([\s\S]*?)\}/.exec(body);
	if (match) {
		for (const pair of match[1].split(",")) {
			// 阶段名带连字符的会被 inspect 输出成 `'sandbox-check': 6`，引号可有可无。
			const entry = /'?([\w-]+)'?:\s*([\d.]+)/.exec(pair);
			if (entry) stages[entry[1]] = Number(entry[2]);
		}
	}
	const runtimeCreate = /runtime-create:\s*([\d.]+)/.exec(body);
	if (runtimeCreate && stages["runtime-create"] === undefined) stages["runtime-create"] = Number(runtimeCreate[1]);
	return stages;
}

/** 崩溃 / 被转交 / 异常退出信号：只保留命中提示词的行，避免整份错误日志。 */
export function collectCrashSignals(text, limit = 40) {
	const signals = [];
	for (const line of text.split("\n")) {
		const upper = line.toUpperCase();
		const hit = CRASH_HINTS.find((hint) => upper.includes(hint.toUpperCase()));
		if (!hit) continue;
		if (!LINE_PATTERN.test(line)) continue;
		signals.push({ hint: hit, line: line.slice(0, 300) });
		if (signals.length >= limit) break;
	}
	return signals;
}

export function buildReport({ text, startups = 3, slowest = 5 }) {
	const sessions = splitStartupSessions(parseStartupMarks(text))
		.map(summarizeSession)
		.slice(-startups);
	const traces = parseSessionCreationTraces(text)
		.filter((trace) => typeof trace.totalDurationMs === "number")
		.sort((left, right) => (right.totalDurationMs ?? 0) - (left.totalDurationMs ?? 0))
		.slice(0, slowest);
	return {
		startups: sessions,
		sessionCreationTraces: traces,
		signals: collectCrashSignals(text),
	};
}

export function formatReport(report) {
	const out = [];
	out.push(`== 启动时间线（最近 ${report.startups.length} 次）==`);
	if (report.startups.length === 0) {
		out.push("（未找到 [startup] 记录：应用版本早于打点，或日志已被轮转）");
	}
	for (const startup of report.startups) {
		out.push(`[启动] ${startup.startTimestamp ?? "(无时间戳)"}  到「${startup.reached}」共 ${startup.totalMs}ms`);
		for (const mark of startup.marks) {
			const slow = mark.deltaMs >= 1_500 ? "  ← 慢" : "";
			out.push(`  ${mark.label.padEnd(32)} at=${String(mark.atMs).padStart(7)}ms  delta=${String(mark.deltaMs).padStart(7)}ms${slow}`);
		}
		if (startup.slowest) {
			out.push(`  最慢一段：${startup.slowest.label} +${startup.slowest.deltaMs}ms`);
		}
	}

	out.push("");
	out.push(`== 会话创建 trace（最慢 ${report.sessionCreationTraces.length} 条）==`);
	if (report.sessionCreationTraces.length === 0) out.push("（未找到 session creation trace 记录）");
	for (const trace of report.sessionCreationTraces) {
		const stages = Object.entries(trace.stages)
			.sort((left, right) => right[1] - left[1])
			.map(([name, ms]) => `${name}=${ms}ms`)
			.join(" ");
		out.push(`  ${trace.timestamp ?? "(无时间戳)"} 总 ${trace.totalDurationMs}ms ${trace.status ?? ""} ${stages}`);
	}

	out.push("");
	out.push("== 崩溃 / 被转交 / 异常信号 ==");
	if (report.signals.length === 0) out.push("（没有命中崩溃或异常退出关键词）");
	for (const signal of report.signals) out.push(`  [${signal.hint}] ${signal.line}`);
	return out.join("\n");
}

function parseArgs(argv) {
	const options = { dir: defaultLogDir(), files: 3, startups: 3, slowest: 5, json: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = () => argv[(index += 1)];
		if (arg === "--dir") options.dir = next();
		else if (arg === "--files") options.files = Number(next());
		else if (arg === "--startups") options.startups = Number(next());
		else if (arg === "--slowest") options.slowest = Number(next());
		else if (arg === "--json") options.json = true;
		else if (arg === "--help" || arg === "-h") options.help = true;
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(
			[
				"用法: node apps/desktop/scripts/startup-report.mjs [选项]",
				"  --dir <目录>      日志目录，默认 <用户目录>/.astravia/desktop-app/logs/main",
				"  --files <n>       读取最新的 n 个日志文件，默认 3",
				"  --startups <n>    报告最近 n 次启动，默认 3",
				"  --slowest <n>     报告最慢的 n 条会话创建 trace，默认 5",
				"  --json            输出 JSON（供其他脚本消费）",
				"",
			].join("\n"),
		);
		return;
	}
	const files = listLogFiles(options.dir, options.files);
	if (files.length === 0) {
		process.stderr.write(`没有在 ${options.dir} 找到 .log 文件。用 --dir 指定日志目录。\n`);
		process.exitCode = 2;
		return;
	}
	const text = await readLogFiles(files);
	const report = buildReport({ text, startups: options.startups, slowest: options.slowest });
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ files: files.map((file) => file.name), ...report }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`读取日志：${files.map((file) => file.name).join(", ")}\n\n`);
	process.stdout.write(`${formatReport(report)}\n`);
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	await main();
}
