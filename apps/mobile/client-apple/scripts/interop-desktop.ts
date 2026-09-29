/**
 * Interop harness: runs the desktop's real LAN server (apps/desktop) and the
 * repository's fake relay, plus a scripted desktop brain, so the Swift client
 * can be exercised end to end over real WebSockets.
 *
 *   bun apps/mobile/client-apple/scripts/interop-desktop.ts <info-file>
 *
 * Writes `{ lanPort, relayPort, invite, relayOnlyInvite, filesInvite }` to <info-file> once
 * listening. Used by `scripts/interop.sh` and handy for manual simulator runs.
 */
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");

// The LAN server logs through electron-log; outside Electron swap in a no-op logger.
Bun.plugin({
	name: "stub-desktop-logger",
	setup(build) {
		build.onLoad({ filter: /apps\/desktop\/src\/main\/logger\.ts$/ }, () => ({
			contents: "export const getAppLogger = () => ({ debug() {}, info() {}, warn() {}, error() {} });",
			loader: "js",
		}));
	},
});

const infoFile = process.argv[2] ?? resolve(root, "node_modules/.cache/vetta-interop.json");
const lanPort = Number(process.env.VETTA_INTEROP_LAN_PORT ?? 43210);
const relayPort = Number(process.env.VETTA_INTEROP_RELAY_PORT ?? 43290);
process.env.VETTA_FAKE_RELAY_PORT = String(relayPort);

const rc = await import(resolve(root, "packages/remote-control/src/index.ts"));
const { DesktopRemoteLanServer } = await import(resolve(root, "apps/desktop/src/main/remote-control/desktop-remote-lan-server.ts"));
const { createDesktopWebSocketFactory } = await import(resolve(root, "apps/desktop/src/main/remote-control/desktop-websocket.ts"));
await import(resolve(root, "packages/remote-control/scripts/fake-relay-server.ts"));
const { RemoteFiles } = await import(resolve(root, "apps/desktop/src/main/remote-control/remote-files.ts"));

type Connection = InstanceType<typeof rc.RemoteConnection>;

const identity = rc.generateIdentityKeyPair();
const devices = new Map<string, { id: string; mobileSecret: string; mobileSecretHash: string; mobileIdentityKey?: string }>();
const journals = new Map<string, InstanceType<typeof rc.RemoteEventJournal>>();
const links = new Set<Connection>();
const desktopName = "Interop MacBook Pro";

function addDevice(): { id: string; mobileSecret: string } {
	const id = rc.randomToken(18);
	const mobileSecret = rc.randomToken(32);
	devices.set(id, { id, mobileSecret, mobileSecretHash: rc.sha256Hex(mobileSecret) });
	return { id, mobileSecret };
}

function journalFor(deviceId: string) {
	let journal = journals.get(deviceId);
	if (!journal) {
		journal = new rc.RemoteEventJournal();
		journals.set(deviceId, journal);
	}
	return journal;
}

// ---- Scripted desktop brain ----------------------------------------------------------
type Summary = Record<string, unknown> & { id: string };
const sessions: Summary[] = [
	{ id: "s-report", projectCwd: "/conversations", projectName: "对话", title: "整理上周周报", preview: "把 Jira 里的工单按模块汇总", updatedAt: Date.now() - 3_600_000, status: "completed", live: false },
	{ id: "s-build", projectCwd: "/Users/dev/vetta", projectName: "vetta", title: "修复桌面端打包脚本", preview: "electron-builder 签名失败", updatedAt: Date.now() - 120_000, status: "running", live: true },
	{ id: "s-docs", projectCwd: "/Users/dev/docs", projectName: "docs", title: "更新安装文档", preview: "链接检查失败：3 个外链 404", updatedAt: Date.now() - 86_400_000, status: "error", live: false },
	...["整理会议纪要", "翻译发布公告", "排查内存占用", "清理旧分支", "生成月度报表", "核对依赖许可证"].map((title, index) => ({
		id: `s-old-${index}`,
		projectCwd: index % 2 ? "/Users/dev/vetta" : "/conversations",
		projectName: index % 2 ? "vetta" : "对话",
		title,
		preview: "已完成，结果已同步到电脑。",
		updatedAt: Date.now() - (2 + index) * 86_400_000,
		status: "completed",
		live: false,
	})),
];
// `VETTA_INTEROP_PIN=<id>` starts with that session pinned, for screenshots of the pinned look.
const pinnedAtStart = sessions.find((entry) => entry.id === process.env.VETTA_INTEROP_PIN);
if (pinnedAtStart) pinnedAtStart.pinnedAt = Date.now();
const conversationCwd = "/conversations";
const projects = [
	{ cwd: "/Users/dev/vetta", name: "vetta" },
	{ cwd: "/Users/dev/docs", name: "docs" },
];
const histories = new Map<string, unknown[]>([
	["s-report", [
		{ kind: "user", id: "u1", text: "把上周 Jira 工单按模块汇总成周报", at: Date.now() - 3_600_000 },
		{ kind: "assistant", id: "a1", text: "已汇总，共 **12** 个工单：\n\n| 模块 | 数量 |\n| --- | --- |\n| 桌面端 | 7 |\n| 手机端 | 5 |\n\n- 桌面端以打包问题为主\n- 手机端集中在配对流程\n\n```bash\njira export --week 38\n```", thinking: "先拉取工单列表，再按 component 分组。", toolCalls: [{ toolCallId: "t1", toolName: "web_search", args: "{\"query\":\"jira week 38\"}", result: "12 issues", durationMs: 820 }], at: Date.now() - 3_590_000 },
		{ kind: "assistant", id: "a1b", text: "周报已同步到共享文档，也写了一份 [weekly.md](./weekly.md)，还有可以直接打开的 [报告页面](report.html)。", toolCalls: [{ toolCallId: "t1b", toolName: "write_file", args: "{\"path\":\"weekly.md\"}", result: "ok", durationMs: 12 }], at: Date.now() - 3_580_000 },
	]],
	["s-build", [{ kind: "user", id: "u2", text: "看看为什么打包签名失败", at: Date.now() - 120_000 }]],
]);
// `VETTA_INTEROP_LONG=<turns>` adds a long chat, for timing how fast a big history opens;
// `VETTA_INTEROP_STEPS=<n>` gives each turn that many tool-calling steps. Like the desktop,
// history is capped at the last 240 entries and tool text at 1200 characters.
const longTurns = Number(process.env.VETTA_INTEROP_LONG ?? 0);
const longSteps = Math.max(1, Number(process.env.VETTA_INTEROP_STEPS ?? 1));
if (longTurns > 0) {
	const start = Date.now() - longTurns * 600_000;
	const narration = (turn: number, step: number) =>
		[
			`### 第 ${turn + 1} 轮 · 第 ${step + 1} 步`,
			`先看 \`src/main/index.ts\` 的第 ${step} 处改动，再对照 [说明](https://example.com/${turn}/${step})。`,
			"- 检查 **签名** 配置\n- 重新跑 `electron-builder`\n- 对比产物大小",
			"```ts\nconst result = await build({ target: \"dmg\" });\nconsole.log(result.artifacts);\n```",
			"结论：".concat("这一步的输出与预期一致，可以继续。".repeat(6)),
		].join("\n\n");
	const entries = Array.from({ length: longTurns }, (_, turn) => {
		const at = start + turn * 600_000;
		return [
			{ kind: "user", id: `lu${turn}`, text: `第 ${turn + 1} 个问题：继续排查打包流程`, at },
			...Array.from({ length: longSteps }, (_, step) => ({
				kind: "assistant",
				id: `la${turn}-${step}`,
				text: narration(turn, step),
				thinking: "先读文件，再运行命令。",
				toolCalls: [0, 1].map((call) => ({
					toolCallId: `lt${turn}-${step}-${call}`,
					toolName: "bash",
					args: `{"command":"ls step-${turn}-${step}-${call}"}`,
					result: "drwxr-xr-x  12 dev  staff   384 Sep 29 10:00 build\n".repeat(40).slice(0, 1_200),
					durationMs: 40,
				})),
				at: at + (step + 1) * 5_000,
			})),
		];
	}).flat();
	sessions.unshift({ id: "s-long", projectCwd: "/Users/dev/vetta", projectName: "vetta", title: "超长会话", preview: "打包流程逐步排查", updatedAt: Date.now(), status: "completed", live: false });
	histories.set("s-long", entries.slice(-240));
}

// ---- Files (ADR-0139) ------------------------------------------------------------------
// Every session's working directory is one fixture folder, served by the desktop's real
// file service; its home is the fixture root, so anything outside it is refused.
const filesHome = join(tmpdir(), "vetta-interop-files");
const filesCwd = join(filesHome, "session");
mkdirSync(join(filesCwd, "out"), { recursive: true });
mkdirSync(join(filesHome, ".ssh"), { recursive: true });
writeFileSync(join(filesCwd, "weekly.md"), "# 第 38 周周报\n\n共 **12** 个工单。\n\n| 模块 | 数量 |\n| --- | --- |\n| 桌面端 | 7 |\n| 手机端 | 5 |\n");
writeFileSync(join(filesCwd, "report.html"), "<!doctype html><meta name=viewport content='width=device-width'><h1>周报</h1><p id=n></p><script>document.getElementById('n').textContent = '脚本已运行';</script>");
writeFileSync(join(filesCwd, "notes.txt"), "Interop notes\n".repeat(200));
writeFileSync(join(filesCwd, "out", "data.csv"), "module,count\ndesktop,7\nmobile,5\n");
writeFileSync(join(filesCwd, "out", "big.bin"), Buffer.alloc(1_600_000, 1));
writeFileSync(join(filesHome, ".ssh", "id_rsa"), "not a key");
const realFilesHome = realpathSync(filesHome);
const remoteFiles = new RemoteFiles({
	fs: {
		readDirectory: async (dir: string) =>
			readdirSync(dir, { withFileTypes: true }).map((entry) => {
				const stats = statSync(join(dir, entry.name));
				return { name: entry.name, path: join(dir, entry.name), isDirectory: entry.isDirectory(), size: stats.size, modifiedAt: stats.mtimeMs };
			}),
		openSource: (target: string) => {
			if (!target.startsWith(`${realFilesHome}/`)) throw new Error("Path is outside any previewable directory");
			return {
				path: target,
				stat: async () => {
					try {
						const stats = statSync(target);
						return { size: stats.size, isFile: stats.isFile(), modifiedAt: stats.mtimeMs };
					} catch {
						return null;
					}
				},
				read: async () => readFileSync(target),
				readHead: async (count: number) => readFileSync(target).subarray(0, count),
			};
		},
		realpath: async (target: string) => {
			try {
				return realpathSync(target);
			} catch {
				return target;
			}
		},
		scaleImage: () => undefined,
	},
	home: realFilesHome,
	path,
});
const realFilesCwd = realpathSync(filesCwd);

function emitAll(deviceId: string, name: string, payload: unknown, sessionId?: string): void {
	const journal = journalFor(deviceId);
	const sequence = journal.nextSequence();
	const event = { type: "event" as const, eventId: `desktop-event-${sequence}`, sequence, name, sessionId, payload };
	journal.remember(event);
	for (const link of links) void link.deliverEvent(event).catch(() => undefined);
}

const pendingQuestions = new Map<string, unknown>();
const uploads = new Map<string, { sessionId: string; name: string; bytes: number }>();
const models = [
	{ key: "anthropic/claude-opus-5", name: "Claude Opus 5", provider: "anthropic", thinkingLevels: ["off", "low", "medium", "high"], defaultThinkingLevel: "medium", supportsImage: true },
	{ key: "zai/glm-5", name: "GLM 5", provider: "zai", thinkingLevels: ["none", "minimal", "low", "medium", "high", "max"], defaultThinkingLevel: "high", supportsImage: false },
];
const settings = new Map<string, { modelKey: string; thinkingLevel: string }>();
function settingsFor(sessionId: string) {
	return settings.get(sessionId) ?? { modelKey: "anthropic/claude-opus-5", thinkingLevel: "medium" };
}
function modelState(sessionId: string) {
	const current = settingsFor(sessionId);
	return { model: models.find((entry) => entry.key === current.modelKey)?.name, ...current };
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

/** Mirrors what the real desktop persists, so `session.history` includes a turn in progress. */
function recordTurn(sessionId: string, text: string) {
	const entries = histories.get(sessionId) ?? [];
	histories.set(sessionId, entries);
	entries.push({ kind: "user", id: `u-${Date.now()}`, text, at: Date.now() });
	const turn = { kind: "assistant", id: `a-${Date.now()}`, text: "", thinking: "", toolCalls: [] as unknown[], at: Date.now() };
	entries.push(turn);
	return turn;
}

/** A turn that never gets an answer: the provider fails, one automatic retry fails the same way. */
async function failReply(deviceId: string, sessionId: string, text: string): Promise<void> {
	const entries = histories.get(sessionId) ?? [];
	histories.set(sessionId, entries);
	entries.push({ kind: "user", id: `u-${Date.now()}`, text, at: Date.now() });
	emitAll(deviceId, "session.message", { kind: "user", text, at: Date.now() }, sessionId);
	emitAll(deviceId, "session.state", { status: "running", ...modelState(sessionId) }, sessionId);
	await delay(4_000);
	const failure = { status: "error", error: { code: "turn_failed", message: "Connection error." } };
	emitAll(deviceId, "session.state", failure, sessionId);
	emitAll(deviceId, "session.state", { status: "running", detail: "retry 1/2" }, sessionId);
	await delay(300);
	emitAll(deviceId, "session.state", failure, sessionId);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		entries.push({ kind: "assistant", id: `a-${Date.now()}-${attempt}`, text: "", toolCalls: [], at: Date.now(), error: "Connection error." });
	}
	emitAll(deviceId, "session.message", { kind: "turn_end", at: Date.now() }, sessionId);
	emitAll(deviceId, "session.state", { status: "completed" }, sessionId);
}

const longReply = [
	"\n\n## 进度说明\n\n",
	"打包脚本失败的原因已经定位：签名步骤读取的证书名称和钥匙串里的不一致，electron-builder 找不到身份后直接退出，日志里只留下一行 **code signing failed**。",
	"\n\n我按下面的顺序处理：\n\n",
	"1. 读取钥匙串里的有效身份，确认 `Developer ID Application` 证书仍在有效期内\n",
	"2. 把 `CSC_NAME` 改成证书的完整名称，并去掉多余的引号\n",
	"3. 重新运行打包，确认公证与装订都通过\n\n",
	"> 注意：CI 上的证书是另一份，需要同步更新密钥库里的名称，否则夜间构建还会失败。\n\n",
	"```bash\nsecurity find-identity -v -p codesigning\nbun run dist:mac\n```\n\n",
	"整个过程大约需要五分钟。完成后我会把新的安装包路径和校验和一起发给你，你可以直接在测试机上安装验证。",
].join("");

async function streamReply(deviceId: string, sessionId: string, text: string, note = ""): Promise<void> {
	const turn = recordTurn(sessionId, text);
	const session = sessions.find((entry) => entry.id === sessionId);
	if (session) Object.assign(session, { status: "running", preview: text, updatedAt: Date.now(), title: session.title || text.slice(0, 60) });
	emitAll(deviceId, "session.message", { kind: "user", text, at: Date.now() }, sessionId);
	emitAll(deviceId, "session.state", { status: "running", ...modelState(sessionId) }, sessionId);
	await delay(80);
	turn.thinking = "先确认需求，";
	emitAll(deviceId, "session.message", { kind: "thinking_delta", text: turn.thinking }, sessionId);
	const tool = { toolCallId: `tool-${Date.now()}`, toolName: "bash", args: "{\"command\":\"ls -la\"}", result: "total 8\ndrwxr-xr-x  README.md", durationMs: 42 };
	turn.toolCalls.push(tool);
	emitAll(deviceId, "session.tool", { ...tool, phase: "completed" }, sessionId);
	for (const chunk of ["收到：", text, note, "。\n\n", "- 第一步已完成\n", "- 需要你确认下一步"]) {
		await delay(40);
		turn.text += chunk;
		emitAll(deviceId, "session.message", { kind: "assistant_delta", text: chunk }, sessionId);
	}
	// `VETTA_INTEROP_LONG_REPLY=1` follows up with a long answer in uneven bursts, as a real
	// model over a real network sends it, to watch how the phone paces and fades it in.
	if (process.env.VETTA_INTEROP_LONG_REPLY === "1") {
		let rest = longReply;
		while (rest.length > 0) {
			await delay(40 + Math.random() * 360);
			const chunk = rest.slice(0, 4 + Math.floor(Math.random() * 90));
			rest = rest.slice(chunk.length);
			turn.text += chunk;
			emitAll(deviceId, "session.message", { kind: "assistant_delta", text: chunk }, sessionId);
		}
	}
	const request = {
		requestId: `q-${Date.now()}`,
		questions: [
			{ question: "继续执行下一步吗？", header: "确认", options: [{ label: "继续", description: "按计划执行" }, { label: "先停下", description: "" }] },
			{ question: "完成后通知谁？", header: "通知", multiSelect: true, options: [{ label: "产品", description: "" }, { label: "测试", description: "" }] },
		],
	};
	pendingQuestions.set(sessionId, request);
	emitAll(deviceId, "session.input", { kind: "question", request }, sessionId);
	if (session) session.status = "waiting_input";
	emitAll(deviceId, "session.state", { status: "waiting_input", ...modelState(sessionId), pendingQuestion: request }, sessionId);
	// Like an older desktop: the turn goes on reporting usage as plain "running" while it waits.
	await delay(40);
	emitAll(deviceId, "session.state", { status: "running", contextPercent: 40, ...modelState(sessionId) }, sessionId);
}

function handleRequest(deviceId: string, connection: Connection, request: { requestId: string; method: string; sessionId?: string; payload?: any }): void {
	const ok = (payload: unknown) => void connection.respond(request.requestId, { success: true, payload }).catch(() => undefined);
	const sessionId = request.sessionId ?? "";
	switch (request.method) {
		case "session.list":
			ok({ sessions });
			return;
		case "project.list": {
			const count = (cwd: string) => sessions.filter((entry) => entry.projectCwd === cwd).length;
			ok({
				projects: [
					{ cwd: conversationCwd, name: "对话", kind: "conversation", sessionCount: count(conversationCwd) },
					...projects.map((project) => ({ ...project, kind: "project", sessionCount: count(project.cwd) })),
				],
			});
			return;
		}
		case "session.create": {
			const project = projects.find((entry) => entry.cwd === request.payload?.projectCwd);
			const session = { id: `s-${rc.randomToken(6)}`, projectCwd: project?.cwd ?? conversationCwd, projectName: project?.name ?? "对话", title: "", updatedAt: Date.now(), status: "idle", live: true };
			sessions.unshift(session);
			histories.set(session.id, []);
			ok({ session });
			emitAll(deviceId, "session.list", { sessions });
			return;
		}
		case "session.open":
			ok({ session: sessions.find((entry) => entry.id === sessionId), state: { status: "idle" } });
			return;
		case "session.history": {
			const session = sessions.find((entry) => entry.id === sessionId);
			ok({ entries: histories.get(sessionId) ?? [], state: { status: session?.status ?? "idle", ...modelState(sessionId), pendingQuestion: pendingQuestions.get(sessionId) } });
			return;
		}
		case "session.prompt": {
			const ids: string[] = Array.isArray(request.payload?.attachments) ? request.payload.attachments : [];
			const attached = ids.map((id) => uploads.get(id));
			if (attached.some((upload) => !upload || upload.sessionId !== sessionId)) {
				void connection.respond(request.requestId, { success: false, error: { code: "not_found", message: "unknown upload", retryable: false } }).catch(() => undefined);
				return;
			}
			for (const id of ids) uploads.delete(id);
			ok({ accepted: true });
			const note = attached.length ? `（附件：${attached.map((upload) => `${upload?.name} ${upload?.bytes}B`).join("、")}）` : "";
			const text = String(request.payload?.text ?? "");
			if (text.includes("模拟报错")) void failReply(deviceId, sessionId, text);
			else void streamReply(deviceId, sessionId, text, note);
			return;
		}
		case "session.upload": {
			const bytes = Buffer.from(String(request.payload?.data ?? ""), "base64").byteLength;
			const uploadId = `up-${rc.randomToken(6)}`;
			uploads.set(uploadId, { sessionId, name: String(request.payload?.name ?? ""), bytes });
			ok({ uploadId });
			return;
		}
		case "model.list":
			ok({ models });
			return;
		case "skill.list": {
			const skills: Array<Record<string, string>> = [
				{ name: "frontend-design", alias: "前端设计", description: "生成有设计感的页面与组件", type: "skill", source: "builtin" },
				{ name: "pdf", description: "读取、合并、拆分 PDF", type: "skill", source: "user" },
				{ name: "weekly-report", alias: "周报", description: "按模板整理本周进展", type: "scene", source: "scene" },
			];
			if (typeof request.payload?.cwd === "string") {
				skills.push({ name: "release", description: "本项目的发版步骤", type: "skill", source: "project" });
			}
			ok({ skills });
			return;
		}
		case "session.configure": {
			const next = { ...settingsFor(sessionId) };
			if (typeof request.payload?.modelKey === "string") next.modelKey = request.payload.modelKey;
			if (typeof request.payload?.thinkingLevel === "string") next.thinkingLevel = request.payload.thinkingLevel;
			settings.set(sessionId, next);
			const state = { status: sessions.find((entry) => entry.id === sessionId)?.status ?? "idle", ...modelState(sessionId) };
			ok({ state });
			emitAll(deviceId, "session.state", state, sessionId);
			return;
		}
		case "session.rename":
		case "session.pin": {
			const session = sessions.find((entry) => entry.id === sessionId);
			if (!session) {
				void connection.respond(request.requestId, { success: false, error: { code: "not_found", message: "Desktop session was not found", retryable: false } }).catch(() => undefined);
				return;
			}
			if (typeof request.payload?.title === "string" && request.payload.title.trim()) session.title = request.payload.title.trim();
			if (typeof request.payload?.pinned === "boolean") {
				if (request.payload.pinned) session.pinnedAt = Date.now();
				else delete session.pinnedAt;
			}
			ok({ session });
			emitAll(deviceId, "session.list", { sessions });
			return;
		}
		case "session.delete": {
			const index = sessions.findIndex((entry) => entry.id === sessionId);
			if (index >= 0) sessions.splice(index, 1);
			histories.delete(sessionId);
			ok({ deleted: true });
			emitAll(deviceId, "session.list", { sessions });
			return;
		}
		case "session.respond":
			ok({ responded: true });
			pendingQuestions.delete(sessionId);
			emitAll(deviceId, "session.input", { kind: "resolved", requestId: request.payload?.requestId }, sessionId);
			void (async () => {
				await delay(60);
				const entries = histories.get(sessionId) ?? [];
				const last = entries[entries.length - 1] as { kind?: string; text?: string } | undefined;
				const answers: Array<{ answers?: string[] }> = Array.isArray(request.payload?.answers) ? request.payload.answers : [];
				const chosen = answers.map((answer) => (answer.answers ?? []).join("、")).filter(Boolean).join("；");
				const reply = `\n\n你的选择：${chosen || "无"}\n\n好的，已按你的选择继续。`;
				if (last?.kind === "assistant") last.text += reply;
				emitAll(deviceId, "session.message", { kind: "assistant_delta", text: reply }, sessionId);
				emitAll(deviceId, "session.message", { kind: "turn_end", at: Date.now() }, sessionId);
				emitAll(deviceId, "session.state", { status: "completed", ...modelState(sessionId) }, sessionId);
				const session = sessions.find((entry) => entry.id === sessionId);
				if (session) session.status = "completed";
			})();
			return;
		case "session.abort":
			ok({ aborted: true });
			emitAll(deviceId, "session.state", { status: "aborted" }, sessionId);
			return;
		case "file.list":
		case "file.stat":
		case "file.read": {
			const serve = request.method === "file.list" ? remoteFiles.list : request.method === "file.stat" ? remoteFiles.stat : remoteFiles.read;
			serve.call(remoteFiles, realFilesCwd, request.payload).then(ok, (error: { code?: string; message?: string }) => {
				const code = error.code ?? "internal_error";
				void connection.respond(request.requestId, { success: false, error: { code, message: error.message ?? code, retryable: false } }).catch(() => undefined);
			});
			return;
		}
		case "diagnostics.snapshot":
			ok({ deviceName: desktopName, lanEndpoints: [`127.0.0.1:${lanPort}`], relayEnabled: true, runningSessionCount: 1, liveSessionCount: 1 });
			return;
		default:
			ok({});
	}
}

function attach(deviceId: string, connection: Connection): void {
	connection.onEvent((event: any) => {
		if (event.type === "state") console.info(`[interop] ${new Date().toISOString().slice(11, 23)} ${deviceId.slice(0, 6)} link ${event.state}`);
		if (event.type === "error") console.info(`[interop] ${deviceId.slice(0, 6)} error ${event.error.code}: ${event.error.message}`);
		if (event.type === "remote-request") handleRequest(deviceId, connection, event.request);
		if (event.type === "state" && event.state === "online") {
			links.add(connection);
			emitAll(deviceId, "device.status", { deviceName: desktopName, osLabel: "macOS", lanEndpoints: [`127.0.0.1:${lanPort}`], relayEnabled: true, runningSessionCount: 1, fileRead: true });
		}
		if (event.type === "state" && (event.state === "closed" || event.state === "failed" || event.state === "reconnecting")) links.delete(connection);
	});
}

// ---- LAN server (real desktop implementation) ------------------------------------------
const lan = new DesktopRemoteLanServer({
	identity,
	deviceId: "interop-desktop",
	deviceName: desktopName,
	lookupDevice: (id: string) => devices.get(id),
	onDeviceHello: (device: { id: string; mobileIdentityKey?: string }, hello: { identityKey: string }) => {
		const stored = devices.get(device.id);
		// UI tests launch a brand-new phone per test with the same invite; let it take the pairing over.
		const repin = process.env.VETTA_INTEROP_REPIN === "1";
		if (!repin && stored?.mobileIdentityKey && stored.mobileIdentityKey !== hello.identityKey) return { kind: "reject", reason: "peer identity does not match the pinned key" };
		if (stored) stored.mobileIdentityKey = hello.identityKey;
		return { kind: "approve" };
	},
	onManualHello: async (_hello: unknown, code: string) => {
		console.info(`[interop] manual pairing, verification code ${code}; auto-approving`);
		await delay(300);
		return true;
	},
	onAccepted: (kind: { type: string; id?: string }, link: { connection: Connection }) => {
		if (kind.type === "device" && kind.id) {
			attach(kind.id, link.connection);
			return;
		}
		link.connection.onEvent((event: any) => {
			if (event.type !== "state" || event.state !== "online") return;
			const device = addDevice();
			void link.connection.emitEvent("device.paired", {
				pairingId: device.id,
				mobileSecret: device.mobileSecret,
				desktopName,
				lanEndpoints: [`127.0.0.1:${lanPort}`],
				relayBaseUrl: `ws://127.0.0.1:${relayPort}`,
			});
		});
	},
	journalFor,
});
const boundPort = await lan.start(lanPort);

// ---- Relay side ------------------------------------------------------------------------
const primary = addDevice();
async function connectRelay(deviceId: string, secret: string): Promise<void> {
	const transport = new rc.WebSocketRemoteTransport(rc.relayControlUrl(`ws://127.0.0.1:${relayPort}`, deviceId, "desktop"), {
		peerCredentialHash: rc.sha256Hex(secret),
		createSocket: createDesktopWebSocketFactory(),
		keepaliveIntervalMs: 20_000,
	});
	const connection = new rc.RemoteConnection(transport, {
		role: "desktop",
		deviceId: "interop-desktop",
		deviceName: desktopName,
		capabilities: { chat: true, sessionRead: true },
		identity,
		journal: journalFor(deviceId),
	});
	attach(deviceId, connection);
	connection.onEvent((event: any) => {
		if (event.type === "state" && (event.state === "reconnecting" || event.state === "failed")) {
			setTimeout(() => void connectRelay(deviceId, secret), 300);
		}
	});
	await connection.connect();
}
await connectRelay(primary.id, primary.mobileSecret);

// `VETTA_INTEROP_ASK_AFTER_MS=<ms>` has the running build session ask a question that long after
// start, so the phone can be sent to the background first and show its notification.
const askAfterMs = Number(process.env.VETTA_INTEROP_ASK_AFTER_MS ?? 0);
if (askAfterMs > 0) {
	setTimeout(() => {
		const sessionId = "s-build";
		const request = {
			requestId: `q-${Date.now()}`,
			questions: [{ question: "签名证书过期了，要用新证书重新打包吗？", header: "确认", options: [{ label: "重新打包", description: "" }, { label: "先停下", description: "" }] }],
		};
		pendingQuestions.set(sessionId, request);
		const session = sessions.find((entry) => entry.id === sessionId);
		if (session) Object.assign(session, { status: "waiting_input", updatedAt: Date.now() });
		emitAll(primary.id, "session.input", { kind: "question", request }, sessionId);
		emitAll(primary.id, "session.state", { status: "waiting_input", ...modelState(sessionId), pendingQuestion: request }, sessionId);
		console.info(`[interop] ${sessionId} asked a question`);
	}, askAfterMs);
}

const invite = rc.buildPairingUri({
	version: 2,
	pairingId: primary.id,
	mobileSecret: primary.mobileSecret,
	desktopIdentityKey: rc.toBase64Url(identity.publicKey),
	desktopName,
	lanEndpoints: [`127.0.0.1:${boundPort}`],
	relayBaseUrl: `ws://127.0.0.1:${relayPort}`,
});
const relayOnly = addDevice();
await connectRelay(relayOnly.id, relayOnly.mobileSecret);
const relayOnlyInvite = rc.buildPairingUri({
	version: 2,
	pairingId: relayOnly.id,
	mobileSecret: relayOnly.mobileSecret,
	desktopIdentityKey: rc.toBase64Url(identity.publicKey),
	desktopName,
	lanEndpoints: ["127.0.0.1:1"],
	relayBaseUrl: `ws://127.0.0.1:${relayPort}`,
});

// Its own phone, so reading files through the relay does not share a pairing with the tests above.
const filesDevice = addDevice();
await connectRelay(filesDevice.id, filesDevice.mobileSecret);
const filesInvite = rc.buildPairingUri({
	version: 2,
	pairingId: filesDevice.id,
	mobileSecret: filesDevice.mobileSecret,
	desktopIdentityKey: rc.toBase64Url(identity.publicKey),
	desktopName,
	lanEndpoints: ["127.0.0.1:1"],
	relayBaseUrl: `ws://127.0.0.1:${relayPort}`,
});

writeFileSync(infoFile, JSON.stringify({ lanPort: boundPort, relayPort, invite, relayOnlyInvite, filesInvite }, null, 2));
console.info(`[interop] LAN ws://127.0.0.1:${boundPort}  relay ws://127.0.0.1:${relayPort}`);
console.info(`[interop] invite ${invite}`);
