import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Message, Model } from "@vetta/ai";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { type HistoryEntry, RuntimeHost, type SessionEvent } from "@vetta/runtime-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "../../../../cli-app/test/support/openai-responses-test-server.js";
import { DesktopRuntimeBackendPool } from "./backend-pool.js";

interface RuntimeFixture {
	readonly runtime: RuntimeHost;
	readonly dispose: () => Promise<void>;
}

describe("Desktop RuntimeHost production contract", () => {
	const directories: string[] = [];
	const fixtures: RuntimeFixture[] = [];

	afterEach(async () => {
		for (const fixture of fixtures.splice(0).reverse()) await fixture.dispose();
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	for (const backend of ["runtime"] as const) {
		it(`${backend} preserves the common Desktop host lifecycle contract`, async () => {
			const cwd = await temporaryDirectory(`desktop-${backend}-contract-workspace-`);
			const sessionDir = await temporaryDirectory(`desktop-${backend}-contract-sessions-`);
			const agentStateDir = await temporaryDirectory(`desktop-${backend}-contract-agent-`);
			const fixture = createRuntimeFixture(backend, agentStateDir);
			fixtures.push(fixture);

			const created = await fixture.runtime.createSession({
				cwd,
				sessionDir,
				model: MODEL,
				thinkingLevel: "medium",
				scenario: "batch",
				executionMode: "full-access",
				enableBackgroundTasks: false,
				includeAgentSkills: false,
			});
			const sessionPath = fixture.runtime.getSessionPath(created.sessionId);
			if (!sessionPath) throw new Error(`${backend} did not expose a session path`);

			expect(fixture.runtime.getState(created.sessionId)).toMatchObject({
				sessionId: created.sessionId,
				model: MODEL,
				thinkingLevel: "medium",
				executionMode: "full-access",
				scenario: "batch",
				isStreaming: false,
				messageCount: 0,
			});
			expect(fixture.runtime.getMessages(created.sessionId)).toEqual([]);
			expect(fixture.runtime.getFullHistory(created.sessionId)).toEqual([]);

			await fixture.runtime.updateSettings(created.sessionId, {
				thinkingLevel: "low",
				steeringMode: "all",
				followUpMode: "one-at-a-time",
			});
			expect(fixture.runtime.getState(created.sessionId).thinkingLevel).toBe("low");

			await fixture.runtime.disposeSession(created.sessionId);
			await fixture.runtime.disposeSession(created.sessionId);
			const resumed = await fixture.runtime.createSession({
				cwd,
				sessionDir,
				sessionPath,
				model: MODEL,
				scenario: "batch",
				executionMode: "full-access",
				enableBackgroundTasks: false,
				includeAgentSkills: false,
			});
			expect(fixture.runtime.getSessionPath(resumed.sessionId)).toBe(sessionPath);
			expect(fixture.runtime.getFullHistory(resumed.sessionId)).toEqual([]);
		}, 30_000);
	}

	it("preserves real Tool Loop events, persistence and host-restart recovery", async () => {
		const observations: Record<"runtime", RuntimeLifecycleObservation> = {
			runtime: emptyLifecycleObservation(),
		};

		for (const backend of ["runtime"] as const) {
			const cwd = await temporaryDirectory(`desktop-${backend}-turn-workspace-`);
			const sessionDir = await temporaryDirectory(`desktop-${backend}-turn-sessions-`);
			const agentStateDir = await temporaryDirectory(`desktop-${backend}-turn-agent-`);
			const sourcePath = join(cwd, "message.txt");
			await writeFile(sourcePath, "desktop tool fixture content", "utf8");
			const server = await startOpenAiResponsesTestServer((_request, index) => {
				if (index === 0) {
					return { kind: "events", events: toolCallResponseEvents("read", { path: sourcePath }) };
				}
				return {
					kind: "events",
					events: textResponseEvents(index === 1 ? "The Desktop file was read." : "The Desktop session resumed."),
				};
			});
			const model = { ...MODEL, baseUrl: server.baseUrl };
			const fixture = createRuntimeFixture(backend, agentStateDir, model);
			fixtures.push(fixture);

			try {
				const created = await fixture.runtime.createSession({
					cwd,
					sessionDir,
					model,
					scenario: "batch",
					executionMode: "full-access",
					enableBackgroundTasks: false,
					includeAgentSkills: false,
				});
				const events: SessionEvent[] = [];
				const unsubscribe = fixture.runtime.subscribe(created.sessionId, (event) => events.push(event));

				await fixture.runtime.prompt(created.sessionId, { text: "Read message.txt" });
				unsubscribe();

				expect(server.requests).toHaveLength(2);
				expect(JSON.stringify(server.requests[1]?.body.input)).toContain("desktop tool fixture content");
				const sessionPath = fixture.runtime.getSessionPath(created.sessionId);
				if (!sessionPath) throw new Error(`${backend} did not persist the Tool Loop session`);
				const messagesBeforeResume = fixture.runtime.getMessages(created.sessionId);
				const initial = observeTurn(events, messagesBeforeResume, cwd);

				await fixture.dispose();
				const restartedFixture = createRuntimeFixture(backend, agentStateDir, model);
				fixtures.push(restartedFixture);
				const resumed = await restartedFixture.runtime.createSession({
					cwd,
					sessionDir,
					sessionPath,
					model,
					scenario: "batch",
					executionMode: "full-access",
					enableBackgroundTasks: false,
					includeAgentSkills: false,
				});
				const restoredMessages = restartedFixture.runtime.getMessages(resumed.sessionId);
				const resumedEvents: SessionEvent[] = [];
				const unsubscribeResumed = restartedFixture.runtime.subscribe(resumed.sessionId, (event) =>
					resumedEvents.push(event),
				);
				await restartedFixture.runtime.prompt(resumed.sessionId, { text: "Continue after host restart" });
				unsubscribeResumed();
				expect(server.requests).toHaveLength(3);
				const resumedProviderInput = JSON.stringify(server.requests[2]?.body.input);
				observations[backend] = {
					initial,
					resumed: observeTurn(resumedEvents, restartedFixture.runtime.getMessages(resumed.sessionId), cwd),
					historyRestoredBeforePrompt:
						JSON.stringify(observeMessages(restoredMessages)) ===
						JSON.stringify(observeMessages(messagesBeforeResume)),
					sessionIdentityRestored: resumed.sessionId === created.sessionId,
					resumedProviderSawPriorToolResult: resumedProviderInput.includes("desktop tool fixture content"),
					resumedProviderSawPriorAssistant: resumedProviderInput.includes("The Desktop file was read."),
				};
			} finally {
				await server.dispose();
			}
		}

		expect(observations.runtime).toMatchObject({
			initial: {
				lifecycle: ["created", "agent_start", "turn_start", "turn_end", "turn_start", "turn_end", "agent_end"],
				finalAssistantText: "The Desktop file was read.",
				tools: [{ name: "read", isError: false }],
				messageRoles: ["user", "assistant", "toolResult", "assistant"],
			},
			resumed: {
				lifecycle: ["created", "agent_start", "turn_start", "turn_end", "agent_end"],
				finalAssistantText: "The Desktop session resumed.",
				tools: [],
				messageRoles: ["user", "assistant", "toolResult", "assistant", "user", "assistant"],
			},
			historyRestoredBeforePrompt: true,
			sessionIdentityRestored: true,
			resumedProviderSawPriorToolResult: true,
			resumedProviderSawPriorAssistant: true,
		});
		expect(observations.runtime.initial.events.map(({ type }) => type)).toEqual([
			"session.lifecycle",
			"active_tools_update",
			"mcp.reload.start",
			"mcp.reload.end",
			"session.lifecycle",
			"session.lifecycle",
			"toolcall.start",
			"message.final",
			"usage.update",
			"tool.start",
			"tool.end",
			"session.lifecycle",
			"session.lifecycle",
			"message.delta",
			"message.final",
			"usage.update",
			"session.lifecycle",
			"session.lifecycle",
		]);
	}, 30_000);

	it("preserves history mutations, forks and resumed Provider context", async () => {
		const observations: Partial<Record<"runtime", RuntimeHistoryMutationObservation>> = {};

		for (const backend of ["runtime"] as const) {
			const cwd = await temporaryDirectory(`desktop-${backend}-history-workspace-`);
			const sessionDir = await temporaryDirectory(`desktop-${backend}-history-sessions-`);
			const agentStateDir = await temporaryDirectory(`desktop-${backend}-history-agent-`);
			const responses = [
				"assistant-one",
				"assistant-original",
				"assistant-edited",
				"assistant-replacement",
				"assistant-parent-resumed",
				"assistant-child-resumed",
			];
			const server = await startOpenAiResponsesTestServer((_request, index) =>
				index === responses.length
					? { kind: "hold" }
					: { kind: "events", events: textResponseEvents(responses[index] ?? `unexpected-${index}`) },
			);
			const model = { ...MODEL, baseUrl: server.baseUrl };
			const fixture = createRuntimeFixture(backend, agentStateDir, model);
			fixtures.push(fixture);

			try {
				const created = await fixture.runtime.createSession({
					cwd,
					sessionDir,
					model,
					scenario: "conversation",
					executionMode: "full-access",
					enableBackgroundTasks: false,
					includeAgentSkills: false,
				});
				const parentPath = fixture.runtime.getSessionPath(created.sessionId);
				if (!parentPath) throw new Error(`${backend} did not persist the history session`);

				await fixture.runtime.prompt(created.sessionId, { text: "first-user" });
				const firstAssistantId = requireMessageEntryId(
					fixture.runtime,
					created.sessionId,
					"assistant",
					"assistant-one",
				);
				await fixture.runtime.prompt(created.sessionId, { text: "original-user" });
				const originalUserId = requireMessageEntryId(fixture.runtime, created.sessionId, "user", "original-user");
				const navigation = await captureSessionEvents(fixture.runtime, created.sessionId, () =>
					fixture.runtime.navigateForEdit(created.sessionId, originalUserId),
				);
				expect(navigation.result).toEqual({ text: "original-user", cancelled: false });
				expect(observeHistory(fixture.runtime.getFullHistory(created.sessionId))).toEqual([
					historyMessage("user", "first-user", null),
					historyMessage("assistant", "assistant-one", 0),
				]);

				await fixture.runtime.prompt(created.sessionId, { text: "edited-user" });
				expect(observeHistory(fixture.runtime.getFullHistory(created.sessionId))).toEqual([
					historyMessage("user", "first-user", null),
					historyMessage("assistant", "assistant-one", 0),
					historyMessage("user", "edited-user", 1),
					historyMessage("assistant", "assistant-edited", 2),
				]);

				const switched = await captureSessionEvents(fixture.runtime, created.sessionId, () =>
					fixture.runtime.switchBranch(created.sessionId, originalUserId),
				);
				expect(switched.result.leafId).toBeTruthy();
				expect(observeHistory(fixture.runtime.getFullHistory(created.sessionId))).toEqual([
					historyMessage("user", "first-user", null),
					historyMessage("assistant", "assistant-one", 0),
					historyMessage("user", "original-user", 1),
					historyMessage("assistant", "assistant-original", 2),
				]);

				const deleted = await captureSessionEvents(fixture.runtime, created.sessionId, () =>
					fixture.runtime.deleteMessage(created.sessionId, firstAssistantId),
				);
				expect(deleted.result.leafId).toBeTruthy();
				expect(observeHistory(fixture.runtime.getFullHistory(created.sessionId))).toEqual([
					historyMessage("user", "first-user", null),
					historyMessage("user", "original-user", 0),
					historyMessage("assistant", "assistant-original", 1),
				]);

				const replaced = await captureSessionEvents(fixture.runtime, created.sessionId, () =>
					fixture.runtime.replaceLastUserMessage(created.sessionId, originalUserId),
				);
				expect(replaced.result.leafId).toBeTruthy();
				expect(observeHistory(fixture.runtime.getFullHistory(created.sessionId))).toEqual([
					historyMessage("user", "first-user", null),
				]);

				await fixture.runtime.prompt(created.sessionId, { text: "replacement-user" });
				const replacementUserId = requireMessageEntryId(
					fixture.runtime,
					created.sessionId,
					"user",
					"replacement-user",
				);
				const parentBeforeFork = await readFile(parentPath);
				const forked = await captureSessionEvents(fixture.runtime, created.sessionId, () =>
					fixture.runtime.forkSession(created.sessionId, replacementUserId),
				);
				expect(forked.result.text).toBe("replacement-user");
				expect(await readFile(parentPath)).toEqual(parentBeforeFork);

				const parentBeforeRestart = observeHistory(fixture.runtime.getFullHistory(created.sessionId));
				await fixture.dispose();
				const restartedFixture = createRuntimeFixture(backend, agentStateDir, model);
				fixtures.push(restartedFixture);
				const resumedParent = await restartedFixture.runtime.createSession({
					cwd,
					sessionDir,
					sessionPath: parentPath,
					model,
					scenario: "conversation",
					executionMode: "full-access",
					enableBackgroundTasks: false,
					includeAgentSkills: false,
				});
				const resumedChild = await restartedFixture.runtime.createSession({
					cwd,
					sessionDir,
					sessionPath: forked.result.path,
					model,
					scenario: "conversation",
					executionMode: "full-access",
					enableBackgroundTasks: false,
					includeAgentSkills: false,
				});
				const parentRestored = observeHistory(restartedFixture.runtime.getFullHistory(resumedParent.sessionId));
				const childRestored = observeHistory(restartedFixture.runtime.getFullHistory(resumedChild.sessionId));

				await restartedFixture.runtime.prompt(resumedParent.sessionId, { text: "parent-after-restart" });
				await restartedFixture.runtime.prompt(resumedChild.sessionId, { text: "child-after-restart" });
				expect(server.requests).toHaveLength(6);
				const parentProviderInput = server.requests[4]?.rawBody ?? "";
				const childProviderInput = server.requests[5]?.rawBody ?? "";
				const lastParentUserId = requireMessageEntryId(
					restartedFixture.runtime,
					resumedParent.sessionId,
					"user",
					"parent-after-restart",
				);
				const busyPrompt = restartedFixture.runtime.prompt(resumedParent.sessionId, { text: "busy-user" });
				await waitForProviderRequestCount(server.requests, 7);
				await delay(25);
				const busyHistory = observeHistory(restartedFixture.runtime.getFullHistory(resumedParent.sessionId));
				const busyErrors = await Promise.all([
					captureErrorMessage(() =>
						restartedFixture.runtime.navigateForEdit(resumedParent.sessionId, replacementUserId),
					),
					captureErrorMessage(() =>
						restartedFixture.runtime.switchBranch(resumedParent.sessionId, replacementUserId),
					),
					captureErrorMessage(() =>
						restartedFixture.runtime.deleteMessage(resumedParent.sessionId, replacementUserId),
					),
					captureErrorMessage(() =>
						restartedFixture.runtime.replaceLastUserMessage(resumedParent.sessionId, lastParentUserId),
					),
					captureErrorMessage(() =>
						restartedFixture.runtime.forkSession(resumedParent.sessionId, replacementUserId),
					),
				]);
				const busyHistoryUnchanged =
					JSON.stringify(observeHistory(restartedFixture.runtime.getFullHistory(resumedParent.sessionId))) ===
					JSON.stringify(busyHistory);
				const heldRequestClosed = server.waitForHeldRequestClosed();
				await restartedFixture.runtime.abort(resumedParent.sessionId);
				await Promise.all([busyPrompt.catch(() => undefined), heldRequestClosed]);

				observations[backend] = {
					mutationEvents: [navigation, switched, deleted, replaced, forked].flatMap(({ events }) => events),
					parentRestored: JSON.stringify(parentRestored) === JSON.stringify(parentBeforeRestart),
					childRestored,
					parentProviderSawReplacement: parentProviderInput.includes("replacement-user"),
					parentProviderExcludedRemovedBranches:
						!parentProviderInput.includes("original-user") && !parentProviderInput.includes("edited-user"),
					childProviderSawForkBase: childProviderInput.includes("first-user"),
					childProviderSawForkedTurn:
						childProviderInput.includes("replacement-user") &&
						childProviderInput.includes("assistant-replacement"),
					busyErrors,
					busyHistoryUnchanged,
				};
			} finally {
				await server.dispose();
			}
		}

		expect(observations.runtime).toEqual({
			mutationEvents: [],
			parentRestored: true,
			childRestored: [
				historyMessage("user", "first-user", null),
				historyMessage("user", "replacement-user", 0),
				historyMessage("assistant", "assistant-replacement", 1),
			],
			parentProviderSawReplacement: true,
			parentProviderExcludedRemovedBranches: true,
			childProviderSawForkBase: true,
			childProviderSawForkedTurn: true,
			busyErrors: [
				"Cannot edit message while the session is streaming",
				"Cannot switch branch while the session is streaming",
				"Cannot delete a message while the session is streaming",
				"Cannot replace a message while the session is streaming",
				"Cannot fork while the session is streaming",
			],
			busyHistoryUnchanged: true,
		});
	}, 60_000);

	for (const backend of ["runtime"] as const) {
		it(`${backend} keeps interactive, automation and batch ownership isolated in one RuntimeHost`, async () => {
			const agentStateDir = await temporaryDirectory(`desktop-${backend}-consumers-agent-`);
			const fixture = createRuntimeFixture(backend, agentStateDir);
			fixtures.push(fixture);
			const scenarios = ["conversation", "automation", "batch"] as const;
			const sessions: Array<{ readonly sessionId: string }> = [];

			for (const scenario of scenarios) {
				const cwd = await temporaryDirectory(`desktop-${backend}-${scenario}-workspace-`);
				const sessionDir = await temporaryDirectory(`desktop-${backend}-${scenario}-sessions-`);
				sessions.push(
					await fixture.runtime.createSession({
						cwd,
						sessionDir,
						model: MODEL,
						scenario,
						executionMode: "full-access",
						enableBackgroundTasks: scenario === "conversation",
						includeAgentSkills: false,
					}),
				);
			}

			expect(new Set(sessions.map(({ sessionId }) => sessionId)).size).toBe(3);
			expect(new Set(sessions.map(({ sessionId }) => fixture.runtime.getSessionPath(sessionId))).size).toBe(3);
			expect(sessions.map(({ sessionId }) => fixture.runtime.getState(sessionId).scenario)).toEqual(scenarios);

			await fixture.runtime.disposeSession(sessions[1]!.sessionId);
			expect(fixture.runtime.getState(sessions[0]!.sessionId).scenario).toBe("conversation");
			expect(fixture.runtime.getState(sessions[2]!.sessionId).scenario).toBe("batch");
		}, 30_000);
	}

	function createRuntimeFixture(
		_backend: "runtime",
		_agentStateDir: string,
		model: Model<Api> = MODEL,
	): RuntimeFixture {
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(model),
				initialModel: model,
				initialThinkingLevel: "off",
			},
		});
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		return {
			runtime,
			dispose: async () => {
				try {
					await runtime.disposeAllSessions();
				} finally {
					await pool.dispose();
				}
			},
		};
	}

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

interface RuntimeTurnObservation {
	readonly lifecycle: string[];
	readonly finalAssistantText: string;
	readonly tools: Array<{ readonly name: string; readonly isError: boolean }>;
	readonly messageRoles: string[];
	readonly events: RuntimeEventObservation[];
}

interface RuntimeEventObservation {
	readonly type: SessionEvent["type"];
	readonly source: SessionEvent["source"];
	readonly detail?: unknown;
}

interface RuntimeLifecycleObservation {
	readonly initial: RuntimeTurnObservation;
	readonly resumed: RuntimeTurnObservation;
	readonly historyRestoredBeforePrompt: boolean;
	readonly sessionIdentityRestored: boolean;
	readonly resumedProviderSawPriorToolResult: boolean;
	readonly resumedProviderSawPriorAssistant: boolean;
}

interface RuntimeHistoryMutationObservation {
	readonly mutationEvents: SessionEvent["type"][];
	readonly parentRestored: boolean;
	readonly childRestored: NormalizedHistoryMessage[];
	readonly parentProviderSawReplacement: boolean;
	readonly parentProviderExcludedRemovedBranches: boolean;
	readonly childProviderSawForkBase: boolean;
	readonly childProviderSawForkedTurn: boolean;
	readonly busyErrors: string[];
	readonly busyHistoryUnchanged: boolean;
}

interface NormalizedHistoryMessage {
	readonly role: Message["role"];
	readonly text: string;
	readonly parentIndex: number | null;
}

function emptyLifecycleObservation(): RuntimeLifecycleObservation {
	const emptyTurn = (): RuntimeTurnObservation => ({
		lifecycle: [],
		finalAssistantText: "",
		tools: [],
		messageRoles: [],
		events: [],
	});
	return {
		initial: emptyTurn(),
		resumed: emptyTurn(),
		historyRestoredBeforePrompt: false,
		sessionIdentityRestored: false,
		resumedProviderSawPriorToolResult: false,
		resumedProviderSawPriorAssistant: false,
	};
}

function observeTurn(
	events: readonly SessionEvent[],
	messages: readonly Message[],
	cwd: string,
): RuntimeTurnObservation {
	return {
		lifecycle: events.flatMap((event) => (event.type === "session.lifecycle" ? [event.phase] : [])),
		finalAssistantText: observeMessages(messages).finalAssistantText,
		tools: events.flatMap((event) =>
			event.type === "tool.end" ? [{ name: event.toolName, isError: event.isError }] : [],
		),
		messageRoles: messages.map(({ role }) => role),
		events: events.map((event) => observeEvent(event, cwd)),
	};
}

function observeEvent(event: SessionEvent, cwd: string): RuntimeEventObservation {
	const base = { type: event.type, source: event.source };
	switch (event.type) {
		case "session.lifecycle":
			return { ...base, detail: event.phase };
		case "message.delta":
		case "thinking.delta":
			return { ...base, detail: event.delta };
		case "message.final":
			return { ...base, detail: observeMessages([event.message]) };
		case "toolcall.start":
			return { ...base, detail: { toolName: event.toolName } };
		case "tool.start":
			return { ...base, detail: { toolName: event.toolName, args: normalizeEventValue(event.args, cwd) } };
		case "tool.end":
			return {
				...base,
				detail: {
					toolName: event.toolName,
					isError: event.isError,
					result: normalizeEventValue(event.result, cwd),
				},
			};
		case "usage.update":
			return {
				...base,
				detail: {
					input: event.input,
					output: event.output,
					cacheRead: event.cacheRead,
					cacheWrite: event.cacheWrite,
					contextPercent: event.contextPercent,
					contextWindow: event.contextWindow,
				},
			};
		default:
			return base;
	}
}

function normalizeEventValue(value: unknown, cwd: string): unknown {
	if (typeof value === "string") return value.replaceAll(cwd, "<workspace>");
	if (Array.isArray(value)) return value.map((entry) => normalizeEventValue(entry, cwd));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeEventValue(entry, cwd)]));
}

function observeMessages(messages: readonly Message[]): {
	readonly finalAssistantText: string;
	readonly roles: string[];
} {
	const assistant = [...messages].reverse().find(({ role }) => role === "assistant");
	const finalAssistantText =
		assistant?.role === "assistant"
			? assistant.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join("\n")
			: "";
	return { finalAssistantText, roles: messages.map(({ role }) => role) };
}

function observeHistory(history: readonly HistoryEntry[]): NormalizedHistoryMessage[] {
	const messages = history.filter(
		(entry): entry is Extract<HistoryEntry, { type: "message" }> => entry.type === "message",
	);
	const indexById = new Map(
		messages.flatMap((entry, index) => (entry.entryId ? [[entry.entryId, index] as const] : [])),
	);
	return messages.map((entry, index) => ({
		role: entry.message.role,
		text: messageText(entry.message),
		parentIndex: entry.parentId ? (indexById.get(entry.parentId) ?? (index > 0 ? index - 1 : null)) : null,
	}));
}

function historyMessage(role: Message["role"], text: string, parentIndex: number | null): NormalizedHistoryMessage {
	return { role, text, parentIndex };
}

function requireMessageEntryId(runtime: RuntimeHost, sessionId: string, role: Message["role"], text: string): string {
	const entry = runtime
		.getFullHistory(sessionId)
		.find(
			(candidate): candidate is Extract<HistoryEntry, { type: "message" }> =>
				candidate.type === "message" && candidate.message.role === role && messageText(candidate.message) === text,
		);
	if (!entry?.entryId) throw new Error(`Expected ${role} history entry: ${text}`);
	return entry.entryId;
}

async function captureSessionEvents<T>(
	runtime: RuntimeHost,
	sessionId: string,
	operation: () => Promise<T>,
): Promise<{ readonly result: T; readonly events: SessionEvent["type"][] }> {
	const events: SessionEvent["type"][] = [];
	const unsubscribe = runtime.subscribe(sessionId, (event) => events.push(event.type));
	events.length = 0;
	try {
		return { result: await operation(), events };
	} finally {
		unsubscribe();
	}
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join("");
}

async function captureErrorMessage(operation: () => Promise<unknown>): Promise<string> {
	try {
		await operation();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("Expected the history mutation to be rejected");
}

async function waitForProviderRequestCount(requests: readonly unknown[], expected: number): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (requests.length >= expected) return;
		await delay(10);
	}
	throw new Error(`Timed out waiting for ${expected} Provider requests; received ${requests.length}`);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function modelRegistry(model: Model<Api> = MODEL): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [model],
		find: (provider, modelId) => (provider === model.provider && modelId === model.id ? model : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const MODEL: Model<Api> = {
	id: "desktop-runtime-contract-model",
	name: "Desktop Runtime Contract Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
