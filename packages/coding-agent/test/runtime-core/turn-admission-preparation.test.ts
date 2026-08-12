import type { RuntimeSnapshot, RuntimeSnapshotAcquireContext, RuntimeSnapshotLease } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	type CodingAgentSessionRuntimeResourcesOptions,
	createCodingAgentSessionRuntimeResources,
} from "../../src/composition/session-lifecycle/runtime-resources.js";

describe("Coding Agent Turn admission preparation", () => {
	it("publishes refreshed MCP state before atomically capturing the Turn generation", async () => {
		const order: string[] = [];
		const lease = {
			snapshot: {} as RuntimeSnapshot,
			release: vi.fn(async () => undefined),
		} satisfies RuntimeSnapshotLease;
		const acquire = vi.fn(async () => {
			order.push("capture");
			return lease;
		});
		const resources = createCodingAgentSessionRuntimeResources({
			session: {
				initialSessionId: "session",
				readSessionId: () => "session",
				cwd: "C:\\workspace",
			},
			conversation: { resolveSessionPath: () => undefined },
			turnCapabilityAssembly: {
				capabilities: { acquire },
				promptAdapter: {},
			},
			refreshSessionMcp: async () => {
				order.push("publish");
			},
			activation: { mode: "explicit", toolNames: [] },
		} as unknown as CodingAgentSessionRuntimeResourcesOptions);
		const context: RuntimeSnapshotAcquireContext = {
			sessionId: "session",
			operationId: "turn",
			reason: "turn",
			signal: new AbortController().signal,
		};

		await resources.snapshotProvider.acquire(context);

		expect(order).toEqual(["publish", "capture"]);
		expect(acquire).toHaveBeenCalledWith(context);
	});

	it("does not refresh mutable MCP state before the immutable Turn admission point", async () => {
		const refreshSessionMcp = vi.fn(async () => undefined);
		const createRequest = vi.fn((request: { text: string }) => ({ payload: request, displayText: request.text }));
		const resources = createCodingAgentSessionRuntimeResources({
			session: {
				initialSessionId: "session",
				readSessionId: () => "session",
				cwd: "C:\\workspace",
			},
			conversation: { resolveSessionPath: () => undefined },
			turnCapabilityAssembly: {
				capabilities: {},
				promptAdapter: { createRequest },
			},
			refreshSessionMcp,
			activation: { mode: "explicit", toolNames: [] },
		} as unknown as CodingAgentSessionRuntimeResourcesOptions);

		resources.promptAdapter.createRequest({ text: "hello" });

		expect(refreshSessionMcp).not.toHaveBeenCalled();
		expect(createRequest).toHaveBeenCalledOnce();
	});
});
