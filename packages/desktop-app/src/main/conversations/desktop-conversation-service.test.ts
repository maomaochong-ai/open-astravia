import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RuntimeHost, runtimeError } from "@vetta/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DesktopConversationError, DesktopConversationService } from "./desktop-conversation-service.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({
		debug: () => undefined,
		error: () => undefined,
		info: () => undefined,
		warn: () => undefined,
	}),
}));

vi.mock("../app-monitor/app-monitor-service.js", () => ({
	monitorRuntimeSession: () => undefined,
}));

vi.mock("../ipc/fs.js", () => ({
	allowProjectRoot: () => undefined,
	DEFAULT_CONVERSATION_CWD: "C:/vetta/conversation",
	DEFAULT_CONVERSATION_SESSION_DIR: "C:/vetta/conversation/.vetta/sessions",
	DEFAULT_IM_CONVERSATION_CWD: "C:/vetta/im",
	DEFAULT_IM_CONVERSATION_SESSION_DIR: "C:/vetta/im/.vetta/sessions",
	KB_PROCESSING_CWD: "C:/vetta/knowledge",
	KB_PROCESSING_SESSION_DIR: "C:/vetta/knowledge/.vetta/sessions",
	readDesktopConfig: async () => ({
		agentMode: "work",
		defaultExecutionMode: "sandbox",
		experimental: {},
	}),
}));

vi.mock("../plugins/plugin-catalog.js", () => ({
	pluginAgentContributionService: {
		buildRuntimeConfig: () => undefined,
		setAgentMode: () => undefined,
	},
}));

vi.mock("../runtime.js", () => ({
	getSharedRuntime: () => {
		throw new Error("Unexpected shared runtime access in unit test");
	},
}));

vi.mock("../sandbox/capability.js", () => ({
	assertSandboxAvailableForMode: async () => undefined,
}));

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopConversationService session access", () => {
	it("adds host capabilities to listed sessions", async () => {
		const cwd = await createTemporaryRoot();
		const sessionPath = join(cwd, "session.jsonl");
		const listSessions = vi.fn(async () => [
			{
				id: "session-1",
				path: sessionPath,
				cwd,
				firstMessage: "hello",
				modifiedAt: 1,
			},
		]);
		const resolveSessionAccess = vi.fn(async () => ({
			readHistory: true,
			interactiveResume: false,
			rename: true,
			delete: true,
		}));
		const runtime = { listSessions, resolveSessionAccess } as unknown as RuntimeHost;
		const service = new DesktopConversationService(runtime);

		expect(await service.listSessions(cwd)).toEqual([
			expect.objectContaining({
				id: "session-1",
				access: {
					readHistory: true,
					interactiveResume: false,
					rename: true,
					delete: true,
				},
			}),
		]);
		expect(resolveSessionAccess).toHaveBeenCalledWith(sessionPath);
	});

	it("rejects history-only sessions before handing them to the interactive backend", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = join(root, "readonly.conversation.jsonl");
		await writeFile(sessionPath, "{}\n", "utf8");
		const runtime = {
			resolveSessionAccess: vi.fn(async () => ({
				readHistory: true,
				interactiveResume: false,
				rename: true,
				delete: true,
			})),
			createSession: vi.fn(),
		} as unknown as RuntimeHost;
		const service = new DesktopConversationService(runtime);

		const error = await service.openSession(sessionPath, "sandbox", "interactive").catch((reason: unknown) => reason);
		expect(error).toMatchObject<Partial<DesktopConversationError>>({ code: "SESSION_READ_ONLY" });
		expect(runtime.createSession).not.toHaveBeenCalled();
	});

	it("maps session ownership conflicts by runtime code instead of error name", async () => {
		const cwd = await createTemporaryRoot();
		const runtime = {
			createSession: vi.fn(async () => {
				throw runtimeError("SESSION_LOCKED", "this message may change", false);
			}),
		} as unknown as RuntimeHost;
		const service = new DesktopConversationService(runtime);

		const error = await service.createSession({ cwd }, "other", "interactive").catch((reason: unknown) => reason);
		expect(error).toMatchObject<Partial<DesktopConversationError>>({ code: "SESSION_LOCKED" });
	});

	it("maps concurrent turns by runtime code instead of error message", async () => {
		const runtime = {
			getState: vi.fn(() => ({ isStreaming: false })),
			getMessages: vi.fn(() => []),
			prompt: vi.fn(async () => {
				throw runtimeError("SESSION_BUSY", "unrelated wording", true);
			}),
			abort: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const service = new DesktopConversationService(runtime);

		const error = await service
			.runTurn({
				session: {
					sessionId: "session-1",
					sessionPath: "C:/sessions/session-1.conversation.jsonl",
					cwd: "C:/workspace",
					listCwd: "C:/workspace",
					source: "interactive",
				},
				prompt: { text: "hello" },
				timeoutMs: 1_000,
			})
			.catch((reason: unknown) => reason);
		expect(error).toMatchObject<Partial<DesktopConversationError>>({ code: "SESSION_BUSY" });
	});
});

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-desktop-session-access-"));
	temporaryRoots.push(root);
	return root;
}
