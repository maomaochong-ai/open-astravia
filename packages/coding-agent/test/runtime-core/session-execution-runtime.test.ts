import type { RuntimeSessionObservationEvent } from "@vetta/runtime-core";
import type { AgentSession, ModelCallContributionContext, SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { CodingToolCatalogEntry } from "@vetta/runtime-tools/coding";
import { describe, expect, it } from "vitest";
import { CodingAgentSessionExecutionRuntime } from "../../src/host/session-execution/execution-runtime.js";

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
		fixture.runtime.dispose();
	});

	it("reflects shared registry removal without rebuilding the session feature", async () => {
		const states = new Map<string, CodingToolCatalogEntry["state"]>();
		let bashRevision = "1";
		const fixture = createRuntimeFixture("session-dynamic", (toolName) =>
			createSourceToolEntry(toolName, states.get(toolName) ?? "active", toolName === "bash" ? bashRevision : "1"),
		);
		const signal = new AbortController().signal;
		const prepared = await fixture.runtime.feature.prepare({ signal });
		const contribution = await prepared.contribute({ profileId: "coding", signal });
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
					input: { command: "must-not-run" },
					signal,
				}),
			).rejects.toMatchObject({ code: "coding_tool_deactivated" });

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
			fixture.runtime.dispose();
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
			first.runtime.dispose();
			second.runtime.dispose();
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
} {
	const observations: RuntimeSessionObservationEvent[] = [];
	const records: SessionContextRecord[] = [];
	let asyncDeliveries = 0;
	const runtime = new CodingAgentSessionExecutionRuntime({
		cwd: process.cwd(),
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
	};
}

function createSourceToolEntry(
	toolName: string,
	state: CodingToolCatalogEntry["state"],
	revision: string,
): CodingToolCatalogEntry {
	return {
		binding: {
			sourceId: "shared-tools",
			capabilityId: toolName,
			revision,
		},
		registration: {
			tool: {
				name: toolName,
				label: toolName,
				description: toolName,
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
