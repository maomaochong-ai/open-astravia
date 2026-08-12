import type { RuntimeSnapshotAcquireContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	CODING_TOOL_AVAILABILITY_ERROR_CODES,
	type CodingToolRegistration,
	type CodingToolScope,
	guardCodingToolRegistration,
	InMemoryCodingToolRegistry,
	selectCodingTools,
} from "../../src/coding/index.js";

describe("coding tool registry", () => {
	it("creates a deterministic frozen membership snapshot", () => {
		const registry = new InMemoryCodingToolRegistry([
			registration("zeta", ["project"]),
			registration("alpha", ["cli"]),
		]);

		const snapshot = registry.snapshot();

		expect(snapshot.version).toBe(0);
		expect(snapshot.registrations.map(({ tool }) => tool.name)).toEqual(["alpha", "zeta"]);
		expect(registry.snapshot()).toBe(snapshot);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.registrations)).toBe(true);
		expect(Object.isFrozen(snapshot.registrations[0])).toBe(true);
		expect(Object.isFrozen(snapshot.registrations[0]?.tool)).toBe(true);
		expect(Object.isFrozen(snapshot.registrations[0]?.scopeUse)).toBe(true);
		expect(Object.isFrozen(snapshot.entries)).toBe(true);
		expect(Object.isFrozen(snapshot.entries[0]?.binding)).toBe(true);
	});

	it("registers and unregisters without mutating older snapshots", () => {
		const registry = new InMemoryCodingToolRegistry([registration("alpha", ["project"])]);
		const first = registry.snapshot();

		registry.register(registration("beta", ["project"]));
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
		expect(
			() =>
				new InMemoryCodingToolRegistry([
					registration("duplicate", ["project"]),
					registration("duplicate", ["cli"]),
				]),
		).toThrow("Duplicate coding tool registration: duplicate");

		const registry = new InMemoryCodingToolRegistry([registration("duplicate", ["project"])]);
		expect(() => registry.register(registration("duplicate", ["cli"]))).toThrow(
			"Duplicate coding tool registration: duplicate",
		);
		expect(registry.snapshot().version).toBe(0);
	});

	it("copies registration scope metadata at the registry boundary", () => {
		const mutableScopes: CodingToolScope[] = ["project"];
		const registry = new InMemoryCodingToolRegistry([registration("alpha", mutableScopes)]);

		mutableScopes.push("cli");

		expect(registry.snapshot().registrations[0]?.scopeUse).toEqual(["project"]);
	});

	it("preserves class-backed tool execution when freezing the catalog definition", async () => {
		const registry = new InMemoryCodingToolRegistry([
			{
				tool: new ClassBackedTool("class-tool"),
				scopeUse: ["project"],
				category: "core",
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

	it("keeps an advertised implementation stable after replacement", async () => {
		let replacementExecutions = 0;
		const registry = new InMemoryCodingToolRegistry([registration("replaceable", ["project"])]);
		const lease = registry.acquireSnapshot();
		const advertised = lease.snapshot.entries[0];
		if (!advertised) throw new Error("Missing advertised registration");
		const guarded = guardCodingToolRegistration(registry, advertised);

		expect(registry.unregister("replaceable")).toBe(true);
		const replacement = registration("replaceable", ["project"]);
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
		const base = registration("leased", ["project"]);
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
		const registry = new InMemoryCodingToolRegistry([registration("stable", ["project"])], {
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
		const registry = new InMemoryCodingToolRegistry([registration("toggle", ["project"])]);
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
				...registration("revocable", ["project"]),
				tool: {
					...registration("revocable", ["project"]).tool,
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
		const baseRegistration = registration("ignores-cancellation", ["project"]);
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
					...registration(operation, ["project"]),
					tool: {
						...registration(operation, ["project"]).tool,
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

describe("coding tool activation", () => {
	const registrations = [
		registration("default-project", ["project"]),
		registration("default-cli", ["cli"]),
		registration("deferred", []),
	];

	it("selects scope defaults and additionally enabled tools", () => {
		expect(
			selectCodingTools(registrations, {
				mode: "scope",
				scope: "project",
				additionallyEnabledToolNames: ["deferred", "missing"],
			}).map(({ name }) => name),
		).toEqual(["default-project", "deferred"]);
	});

	it("supports an explicit replacement set and ignores unknown names", () => {
		expect(
			selectCodingTools(registrations, {
				mode: "explicit",
				toolNames: ["deferred", "missing"],
			}).map(({ name }) => name),
		).toEqual(["deferred"]);
	});

	it("uses cli as the default scope without activating empty-scope tools", () => {
		expect(
			selectCodingTools(registrations, {
				mode: "scope",
			}).map(({ name }) => name),
		).toEqual(["default-cli"]);
	});
});

function registration(name: string, scopeUse: readonly CodingToolScope[]): CodingToolRegistration {
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
		scopeUse,
		category: "core",
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
