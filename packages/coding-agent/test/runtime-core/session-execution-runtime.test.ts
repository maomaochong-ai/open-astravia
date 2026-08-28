import type { RuntimeSessionObservationEvent } from "@vetta/runtime-core";
import type { AgentSession, ModelCallContributionContext, SessionContextRecord } from "@vetta/runtime-core/kernel";
import { createNodeSandboxCodingToolEnvironment, type ForegroundCommandOperations } from "@vetta/runtime-node/coding";
import type { CodingToolCatalogEntry } from "@vetta/runtime-tools";
import { describe, expect, it } from "vitest";
import type { CodingAgentSandboxAuthorizationPort } from "../../src/execution/sandbox/authorization-contract.js";
import { CodingAgentSessionExecutionRuntime } from "../../src/execution/session/runtime.js";
import { createCodingAgentNodeSessionExecutionEnvironment } from "../../src/host/tool-environment/node/node-session-execution-environment.js";

describe("CodingAgentSessionExecutionRuntime", () => {
	it("switches execution mode per session and reports the real busy state", async () => {
		let state: AgentSession["state"] = "idle";
		const fixture = createRuntimeFixture("session-mode");
		const controller = fixture.runtime.createExecutionController({
			get state() {
				return state;
			},
		} as unknown as AgentSession);

		expect(fixture.runtime.readRegistrations().map(({ tool }) => tool.name)).toEqual([
			"bash",
			"shell",
			"task_output",
			"task_stop",
		]);
		expect(controller.isBusy()).toBe(false);
		state = "running";
		expect(controller.isBusy()).toBe(true);
		state = "idle";

		await controller.reconfigure({
			mode: "sandbox",
			sessionId: "session-mode",
		});

		expect(fixture.runtime.readMode()).toBe("sandbox");
		expect(fixture.runtime.readRegistrations().map(({ tool }) => tool.name)).toEqual(
			expect.arrayContaining(["read", "write", "edit", "task_output", "task_stop"]),
		);

		await controller.reconfigure({
			mode: "full-access",
			sessionId: "session-mode",
		});
		expect(fixture.runtime.readRegistrations().map(({ tool }) => tool.name)).toEqual([
			"bash",
			"shell",
			"task_output",
			"task_stop",
		]);
		await fixture.runtime.dispose();
		expect(fixture.environmentDisposeCalls).toBe(1);
	});

	it("preserves the product model order when sandbox replaces execution tools", async () => {
		const fixture = createRuntimeFixture("session-sandbox-order", (toolName) =>
			createSourceToolEntry(toolName, "active", "1", toolName === "read" ? 100 : undefined),
		);
		const controller = fixture.runtime.createExecutionController({ state: "idle" } as unknown as AgentSession);

		try {
			await controller.reconfigure({
				mode: "sandbox",
				sessionId: "session-sandbox-order",
			});

			const readRegistration = fixture.runtime.readRegistrations().find(({ tool }) => tool.name === "read");
			expect(readRegistration).toMatchObject({
				modelOrder: 100,
				tool: { modelOrder: 100 },
			});
		} finally {
			await fixture.runtime.dispose();
		}
	});

	it("applies shared registry removal to future frames without revoking an advertised Turn tool", async () => {
		const states = new Map<string, CodingToolCatalogEntry["state"]>();
		let bashRevision = "1";
		const fixture = createRuntimeFixture("session-dynamic", (toolName) =>
			createSourceToolEntry(toolName, states.get(toolName) ?? "active", toolName === "bash" ? bashRevision : "1"),
		);
		const signal = new AbortController().signal;
		const prepared = await fixture.runtime.feature.prepare({ signal });
		const contribution = await prepared.contribute({ signal });
		const provider = contribution.modelCallProviders?.[0];
		if (!provider) throw new Error("Expected session execution model-call provider");

		try {
			const initialTools = (await provider.contribute(modelCallContext(signal))).tools ?? [];
			expect(initialTools.map(({ name }) => name)).toEqual(["bash", "shell", "task_output", "task_stop"]);

			states.set("bash", "deactivated");
			expect((await provider.contribute(modelCallContext(signal))).tools?.map(({ name }) => name)).toEqual([
				"shell",
				"task_output",
				"task_stop",
			]);
			const advertisedBash = initialTools.find(({ name }) => name === "bash");
			if (!advertisedBash) throw new Error("Expected advertised bash tool");
			await expect(
				advertisedBash.execute({
					sessionId: "session-dynamic",
					turnId: "turn-dynamic",
					toolCallId: "tool-bash",
					input: { command: process.platform === "win32" ? "Write-Output stable" : "printf stable" },
					signal,
				}),
			).resolves.toMatchObject({ content: expect.any(Array) });

			states.set("bash", "active");
			bashRevision = "2";
			expect(fixture.runtime.ownsTool("bash")).toBe(false);
			expect((await provider.contribute(modelCallContext(signal))).tools?.map(({ name }) => name)).toEqual([
				"shell",
				"task_output",
				"task_stop",
			]);
		} finally {
			await prepared.dispose();
			await fixture.runtime.dispose();
		}
	});

	it("isolates background tasks and publishes session observations plus model-visible notifications", async () => {
		const first = createRuntimeFixture("session-first");
		const second = createRuntimeFixture("session-second");
		const command = process.platform === "win32" ? "Write-Output done" : "true";

		try {
			const task = first.runtime.backgroundService.spawn({
				command,
				cwd: process.cwd(),
				env: { ...process.env },
			});

			expect(task.id).toBe("b1");
			expect(first.runtime.backgroundService.list()).toHaveLength(1);
			expect(second.runtime.backgroundService.list()).toEqual([]);

			const result = await first.runtime.backgroundService.wait(task.id, { maxMs: 5_000 });
			expect(result.stillRunning).toBe(false);
			expect(result.snapshot.status).toBe("completed");
			expect(first.observations.some(({ type }) => type === "background_tasks_update")).toBe(true);
			expect(second.observations).toEqual([]);
			expect(first.records).toEqual([
				expect.objectContaining({
					type: "task-notification",
					modelVisible: true,
					display: true,
				}),
			]);
			expect(second.records).toEqual([]);
		} finally {
			await Promise.all([first.runtime.dispose(), second.runtime.dispose()]);
		}
	});
});

function createRuntimeFixture(
	sessionId: string,
	resolveToolEntry?: (toolName: string) => CodingToolCatalogEntry | undefined,
): {
	readonly runtime: CodingAgentSessionExecutionRuntime;
	readonly observations: RuntimeSessionObservationEvent[];
	readonly records: SessionContextRecord[];
	readonly asyncDeliveries: number;
	readonly environmentDisposeCalls: number;
} {
	const observations: RuntimeSessionObservationEvent[] = [];
	const records: SessionContextRecord[] = [];
	let asyncDeliveries = 0;
	let environmentDisposeCalls = 0;
	const environment = createCodingAgentNodeSessionExecutionEnvironment({
		cwd: process.cwd(),
		scenario: "cli",
	});
	const sandboxCommandOperations: ForegroundCommandOperations = {
		async exec(_command, _cwd, options) {
			options.onData(Buffer.from("ok"));
			return { exitCode: 0 };
		},
	};
	const runtime = new CodingAgentSessionExecutionRuntime({
		cwd: process.cwd(),
		sandboxAuthorization: DENY_SANDBOX_AUTHORIZATION,
		environment: {
			...environment,
			sandbox: {
				createToolSet: () =>
					createNodeSandboxCodingToolEnvironment({
						cwd: process.cwd(),
						platform: "linux",
						commandOperations: sandboxCommandOperations,
						editPathPolicy: { getRejectionReason: () => undefined },
						writePathPolicy: { getRejectionReason: () => undefined },
					}),
			},
			dispose: async () => {
				environmentDisposeCalls += 1;
				await environment.dispose();
			},
		},
		activation: {
			mode: "explicit",
			toolNames: ["bash", "shell", "read", "write", "edit", "task_output", "task_stop"],
		},
		readSessionId: () => sessionId,
		resolveToolEntry,
		resourceContext: {
			operation: "create",
			contextAppender: {
				append: (next) => {
					records.push(...next);
				},
			},
			async deliverAsyncContext(next) {
				asyncDeliveries += 1;
				records.push(...next);
			},
			abortCurrentRun() {},
			async reportObservation(observation) {
				observations.push(observation);
			},
		},
	});
	return {
		runtime,
		observations,
		records,
		get asyncDeliveries() {
			return asyncDeliveries;
		},
		get environmentDisposeCalls() {
			return environmentDisposeCalls;
		},
	};
}

const DENY_SANDBOX_AUTHORIZATION: CodingAgentSandboxAuthorizationPort = {
	isAvailable: () => false,
	request: async () => "deny",
};

function createSourceToolEntry(
	toolName: string,
	state: CodingToolCatalogEntry["state"],
	revision: string,
	modelOrder?: number,
): CodingToolCatalogEntry {
	return {
		binding: {
			sourceId: "shared-tools",
			capabilityId: toolName,
			revision,
		},
		registration: {
			...(modelOrder !== undefined ? { modelOrder } : {}),
			tool: {
				name: toolName,
				label: toolName,
				description: toolName,
				...(modelOrder !== undefined ? { modelOrder } : {}),
				inputSchema: { type: "object" },
				execute: async () => ({ content: [] }),
			},
			scopeUse: [],
			category: "core",
		},
		state,
	};
}

function modelCallContext(signal: AbortSignal): ModelCallContributionContext {
	return {
		sessionId: "session-dynamic",
		turnId: "turn-dynamic",
		signal,
	};
}
