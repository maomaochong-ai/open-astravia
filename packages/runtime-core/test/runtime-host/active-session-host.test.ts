import { describe, expect, it, vi } from "vitest";
import {
	type RuntimeActiveSessionCreateOptions,
	RuntimeActiveSessionHost,
	type RuntimeSession,
	type RuntimeSessionExecutionObservation,
	type SessionEvent,
} from "../../src/index.js";
import type { KernelRuntimeSessionBackend } from "../../src/runtime-host/kernel-runtime-session-backend.js";

describe("RuntimeActiveSessionHost", () => {
	it("commits a new active Session and owns retired and final cleanup", async () => {
		const initial = createSession("initial");
		const next = createSession("next");
		const create = vi.fn(async () => next.session);
		const resume = vi.fn(async () => next.session);
		const hookOrder: string[] = [];
		const host = new RuntimeActiveSessionHost({
			runtime: {
				backend: { create, resume } as unknown as KernelRuntimeSessionBackend<RuntimeActiveSessionCreateOptions>,
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
});

function createSession(sessionId: string) {
	const eventListeners = new Set<(event: SessionEvent) => void>();
	const observationListeners = new Set<(observation: RuntimeSessionExecutionObservation) => Promise<void> | void>();
	const dispose = vi.fn(async () => undefined);
	const sessionPath = `virtual://session/${sessionId}`;
	const session = {
		sessionId,
		readState: () => ({ isStreaming: false }),
		subscribe: (listener: (event: SessionEvent) => void) => {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		createCoreAssembly: () => ({
			lifecycle: { sessionId, sessionPath, dispose },
			historyController: { navigateForEdit: async () => ({ text: "", cancelled: false }) },
			executionObservationStream: {
				subscribe: (listener: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void) => {
					observationListeners.add(listener);
					return () => observationListeners.delete(listener);
				},
			},
		}),
		dispose,
	} as unknown as RuntimeSession;
	return { session, dispose };
}
