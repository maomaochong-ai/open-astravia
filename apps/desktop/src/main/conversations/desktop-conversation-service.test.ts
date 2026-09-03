import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RuntimeHost, runtimeError } from "@vetta/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onConversationListChanged } from "./conversation-list-events.js";
import type { ConversationOwnershipCatalogPort } from "./conversation-ownership-catalog.js";
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
		defaultAgentMode: "work",
		defaultExecutionMode: "sandbox",
		experimental: {},
	}),
}));

vi.mock("../plugins/plugin-catalog.js", () => ({
	pluginAgentContributionService: {
		buildRuntimeConfig: () => undefined,
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => resolvePromise?.(value),
	};
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopConversationService session access", () => {
	it("starts first-message auto-title when the turn is accepted without waiting for the assistant", async () => {
		const promptResult = deferred<{ status: "completed" }>();
		const autoTitleResult = deferred<string | null>();
		let sessionEventHandler: ((event: { type: "session.lifecycle"; phase: "agent_start" }) => void) | undefined;
		const unsubscribe = vi.fn();
		const runtime = {
			getMessages: vi.fn(() => []),
			getSessionPath: vi.fn(() => "C:/sessions/session-1.conversation.jsonl"),
			subscribe: vi.fn((_sessionId, handler) => {
				sessionEventHandler = handler;
				return unsubscribe;
			}),
			prompt: vi.fn(() => promptResult.promise),
			invokeSessionExtension: vi.fn(() => autoTitleResult.promise),
			renameSessionById: vi.fn(async () => {}),
		} as unknown as RuntimeHost;
		const changedEvents: Array<{ cwd: string; sessionPath: string }> = [];
		const stopListening = onConversationListChanged((event) => changedEvents.push(event));
		const service = new DesktopConversationService(runtime);

		try {
			const turn = service.promptInteractiveSession(
				"session-1",
				{ text: "Explain the retry policy" },
				"C:/workspace",
			);
			expect(runtime.invokeSessionExtension).not.toHaveBeenCalled();

			sessionEventHandler?.({ type: "session.lifecycle", phase: "agent_start" });
			expect(runtime.invokeSessionExtension).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({ extensionId: "coding-agent.session-assistance" }),
				{ userText: "Explain the retry policy", assistantText: "" },
			);

			autoTitleResult.resolve("Retry policy");
			await vi.waitFor(() => {
				expect(changedEvents).toEqual([
					{ cwd: "C:/workspace", sessionPath: "C:/sessions/session-1.conversation.jsonl" },
				]);
			});

			// The title task has completed while the agent turn is still unresolved.
			expect(unsubscribe).toHaveBeenCalledOnce();
			promptResult.resolve({ status: "completed" });
			await expect(turn).resolves.toEqual({ status: "completed" });
		} finally {
			stopListening();
		}
	});

	it("does not auto-title a session that already has messages", async () => {
		const runtime = {
			getMessages: vi.fn(() => [{ role: "user" }]),
			getSessionPath: vi.fn(() => "C:/sessions/session-1.conversation.jsonl"),
			subscribe: vi.fn(),
			prompt: vi.fn(async () => ({ status: "completed" as const })),
			invokeSessionExtension: vi.fn(),
		} as unknown as RuntimeHost;
		const service = new DesktopConversationService(runtime);

		await expect(
			service.promptInteractiveSession("session-1", { text: "Second question" }, "C:/workspace"),
		).resolves.toEqual({ status: "completed" });
		expect(runtime.subscribe).not.toHaveBeenCalled();
		expect(runtime.invokeSessionExtension).not.toHaveBeenCalled();
	});

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
			resume: false,
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
					resume: false,
					rename: true,
					delete: true,
				},
			}),
		]);
		expect(resolveSessionAccess).toHaveBeenCalledWith(sessionPath);
	});

	it("removes product-owned Conversations before resolving ordinary-session capabilities", async () => {
		const cwd = await createTemporaryRoot();
		const teamPath = join(cwd, "team.conversation.jsonl");
		const ordinaryPath = join(cwd, "ordinary.conversation.jsonl");
		const listSessions = vi.fn(async () => [
			{ id: "team", path: teamPath, cwd, firstMessage: "team", modifiedAt: 2 },
			{ id: "ordinary", path: ordinaryPath, cwd, firstMessage: "hello", modifiedAt: 1 },
		]);
		const resolveSessionAccess = vi.fn(async () => ({
			readHistory: true,
			resume: true,
			rename: true,
			delete: true,
		}));
		const ownership: Pick<ConversationOwnershipCatalogPort, "filterUserSessions"> = {
			async filterUserSessions<T extends { readonly path: string }>(sessions: readonly T[]): Promise<T[]> {
				return sessions.filter((session) => session.path === ordinaryPath);
			},
		};
		const runtime = { listSessions, resolveSessionAccess } as unknown as RuntimeHost;
		const ensureOwnershipReady = vi.fn(async () => undefined);
		const service = new DesktopConversationService(runtime, ownership, ensureOwnershipReady);

		await expect(service.listSessions(cwd)).resolves.toEqual([expect.objectContaining({ id: "ordinary" })]);
		expect(ensureOwnershipReady).toHaveBeenCalledOnce();
		expect(resolveSessionAccess).toHaveBeenCalledOnce();
		expect(resolveSessionAccess).toHaveBeenCalledWith(ordinaryPath);
	});

	it("rejects direct ordinary-chat opens for Team-owned Conversations", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = join(root, "team.conversation.jsonl");
		await writeFile(sessionPath, "{}\n", "utf8");
		const runtime = {
			resolveSessionAccess: vi.fn(),
			createSession: vi.fn(),
		} as unknown as RuntimeHost;
		const ownership = {
			filterUserSessions: async <T extends { readonly path: string }>(sessions: readonly T[]) => [...sessions],
			getOwner: vi.fn(async () => ({
				kind: "agent-team" as const,
				teamId: "team-1",
				teamSessionId: "team-session-1",
				role: "coordination" as const,
			})),
		};
		const ensureOwnershipReady = vi.fn(async () => undefined);
		const service = new DesktopConversationService(runtime, ownership, ensureOwnershipReady);

		const error = await service.openSession(sessionPath, "sandbox", "interactive").catch((reason: unknown) => reason);

		expect(error).toMatchObject<Partial<DesktopConversationError>>({
			code: "INVALID_SESSION_PATH",
			details: { teamId: "team-1", teamSessionId: "team-session-1" },
		});
		expect(ensureOwnershipReady).toHaveBeenCalledOnce();
		expect(runtime.resolveSessionAccess).not.toHaveBeenCalled();
		expect(runtime.createSession).not.toHaveBeenCalled();
	});

	it("rejects direct ordinary-session creation from a Team-owned path", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = join(root, "team.conversation.jsonl");
		const runtime = { createSession: vi.fn() } as unknown as RuntimeHost;
		const ownership = {
			filterUserSessions: async <T extends { readonly path: string }>(sessions: readonly T[]) => [...sessions],
			getOwner: vi.fn(async () => ({
				kind: "agent-team" as const,
				teamId: "team-1",
				teamSessionId: "team-session-1",
				role: "member" as const,
			})),
		};
		const ensureOwnershipReady = vi.fn(async () => undefined);
		const service = new DesktopConversationService(runtime, ownership, ensureOwnershipReady);

		const error = await service
			.createSession({ cwd: root, sessionPath }, "other", "interactive")
			.catch((reason: unknown) => reason);

		expect(error).toMatchObject<Partial<DesktopConversationError>>({
			code: "INVALID_SESSION_PATH",
			details: { teamId: "team-1", teamSessionId: "team-session-1" },
		});
		expect(ensureOwnershipReady).toHaveBeenCalledOnce();
		expect(runtime.createSession).not.toHaveBeenCalled();
	});

	it("rejects history-only sessions before handing them to the interactive backend", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = join(root, "readonly.conversation.jsonl");
		await writeFile(sessionPath, "{}\n", "utf8");
		const runtime = {
			resolveSessionAccess: vi.fn(async () => ({
				readHistory: true,
				resume: false,
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

	it("preserves structured provider diagnostics when a turn is rejected", async () => {
		const runtime = {
			getState: vi.fn(() => ({ isStreaming: false })),
			getMessages: vi.fn(() => []),
			prompt: vi.fn(async () => {
				throw runtimeError("INTERNAL_ERROR", "quota exhausted", false, "provider", {
					statusCode: 402,
					provider: "deepseek",
					modelId: "deepseek-chat",
					providerCode: "insufficient_quota",
				});
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

		expect(error).toMatchObject({
			code: "TURN_FAILED",
			details: {
				code: "INTERNAL_ERROR",
				retryable: false,
				origin: "provider",
				details: { statusCode: 402, provider: "deepseek", modelId: "deepseek-chat" },
			},
		});
	});

	it("runs manual context compaction through the RuntimeHost control port", async () => {
		const compactSessionContext = vi.fn(async () => ({
			summary: "summary",
			firstKeptEntryId: "entry-2",
			tokensBefore: 91_000,
		}));
		const runtime = {
			getState: vi.fn(() => ({ contextTokens: 91_000, contextWindow: 100_000 })),
			compactSessionContext,
			abortSessionContextCompaction: vi.fn(),
		} as unknown as RuntimeHost;
		const service = new DesktopConversationService(runtime);

		const result = await service.compactSessionContext(
			{
				sessionId: "session-1",
				sessionPath: "C:/sessions/session-1.conversation.jsonl",
				cwd: "C:/workspace",
				listCwd: "C:/workspace",
				source: "debug",
			},
			"preserve decisions",
		);

		expect(result).toMatchObject({ tokensBefore: 91_000, firstKeptEntryId: "entry-2" });
		expect(compactSessionContext).toHaveBeenCalledWith("session-1", {
			customInstructions: "preserve decisions",
		});
	});
});

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-desktop-session-access-"));
	temporaryRoots.push(root);
	return root;
}
