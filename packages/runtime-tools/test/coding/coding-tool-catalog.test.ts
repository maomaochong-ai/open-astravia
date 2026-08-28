import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "@vetta/runtime-core";
import type { RuntimeSnapshotAcquireContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	CODING_TOOL_AVAILABILITY_ERROR_CODES,
	CODING_TOOL_CATALOG_OBSERVATION,
	type CodingToolRegistration,
	GenerationalCodingToolCatalog,
	guardCodingToolRegistration,
	InMemoryCodingToolRegistry,
	PRESERVE_CODING_TOOL_RESULT_POLICY,
} from "../../src/coding/index.js";

describe("coding tool registry", () => {
	it("publishes safe catalog changes through an arbitrary observation adapter", () => {
		const records: RuntimeObservationRecord[] = [];
		const registry = new InMemoryCodingToolRegistry([], {
			observationPublisher: createRuntimeObservationPublisher({
				port: {
					record: (record) => {
						records.push(record);
					},
				},
			}),
		});

		registry.register(registration("observed"));
		registry.deactivate("observed");
		registry.activate("observed");
		registry.revoke("observed", { reason: "secret-reason", auditId: "secret-audit" });
		registry.unregister("observed");

		expect(records.map(({ token, payload }) => [token, (payload as { operation?: string }).operation])).toEqual([
			[CODING_TOOL_CATALOG_OBSERVATION, "register"],
			[CODING_TOOL_CATALOG_OBSERVATION, "deactivate"],
			[CODING_TOOL_CATALOG_OBSERVATION, "activate"],
			[CODING_TOOL_CATALOG_OBSERVATION, "revoke"],
			[CODING_TOOL_CATALOG_OBSERVATION, "unregister"],
		]);
		expect(JSON.stringify(records)).not.toContain("secret-");
	});

	it("creates a deterministic frozen membership snapshot", () => {
		const registry = new InMemoryCodingToolRegistry([registration("zeta"), registration("alpha")]);

		const snapshot = registry.snapshot();

		expect(snapshot.version).toBe(0);
		expect(snapshot.registrations.map(({ tool }) => tool.name)).toEqual(["alpha", "zeta"]);
		expect(registry.snapshot()).toBe(snapshot);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.registrations)).toBe(true);
		expect(Object.isFrozen(snapshot.registrations[0])).toBe(true);
		expect(Object.isFrozen(snapshot.registrations[0]?.tool)).toBe(true);
		expect(Object.isFrozen(snapshot.entries)).toBe(true);
		expect(Object.isFrozen(snapshot.entries[0]?.binding)).toBe(true);
	});

	it("registers and unregisters without mutating older snapshots", () => {
		const registry = new InMemoryCodingToolRegistry([registration("alpha")]);
		const first = registry.snapshot();

		registry.register(registration("beta"));
		const second = registry.snapshot();
		expect(second.version).toBe(1);
		expect(second.registrations.map(({ tool }) => tool.name)).toEqual(["alpha", "beta"]);
		expect(first.registrations.map(({ tool }) => tool.name)).toEqual(["alpha"]);

		expect(registry.unregister("alpha")).toBe(true);
		const third = registry.snapshot();
		expect(third.version).toBe(2);
		expect(third.registrations.map(({ tool }) => tool.name)).toEqual(["beta"]);
		expect(second.registrations.map(({ tool }) => tool.name)).toEqual(["alpha", "beta"]);

		expect(registry.unregister("missing")).toBe(false);
		expect(registry.snapshot()).toBe(third);
	});

	it("rejects duplicate tool names in initial and dynamic registrations", () => {
		expect(() => new InMemoryCodingToolRegistry([registration("duplicate"), registration("duplicate")])).toThrow(
			"Duplicate coding tool registration: duplicate",
		);

		const registry = new InMemoryCodingToolRegistry([registration("duplicate")]);
		expect(() => registry.register(registration("duplicate"))).toThrow(
			"Duplicate coding tool registration: duplicate",
		);
		expect(registry.snapshot().version).toBe(0);
	});

	it("preserves and freezes optional configuration metadata", () => {
		const configurationIds = ["tool.output"];
		const registry = new InMemoryCodingToolRegistry([
			{
				...registration("configured"),
				configuration: {
					configurationIds,
					requiredConfigurationIds: configurationIds,
					support: "adapter",
				},
			},
		]);
		configurationIds.push("mutated");
		const frozen = registry.snapshot().registrations[0];

		expect(frozen?.configuration).toEqual({
			configurationIds: ["tool.output"],
			requiredConfigurationIds: ["tool.output"],
			support: "adapter",
		});
		expect(Object.isFrozen(frozen?.configuration)).toBe(true);
		expect(Object.isFrozen(frozen?.configuration?.configurationIds)).toBe(true);
	});

	it("preserves class-backed tool execution when freezing the catalog definition", async () => {
		const registry = new InMemoryCodingToolRegistry([
			{
				tool: new ClassBackedTool("class-tool"),
			},
		]);
		const tool = registry.snapshot().registrations[0]?.tool;
		if (!tool) throw new Error("Missing registered tool");

		const result = await tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "tool-call-1",
			input: {},
			signal: new AbortController().signal,
		});

		expect(result.content).toEqual([{ type: "text", text: "class-tool" }]);
	});

	it("lets a registration override the catalog result projection policy", async () => {
		const registry = new InMemoryCodingToolRegistry(
			[
				registration("projected"),
				{ ...registration("preserved"), resultPolicy: PRESERVE_CODING_TOOL_RESULT_POLICY },
			],
			{
				resultPolicy: {
					project: async () => ({ content: [{ type: "text", text: "projected-result" }] }),
				},
			},
		);
		const projected = registry.resolve("projected");
		const preserved = registry.resolve("preserved");
		if (!projected || !preserved) throw new Error("Missing result policy test registration");

		expect((await execute(guardCodingToolRegistration(registry, projected))).content).toEqual([
			{ type: "text", text: "projected-result" },
		]);
		expect((await execute(guardCodingToolRegistration(registry, preserved))).content).toEqual([
			{ type: "text", text: "preserved" },
		]);
	});

	it("keeps an advertised implementation stable after replacement", async () => {
		let replacementExecutions = 0;
		const registry = new InMemoryCodingToolRegistry([registration("replaceable")]);
		const lease = registry.acquireSnapshot();
		const advertised = lease.snapshot.entries[0];
		if (!advertised) throw new Error("Missing advertised registration");
		const guarded = guardCodingToolRegistration(registry, advertised);

		expect(registry.unregister("replaceable")).toBe(true);
		const replacement = registration("replaceable");
		registry.register({
			...replacement,
			tool: {
				...replacement.tool,
				async execute() {
					replacementExecutions += 1;
					return { content: [] };
				},
			},
		});

		expect((await execute(guarded)).content).toEqual([{ type: "text", text: "replaceable" }]);
		expect(replacementExecutions).toBe(0);

		await lease.release();
		await expect(execute(guarded)).rejects.toMatchObject({
			code: CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE,
		});
	});

	it("acquires and releases external implementation leases with the catalog generation", async () => {
		let releases = 0;
		const base = registration("leased");
		const registry = new InMemoryCodingToolRegistry([
			{
				...base,
				tool: {
					...base.tool,
					bindForTurn: () => ({
						tool: {
							...base.tool,
							execute: async () => ({ content: [{ type: "text", text: "leased-generation" }] }),
						},
						release: async () => {
							releases += 1;
						},
					}),
				},
			},
		]);
		const lease = registry.acquireSnapshot(turnContext());
		const entry = lease.snapshot.entries[0];
		if (!entry) throw new Error("Missing leased tool");
		const guarded = guardCodingToolRegistration(registry, entry);

		expect(registry.unregister("leased")).toBe(true);
		expect((await execute(guarded)).content).toEqual([{ type: "text", text: "leased-generation" }]);
		expect(releases).toBe(0);

		await lease.release();
		expect(releases).toBe(1);
		await expect(execute(guarded)).rejects.toMatchObject({
			code: CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE,
		});
	});

	it("uses stable binding values instead of catalog entry object identity", async () => {
		const registry = new InMemoryCodingToolRegistry([registration("stable")], {
			sourceId: "test-catalog",
		});
		const entry = registry.resolve("stable");
		if (!entry) throw new Error("Missing stable entry");

		const result = await registry.execute(
			{ ...entry.binding },
			{
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "tool-call-1",
				input: {},
				signal: new AbortController().signal,
			},
		);

		expect(entry.binding).toEqual({
			sourceId: "test-catalog",
			capabilityId: "stable",
			revision: "1",
		});
		expect(result.content).toEqual([{ type: "text", text: "stable" }]);
	});

	it("deactivates future acquisitions without invalidating an advertised binding", async () => {
		const registry = new InMemoryCodingToolRegistry([registration("toggle")]);
		const advertised = registry.resolve("toggle");
		if (!advertised) throw new Error("Missing toggle entry");
		const guarded = guardCodingToolRegistration(registry, advertised);

		expect(registry.deactivate("toggle")).toBe(true);
		expect(registry.snapshot().registrations).toEqual([]);
		expect((await execute(guarded)).content).toEqual([{ type: "text", text: "toggle" }]);

		expect(registry.activate("toggle")).toBe(true);
		expect(registry.resolve("toggle")?.binding).toEqual(advertised.binding);
		expect((await execute(guarded)).content).toEqual([{ type: "text", text: "toggle" }]);
	});

	it("revokes old bindings and aborts their in-flight executions", async () => {
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const registry = new InMemoryCodingToolRegistry([
			{
				...registration("revocable"),
				tool: {
					...registration("revocable").tool,
					async execute(request) {
						markStarted?.();
						await new Promise<void>((_resolve, reject) => {
							request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
						});
						return { content: [] };
					},
				},
			},
		]);
		const advertised = registry.resolve("revocable");
		if (!advertised) throw new Error("Missing revocable entry");
		const guarded = guardCodingToolRegistration(registry, advertised);
		const execution = execute(guarded);

		await started;
		expect(
			registry.revoke("revocable", {
				reason: "security policy changed",
				auditId: "audit-revocable",
			}),
		).toBe(true);
		await expect(execution).rejects.toMatchObject({
			code: CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED,
			details: {
				code: CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED,
				retryable: false,
			},
		});
		expect(registry.activate("revocable")).toBe(false);
		expect(registry.resolve("revocable")?.binding.revision).not.toBe(advertised.binding.revision);
	});

	it("discards a late result when the revoked implementation ignores cancellation", async () => {
		let finish: (() => void) | undefined;
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const baseRegistration = registration("ignores-cancellation");
		const registry = new InMemoryCodingToolRegistry([
			{
				...baseRegistration,
				tool: {
					...baseRegistration.tool,
					async execute() {
						markStarted?.();
						await finished;
						return { content: [{ type: "text", text: "late success" }] };
					},
				},
			},
		]);
		const advertised = registry.resolve("ignores-cancellation");
		if (!advertised) throw new Error("Missing ignores-cancellation entry");
		const execution = execute(guardCodingToolRegistration(registry, advertised));

		await started;
		expect(
			registry.revoke("ignores-cancellation", {
				reason: "security policy changed",
				auditId: "audit-ignores-cancellation",
			}),
		).toBe(true);
		finish?.();

		await expect(execution).rejects.toMatchObject({
			code: CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED,
			details: {
				code: CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED,
				retryable: false,
			},
		});
	});

	it("allows in-flight executions to finish after deactivate or unregister", async () => {
		for (const operation of ["deactivate", "unregister"] as const) {
			let finish: (() => void) | undefined;
			let markStarted: (() => void) | undefined;
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			const finished = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const registry = new InMemoryCodingToolRegistry([
				{
					...registration(operation),
					tool: {
						...registration(operation).tool,
						async execute(request) {
							markStarted?.();
							await finished;
							expect(request.signal.aborted).toBe(false);
							return { content: [{ type: "text", text: operation }] };
						},
					},
				},
			]);
			const advertised = registry.resolve(operation);
			if (!advertised) throw new Error(`Missing ${operation} entry`);
			const execution = execute(guardCodingToolRegistration(registry, advertised));

			await started;
			expect(registry[operation](operation)).toBe(true);
			finish?.();

			expect((await execution).content).toEqual([{ type: "text", text: operation }]);
		}
	});
});

describe("generational coding tool catalog", () => {
	it("keeps a leased generation executable until release while new Turns see the latest catalog", async () => {
		const first = new InMemoryCodingToolRegistry([registrationWithOutput("mode-tool", "first")], {
			sourceId: "mode:1",
		});
		const catalog = new GenerationalCodingToolCatalog(first);
		const lease = catalog.acquireSnapshot();
		const oldEntry = lease.snapshot.entries[0];
		if (!oldEntry) throw new Error("Missing old tool entry");
		const oldTool = guardCodingToolRegistration(catalog, oldEntry);

		catalog.publish(
			new InMemoryCodingToolRegistry([registrationWithOutput("mode-tool", "second")], {
				sourceId: "mode:2",
			}),
		);

		expect(catalog.snapshot().entries[0]?.binding.sourceId).toBe("mode:2");
		expect((await execute(oldTool)).content).toEqual([{ type: "text", text: "first" }]);
		await lease.release();
		await expect(execute(oldTool)).rejects.toMatchObject({
			code: CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE,
		});
	});

	it("rejects binding identity reuse while the old generation is leased", () => {
		const first = new InMemoryCodingToolRegistry([registration("mode-tool")], {
			sourceId: "same-source",
		});
		const catalog = new GenerationalCodingToolCatalog(first);
		const lease = catalog.acquireSnapshot();

		expect(() =>
			catalog.publish(
				new InMemoryCodingToolRegistry([registration("mode-tool")], {
					sourceId: "same-source",
				}),
			),
		).toThrow("reuses a leased binding");
		void lease.release();
	});
});

function registration(name: string): CodingToolRegistration {
	const tool: RuntimeToolDefinition = {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object" },
		async execute() {
			return {
				content: [{ type: "text", text: name }],
			};
		},
	};
	return {
		tool,
	};
}

function registrationWithOutput(name: string, output: string): CodingToolRegistration {
	const base = registration(name);
	return {
		...base,
		tool: {
			...base.tool,
			execute: async () => ({ content: [{ type: "text", text: output }] }),
		},
	};
}

class ClassBackedTool implements RuntimeToolDefinition {
	readonly name = "class-backed";
	readonly label = "class-backed";
	readonly description = "class-backed";
	readonly inputSchema = { type: "object" };

	constructor(private readonly output: string) {}

	async execute() {
		return {
			content: [{ type: "text" as const, text: this.output }],
		};
	}
}

function execute(tool: RuntimeToolDefinition) {
	return tool.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "tool-call-1",
		input: {},
		signal: new AbortController().signal,
	});
}

function turnContext(): RuntimeSnapshotAcquireContext {
	return {
		sessionId: "session-1",
		operationId: "turn-1",
		reason: "turn",
		signal: new AbortController().signal,
	};
}
