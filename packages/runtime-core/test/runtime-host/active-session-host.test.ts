import { describe, expect, it, vi } from "vitest";
import {
	createRuntimeObservationPublisher,
	RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION,
	type RuntimeActiveSession,
	type RuntimeActiveSessionCreateOptions,
	RuntimeActiveSessionHost,
	type RuntimeActiveSessionHostObservation,
	type RuntimeObservationRecord,
	type RuntimeSessionExecutionObservation,
	type SessionEvent,
} from "../../src/index.js";

describe("RuntimeActiveSessionHost", () => {
	it("commits a new active Session and owns retired and final cleanup", async () => {
		const initial = createSession("initial");
		const next = createSession("next");
		const create = vi.fn(async () => next.session);
		const resume = vi.fn(async () => next.session);
		const hookOrder: string[] = [];
		const host = new RuntimeActiveSessionHost<RuntimeActiveSessionCreateOptions, RuntimeActiveSession>({
			runtime: {
				sessions: { create, resume },
				sessionHooks: {
					end: async (sessionId, cause) => {
						hookOrder.push(`end:${sessionId}:${cause}`);
					},
					start: (sessionId, source) => hookOrder.push(`start:${sessionId}:${source}`),
					discard: vi.fn(),
				},
				quiesceSessionBackgroundCommands: async (sessionId) => {
					hookOrder.push(`quiesce:${sessionId}`);
				},
				preserveSessionExecutionContext: async () => undefined,
			},
			initialSession: initial.session,
			sessionOptions: {},
			conversationDir: "virtual://conversations",
			defaultCwd: "virtual://workspace",
			sessionCatalog: {
				ownsSession: async () => false,
				listProjects: async () => [],
				listSessions: async () => [],
				renameSession: async () => undefined,
				deleteSessionArtifacts: async () => undefined,
			},
			createSessionId: () => "next",
			resolveSessionId: (path) => path.slice("virtual://session/".length),
			resolveSessionPath: (sessionId) => `virtual://session/${sessionId}`,
			lifecycle: {
				before: async ({ kind }) => {
					hookOrder.push(`before:${kind}`);
					return { cancelled: false };
				},
				after: async ({ kind }) => {
					hookOrder.push(`after:${kind}`);
				},
			},
		});

		await expect(host.newSession()).resolves.toEqual({ cancelled: false });

		expect(create).toHaveBeenCalledWith({ sessionId: "next", parentSessionPath: undefined });
		expect(host.readSession()).toBe(next.session);
		expect(initial.dispose).toHaveBeenCalledOnce();
		expect(hookOrder).toEqual([
			"before:new",
			"end:initial:new_session",
			"quiesce:initial",
			"start:next:clear",
			"after:new",
		]);

		await host.dispose();
		expect(next.dispose).toHaveBeenCalledOnce();
	});

	it("routes listener and committed transition cleanup failures through the shared Observation publisher", async () => {
		const initial = createSession("initial");
		const next = createSession("next");
		initial.dispose.mockRejectedValueOnce(new Error("private cleanup failure")).mockResolvedValueOnce(undefined);
		const records: RuntimeObservationRecord[] = [];
		const host = new RuntimeActiveSessionHost({
			runtime: {
				sessions: { create: async () => next.session, resume: async () => next.session },
				sessionHooks: { end: async () => {}, start: () => {}, discard: () => {} },
				quiesceSessionBackgroundCommands: async () => {},
				preserveSessionExecutionContext: async () => {},
			},
			initialSession: initial.session,
			sessionOptions: {},
			conversationDir: "virtual://conversations",
			defaultCwd: "virtual://workspace",
			sessionCatalog: {
				ownsSession: async () => false,
				listProjects: async () => [],
				listSessions: async () => [],
				renameSession: async () => {},
				deleteSessionArtifacts: async () => {},
			},
			createSessionId: () => "next",
			resolveSessionId: (path) => path.slice("virtual://session/".length),
			resolveSessionPath: (sessionId) => `virtual://session/${sessionId}`,
			observationPublisher: createRuntimeObservationPublisher({
				port: {
					record: (record) => {
						records.push(record);
					},
				},
			}),
		});
		host.subscribe(() => {
			throw new Error("private listener failure");
		});

		initial.emit({
			type: "session.lifecycle",
			phase: "agent_start",
			schemaVersion: 1,
			sessionId: "initial",
			eventId: "event-1",
			timestamp: 1,
			source: "runtime-core",
		});
		await expect(host.newSession()).resolves.toEqual({ cancelled: false });

		const failures = records
			.filter((record) => record.token === RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION)
			.map((record) => record.payload as RuntimeActiveSessionHostObservation);
		expect(failures).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ operation: "listener.notify", component: "event-listener" }),
				expect.objectContaining({
					operation: "transition.cleanup",
					component: "retired-session",
					transitionKind: "new",
				}),
			]),
		);
		expect(JSON.stringify(failures)).not.toContain("private");
		await host.dispose();
	});
});

function createSession(sessionId: string) {
	const eventListeners = new Set<(event: SessionEvent) => void>();
	const observationListeners = new Set<(observation: RuntimeSessionExecutionObservation) => Promise<void> | void>();
	const dispose = vi.fn(async () => undefined);
	const sessionPath = `virtual://session/${sessionId}`;
	const session = {
		sessionId,
		sessionPath,
		readState: () => ({
			thinkingLevel: "medium",
			isStreaming: false,
			messageCount: 0,
			contextPercent: null,
			contextWindow: 0,
			activeToolNames: [],
		}),
		readMessages: () => [],
		prompt: async () => undefined,
		continue: async () => undefined,
		retry: async () => undefined,
		abort: async () => undefined,
		subscribe: (listener: (event: SessionEvent) => void) => {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		subscribeExecutionObservations: (
			listener: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
		) => {
			observationListeners.add(listener);
			return () => observationListeners.delete(listener);
		},
		navigateForEdit: async () => ({ text: "", cancelled: false }),
		forkSession: async () => ({ path: sessionPath, text: "" }),
		dispose,
	} satisfies RuntimeActiveSession;
	return {
		session,
		dispose,
		emit(event: SessionEvent) {
			for (const listener of eventListeners) listener(event);
		},
	};
}
