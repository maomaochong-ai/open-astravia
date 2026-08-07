import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	GreenfieldRuntimeSession,
	RuntimeSessionCatalog,
	RuntimeSessionExecutionObservation,
	SessionEvent,
} from "@vetta/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeComposition } from "../../src/composition/runtime-composition.js";
import {
	CodingAgentActiveSessionHost,
	type CodingAgentPreparedSessionBinding,
} from "../../src/composition/session-host/active-session-transition-host.js";
import { createCodingAgentSessionSetupSeedInitializer } from "../../src/sessions/setup/session-setup-seed-initializer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0).reverse()) {
		await rm(directory, { force: true, recursive: true });
	}
});

describe("CodingAgentActiveSessionHost", () => {
	it("switches the active session atomically and keeps external event subscriptions stable", async () => {
		const fixture = await createFixture();
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);
		const events: string[] = [];
		fixture.host.subscribe((event) => events.push(event.eventId));

		fixture.initial.emit(sessionEvent("old-event", "initial"));
		await expect(fixture.host.switchSession(fixture.sessionPath("next"))).resolves.toEqual({ cancelled: false });
		fixture.initial.emit(sessionEvent("stale-event", "initial"));
		next.emit(sessionEvent("next-event", "next"));

		expect(fixture.host.readSession()).toBe(next.session);
		expect(events).toEqual(["old-event", "next-event"]);
		expect(fixture.initial.dispose).toHaveBeenCalledOnce();
		expect(fixture.sessionHookEnd).toHaveBeenCalledWith("initial", "switch_session");
		expect(fixture.sessionHookStart).toHaveBeenCalledWith("next", "resume");
		expect(fixture.sessionHookDiscard).not.toHaveBeenCalled();
		expect(fixture.lifecycleOrder).toEqual([
			"before:resume",
			"prepare:next",
			"commit:next",
			"after:resume",
			"finalize:next",
		]);
	});

	it("rebinds complete execution observations when the active session changes", async () => {
		const fixture = await createFixture();
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);
		const observations: string[] = [];
		fixture.host.subscribeExecutionObservations((observation) => {
			observations.push(observation.turnId);
		});

		await fixture.initial.emitObservation(executionObservation("old-turn"));
		await fixture.host.switchSession(fixture.sessionPath("next"));
		await fixture.initial.emitObservation(executionObservation("stale-turn"));
		await next.emitObservation(executionObservation("next-turn"));

		expect(observations).toEqual(["old-turn", "next-turn"]);
	});

	it("isolates throwing execution observers before and after a switch", async () => {
		const fixture = await createFixture();
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const observations: string[] = [];
		fixture.host.subscribeExecutionObservations(() => {
			throw new Error("observation failed");
		});
		fixture.host.subscribeExecutionObservations((observation) => {
			observations.push(observation.turnId);
		});

		try {
			await fixture.initial.emitObservation(executionObservation("old-turn"));
			await fixture.host.switchSession(fixture.sessionPath("next"));
			await next.emitObservation(executionObservation("next-turn"));

			expect(observations).toEqual(["old-turn", "next-turn"]);
			expect(warning).toHaveBeenCalledTimes(2);
		} finally {
			warning.mockRestore();
		}
	});

	it("isolates throwing external observers before and after a switch", async () => {
		const fixture = await createFixture();
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const events: string[] = [];
		fixture.host.subscribe(() => {
			throw new Error("observer failed");
		});
		fixture.host.subscribe((event) => events.push(event.eventId));

		try {
			fixture.initial.emit(sessionEvent("old-event", "initial"));
			await fixture.host.switchSession(fixture.sessionPath("next"));
			next.emit(sessionEvent("next-event", "next"));

			expect(events).toEqual(["old-event", "next-event"]);
			expect(warning).toHaveBeenCalledTimes(2);
		} finally {
			warning.mockRestore();
		}
	});

	it("rolls back the active session and prepared binding when after-transition fails", async () => {
		const fixture = await createFixture({ failAfter: true });
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);

		await expect(fixture.host.switchSession(fixture.sessionPath("next"))).rejects.toThrow("after failed");

		expect(fixture.host.readSession()).toBe(fixture.initial.session);
		expect(next.dispose).toHaveBeenCalledOnce();
		expect(fixture.initial.dispose).not.toHaveBeenCalled();
		expect(fixture.sessionHookEnd).toHaveBeenCalledWith("initial", "switch_session");
		expect(fixture.sessionHookStart).toHaveBeenNthCalledWith(1, "next", "resume");
		expect(fixture.sessionHookDiscard).toHaveBeenCalledWith("next");
		expect(fixture.sessionHookStart).toHaveBeenNthCalledWith(2, "initial", "resume");
		expect(fixture.lifecycleOrder).toEqual([
			"before:resume",
			"prepare:next",
			"commit:next",
			"after:resume",
			"rollback:next",
		]);
	});

	it("shuts down source background commands before failed target acquisition", async () => {
		const fixture = await createFixture();
		fixture.resume.mockRejectedValueOnce(new Error("target session is locked"));

		await expect(fixture.host.switchSession(fixture.sessionPath("next"))).rejects.toThrow("target session is locked");

		expect(fixture.quiesceSessionBackgroundCommands).toHaveBeenCalledWith("initial");
		expect(fixture.host.readSession()).toBe(fixture.initial.session);
		expect(fixture.initial.dispose).not.toHaveBeenCalled();
		expect(fixture.sessionHookEnd).toHaveBeenCalledWith("initial", "switch_session");
		expect(fixture.sessionHookStart).toHaveBeenCalledOnce();
		expect(fixture.sessionHookStart).toHaveBeenCalledWith("initial", "resume");
		expect(fixture.sessionHookDiscard).not.toHaveBeenCalled();
	});

	it("reports every post-commit cleanup failure while keeping the target usable", async () => {
		const fixture = await createFixture({ failFinalize: true });
		const next = createSession("next", fixture.sessionPath("next"));
		const later = createSession("later", fixture.sessionPath("later"));
		fixture.resume.mockResolvedValueOnce(next.session).mockResolvedValueOnce(later.session);
		fixture.initial.dispose.mockRejectedValueOnce(new Error("previous dispose failed"));

		await expect(fixture.host.switchSession(fixture.sessionPath("next"))).resolves.toEqual({ cancelled: false });

		expect(fixture.host.readSession()).toBe(next.session);
		expect(fixture.initial.dispose).toHaveBeenCalledOnce();
		expect(next.dispose).not.toHaveBeenCalled();
		expect(fixture.cleanupErrors).toHaveLength(1);
		expect(fixture.cleanupErrors[0]?.errors).toEqual([
			expect.objectContaining({ message: "finalize failed" }),
			expect.objectContaining({ message: "previous dispose failed" }),
		]);
		await expect(
			fixture.host.startActiveSessionOperation((session) => session.prompt({ text: "target prompt" })),
		).resolves.toEqual({ kind: "started" });
		expect(next.prompt).toHaveBeenCalledWith({ text: "target prompt" });
		await expect(fixture.host.switchSession(fixture.sessionPath("later"))).resolves.toEqual({ cancelled: false });
		expect(fixture.host.readSession()).toBe(later.session);
		expect(fixture.sessionHookStart).not.toHaveBeenCalledWith("initial", "resume");
		expect(fixture.lifecycleOrder).toEqual([
			"before:resume",
			"prepare:next",
			"commit:next",
			"after:resume",
			"finalize:next",
			"before:resume",
			"prepare:later",
			"commit:later",
			"after:resume",
			"finalize:later",
		]);
	});

	it("isolates cleanup diagnostic failures after the target commits", async () => {
		const fixture = await createFixture({ failFinalize: true, failCleanupReporter: true });
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		try {
			await expect(fixture.host.switchSession(fixture.sessionPath("next"))).resolves.toEqual({ cancelled: false });
			expect(fixture.host.readSession()).toBe(next.session);
			expect(warning).toHaveBeenCalledWith(
				"[GreenfieldActiveSessionHost] Failed to report committed session transition cleanup",
				expect.any(AggregateError),
			);
		} finally {
			warning.mockRestore();
		}
	});

	it("retries only failed retired-session cleanup during final host disposal", async () => {
		const fixture = await createFixture({ failFinalize: true });
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);
		fixture.initial.dispose.mockRejectedValueOnce(new Error("previous dispose failed"));

		await fixture.host.switchSession(fixture.sessionPath("next"));
		await expect(fixture.host.dispose()).resolves.toBeUndefined();
		await expect(fixture.host.dispose()).resolves.toBeUndefined();

		expect(fixture.initial.dispose).toHaveBeenCalledTimes(2);
		expect(next.dispose).toHaveBeenCalledOnce();
		expect(fixture.lifecycleOrder.filter((entry) => entry === "finalize:next")).toHaveLength(2);
	});

	it("stops forwarding events and observations before disposing the active session", async () => {
		const fixture = await createFixture();
		const events: string[] = [];
		const observations: string[] = [];
		fixture.host.subscribe((event) => events.push(event.eventId));
		fixture.host.subscribeExecutionObservations((observation) => {
			observations.push(observation.turnId);
		});

		await fixture.host.dispose();
		fixture.initial.emit(sessionEvent("after-dispose", "initial"));
		await fixture.initial.emitObservation(executionObservation("after-dispose"));

		expect(events).toEqual([]);
		expect(observations).toEqual([]);
		expect(fixture.initial.dispose).toHaveBeenCalledOnce();
	});

	it("publishes Extension setup as a native V2 seed before activation", async () => {
		const fixture = await createFixture();
		const next = createSession("created", fixture.sessionPath("created"));
		fixture.resume.mockResolvedValueOnce(next.session);
		let setupSessionFile: string | undefined;

		await expect(
			fixture.host.newSession({
				parentSession: fixture.initial.path,
				seedInitializer: createCodingAgentSessionSetupSeedInitializer(async (sessionManager) => {
					expect(sessionManager.isPersisted()).toBe(true);
					setupSessionFile = sessionManager.getSessionFile();
					expect(sessionManager.getSessionId()).toBe("created");
					sessionManager.appendMessage({
						role: "user",
						content: [{ type: "text", text: "setup context" }],
						timestamp: 10,
					});
				}),
			}),
		).resolves.toEqual({ cancelled: false });

		expect(setupSessionFile).toBeDefined();
		expect(fixture.resume).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "created", parentSessionPath: fixture.initial.path }),
		);
		expect(setupSessionFile).toBe(fixture.sessionPath("created"));
		const seeded = await readFile(fixture.sessionPath("created"), "utf8");
		expect(seeded).toContain('"recordType":"conversation.seed"');
		expect(seeded).not.toContain('"recordType":"conversation.import.seed"');
		expect(seeded).toContain("setup context");
	});

	it("removes a created fork and restores the source session when rebinding fails", async () => {
		const fixture = await createFixture({ failPrepare: true });
		const fork = createSession("forked", fixture.sessionPath("forked"));
		await fixture.writeConversationPlaceholder("forked");
		fixture.initial.forkSession.mockResolvedValueOnce({ path: fork.path, text: "fork prompt" });
		fixture.resume.mockResolvedValueOnce(fork.session);

		await expect(fixture.host.fork("entry-1")).rejects.toThrow("prepare failed");

		expect(fork.navigateForEdit).toHaveBeenCalledWith("entry-1");
		expect(fixture.host.readSession()).toBe(fixture.initial.session);
		expect(fork.dispose).toHaveBeenCalledOnce();
		expect(fixture.sessionHookEnd).toHaveBeenCalledWith("initial", "fork_session");
		expect(fixture.sessionHookStart).toHaveBeenNthCalledWith(1, "forked", "clear");
		expect(fixture.sessionHookDiscard).toHaveBeenCalledWith("forked");
		expect(fixture.sessionHookStart).toHaveBeenNthCalledWith(2, "initial", "resume");
		await expect(access(fork.path)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("moves a default fork before the selected user turn without preserving source execution context", async () => {
		const fixture = await createFixture();
		const fork = createSession("forked", fixture.sessionPath("forked"));
		await fixture.writeConversationPlaceholder("forked");
		fixture.initial.forkSession.mockResolvedValueOnce({ path: fork.path, text: "fork prompt" });
		fixture.resume.mockResolvedValueOnce(fork.session);

		await expect(fixture.host.fork("entry-1")).resolves.toEqual({ text: "fork prompt", cancelled: false });

		expect(fork.navigateForEdit).toHaveBeenCalledWith("entry-1");
		expect(fixture.preserveSessionExecutionContext).not.toHaveBeenCalled();
		expect(fixture.host.readSession()).toBe(fork.session);
	});

	it("preserves the source execution context when session_before_fork requests it", async () => {
		const fixture = await createFixture({ skipConversationRestore: true });
		const fork = createSession("forked", fixture.sessionPath("forked"));
		await fixture.writeConversationPlaceholder("forked");
		fixture.initial.forkSession.mockResolvedValueOnce({ path: fork.path, text: "fork prompt" });
		fixture.resume.mockResolvedValueOnce(fork.session);

		await expect(fixture.host.fork("entry-1")).resolves.toEqual({ text: "fork prompt", cancelled: false });

		expect(fork.navigateForEdit).toHaveBeenCalledWith("entry-1");
		expect(fixture.preserveSessionExecutionContext).toHaveBeenCalledWith("initial", "forked");
		expect(fixture.sessionHookEnd).toHaveBeenCalledWith("initial", "fork_session");
		expect(fixture.sessionHookStart).toHaveBeenCalledWith("forked", "clear");
		expect(fixture.sessionHookDiscard).not.toHaveBeenCalled();
		expect(fixture.lifecycleOrder).toEqual([
			"before:fork",
			"preserve:initial:forked",
			"prepare:forked",
			"commit:forked",
			"after:fork",
			"finalize:forked",
		]);
	});

	it("runs session_before_switch before abort and leaves an active turn untouched when cancelled", async () => {
		const fixture = await createFixture({ cancelBefore: true });
		fixture.initial.setStreaming(true);

		await expect(fixture.host.newSession()).resolves.toEqual({ cancelled: true });

		expect(fixture.initial.abort).not.toHaveBeenCalled();
		expect(fixture.host.readSession()).toBe(fixture.initial.session);
		expect(fixture.sessionHookEnd).not.toHaveBeenCalled();
		expect(fixture.sessionHookStart).not.toHaveBeenCalled();
		expect(fixture.lifecycleOrder).toEqual(["before:new"]);
	});

	it("interrupts an approved session switch without forwarding the old terminal event", async () => {
		const fixture = await createFixture();
		const next = createSession("next", fixture.sessionPath("next"));
		fixture.resume.mockResolvedValueOnce(next.session);
		fixture.initial.setStreaming(true);
		const events: SessionEvent[] = [];
		fixture.host.subscribe((event) => events.push(event));

		await expect(fixture.host.switchSession(next.path)).resolves.toEqual({ cancelled: false });

		expect(fixture.initial.abort).toHaveBeenCalledWith("switch_session");
		expect(events).toEqual([]);
		expect(fixture.lifecycleOrder[0]).toBe("before:resume");
		expect(fixture.host.readSession()).toBe(next.session);
	});

	it("does not miss a terminal event emitted while installing the idle subscription", async () => {
		const fixture = await createFixture();
		fixture.initial.setStreaming(true);
		fixture.initial.finishDuringNextSubscribe();

		await expect(fixture.host.waitForIdle()).resolves.toBeUndefined();
	});

	it("keeps fork idle-gated while allowing an admitted operation to start before a queued transition", async () => {
		const fixture = await createFixture();
		const fork = createSession("forked", fixture.sessionPath("forked"));
		await fixture.writeConversationPlaceholder("forked");
		fixture.initial.forkSession.mockResolvedValueOnce({ path: fork.path, text: "fork prompt" });
		fixture.resume.mockResolvedValueOnce(fork.session);
		fixture.initial.setStreaming(true);
		const operation = vi.fn(async () => "started");

		await expect(fixture.host.startActiveSessionOperation(operation)).resolves.toBe("started");
		const pendingFork = fixture.host.fork("entry-1");
		await Promise.resolve();
		expect(fixture.initial.forkSession).not.toHaveBeenCalled();

		fixture.initial.setStreaming(false);
		fixture.initial.emit(sessionEvent("idle", "initial", "agent_end"));
		await expect(pendingFork).resolves.toEqual({ text: "fork prompt", cancelled: false });
		expect(operation).toHaveBeenCalledWith(fixture.initial.session);
	});
});

async function createFixture(
	options: {
		failAfter?: boolean;
		failFinalize?: boolean;
		failCleanupReporter?: boolean;
		failPrepare?: boolean;
		skipConversationRestore?: boolean;
		cancelBefore?: boolean;
	} = {},
) {
	const conversationDir = await mkdtemp(join(tmpdir(), "greenfield-active-session-host-"));
	temporaryDirectories.push(conversationDir);
	const initial = createSession("initial", sessionPath(conversationDir, "initial"));
	const create = vi.fn<(options: { sessionId: string }) => Promise<GreenfieldRuntimeSession>>();
	const resume = vi.fn<(options: { sessionId: string }) => Promise<GreenfieldRuntimeSession>>();
	const preserveSessionExecutionContext = vi.fn(async (sourceSessionId: string, targetSessionId: string) => {
		lifecycleOrder.push(`preserve:${sourceSessionId}:${targetSessionId}`);
	});
	const quiesceSessionBackgroundCommands = vi.fn(async () => {});
	const sessionHookEnd = vi.fn(async () => {});
	const sessionHookStart = vi.fn();
	const sessionHookDiscard = vi.fn();
	const cleanupErrors: AggregateError[] = [];
	let finalizeAttempts = 0;
	const runtime = {
		backend: { create, resume },
		quiesceSessionBackgroundCommands,
		preserveSessionExecutionContext,
		sessionHooks: {
			end: sessionHookEnd,
			start: sessionHookStart,
			discard: sessionHookDiscard,
		},
	} as unknown as CodingAgentRuntimeComposition;
	const catalog: RuntimeSessionCatalog = {
		ownsSession: async (path) => {
			try {
				await access(path);
				return true;
			} catch {
				return false;
			}
		},
		listProjects: async () => [],
		listSessions: async () => [],
		renameSession: async () => {},
		deleteSessionArtifacts: async (path) => rm(path, { force: true }),
	};
	const lifecycleOrder: string[] = [];
	const host = new CodingAgentActiveSessionHost({
		runtime,
		initialSession: initial.session,
		sessionOptions: { cwd: conversationDir },
		conversationDir,
		sessionCatalog: catalog,
		createSessionId: () => "created",
		resolveSessionId: (path) => {
			const encoded = path.match(/([^\\/]+)\.conversation\.jsonl$/)?.[1];
			return encoded ? Buffer.from(encoded, "base64url").toString("utf8") : undefined;
		},
		onTransitionCleanupError: (error) => {
			cleanupErrors.push(error);
			if (options.failCleanupReporter) throw new Error("cleanup reporter failed");
		},
		lifecycle: {
			before: async ({ kind }) => {
				lifecycleOrder.push(`before:${kind}`);
				return {
					cancelled: options.cancelBefore === true,
					...(kind === "fork" && options.skipConversationRestore ? { skipConversationRestore: true } : {}),
				};
			},
			prepare: async ({ next }): Promise<CodingAgentPreparedSessionBinding> => {
				lifecycleOrder.push(`prepare:${next.sessionId}`);
				if (options.failPrepare) throw new Error("prepare failed");
				return {
					commit: async () => {
						lifecycleOrder.push(`commit:${next.sessionId}`);
					},
					rollback: async () => {
						lifecycleOrder.push(`rollback:${next.sessionId}`);
					},
					finalize: async () => {
						lifecycleOrder.push(`finalize:${next.sessionId}`);
						if (options.failFinalize && finalizeAttempts++ === 0) throw new Error("finalize failed");
					},
				};
			},
			after: async ({ kind }) => {
				lifecycleOrder.push(`after:${kind}`);
				if (options.failAfter) throw new Error("after failed");
			},
		},
	});
	return {
		host,
		initial,
		create,
		resume,
		quiesceSessionBackgroundCommands,
		preserveSessionExecutionContext,
		sessionHookEnd,
		sessionHookStart,
		sessionHookDiscard,
		cleanupErrors,
		lifecycleOrder,
		sessionPath: (id: string) => sessionPath(conversationDir, id),
		writeConversationPlaceholder: async (id: string) => writeFile(sessionPath(conversationDir, id), "placeholder"),
	};
}

function createSession(id: string, path: string) {
	const listeners = new Set<(event: SessionEvent) => void>();
	const observationListeners = new Set<(observation: RuntimeSessionExecutionObservation) => Promise<void> | void>();
	let streaming = false;
	let finishOnSubscribe = false;
	const dispose = vi.fn(async () => {});
	const prompt = vi.fn(async () => ({ kind: "started" as const }));
	const forkSession = vi.fn(async () => ({ path, text: "" }));
	const navigateForEdit = vi.fn(async () => ({ text: "", cancelled: false }));
	const abort = vi.fn(async () => {
		if (!streaming) return;
		streaming = false;
		for (const listener of listeners) listener(sessionEvent("aborted", id, "aborted"));
	});
	const session = {
		get sessionId() {
			return id;
		},
		readState: () => ({ isStreaming: streaming }),
		createCoreAssembly: () => ({
			historyController: { navigateForEdit },
			lifecycle: { sessionId: id, sessionPath: path, dispose },
			executionObservationStream: {
				subscribe: (handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void) => {
					observationListeners.add(handler);
					return () => observationListeners.delete(handler);
				},
			},
		}),
		subscribe: (handler: (event: SessionEvent) => void) => {
			listeners.add(handler);
			if (finishOnSubscribe) {
				finishOnSubscribe = false;
				streaming = false;
				handler(sessionEvent("subscribe-terminal", id, "agent_end"));
			}
			return () => listeners.delete(handler);
		},
		abort,
		prompt,
		forkSession,
		dispose,
	} as unknown as GreenfieldRuntimeSession;
	return {
		session,
		path,
		dispose,
		abort,
		prompt,
		forkSession,
		navigateForEdit,
		emit(event: SessionEvent) {
			for (const listener of listeners) listener(event);
		},
		async emitObservation(observation: RuntimeSessionExecutionObservation) {
			for (const listener of observationListeners) await listener(observation);
		},
		setStreaming(value: boolean) {
			streaming = value;
		},
		finishDuringNextSubscribe() {
			finishOnSubscribe = true;
		},
	};
}

function executionObservation(turnId: string): RuntimeSessionExecutionObservation {
	return { turnId, timestamp: 1, event: { type: "agent.start" } };
}

function sessionPath(root: string, id: string): string {
	return join(root, `${Buffer.from(id, "utf8").toString("base64url")}.conversation.jsonl`);
}

function sessionEvent(
	eventId: string,
	sessionId: string,
	phase: Extract<SessionEvent, { type: "session.lifecycle" }>["phase"] = "agent_start",
): SessionEvent {
	return {
		type: "session.lifecycle",
		phase,
		schemaVersion: 1,
		sessionId,
		eventId,
		timestamp: 1,
		source: "runtime-core",
	};
}
