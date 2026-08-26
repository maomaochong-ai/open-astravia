import { describe, expect, it, vi } from "vitest";
import { createCodingAgentCompositionShutdown } from "../../src/composition/session-lifecycle/composition-shutdown.js";
import { CodingAgentCompositionResourceRegistry } from "../../src/composition/session-lifecycle/resource-registry.js";
import type { CodingAgentSessionExecutionRuntime } from "../../src/execution/session/runtime.js";

describe("Coding Agent composition shutdown", () => {
	it("keeps shared resources alive until the Agent Session owner closes and retries failed phases", async () => {
		const registry = new CodingAgentCompositionResourceRegistry();
		const events: string[] = [];
		let sessionCloseAttempts = 0;
		let repositoryCloseAttempts = 0;
		const closeAgentRuntime = vi.fn(async () => {
			events.push("sessions");
			sessionCloseAttempts += 1;
			if (sessionCloseAttempts === 1) throw new Error("transient session close failure");
		});
		const closeConversationRepository = vi.fn(async () => {
			events.push("repository");
			repositoryCloseAttempts += 1;
			if (repositoryCloseAttempts === 1) throw new Error("transient repository close failure");
		});
		const disposeCodingTools = vi.fn(() => {
			events.push("tools");
		});
		const closeObservationHub = vi.fn(() => {
			events.push("observations");
		});
		const shutdown = createCodingAgentCompositionShutdown({
			registry,
			clearConversationContextOverlay: () => events.push("indexes"),
			closeConversationRepository,
			disposeCodingTools,
			closeAgentRuntime,
			closeObservationHub,
		});

		await expect(shutdown.dispose()).rejects.toThrow("transient session close failure");
		expect(events).toEqual(["sessions"]);

		await expect(shutdown.dispose()).rejects.toThrow("transient repository close failure");
		expect(events).toEqual(["sessions", "sessions", "indexes", "repository", "tools", "observations"]);

		await expect(shutdown.dispose()).resolves.toBeUndefined();
		expect(events).toEqual(["sessions", "sessions", "indexes", "repository", "tools", "observations", "repository"]);
		expect(closeAgentRuntime).toHaveBeenCalledTimes(2);
		expect(closeConversationRepository).toHaveBeenCalledTimes(2);
		expect(disposeCodingTools).toHaveBeenCalledOnce();
		expect(closeObservationHub).toHaveBeenCalledOnce();
	});

	it("clears lookup indexes without becoming a second Session resource owner", async () => {
		const registry = new CodingAgentCompositionResourceRegistry();
		const indexedRuntime = { dispose: vi.fn(async () => {}) };
		registry.indexes.executionRuntimes.set(
			"session",
			indexedRuntime as unknown as CodingAgentSessionExecutionRuntime,
		);
		const shutdown = createCodingAgentCompositionShutdown({
			registry,
			clearConversationContextOverlay: () => {},
			closeConversationRepository: () => {},
			disposeCodingTools: () => {},
		});

		await shutdown.dispose();

		expect(registry.indexes.executionRuntimes.get("session")).toBeUndefined();
		expect(indexedRuntime.dispose).not.toHaveBeenCalled();
	});
});
