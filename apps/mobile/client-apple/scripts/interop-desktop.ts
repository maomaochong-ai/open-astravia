/**
 * Interop harness: runs the desktop's real LAN server (apps/desktop) and the
 * repository's fake relay, plus a scripted desktop brain, so the Swift client
 * can be exercised end to end over real WebSockets.
 *
 *   bun apps/mobile/client-apple/scripts/interop-desktop.ts <info-file>
 *
 * Writes `{ lanPort, relayPort, invite, relayOnlyInvite }` to <info-file> once
 * listening. Used by `scripts/interop.sh` and handy for manual simulator runs.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
const conversationCwd = "/conversations";
const projects = [
	{ cwd: "/Users/dev/vetta", name: "vetta" },
	{ cwd: "/Users/dev/docs", name: "docs" },
];
const histories = new Map<string, unknown[]>([
	["s-report", [
		{ kind: "user", id: "u1", text: "把上周 Jira 工单按模块汇总成周报", at: Date.now() - 3_600_000 },
		{ kind: "assistant", id: "a1", text: "已汇总，共 **12** 个工单：\n\n| 模块 | 数量 |\n| --- | --- |\n| 桌面端 | 7 |\n| 手机端 | 5 |\n\n- 桌面端以打包问题为主\n- 手机端集中在配对流程\n\n```bash\njira export --week 38\n```", thinking: "先拉取工单列表，再按 component 分组。", toolCalls: [{ toolCallId: "t1", toolName: "web_search", args: "{\"query\":\"jira week 38\"}", result: "12 issues", durationMs: 820 }], at: Date.now() - 3_590_000 },
	]],
	["s-build", [{ kind: "user", id: "u2", text: "看看为什么打包签名失败", at: Date.now() - 120_000 }]],
]);

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
	const request = {
		requestId: `q-${Date.now()}`,
		questions: [{ question: "继续执行下一步吗？", header: "确认", options: [{ label: "继续", description: "按计划执行" }, { label: "先停下", description: "" }] }],
	};
	pendingQuestions.set(sessionId, request);
	emitAll(deviceId, "session.input", { kind: "question", request }, sessionId);
	if (session) session.status = "waiting_input";
	emitAll(deviceId, "session.state", { status: "waiting_input", ...modelState(sessionId), pendingQuestion: request }, sessionId);
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
			void streamReply(deviceId, sessionId, String(request.payload?.text ?? ""), note);
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
		case "session.respond":
			ok({ responded: true });
			pendingQuestions.delete(sessionId);
			emitAll(deviceId, "session.input", { kind: "resolved", requestId: request.payload?.requestId }, sessionId);
			void (async () => {
				await delay(60);
				const entries = histories.get(sessionId) ?? [];
				const last = entries[entries.length - 1] as { kind?: string; text?: string } | undefined;
				if (last?.kind === "assistant") last.text += "\n\n好的，已按你的选择继续。";
				emitAll(deviceId, "session.message", { kind: "assistant_delta", text: "\n\n好的，已按你的选择继续。" }, sessionId);
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
			emitAll(deviceId, "device.status", { deviceName: desktopName, osLabel: "macOS", lanEndpoints: [`127.0.0.1:${lanPort}`], relayEnabled: true, runningSessionCount: 1 });
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
		if (stored?.mobileIdentityKey && stored.mobileIdentityKey !== hello.identityKey) return { kind: "reject", reason: "peer identity does not match the pinned key" };
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

writeFileSync(infoFile, JSON.stringify({ lanPort: boundPort, relayPort, invite, relayOnlyInvite }, null, 2));
console.info(`[interop] LAN ws://127.0.0.1:${boundPort}  relay ws://127.0.0.1:${relayPort}`);
console.info(`[interop] invite ${invite}`);
