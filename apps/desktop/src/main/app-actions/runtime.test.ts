import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppActionCatalog } from "./catalog.js";
import { AppActionRuntime, shouldBypassActionApproval } from "./runtime.js";
import { type ActionApprovalRequester, type ActionDefinition, ActionError, type JsonValue } from "./types.js";

const logger = vi.hoisted(() => ({
	debug: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
}));

vi.mock("../logger.js", () => ({ getAppLogger: () => logger }));

function action(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
	return {
		id: "test.run",
		domain: "test",
		title: "Test action",
		summary: "Runs a test action",
		availability: "gui-main",
		permission: "test.run",
		inputSchema: { description: "Test input" },
		examples: [],
		validateInput: (input) => input as JsonValue,
		run: async () => ({ status: "ok" }),
		...overrides,
	};
}

function runtime(definition: ActionDefinition, approvalRequester?: ActionApprovalRequester): AppActionRuntime {
	const catalog = new AppActionCatalog();
	catalog.register(definition, { providerId: "test-provider" });
	return new AppActionRuntime(catalog, approvalRequester ?? { request: async () => ({ approved: true }) });
}

describe("AppActionRuntime logging", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("records input shape without persisting input values", async () => {
		await runtime(action()).run(
			"test.run",
			{ path: "C:/private/customer.txt", token: "secret-value" },
			{ source: "internal", requestId: "request-1" },
		);

		expect(logger.info).toHaveBeenCalledWith(
			"run: input validated",
			expect.objectContaining({ actionId: "test.run", requestId: "request-1" }),
			{ inputType: "object", inputKeyCount: 2 },
		);
		expect(JSON.stringify(logger.info.mock.calls)).not.toContain("customer.txt");
		expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret-value");
	});

	it("writes an explicit rejected terminal event", async () => {
		const run = vi.fn();
		const result = await runtime(
			action({
				approval: {
					defaultPresentation: "generic",
					presentations: [{ id: "generic", title: "Approve", description: "Approve action" }],
				},
				requiresApproval: () => true,
				run,
			}),
			{ request: async () => ({ approved: false }) },
		).run("test.run", {}, { source: "local-server", requestId: "request-2" });

		expect(result).toMatchObject({ status: "rejected", actionId: "test.run" });
		expect(run).not.toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith(
			"run: rejected",
			expect.objectContaining({ actionId: "test.run", requestId: "request-2", domain: "test" }),
			expect.objectContaining({ durationMs: expect.any(Number) }),
		);
	});

	it("logs stable failure metadata without persisting the error message", async () => {
		const target = runtime(
			action({
				run: async () => {
					throw new ActionError("TEST_FAILED", "secret failure detail");
				},
			}),
		);

		await expect(target.run("test.run", {}, { source: "internal", requestId: "request-3" })).rejects.toThrow(
			"secret failure detail",
		);
		expect(logger.error).toHaveBeenCalledWith(
			"run: failed",
			expect.objectContaining({ actionId: "test.run", requestId: "request-3", domain: "test" }),
			expect.objectContaining({ errorName: "ActionError", errorCode: "TEST_FAILED" }),
		);
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret failure detail");
	});
});

describe("development approval policy", () => {
	it("does not invoke the approval broker for a write action in dev", async () => {
		vi.stubEnv("VETTA_CONFIG_DIR", ".vetta-dev");
		vi.stubEnv("VETTA_DEV_AUTO_APPROVE_ACTIONS", "1");
		const approvalRequester = { request: vi.fn(async () => ({ approved: false })) };
		const run = vi.fn(async () => ({ status: "ok" as const }));
		try {
			const result = await runtime(
				action({
					requiresApproval: () => true,
					approval: {
						defaultPresentation: "generic",
						presentations: [{ id: "generic", title: "Approve", description: "Approve action" }],
					},
					run,
				}),
				approvalRequester,
			).run("test.run", {}, { source: "local-server" });
			expect(result).toEqual({ status: "ok" });
			expect(approvalRequester.request).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("bypasses every local-server action only with the explicit development flag", () => {
		expect(
			shouldBypassActionApproval(
				{ source: "local-server" },
				{ VETTA_CONFIG_DIR: ".vetta-dev", VETTA_DEV_AUTO_APPROVE_ACTIONS: "1" },
			),
		).toBe(true);
		expect(
			shouldBypassActionApproval(
				{ source: "local-server" },
				{ VETTA_CONFIG_DIR: ".vetta-dev", VETTA_DEV_AUTO_APPROVE_ACTIONS: "0" },
			),
		).toBe(false);
	});

	it("never bypasses approvals for production or internal callers", () => {
		expect(
			shouldBypassActionApproval(
				{ source: "local-server" },
				{ VETTA_CONFIG_DIR: ".vetta", VETTA_DEV_AUTO_APPROVE_ACTIONS: "1" },
			),
		).toBe(false);
		expect(
			shouldBypassActionApproval(
				{ source: "internal" },
				{ VETTA_CONFIG_DIR: ".vetta-dev", VETTA_DEV_AUTO_APPROVE_ACTIONS: "1" },
			),
		).toBe(false);
	});
});
