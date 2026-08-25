import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "@vetta/runtime-core";
import {
	type RuntimeConfigurationDefinition,
	type RuntimeConfigurationJsonObject,
	type RuntimeConfigurationLayerSnapshot,
	RuntimeConfigurationRegistry,
	RuntimeConfigurationResolver,
} from "@vetta/runtime-core/configuration";
import type {
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
	RuntimeToolExecutionRequest,
} from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	CODING_TOOL_CONFIGURATION_ERROR_CODES,
	CODING_TOOL_CONFIGURATION_ISSUE_OBSERVATION,
	CODING_TOOL_CONFIGURATION_OBSERVATION,
	type CodingToolRegistration,
	withCodingToolConfiguration,
} from "../../src/coding/index.js";

type ToolConfiguration = RuntimeConfigurationJsonObject & {
	readonly prefix: string;
};

describe("Coding Tool configuration adapter", () => {
	it("keeps tools without configuration on the unchanged registration path", () => {
		const registration = baseRegistration("plain");

		expect(registration.configuration).toBeUndefined();
		expect(registration.tool.bindForTurn).toBeUndefined();
	});

	it("captures configuration per Turn and keeps older bindings stable", async () => {
		const harness = configurationHarness([{ id: "user", revision: "1", precedence: 100, values: {} }]);
		const configured = configuredRegistration(baseRegistration("configurable"), harness);
		const oldBinding = configured.tool.bindForTurn?.(turnContext("turn-old"));
		if (!oldBinding) throw new Error("Missing old configured binding");

		harness.layers = [
			{
				id: "user",
				revision: "2",
				precedence: 100,
				values: { "tool.output": { prefix: "new" } },
			},
		];
		const newBinding = configured.tool.bindForTurn?.(turnContext("turn-new"));
		if (!newBinding) throw new Error("Missing new configured binding");

		expect(await execute(oldBinding.tool, "turn-old")).toEqual({
			content: [{ type: "text", text: "default:configurable" }],
		});
		expect(await execute(newBinding.tool, "turn-new")).toEqual({
			content: [{ type: "text", text: "new:configurable" }],
		});
		expect(harness.records.filter(({ token }) => token === CODING_TOOL_CONFIGURATION_OBSERVATION)).toHaveLength(2);

		await oldBinding.release();
		await newBinding.release();
		expect(harness.registry.snapshot().activeLeaseCount).toBe(0);
		await harness.registry.close();
	});

	it("composes a legacy Tool binding and releases both leases exactly once", async () => {
		let toolReleases = 0;
		const harness = configurationHarness([]);
		const base = baseRegistration("legacy");
		const legacy: CodingToolRegistration = {
			...base,
			tool: {
				...base.tool,
				bindForTurn: () => ({
					tool: {
						...base.tool,
						execute: async () => ({ content: [{ type: "text", text: "legacy-bound" }] }),
					},
					release: async () => {
						toolReleases += 1;
					},
				}),
			},
		};
		const configured = configuredRegistration(legacy, harness, "adapter");
		const binding = configured.tool.bindForTurn?.(turnContext("turn-legacy"));
		if (!binding) throw new Error("Missing legacy configured binding");

		expect(await execute(binding.tool, "turn-legacy")).toEqual({
			content: [{ type: "text", text: "default:legacy-bound" }],
		});
		await binding.release();
		await binding.release();

		expect(toolReleases).toBe(1);
		expect(harness.registry.snapshot().activeLeaseCount).toBe(0);
		await harness.registry.close();
	});

	it("requires an explicit policy and can fail closed when required configuration is absent", async () => {
		const harness = emptyConfigurationHarness();
		const registration = baseRegistration("required");
		const association = {
			configurationIds: ["missing.configuration"],
			requiredConfigurationIds: ["missing.configuration"],
			support: "host-policy" as const,
		};

		expect(() =>
			withCodingToolConfiguration(registration, {
				association,
				source: harness.source,
				configure: ({ tool }) => tool,
			}),
		).toThrow(expect.objectContaining({ code: CODING_TOOL_CONFIGURATION_ERROR_CODES.INVALID_BINDING }));

		const configured = withCodingToolConfiguration(registration, {
			association,
			source: harness.source,
			configure: ({ tool }) => tool,
			onMissingConfiguration: "fail",
			observationPublisher: harness.publisher,
		});
		expect(() => configured.tool.bindForTurn?.(turnContext("turn-required"))).toThrow(
			expect.objectContaining({ code: CODING_TOOL_CONFIGURATION_ERROR_CODES.MISSING_REQUIRED }),
		);
		await settleReleases();

		expect(harness.registry.snapshot().activeLeaseCount).toBe(0);
		expect(harness.records.some(({ token }) => token === CODING_TOOL_CONFIGURATION_ISSUE_OBSERVATION)).toBe(true);
		await harness.registry.close();
	});

	it("can explicitly fall back for a black-box Tool and emits value-free warning metadata", async () => {
		const harness = emptyConfigurationHarness();
		const configured = withCodingToolConfiguration(baseRegistration("black-box"), {
			association: {
				configurationIds: ["missing.configuration"],
				requiredConfigurationIds: ["missing.configuration"],
				support: "host-policy",
			},
			source: harness.source,
			configure: ({ tool }) => tool,
			onMissingConfiguration: "use-unconfigured",
			observationPublisher: harness.publisher,
		});
		const binding = configured.tool.bindForTurn?.(turnContext("turn-fallback"));
		if (!binding) throw new Error("Missing fallback binding");

		expect(await execute(binding.tool, "turn-fallback")).toEqual({
			content: [{ type: "text", text: "black-box" }],
		});
		expect(harness.records.map(({ token }) => token)).toContain(CODING_TOOL_CONFIGURATION_ISSUE_OBSERVATION);
		expect(JSON.stringify(harness.records)).not.toContain("configurationValue");
		await binding.release();
		await harness.registry.close();
	});

	it("rejects adapters that change the stable Tool name and releases the configuration lease", async () => {
		const harness = configurationHarness([]);
		const configured = withCodingToolConfiguration(baseRegistration("stable-name"), {
			association: { configurationIds: [harness.definition.id], support: "adapter" },
			source: harness.source,
			configure: ({ tool }) => ({ ...tool, name: "renamed" }),
			observationPublisher: harness.publisher,
		});

		expect(() => configured.tool.bindForTurn?.(turnContext("turn-renamed"))).toThrow(
			expect.objectContaining({ code: CODING_TOOL_CONFIGURATION_ERROR_CODES.TOOL_NAME_CHANGED }),
		);
		await settleReleases();
		expect(harness.registry.snapshot().activeLeaseCount).toBe(0);
		await harness.registry.close();
	});
});

function configuredRegistration(
	registration: CodingToolRegistration,
	harness: ReturnType<typeof configurationHarness>,
	support: "native" | "adapter" = "native",
): CodingToolRegistration {
	return withCodingToolConfiguration(registration, {
		association: { configurationIds: [harness.definition.id], support },
		source: harness.source,
		configure: ({ tool, configuration }) => {
			const value = configuration.read(harness.definition);
			if (!value) throw new Error("Missing typed configuration");
			return {
				...tool,
				async execute(request) {
					const result = await tool.execute(request);
					const text = result.content[0]?.type === "text" ? result.content[0].text : "";
					return { content: [{ type: "text", text: `${value.prefix}:${text}` }] };
				},
			};
		},
		observationPublisher: harness.publisher,
	});
}

function configurationHarness(initialLayers: readonly RuntimeConfigurationLayerSnapshot[]) {
	const records: RuntimeObservationRecord[] = [];
	const publisher = createRuntimeObservationPublisher({ port: { record: (record) => void records.push(record) } });
	const registry = new RuntimeConfigurationRegistry({ observationPublisher: publisher });
	const definition = toolConfigurationDefinition();
	registry.upsert({ source: { id: "builtin", revision: "1" }, definition });
	const resolver = new RuntimeConfigurationResolver(registry, { observationPublisher: publisher });
	const harness = {
		definition,
		registry,
		records,
		publisher,
		layers: initialLayers,
		source: {
			acquire: () => resolver.capture(harness.layers),
		},
	};
	return harness;
}

function emptyConfigurationHarness() {
	const records: RuntimeObservationRecord[] = [];
	const publisher = createRuntimeObservationPublisher({ port: { record: (record) => void records.push(record) } });
	const registry = new RuntimeConfigurationRegistry({ observationPublisher: publisher });
	const resolver = new RuntimeConfigurationResolver(registry, { observationPublisher: publisher });
	return {
		registry,
		records,
		publisher,
		source: { acquire: () => resolver.capture([]) },
	};
}

function toolConfigurationDefinition(): RuntimeConfigurationDefinition<ToolConfiguration> {
	return {
		id: "tool.output",
		schemaVersion: 1,
		descriptor: { title: "Tool output", schema: { type: "object" } },
		codec: {
			decode(value) {
				if (!isRecord(value) || typeof value.prefix !== "string") throw new TypeError("invalid prefix");
				return { prefix: value.prefix };
			},
		},
		defaultValue: { prefix: "default" },
		apply: "next-turn",
	};
}

function baseRegistration(name: string): CodingToolRegistration {
	return {
		tool: {
			name,
			label: name,
			description: name,
			inputSchema: { type: "object" },
			execute: async () => ({ content: [{ type: "text", text: name }] }),
		},
		scopeUse: ["project"],
		category: "core",
	};
}

function execute(tool: RuntimeToolDefinition, turnId: string) {
	const request: RuntimeToolExecutionRequest = {
		sessionId: "session-1",
		turnId,
		toolCallId: `call-${turnId}`,
		input: {},
		signal: new AbortController().signal,
	};
	return tool.execute(request);
}

function turnContext(operationId: string): RuntimeSnapshotAcquireContext {
	return {
		sessionId: "session-1",
		operationId,
		reason: "turn",
		signal: new AbortController().signal,
	};
}

async function settleReleases(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
