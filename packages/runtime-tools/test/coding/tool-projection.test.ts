import type {
	ModelCallFrameCompositionContext,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	createModelOnlyToolInputPropertyProjector,
	RuntimeToolProjectionPipeline,
	type RuntimeToolProjector,
} from "../../src/coding/index.js";

describe("Runtime Tool projection pipeline", () => {
	it("projects the model-facing surface without mutating the base Tool", () => {
		const base = tool("read");
		const pipeline = new RuntimeToolProjectionPipeline([
			{
				id: "model-copy",
				order: 100,
				project: () => ({
					patch: {
						label: "Projected read",
						description: "Projected description",
						modelOrder: 42,
					},
				}),
			},
		]);

		const projected = pipeline.projectTools(new Map([[base.name, base]]), frameContext()).get(base.name);

		expect(projected).toMatchObject({
			name: "read",
			label: "Projected read",
			description: "Projected description",
			modelOrder: 42,
		});
		expect(base).toMatchObject({
			name: "read",
			label: "read",
			description: "read description",
		});
	});

	it("applies projections in stable order", () => {
		const pipeline = new RuntimeToolProjectionPipeline([
			descriptionProjector("late", 200, "late"),
			descriptionProjector("early", 100, "early"),
		]);

		const projected = pipeline.projectTools(new Map([["read", tool("read")]]), frameContext()).get("read");

		expect(projected?.description).toBe("late");
	});

	it("rejects input-schema patches that do not map back to the previous Tool contract", () => {
		const pipeline = new RuntimeToolProjectionPipeline([
			{
				id: "unsafe-schema-change",
				order: 100,
				project: () => ({ patch: { inputSchema: { type: "object", properties: {} } } }),
			},
		]);

		expect(() => pipeline.projectTools(new Map([["read", tool("read")]]), frameContext())).toThrow(
			"changed inputSchema without an input mapper",
		);
	});

	it("adds a model-only input property and maps it away before the base validator and handler", async () => {
		let executedInput: Readonly<Record<string, unknown>> | undefined;
		const base: RuntimeToolDefinition = {
			...tool("read"),
			inputSchema: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
				additionalProperties: false,
			},
			validateInput(input) {
				expect(input).toEqual({ path: "README.md" });
				return { path: String(input.path).toUpperCase() };
			},
			async execute(request) {
				executedInput = request.input;
				return { content: [{ type: "text", text: "ok" }] };
			},
		};
		const pipeline = new RuntimeToolProjectionPipeline([
			createModelOnlyToolInputPropertyProjector({
				id: "call-description",
				order: 100,
				propertyName: "description",
				propertySchema: { type: "string", maxLength: 100 },
			}),
		]);

		const projected = pipeline.projectTools(new Map([[base.name, base]]), frameContext()).get(base.name);
		if (!projected?.validateInput) throw new Error("Projected Tool is missing input validation");
		const input = projected.validateInput({ path: "README.md", description: "Read project guidance" });
		await projected.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input,
			signal: new AbortController().signal,
		});

		expect(projected.inputSchema).toMatchObject({
			properties: {
				path: { type: "string" },
				description: { type: "string", maxLength: 100 },
			},
			required: ["path"],
			additionalProperties: false,
		});
		expect(executedInput).toEqual({ path: "README.MD" });
		expect((base.inputSchema.properties as Record<string, unknown>).description).toBeUndefined();
	});

	it("preserves an explicitly declared property as the Tool-owned override", () => {
		const base: RuntimeToolDefinition = {
			...tool("publish"),
			inputSchema: {
				type: "object",
				properties: { description: { type: "string", minLength: 20 } },
				required: ["description"],
			},
		};
		const pipeline = new RuntimeToolProjectionPipeline([
			createModelOnlyToolInputPropertyProjector({
				id: "call-description",
				order: 100,
				propertyName: "description",
				propertySchema: { type: "string", maxLength: 100 },
			}),
		]);

		const projected = pipeline.projectTools(new Map([[base.name, base]]), frameContext()).get(base.name);

		expect(projected).toBe(base);
	});

	it("supports context-aware selection and preserves malformed property maps", () => {
		const projector = createModelOnlyToolInputPropertyProjector({
			id: "selected-property",
			order: 100,
			propertyName: "host_note",
			propertySchema: { type: "string" },
			appliesTo: (toolDefinition, context) =>
				toolDefinition.name.startsWith("selected") && context.sessionId === "session-1",
		});
		const malformed = {
			...tool("selected-malformed"),
			inputSchema: { type: "object", properties: "not-an-object" },
		};
		const other = tool("other");
		const pipeline = new RuntimeToolProjectionPipeline([projector]);

		const projected = pipeline.projectTools(
			new Map([
				["selected", tool("selected")],
				["other", other],
				["selected-malformed", malformed],
			]),
			frameContext(),
		);

		expect((projected.get("selected")?.inputSchema.properties as Record<string, unknown>).host_note).toEqual({
			type: "string",
		});
		expect(projected.get("other")).toBe(other);
		expect(projected.get("selected-malformed")).toBe(malformed);
	});

	it("adopts a recognized legacy model-only property without rewriting its schema", () => {
		const legacyProperty = { type: "string", maxLength: 100, description: "legacy narration" };
		const base: RuntimeToolDefinition = {
			...tool("read"),
			inputSchema: {
				type: "object",
				properties: { path: { type: "string" }, description: legacyProperty },
			},
		};
		const pipeline = new RuntimeToolProjectionPipeline([
			createModelOnlyToolInputPropertyProjector({
				id: "call-description",
				order: 100,
				propertyName: "description",
				propertySchema: { type: "string", maxLength: 100 },
				adoptExistingProperty: (schema) => schema.description === "legacy narration",
			}),
		]);

		const projected = pipeline.projectTools(new Map([[base.name, base]]), frameContext()).get(base.name);
		if (!projected?.validateInput) throw new Error("Projected Tool is missing input validation");

		expect(projected.inputSchema).toBe(base.inputSchema);
		expect(projected.validateInput({ path: "README.md", description: "Read guidance" })).toEqual({
			path: "README.md",
		});
	});

	it("captures dynamic projector state for one Turn and releases it once", async () => {
		let current = "first";
		let releases = 0;
		const projector: RuntimeToolProjector = {
			id: "dynamic-description",
			order: 100,
			bindForTurn() {
				const captured = current;
				return {
					id: this.id,
					order: this.order,
					project: () => ({ patch: { description: captured } }),
					releaseTurnBinding: () => {
						releases += 1;
					},
				};
			},
			project: () => ({ patch: { description: current } }),
		};
		const pipeline = new RuntimeToolProjectionPipeline([projector]);
		const bound = await pipeline.bindForTurn(turnContext());
		current = "second";

		expect(bound.projectTools(new Map([["read", tool("read")]]), frameContext()).get("read")?.description).toBe(
			"first",
		);
		await bound.releaseTurnBinding();
		await bound.releaseTurnBinding();
		expect(releases).toBe(1);
	});

	it("rejects duplicate projector identities and rolls back partial Turn binding", async () => {
		const releaseTurnBinding = vi.fn();
		const first: RuntimeToolProjector = {
			id: "first",
			order: 100,
			bindForTurn: () => ({
				id: "first",
				order: 100,
				project: () => undefined,
				releaseTurnBinding,
			}),
			project: () => undefined,
		};
		const failing: RuntimeToolProjector = {
			id: "failing",
			order: 200,
			bindForTurn: () => {
				throw new Error("binding failed");
			},
			project: () => undefined,
		};

		expect(() => new RuntimeToolProjectionPipeline([first, { ...first }])).toThrow(
			"Duplicate Runtime Tool projector id: first",
		);
		await expect(new RuntimeToolProjectionPipeline([first, failing]).bindForTurn(turnContext())).rejects.toThrow(
			"binding failed",
		);
		expect(releaseTurnBinding).toHaveBeenCalledOnce();
	});
});

function tool(name: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: `${name} description`,
		inputSchema: { type: "object", properties: {} },
		execute: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

function descriptionProjector(id: string, order: number, description: string): RuntimeToolProjector {
	return { id, order, project: () => ({ patch: { description } }) };
}

function frameContext(): ModelCallFrameCompositionContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		messages: [],
		signal: new AbortController().signal,
		frame: { instructions: [], tools: new Map() },
	};
}

function turnContext(): RuntimeSnapshotAcquireContext {
	return {
		sessionId: "session-1",
		operationId: "turn-1",
		reason: "turn",
		signal: new AbortController().signal,
	};
}
