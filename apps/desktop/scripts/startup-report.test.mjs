import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	buildReport,
	collectCrashSignals,
	formatReport,
	listLogFiles,
	parseSessionCreationTraces,
	parseStartupMarks,
	splitStartupSessions,
	summarizeSession,
} from "./startup-report.mjs";

const FIXTURE = [
	"[2026-11-10T08:35:10.000+08:00] [info] [main] [startup] main-module-loaded at=820ms delta=820ms",
	"[2026-11-10T08:35:10.020+08:00] [info] [main] [startup] diagnostics-installed at=840ms delta=20ms",
	"[2026-11-10T08:35:13.100+08:00] [warn] [main] [startup] single-instance-lock-check-end at=3920ms delta=3080ms",
	"[2026-11-10T08:35:13.100+08:00] [warn] [main] [startup] single instance lock not acquired; exiting {",
	"  relaunchingAfterUpdate: false,",
	"  cliMode: false",
	"}",
	"[2026-11-10T08:41:00.000+08:00] [info] [main] [startup] main-module-loaded at=910ms delta=910ms",
	"[2026-11-10T08:41:00.400+08:00] [info] [main] [startup] app-ready at=1310ms delta=400ms",
	"[2026-11-10T08:41:02.900+08:00] [info] [main] [startup] renderer-window-created at=3810ms delta=2500ms",
	"[2026-11-10T08:41:04.100+08:00] [info] [main] [startup] boot-frame-visible at=5010ms delta=1200ms",
	"[2026-11-10T08:41:11.500+08:00] [error] [diagnostics] unhandledRejection AbortError: This operation was aborted",
	"[2026-11-10T08:41:12.000+08:00] [error] [diagnostics] render-process-gone {\n  reason: 'crashed'",
	"[2026-11-10T08:41:20.000+08:00] [info] [conversation-service] session creation trace {",
	"  interactionId: 'abc',",
	"  status: 'completed',",
	"  totalDurationMs: 9096.1,",
	"  stages: { precheck: 6726.3, 'sandbox-check': 6, 'runtime-create': 2350 },",
	"  kind: 'conversation'",
	"}",
	"[2026-11-10T08:42:00.000+08:00] [warn] [conversation-service] session creation trace {",
	"  interactionId: 'def',",
	"  status: 'failed',",
	"  totalDurationMs: 153000.5,",
	"  stages: {",
	"    precheck: 71821.1,",
	"    'runtime-create': 63083.4,",
	"    'sandbox-check': 16548.9",
	"  },",
	"  failedStage: 'runtime-create'",
	"}",
].join("\n");

describe("startup-report 解析", () => {
	it("按进程启动时间与阶段增量解析启动打点", () => {
		const marks = parseStartupMarks(FIXTURE);
		assert.equal(marks.length, 7);
		assert.deepEqual(marks[0], {
			label: "main-module-loaded",
			atMs: 820,
			deltaMs: 820,
			timestamp: "2026-11-10T08:35:10.000+08:00",
			level: "info",
		});
		assert.equal(marks[2].label, "single-instance-lock-check-end");
		assert.equal(marks[2].deltaMs, 3080);
	});

	it("把每次 main-module-loaded 切成一次独立启动，并给出最慢一段", () => {
		const sessions = splitStartupSessions(parseStartupMarks(FIXTURE)).map(summarizeSession);
		assert.equal(sessions.length, 2);

		const [first, second] = sessions;
		assert.equal(first.marks.length, 3);
		assert.equal(first.reached, "single-instance-lock-check-end");
		assert.deepEqual(first.slowest, { label: "single-instance-lock-check-end", deltaMs: 3080 });

		assert.equal(second.totalMs, 5010);
		assert.equal(second.reached, "boot-frame-visible");
		assert.deepEqual(second.slowest, { label: "renderer-window-created", deltaMs: 2500 });
	});

	it("解析单行与多行两种 stage 块（inspect 输出）", () => {
		const traces = parseSessionCreationTraces(FIXTURE);
		assert.equal(traces.length, 2);
		assert.equal(traces[0].status, "completed");
		assert.equal(traces[0].totalDurationMs, 9096.1);
		assert.deepEqual(traces[0].stages, { precheck: 6726.3, "sandbox-check": 6, "runtime-create": 2350 });

		assert.equal(traces[1].status, "failed");
		assert.equal(traces[1].totalDurationMs, 153000.5);
		assert.deepEqual(traces[1].stages, {
			precheck: 71821.1,
			"runtime-create": 63083.4,
			"sandbox-check": 16548.9,
		});
	});

	it("只保留命中崩溃 / 被转交关键词的日志行", () => {
		const hints = collectCrashSignals(FIXTURE).map((signal) => signal.hint);
		assert.deepEqual(hints, ["single instance lock not acquired", "unhandledRejection", "render-process-gone"]);
	});

	it("报告按耗时排序并渲染成可读文本", () => {
		const report = buildReport({ text: FIXTURE, startups: 1, slowest: 2 });
		assert.equal(report.startups.length, 1);
		assert.equal(report.startups[0].startTimestamp, "2026-11-10T08:41:00.000+08:00");
		assert.deepEqual(
			report.sessionCreationTraces.map((trace) => trace.totalDurationMs),
			[153000.5, 9096.1],
		);

		const text = formatReport(report);
		assert.match(text, /启动时间线（最近 1 次）/);
		assert.match(text, /renderer-window-created\s+at=\s*3810ms\s+delta=\s*2500ms\s+← 慢/);
		assert.match(text, /总 153000\.5ms failed precheck=71821\.1ms runtime-create=63083\.4ms sandbox-check=16548\.9ms/);
		assert.match(text, /\[render-process-gone\]/);
	});

	it("空日志给出明确缺数据提示，而不是抛异常", () => {
		const report = buildReport({ text: "" });
		assert.deepEqual(report.startups, []);
		assert.deepEqual(report.sessionCreationTraces, []);
		const text = formatReport(report);
		assert.match(text, /未找到 \[startup\] 记录/);
	});
});

describe("startup-report 读盘", () => {
	const created = [];
	after(async () => {
		await Promise.all(created.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
	});

	it("取最新日志文件并按时间顺序返回，忽略非 .log", async () => {
		const dir = await mkdtemp(join(tmpdir(), "astravia-startup-report-"));
		created.push(dir);
		await writeFile(join(dir, "2026-11-09.log"), "[old]\n");
		await writeFile(join(dir, "2026-11-10.log"), "[new]\n");
		await writeFile(join(dir, "notes.txt"), "ignore me\n");
		// 排序键是 mtime，而 CI 的文件系统精度可能只到秒：两次紧挨的写入拿到同一个
		// 时间戳时，顺序退化成 readdir 顺序，断言就会随机失败。这里把时间戳拉开。
		await utimes(join(dir, "2026-11-09.log"), new Date("2026-11-09T00:00:00Z"), new Date("2026-11-09T00:00:00Z"));
		await utimes(join(dir, "2026-11-10.log"), new Date("2026-11-10T00:00:00Z"), new Date("2026-11-10T00:00:00Z"));

		const files = listLogFiles(dir, 2);
		assert.deepEqual(
			files.map((file) => file.name),
			["2026-11-09.log", "2026-11-10.log"],
		);
	});

	it("日志目录不存在时返回空列表", () => {
		assert.deepEqual(listLogFiles(join(tmpdir(), "astravia-no-such-log-dir"), 3), []);
	});
});
