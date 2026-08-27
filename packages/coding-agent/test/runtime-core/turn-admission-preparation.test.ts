import type { RuntimeSnapshot, RuntimeSnapshotAcquireContext, RuntimeSnapshotLease } from "@vetta/runtime-core/kernel";
import { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import { describe, expect, it, vi } from "vitest";
import {
	type CodingAgentSessionRuntimeResourcesOptions,
	createCodingAgentSessionRuntimeResources,
} from "../../src/composition/session-lifecycle/runtime-resources.js";
import { createCodingAgentBackgroundWorkSessionExtension } from "../../src/execution/background/background-work-session-extension.js";
import { createCodingAgentPluginConfigurationSessionExtension } from "../../src/plugins/runtime/plugin-configuration-session-extension.js";

describe("Coding Agent Turn admission preparation", () => {
	it("keeps the Agent Session as the only Snapshot Provider instead of wrapping MCP refresh", async () => {
		const order: string[] = [];
		const lease = {
			snapshot: {} as RuntimeSnapshot,
			release: vi.fn(async () => undefined),
		} satisfies RuntimeSnapshotLease;
		const acquire = vi.fn(async () => {
			order.push("capture");
			return lease;
		});
		const capabilitySnapshotProvider = { acquire };
		const refreshSessionMcp = vi.fn(async () => {
			order.push("publish");
		});
		const sessionExtensions = await createRequiredSessionExtensions();
		const resources = createCodingAgentSessionRuntimeResources({
			session: {
				initialSessionId: "session",
				readSessionId: () => "session",
				cwd: "C:\\workspace",
			},
			conversation: { resolveSessionDirectory: () => undefined, resolveSessionPath: () => undefined },
			turnCapabilityAssembly: {
				promptAdapter: {},
			},
			capabilitySnapshotProvider,
			sessionExtensions,
			executionRuntime: { backgroundService: {} },
			pluginConfigurationRuntime: {},
			refreshSessionMcp,
			activation: { mode: "explicit", toolNames: [] },
		} as unknown as CodingAgentSessionRuntimeResourcesOptions);
		const context: RuntimeSnapshotAcquireContext = {
			sessionId: "session",
			operationId: "turn",
			reason: "turn",
			signal: new AbortController().signal,
		};

		await resources.snapshotProvider.acquire(context);

		expect(resources.snapshotProvider).toBe(capabilitySnapshotProvider);
		expect(order).toEqual(["capture"]);
		expect(refreshSessionMcp).not.toHaveBeenCalled();
		expect(acquire).toHaveBeenCalledWith(context);
	});

	it("does not refresh mutable MCP state before the immutable Turn admission point", async () => {
		const refreshSessionMcp = vi.fn(async () => undefined);
		const createRequest = vi.fn((request: { text: string }) => ({ payload: request, displayText: request.text }));
		const sessionExtensions = await createRequiredSessionExtensions();
		const resources = createCodingAgentSessionRuntimeResources({
			session: {
				initialSessionId: "session",
				readSessionId: () => "session",
				cwd: "C:\\workspace",
			},
			conversation: { resolveSessionDirectory: () => undefined, resolveSessionPath: () => undefined },
			turnCapabilityAssembly: {
				promptAdapter: { createRequest },
			},
			capabilitySnapshotProvider: { acquire: vi.fn() },
			sessionExtensions,
			executionRuntime: { backgroundService: {} },
			pluginConfigurationRuntime: {},
			refreshSessionMcp,
			activation: { mode: "explicit", toolNames: [] },
		} as unknown as CodingAgentSessionRuntimeResourcesOptions);

		resources.promptAdapter.createRequest({ text: "hello" });

		expect(refreshSessionMcp).not.toHaveBeenCalled();
		expect(createRequest).toHaveBeenCalledOnce();
	});
});

function createRequiredSessionExtensions(): Promise<SessionExtensionComposition> {
	return SessionExtensionComposition.create({
		definitions: [
			createCodingAgentBackgroundWorkSessionExtension(),
			createCodingAgentPluginConfigurationSessionExtension(),
		],
	});
}
