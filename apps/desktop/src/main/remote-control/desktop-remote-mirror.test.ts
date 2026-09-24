import type { Message } from "@vetta/ai";
import type { RemoteEventName, RemoteRequest } from "@vetta/remote-control";
import type {
	HistoryEntry,
	PromptAttachmentRef,
	SessionEvent,
	SessionStateSnapshot,
	SettingsPatch,
} from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";
import type { DesktopConversationSession } from "../conversations/desktop-conversation-service.js";
import { DesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { DesktopRemoteMirror, type RemoteMirrorRuntime } from "./desktop-remote-mirror.js";
import { keyForPath } from "./remote-transcript.js";

interface Emitted {
	readonly name: RemoteEventName;
	readonly payload?: unknown;
	readonly sessionId?: string;
}

const CONVERSATION_CWD = "/home/me/.vetta/conversation";
const PROJECT_CWD = "/home/me/project";
const CONVERSATION_PATH = `${CONVERSATION_CWD}/.vetta/sessions/chat.jsonl`;
const PROJECT_PATH = `${PROJECT_CWD}/.vetta/sessions/work.jsonl`;

class FakeRuntime implements RemoteMirrorRuntime {
	readonly handlers = new Map<string, Set<(event: SessionEvent) => void>>();
	readonly runningHandlers = new Set<(path: string, running: boolean, sessionId?: string) => void>();
	readonly messages = new Map<string, Message[]>();
	readonly paths = new Map<string, string>();
	readonly streaming = new Set<string>();
	readonly aborted: string[] = [];
	readonly running = new Set<string>();
	readonly settings: Array<{ sessionId: string; patch: SettingsPatch }> = [];
	model = { provider: "anthropic", id: "claude-fable-5-1", name: "Claude Fable 5.1" };
	thinkingLevel = "off";

	getState(sessionId: string): SessionStateSnapshot {
		return {
			sessionId,
			thinkingLevel: this.thinkingLevel,
			executionMode: "sandbox",
			isStreaming: this.streaming.has(sessionId),
			messageCount: this.messages.get(sessionId)?.length ?? 0,
			contextPercent: 12,
			contextWindow: 200_000,
			activeToolNames: [],
			model: this.model as unknown as SessionStateSnapshot["model"],
		};
	}
	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
		const set = this.handlers.get(sessionId) ?? new Set();
		set.add(handler);
		this.handlers.set(sessionId, set);
		return () => set.delete(handler);
	}
	emit(sessionId: string, event: Partial<SessionEvent> & { type: string }): void {
		for (const handler of this.handlers.get(sessionId) ?? []) handler({ sessionId, ...event } as SessionEvent);
	}
	getMessages(sessionId: string): Message[] {
		return this.messages.get(sessionId) ?? [];
	}
	getFullHistory(sessionId: string): HistoryEntry[] {
		return this.getMessages(sessionId).map((message) => ({ type: "message", message }) as HistoryEntry);
	}
	readSessionHistoryFromFile(): { history: HistoryEntry[] } {
		return { history: [] };
	}
	getRunningSessionPaths(): string[] {
		return [...this.running];
	}
	onRunningChanged(handler: (path: string, running: boolean, sessionId?: string) => void): () => void {
		this.runningHandlers.add(handler);
		return () => this.runningHandlers.delete(handler);
	}
	setRunning(path: string, sessionId: string, running: boolean): void {
		if (running) this.running.add(path);
		else this.running.delete(path);
		for (const handler of this.runningHandlers) handler(path, running, sessionId);
	}
	getSessionPath(sessionId: string): string | undefined {
		return this.paths.get(sessionId);
	}
	async abort(sessionId: string): Promise<void> {
		this.aborted.push(sessionId);
	}
	readSessionAvailableModels() {
		return [
			{
				provider: "anthropic",
				id: "claude-fable-5-1",
				name: "Claude Fable 5.1",
				api: "anthropic-messages",
				reasoning: true,
				input: ["text", "image"],
			},
			{
				provider: "zai",
				id: "glm-5",
				name: "GLM 5",
				api: "zai-openai-completions",
				reasoning: true,
				input: ["text"],
			},
			{ provider: "local", id: "tiny", name: "", api: "openai-completions", reasoning: false, input: ["text"] },
		] as never;
	}
	async updateSettings(sessionId: string, patch: SettingsPatch): Promise<void> {
		this.settings.push({ sessionId, patch });
		if (patch.modelKey) {
			const [provider, id] = patch.modelKey.split("/");
			this.model = { provider: provider ?? "", id: id ?? "", name: id ?? "" };
		}
		if (patch.thinkingLevel) this.thinkingLevel = patch.thinkingLevel;
	}
}

function harness() {
	const runtime = new FakeRuntime();
	const broker = new DesktopUserQuestionBroker();
	const emitted: Emitted[] = [];
	const prompts: Array<{ sessionId: string; text: string; attachments?: PromptAttachmentRef[] }> = [];
	const uploads: Array<{ sessionKey: string; kind: string; name: string; bytes: number }> = [];
	const sessionIds = new Map<string, string>([
		[CONVERSATION_PATH, "rt-chat"],
		[PROJECT_PATH, "rt-work"],
	]);
	for (const [path, id] of sessionIds) runtime.paths.set(id, path);
	const names = new Map<string, string>();
	const deleted = new Set<string>();
	const pins = new Map<string, number>();
	const pinListeners = new Set<() => void>();
	const catalogListeners = new Set<() => void>();
	const entries = (cwd: string): DesktopSessionHistoryInfo[] =>
		listedEntries(cwd)
			.filter((entry) => !deleted.has(entry.path))
			.map((entry) => (names.has(entry.path) ? { ...entry, name: names.get(entry.path) } : entry));
	const listedEntries = (cwd: string): DesktopSessionHistoryInfo[] =>
		cwd === CONVERSATION_CWD
			? [
					{
						id: "chat",
						path: CONVERSATION_PATH,
						cwd: CONVERSATION_CWD,
						name: "整理周报",
						firstMessage: "帮我整理周报",
						modifiedAt: 200,
						lastMessagePreview: "已完成",
						access: { readHistory: true, resume: true, rename: true, delete: true },
					},
				]
			: cwd === PROJECT_CWD
				? [
						{
							id: "work",
							path: PROJECT_PATH,
							cwd: PROJECT_CWD,
							firstMessage: "修复登录页 bug",
							modifiedAt: 100,
							access: { readHistory: true, resume: true, rename: true, delete: true },
						},
					]
				: [];
	const open = async (path: string): Promise<DesktopConversationSession> => ({
		sessionId: sessionIds.get(path) ?? "rt-new",
		sessionPath: path,
		cwd: path.startsWith(PROJECT_CWD) ? PROJECT_CWD : CONVERSATION_CWD,
		listCwd: path.startsWith(PROJECT_CWD) ? PROJECT_CWD : CONVERSATION_CWD,
		source: "interactive",
	});
	const mirror = new DesktopRemoteMirror({
		runtime,
		conversations: {
			listSessions: async (cwd) => entries(cwd),
			openSession: open,
			createSession: async (config) => {
				const path = `${config?.cwd ?? CONVERSATION_CWD}/.vetta/sessions/new.jsonl`;
				runtime.paths.set("rt-new", path);
				return open(path);
			},
			promptInteractiveSession: async (sessionId, prompt) => {
				prompts.push(
					prompt.attachments
						? { sessionId, text: prompt.text, attachments: prompt.attachments }
						: { sessionId, text: prompt.text },
				);
				return { status: "completed" } as never;
			},
		},
		questions: broker,
		listProjects: async () => [{ cwd: PROJECT_CWD, name: "project" }],
		conversationCwd: CONVERSATION_CWD,
		conversationLabel: "对话",
		isConversationCwd: (cwd) => cwd.startsWith(CONVERSATION_CWD),
		emit: async (name, payload, sessionId) => {
			emitted.push({ name, payload, sessionId });
		},
		deviceStatus: () => ({ deviceName: "MacBook", lanEndpoints: [], relayEnabled: true, runningSessionCount: 0 }),
		saveUpload: async (sessionKey, upload) => {
			uploads.push({ sessionKey, kind: upload.kind, name: upload.name, bytes: upload.bytes.byteLength });
			return `/uploads/${uploads.length}/${upload.name}`;
		},
		sessionCommands: {
			rename: async (path, name) => void names.set(path, name),
			delete: async (path) => void deleted.add(path),
		},
		pins: {
			list: () => pins,
			set: (path, pinned) => {
				if (pinned) pins.set(path, pins.size + 1);
				else pins.delete(path);
				for (const listener of pinListeners) listener();
			},
			onChanged: (listener) => {
				pinListeners.add(listener);
				return () => pinListeners.delete(listener);
			},
		},
		onCatalogChanged: (listener) => {
			catalogListeners.add(listener);
			return () => catalogListeners.delete(listener);
		},
		coalesceMs: 5,
		listRefreshMs: 5,
	});
	const request = (method: RemoteRequest["method"], payload?: unknown, sessionId?: string) =>
		mirror.handleRequest({ type: "request", requestId: "r", method, payload, sessionId });
	const changeCatalog = () => {
		for (const listener of catalogListeners) listener();
	};
	return { runtime, broker, emitted, prompts, uploads, mirror, request, names, deleted, pins, changeCatalog };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 15));

describe("DesktopRemoteMirror", () => {
	it("lists sessions across the conversation root and every project with opaque ids", async () => {
		const { mirror, request, runtime } = harness();
		await mirror.start();
		runtime.running.add(PROJECT_PATH);
		const result = (await request("session.list")) as { sessions: Array<Record<string, unknown>> };
		expect(
			result.sessions.map((session) => [session.id, session.title, session.projectName, session.status]),
		).toEqual([
			[keyForPath(CONVERSATION_PATH), "整理周报", "对话", "idle"],
			[keyForPath(PROJECT_PATH), "修复登录页 bug", "project", "running"],
		]);
		expect(JSON.stringify(result)).not.toContain(".jsonl");
		const projects = (await request("project.list")) as { projects: Array<Record<string, unknown>> };
		expect(projects.projects.map((project) => [project.name, project.kind, project.sessionCount])).toEqual([
			["对话", "conversation", 1],
			["project", "project", 1],
		]);
		mirror.stop();
	});

	it("runs a phone-originated turn: echoes the prompt, streams coalesced text and tool phases, ends the turn", async () => {
		const { mirror, request, runtime, emitted, prompts } = harness();
		await mirror.start();
		await request("session.list");
		const key = keyForPath(CONVERSATION_PATH);

		const opened = (await request("session.open", undefined, key)) as { state: { status: string; model?: string } };
		expect(opened.state).toMatchObject({ status: "idle", model: "Claude Fable 5.1" });

		await request("session.prompt", { text: "继续" }, key);
		expect(prompts).toEqual([{ sessionId: "rt-chat", text: "继续" }]);
		expect(
			emitted.map((event) => [
				event.name,
				(event.payload as { kind?: string; status?: string }).kind ?? (event.payload as { status?: string }).status,
			]),
		).toEqual([
			["session.message", "user"],
			["session.state", "running"],
		]);
		emitted.length = 0;

		// The runtime now reports the turn; the user message must not be echoed twice.
		runtime.messages.set("rt-chat", [{ role: "user", content: "继续", timestamp: 5 } as Message]);
		runtime.emit("rt-chat", { type: "session.lifecycle", phase: "agent_start" } as never);
		runtime.emit("rt-chat", { type: "message.delta", delta: "好" } as never);
		runtime.emit("rt-chat", { type: "message.delta", delta: "的，" } as never);
		runtime.emit("rt-chat", {
			type: "tool.start",
			toolCallId: "t1",
			toolName: "web_search",
			args: { q: "x" },
		} as never);
		runtime.emit("rt-chat", {
			type: "tool.end",
			toolCallId: "t1",
			toolName: "web_search",
			isError: false,
			result: "ok",
			durationMs: 12,
		} as never);
		runtime.emit("rt-chat", { type: "message.delta", delta: "完成了。" } as never);
		runtime.emit("rt-chat", { type: "session.lifecycle", phase: "agent_end" } as never);
		await flush();

		const names = emitted
			.filter((event) => event.name !== "session.list")
			.map((event) => `${event.name}:${JSON.stringify(event.payload)}`);
		expect(names.filter((name) => name.includes('"kind":"user"'))).toEqual([]);
		expect(names).toContain('session.message:{"kind":"assistant_delta","text":"好的，"}');
		expect(names).toContain(
			'session.tool:{"toolCallId":"t1","toolName":"web_search","phase":"started","args":"{\\"q\\":\\"x\\"}"}',
		);
		expect(names).toContain('session.message:{"kind":"assistant_delta","text":"完成了。"}');
		expect(names.some((name) => name.startsWith('session.message:{"kind":"turn_end"'))).toBe(true);
		expect(names.at(-1)).toBe('session.state:{"status":"completed"}');
		expect(emitted.filter((event) => event.name !== "session.list").every((event) => event.sessionId === key)).toBe(
			true,
		);
		mirror.stop();
	});

	it("replays a desktop-originated user message and relays questions both ways", async () => {
		const { mirror, request, runtime, emitted, broker } = harness();
		await mirror.start();
		await request("session.list");
		const key = keyForPath(PROJECT_PATH);

		// The desktop window starts a turn: the mirror follows it via running-changed.
		runtime.messages.set("rt-work", [{ role: "user", content: "把测试跑一遍", timestamp: 10 } as Message]);
		runtime.setRunning(PROJECT_PATH, "rt-work", true);
		await flush();
		runtime.emit("rt-work", { type: "session.lifecycle", phase: "agent_start" } as never);
		await flush();
		expect(
			emitted.some(
				(event) => event.name === "session.message" && (event.payload as { text?: string }).text === "把测试跑一遍",
			),
		).toBe(true);
		expect(emitted.some((event) => event.name === "session.list")).toBe(true);
		emitted.length = 0;

		broker.setInteractiveHandler(() => new Promise(() => undefined));
		const pending = broker.handle({
			requestId: "q1",
			sessionId: "rt-work",
			questions: [{ question: "覆盖旧文件？", header: "确认", options: [{ label: "是", description: "" }] }],
		});
		await flush();
		expect(emitted.map((event) => event.name)).toEqual(["session.input", "session.state"]);
		expect(emitted[1]?.payload).toMatchObject({ status: "waiting_input", pendingQuestion: { requestId: "q1" } });

		// The turn keeps reporting usage while it waits; that must not tell the phone the question is gone.
		runtime.emit("rt-work", { type: "usage.update", contextPercent: 40 } as never);
		await flush();
		expect(emitted[2]).toMatchObject({
			name: "session.state",
			payload: { status: "waiting_input", contextPercent: 40, pendingQuestion: { requestId: "q1" } },
		});
		emitted.splice(2);

		await request(
			"session.respond",
			{ requestId: "q1", cancelled: false, answers: [{ question: "覆盖旧文件？", answers: ["是"] }] },
			key,
		);
		await expect(pending).resolves.toEqual({
			cancelled: false,
			answers: [{ question: "覆盖旧文件？", answers: ["是"] }],
		});
		await flush();
		expect(emitted.map((event) => event.name)).toEqual([
			"session.input",
			"session.state",
			"session.input",
			"session.state",
		]);
		expect(emitted[2]?.payload).toEqual({ kind: "resolved", requestId: "q1" });
		expect(emitted[3]?.payload).not.toHaveProperty("pendingQuestion");

		await request("session.abort", undefined, key);
		expect(runtime.aborted).toEqual(["rt-work"]);
		mirror.stop();
	});

	it("hands a prompt the pictures and files the phone uploaded first, each upload used once", async () => {
		const { mirror, request, prompts, uploads } = harness();
		await mirror.start();
		await request("session.list");
		const key = keyForPath(CONVERSATION_PATH);
		const photo = (await request(
			"session.upload",
			{
				kind: "image",
				name: "photo.jpg",
				mimeType: "image/jpeg",
				data: Buffer.from("jpeg bytes").toString("base64"),
			},
			key,
		)) as { uploadId: string };
		const notes = (await request(
			"session.upload",
			{ kind: "file", name: "notes.txt", mimeType: "text/plain", data: Buffer.from("hello").toString("base64") },
			key,
		)) as { uploadId: string };
		expect(uploads).toEqual([
			{ sessionKey: key, kind: "image", name: "photo.jpg", bytes: 10 },
			{ sessionKey: key, kind: "file", name: "notes.txt", bytes: 5 },
		]);

		await request("session.prompt", { text: "看看这些", attachments: [photo.uploadId, notes.uploadId] }, key);
		expect(prompts).toEqual([
			{
				sessionId: "rt-chat",
				text: "看看这些",
				attachments: [
					{ kind: "image", path: "/uploads/1/photo.jpg" },
					{ kind: "file", path: "/uploads/2/notes.txt" },
				],
			},
		]);
		await expect(
			request("session.prompt", { text: "again", attachments: [photo.uploadId] }, key),
		).rejects.toMatchObject({ code: "not_found" });
		mirror.stop();
	});

	it("refuses uploads that are empty, oversized, or used from another session", async () => {
		const { mirror, request } = harness();
		await mirror.start();
		await request("session.list");
		const chat = keyForPath(CONVERSATION_PATH);
		const work = keyForPath(PROJECT_PATH);
		await expect(request("session.upload", { kind: "file", name: "x", data: "" }, chat)).rejects.toMatchObject({
			code: "invalid_frame",
		});
		const huge = Buffer.alloc(800 * 1024).toString("base64");
		await expect(request("session.upload", { kind: "file", name: "x", data: huge }, chat)).rejects.toMatchObject({
			code: "invalid_frame",
		});
		const upload = (await request(
			"session.upload",
			{ kind: "file", name: "a.txt", mimeType: "text/plain", data: Buffer.from("a").toString("base64") },
			chat,
		)) as { uploadId: string };
		await expect(
			request("session.prompt", { text: "hi", attachments: [upload.uploadId] }, work),
		).rejects.toMatchObject({ code: "not_found" });
		mirror.stop();
	});

	it("lists models with the desktop's thinking menu and switches model and level", async () => {
		const { mirror, request, runtime } = harness();
		await mirror.start();
		await request("session.list");
		const key = keyForPath(CONVERSATION_PATH);
		const listed = (await request("model.list", undefined, key)) as { models: Array<Record<string, unknown>> };
		expect(listed.models.map((model) => [model.key, model.name, model.thinkingLevels, model.supportsImage])).toEqual([
			["anthropic/claude-fable-5-1", "Claude Fable 5.1", ["off", "low", "medium", "high"], true],
			["zai/glm-5", "GLM 5", ["none", "minimal", "low", "medium", "high", "max"], false],
			["local/tiny", "tiny", [], false],
		]);

		const configured = (await request("session.configure", { modelKey: "zai/glm-5", thinkingLevel: "max" }, key)) as {
			state: Record<string, unknown>;
		};
		expect(runtime.settings).toEqual([
			{ sessionId: "rt-chat", patch: { modelKey: "zai/glm-5", thinkingLevel: "max" } },
		]);
		expect(configured.state).toMatchObject({ modelKey: "zai/glm-5", thinkingLevel: "max" });
		await expect(request("session.configure", { modelKey: "nope/none" }, key)).rejects.toMatchObject({
			code: "not_found",
		});
		runtime.streaming.add("rt-chat");
		await expect(request("session.configure", { thinkingLevel: "low" }, key)).rejects.toMatchObject({ code: "busy" });
		mirror.stop();
	});

	it("rejects prompts for busy sessions and unknown ids with protocol-mappable errors", async () => {
		const { mirror, request, runtime } = harness();
		await mirror.start();
		await request("session.list");
		const key = keyForPath(CONVERSATION_PATH);
		await request("session.open", undefined, key);
		runtime.streaming.add("rt-chat");
		await expect(request("session.prompt", { text: "again" }, key)).rejects.toMatchObject({ code: "busy" });
		await expect(request("session.open", undefined, "nope")).rejects.toMatchObject({ code: "not_found" });
		mirror.stop();
	});

	it("renames a session the way the sidebar does and returns the new title", async () => {
		const { mirror, request, names } = harness();
		await mirror.start();
		await request("session.list");
		const key = keyForPath(PROJECT_PATH);
		const renamed = (await request("session.rename", { title: "  修登录页  " }, key)) as {
			session: { title: string };
		};
		expect(names.get(PROJECT_PATH)).toBe("修登录页");
		expect(renamed.session.title).toBe("修登录页");
		await expect(request("session.rename", { title: "   " }, key)).rejects.toMatchObject({ code: "invalid_frame" });
		mirror.stop();
	});

	it("pins and unpins through the desktop's pins and keeps pinned sessions listed", async () => {
		const { mirror, request, emitted } = harness();
		await mirror.start();
		await request("session.list");
		const key = keyForPath(PROJECT_PATH);
		const pinned = (await request("session.pin", { pinned: true }, key)) as { session: { pinnedAt?: number } };
		expect(pinned.session.pinnedAt).toBe(1);
		await flush();
		expect(emitted.some((event) => event.name === "session.list")).toBe(true);
		const unpinned = (await request("session.pin", { pinned: false }, key)) as { session: { pinnedAt?: number } };
		expect(unpinned.session.pinnedAt).toBeUndefined();
		mirror.stop();
	});

	it("tells the phone when the desktop pins, renames or deletes a session", async () => {
		const { mirror, request, emitted, pins, changeCatalog } = harness();
		await mirror.start();
		await request("session.list");
		pins.set(CONVERSATION_PATH, 7);
		changeCatalog();
		await flush();
		const lists = emitted.filter((event) => event.name === "session.list");
		expect(lists).toHaveLength(1);
		const sessions = (lists[0]?.payload as { sessions: Array<{ id: string; pinnedAt?: number }> }).sessions;
		expect(sessions.find((session) => session.id === keyForPath(CONVERSATION_PATH))?.pinnedAt).toBe(7);
		mirror.stop();
	});

	it("deletes an idle session and forgets it, but refuses one mid-turn", async () => {
		const { mirror, request, runtime, deleted } = harness();
		await mirror.start();
		await request("session.list");
		const chat = keyForPath(CONVERSATION_PATH);
		await request("session.open", undefined, chat);
		runtime.streaming.add("rt-chat");
		await expect(request("session.delete", undefined, chat)).rejects.toMatchObject({ code: "busy" });
		expect(deleted.size).toBe(0);
		runtime.streaming.delete("rt-chat");
		expect(await request("session.delete", undefined, chat)).toEqual({ deleted: true });
		expect([...deleted]).toEqual([CONVERSATION_PATH]);
		await expect(request("session.open", undefined, chat)).rejects.toMatchObject({ code: "not_found" });
		const list = (await request("session.list")) as { sessions: Array<{ id: string }> };
		expect(list.sessions.map((session) => session.id)).toEqual([keyForPath(PROJECT_PATH)]);
		mirror.stop();
	});

	it("creates a session in the conversation root by default and returns its summary", async () => {
		const { mirror, request } = harness();
		await mirror.start();
		const created = (await request("session.create")) as { session: { id: string; projectName: string } };
		expect(created.session.projectName).toBe("对话");
		expect(created.session.id).toMatch(/^[0-9a-f]{24}$/);
		mirror.stop();
	});

	it("stops cleanly and no longer reacts to runtime events", async () => {
		const { mirror, request, runtime, emitted } = harness();
		await mirror.start();
		await request("session.list");
		await request("session.open", undefined, keyForPath(CONVERSATION_PATH));
		mirror.stop();
		emitted.length = 0;
		runtime.emit("rt-chat", { type: "message.delta", delta: "late" } as never);
		runtime.setRunning(PROJECT_PATH, "rt-work", true);
		await flush();
		expect(emitted).toEqual([]);
	});
});
