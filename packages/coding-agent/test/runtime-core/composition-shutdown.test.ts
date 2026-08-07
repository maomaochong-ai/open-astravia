import { describe, expect, it, vi } from "vitest";
import type { CodingAgentPluginMcpRuntime } from "../../src/adapters/runtime-core/greenfield-plugin-mcp-runtime.js";
import { createCodingAgentCompositionShutdown } from "../../src/composition/session-lifecycle/composition-shutdown.js";
import { CodingAgentCompositionResourceRegistry } from "../../src/composition/session-lifecycle/resource-registry.js";
import type { CodingAgentSessionExecutionRuntime } from "../../src/host/session-execution/execution-runtime.js";

describe("Coding Agent composition shutdown", () => {
	it("deduplicates Session aliases, preserves phase order and retries only failed resources", async () => {
		const registry = new CodingAgentCompositionResourceRegistry();
		const contextRuntime = { dispose: vi.fn() };
		const memoryRuntime = { dispose: vi.fn() };
		const executionRuntime = { dispose: vi.fn(async () => {}) };
		const hookSessionDisposer = vi.fn(async () => {});
		const todoRuntime = { dispose: vi.fn(async () => {}) };
		const turnCapabilityAssembly = { dispose: vi.fn(async () => {}) };
		let ownershipAttempts = 0;
		const ownershipBinding = {
			dispose: vi.fn(async () => {
				ownershipAttempts += 1;
				if (ownershipAttempts === 1) throw new Error("transient ownership failure");
			}),
		};
		const pluginMcpRuntime = { dispose: vi.fn(async () => {}) };
		registry.trackContextRuntime(contextRuntime);
		registry.trackMemoryRuntime(memoryRuntime);
		registry.trackHookSessionDisposer(hookSessionDisposer);
		registry.trackTodoRuntime(todoRuntime);
		registry.trackTurnCapabilityAssembly(turnCapabilityAssembly);
		registry.trackOwnershipBinding(ownershipBinding);
		registry.indexes.executionRuntimes.set(
			"source",
			executionRuntime as unknown as CodingAgentSessionExecutionRuntime,
		);
		registry.indexes.executionRuntimes.set(
			"target",
			executionRuntime as unknown as CodingAgentSessionExecutionRuntime,
		);
		registry.indexes.pluginMcpRuntimes.set("source", pluginMcpRuntime as unknown as CodingAgentPluginMcpRuntime);
		registry.indexes.pluginMcpRuntimes.set("target", pluginMcpRuntime as unknown as CodingAgentPluginMcpRuntime);
		registry.indexes.mcpRefreshObservedSessions.add("target");

		let auxiliaryIndexesCleared = false;
		let repositoryClosed = false;
		const closeConversationRepository = vi.fn(() => {
			expect(auxiliaryIndexesCleared).toBe(true);
			expect(contextRuntime.dispose).toHaveBeenCalledOnce();
			expect(executionRuntime.dispose).toHaveBeenCalledOnce();
			repositoryClosed = true;
		});
		const disposeMcpSynchronizer = vi.fn(() => {
			expect(repositoryClosed).toBe(true);
		});
		const disposeCodingTools = vi.fn(() => {
			expect(repositoryClosed).toBe(true);
		});
		const shutdown = createCodingAgentCompositionShutdown({
			registry,
			clearConversationContextOverlay: () => {
				expect(registry.indexes.mcpRefreshObservedSessions.has("target")).toBe(false);
				auxiliaryIndexesCleared = true;
			},
			closeConversationRepository,
			disposeMcpSynchronizer,
			disposeCodingTools,
		});

		const firstDisposal = shutdown.dispose();
		await expect(firstDisposal).rejects.toThrow("Failed to dispose one or more Greenfield runtime resources");
		await expect(firstDisposal).rejects.toMatchObject({
			errors: [expect.objectContaining({ message: "transient ownership failure" })],
		});
		expect(executionRuntime.dispose).toHaveBeenCalledOnce();
		expect(pluginMcpRuntime.dispose).toHaveBeenCalledOnce();
		expect(registry.indexes.executionRuntimes.get("source")).toBeUndefined();
		expect(registry.indexes.executionRuntimes.get("target")).toBeUndefined();
		expect(registry.indexes.pluginMcpRuntimes.get("source")).toBeUndefined();
		expect(registry.indexes.pluginMcpRuntimes.get("target")).toBeUndefined();
		expect(closeConversationRepository).toHaveBeenCalledOnce();
		expect(disposeMcpSynchronizer).toHaveBeenCalledOnce();
		expect(disposeCodingTools).toHaveBeenCalledOnce();

		await expect(shutdown.dispose()).resolves.toBeUndefined();
		expect(ownershipBinding.dispose).toHaveBeenCalledTimes(2);
		expect(contextRuntime.dispose).toHaveBeenCalledOnce();
		expect(memoryRuntime.dispose).toHaveBeenCalledOnce();
		expect(executionRuntime.dispose).toHaveBeenCalledOnce();
		expect(hookSessionDisposer).toHaveBeenCalledOnce();
		expect(todoRuntime.dispose).toHaveBeenCalledOnce();
		expect(turnCapabilityAssembly.dispose).toHaveBeenCalledOnce();
		expect(pluginMcpRuntime.dispose).toHaveBeenCalledOnce();
		expect(closeConversationRepository).toHaveBeenCalledOnce();
	});

	it("does not dispose resources already removed by normal Session cleanup", async () => {
		const registry = new CodingAgentCompositionResourceRegistry();
		const contextRuntime = { dispose: vi.fn() };
		const todoRuntime = { dispose: vi.fn(async () => {}) };
		const executionRuntime = { dispose: vi.fn(async () => {}) };
		registry.trackContextRuntime(contextRuntime);
		registry.trackTodoRuntime(todoRuntime);
		registry.indexes.executionRuntimes.set(
			"session",
			executionRuntime as unknown as CodingAgentSessionExecutionRuntime,
		);
		registry.untrackContextRuntime(contextRuntime);
		registry.untrackTodoRuntime(todoRuntime);
		registry.indexes.executionRuntimes.unbind(
			"session",
			executionRuntime as unknown as CodingAgentSessionExecutionRuntime,
		);
		const shutdown = createCodingAgentCompositionShutdown({
			registry,
			clearConversationContextOverlay: () => {},
			closeConversationRepository: () => {},
			disposeCodingTools: () => {},
		});

		await shutdown.dispose();
		expect(contextRuntime.dispose).not.toHaveBeenCalled();
		expect(todoRuntime.dispose).not.toHaveBeenCalled();
		expect(executionRuntime.dispose).not.toHaveBeenCalled();
	});
});
