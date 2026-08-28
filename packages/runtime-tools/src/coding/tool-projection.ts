import { Type } from "@sinclair/typebox";
import { formatToolArgumentValidationIssues, ToolArgumentsValidationError, validateToolArguments } from "@vetta/ai";
import type {
	ModelCallFrameCompositionContext,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";

export type RuntimeToolModelSurfacePatch = Partial<
	Pick<
		RuntimeToolDefinition,
		"label" | "description" | "inputSchema" | "modelOrder" | "contextSource" | "contextCategory"
	>
>;

export type RuntimeToolProjectionInputMapper = (
	input: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, unknown>>;

export interface RuntimeToolProjectionResult {
	/** Only model-facing fields are patchable; identity, execution, activation and authorization stay with their owners. */
	readonly patch?: RuntimeToolModelSurfacePatch;
	/** Maps the projected model input back to the previous Tool contract before execution. */
	readonly mapInput?: RuntimeToolProjectionInputMapper;
}

export interface RuntimeToolProjector {
	readonly id: string;
	readonly order: number;
	bindForTurn?(context: RuntimeSnapshotAcquireContext): Promise<RuntimeToolProjector> | RuntimeToolProjector;
	releaseTurnBinding?(): Promise<void> | void;
	project(
		tool: RuntimeToolDefinition,
		context: ModelCallFrameCompositionContext,
	): RuntimeToolProjectionResult | undefined;
}

export interface ModelOnlyToolInputPropertyProjectorOptions {
	readonly id: string;
	readonly order: number;
	readonly propertyName: string;
	readonly propertySchema: Readonly<Record<string, unknown>>;
	/** Limits the projection to a product-defined subset without coupling the pipeline to Tool provenance. */
	readonly appliesTo?: (tool: RuntimeToolDefinition, context: ModelCallFrameCompositionContext) => boolean;
	/** Recognizes a legacy copy of the same host-owned field so it can be mapped without rewriting its schema. */
	readonly adoptExistingProperty?: (propertySchema: Readonly<Record<string, unknown>>) => boolean;
	/** Existing Tool-owned properties win by default. Trusted hosts may explicitly replace or reject collisions. */
	readonly onConflict?: "preserve" | "replace" | "error";
	/** Non-object schemas are preserved by default because Tool parameters must remain provider-compatible. */
	readonly onUnsupportedSchema?: "preserve" | "error";
}

/**
 * Immutable, ordered projection of Runtime Tools into their model-visible form.
 *
 * External state is captured through {@link RuntimeToolProjector.bindForTurn}; projection itself stays synchronous
 * and may only read that captured state plus the current Turn-local model-call context.
 */
export class RuntimeToolProjectionPipeline {
	private readonly projectors: readonly RuntimeToolProjector[];
	private readonly releasableProjectors: readonly RuntimeToolProjector[];
	private released = false;

	constructor(
		projectors: readonly RuntimeToolProjector[],
		releasableProjectors: readonly RuntimeToolProjector[] = [],
	) {
		this.projectors = Object.freeze(normalizeProjectors(projectors));
		this.releasableProjectors = Object.freeze([...releasableProjectors]);
	}

	async bindForTurn(context: RuntimeSnapshotAcquireContext): Promise<RuntimeToolProjectionPipeline> {
		context.signal.throwIfAborted();
		const boundProjectors: RuntimeToolProjector[] = [];
		const releasableProjectors: RuntimeToolProjector[] = [];
		try {
			for (const projector of this.projectors) {
				context.signal.throwIfAborted();
				if (!projector.bindForTurn) {
					boundProjectors.push(projector);
					continue;
				}
				const bound = await projector.bindForTurn(context);
				assertBoundProjector(projector, bound);
				boundProjectors.push(bound);
				releasableProjectors.push(bound);
			}
			context.signal.throwIfAborted();
			return new RuntimeToolProjectionPipeline(boundProjectors, releasableProjectors);
		} catch (error) {
			await releaseProjectors(releasableProjectors);
			throw error;
		}
	}

	projectTools(
		tools: ReadonlyMap<string, RuntimeToolDefinition>,
		context: ModelCallFrameCompositionContext,
	): ReadonlyMap<string, RuntimeToolDefinition> {
		const projected = new Map<string, RuntimeToolDefinition>();
		for (const [name, baseTool] of tools) {
			const tool = this.projectTool(baseTool, context);
			if (tool.name !== name) {
				throw new Error(`Runtime Tool map key does not match stable name: ${name} != ${tool.name}`);
			}
			projected.set(name, tool);
		}
		return projected;
	}

	projectTool(baseTool: RuntimeToolDefinition, context: ModelCallFrameCompositionContext): RuntimeToolDefinition {
		let tool = baseTool;
		for (const projector of this.projectors) {
			context.signal.throwIfAborted();
			const stableName = tool.name;
			const result = projector.project(tool, context);
			if (result) tool = applyProjection(tool, result, projector.id);
			if (tool.name !== stableName) {
				throw new Error(`Runtime Tool projection changed stable name: ${stableName} -> ${tool.name}`);
			}
		}
		return tool;
	}

	async releaseTurnBinding(): Promise<void> {
		if (this.released) return;
		this.released = true;
		await releaseProjectors(this.releasableProjectors);
	}
}

/** Creates a reusable projection for a host-owned model-only input property. */
export function createModelOnlyToolInputPropertyProjector(
	options: ModelOnlyToolInputPropertyProjectorOptions,
): RuntimeToolProjector {
	const propertyName = requireIdentifier(options.propertyName, "propertyName");
	return Object.freeze({
		id: requireIdentifier(options.id, "id"),
		order: requireFiniteOrder(options.order),
		project(tool: RuntimeToolDefinition, context: ModelCallFrameCompositionContext) {
			if (options.appliesTo && !options.appliesTo(tool, context)) return undefined;
			const schema = tool.inputSchema;
			const declaredProperties = schema.properties;
			const sourceProperties = declaredProperties === undefined ? {} : asRecord(declaredProperties);
			if (schema.type !== "object" || !sourceProperties) {
				if (options.onUnsupportedSchema === "error") {
					throw new Error(`Runtime Tool ${tool.name} must use an object input schema to project ${propertyName}`);
				}
				return undefined;
			}
			const hasProperty = Object.hasOwn(sourceProperties, propertyName);
			const existingProperty = hasProperty ? asRecord(sourceProperties[propertyName]) : undefined;
			if (existingProperty && options.adoptExistingProperty?.(existingProperty)) {
				return {
					mapInput: (input: Readonly<Record<string, unknown>>) => omitProperty(input, propertyName),
				};
			}
			const conflict = options.onConflict ?? "preserve";
			if (hasProperty && conflict === "preserve") return undefined;
			if (hasProperty && conflict === "error") {
				throw new Error(`Runtime Tool ${tool.name} already declares projected property ${propertyName}`);
			}
			return {
				patch: {
					inputSchema: {
						...schema,
						properties: { ...sourceProperties, [propertyName]: options.propertySchema },
					},
				},
				mapInput: (input: Readonly<Record<string, unknown>>) => omitProperty(input, propertyName),
			};
		},
	});
}

function applyProjection(
	tool: RuntimeToolDefinition,
	result: RuntimeToolProjectionResult,
	projectorId: string,
): RuntimeToolDefinition {
	if (!result.patch && !result.mapInput) return tool;
	if (result.patch?.inputSchema && !result.mapInput) {
		throw new Error(`Runtime Tool projection ${projectorId} changed inputSchema without an input mapper`);
	}
	const projected = applyModelSurfacePatch(tool, result.patch);
	if (!result.mapInput) return projected;
	const mapInput = result.mapInput;
	return {
		...projected,
		validateInput(input) {
			const projectedInput = validateAndDecodeInput(projected.inputSchema, input, tool.name, projectorId);
			const mappedInput = assertObjectInput(mapInput(projectedInput), tool.name, projectorId);
			return tool.validateInput
				? tool.validateInput(mappedInput)
				: validateAndDecodeInput(tool.inputSchema, mappedInput, tool.name, projectorId);
		},
	};
}

function applyModelSurfacePatch(
	tool: RuntimeToolDefinition,
	patch: RuntimeToolModelSurfacePatch | undefined,
): RuntimeToolDefinition {
	if (!patch) return tool;
	return {
		...tool,
		...(patch.label !== undefined ? { label: patch.label } : {}),
		...(patch.description !== undefined ? { description: patch.description } : {}),
		...(patch.inputSchema !== undefined ? { inputSchema: patch.inputSchema } : {}),
		...(patch.modelOrder !== undefined ? { modelOrder: patch.modelOrder } : {}),
		...(patch.contextSource !== undefined ? { contextSource: patch.contextSource } : {}),
		...(patch.contextCategory !== undefined ? { contextCategory: patch.contextCategory } : {}),
	};
}

function validateAndDecodeInput(
	schema: Readonly<Record<string, unknown>>,
	input: Record<string, unknown>,
	toolName: string,
	projectorId: string,
): Readonly<Record<string, unknown>> {
	const runtimeSchema = Type.Unsafe<Record<string, unknown>>({ ...schema });
	try {
		const validated: unknown = validateToolArguments(
			{ name: toolName, description: projectorId, parameters: runtimeSchema },
			{
				type: "toolCall",
				id: `projection:${projectorId}`,
				name: toolName,
				arguments: input,
			},
		);
		return assertObjectInput(validated, toolName, projectorId);
	} catch (error) {
		const issueSummary =
			error instanceof ToolArgumentsValidationError ? `: ${formatToolArgumentValidationIssues(error.issues)}` : "";
		throw new Error(`Runtime Tool ${toolName} input rejected by projection ${projectorId}${issueSummary}`, {
			cause: error,
		});
	}
}

function assertObjectInput(input: unknown, toolName: string, projectorId: string): Readonly<Record<string, unknown>> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error(`Runtime Tool ${toolName} projection ${projectorId} must produce an object input`);
	}
	return input as Readonly<Record<string, unknown>>;
}

function omitProperty(
	input: Readonly<Record<string, unknown>>,
	propertyName: string,
): Readonly<Record<string, unknown>> {
	if (!Object.hasOwn(input, propertyName)) return input;
	const result = { ...input };
	delete result[propertyName];
	return result;
}

function normalizeProjectors(projectors: readonly RuntimeToolProjector[]): RuntimeToolProjector[] {
	const ids = new Set<string>();
	return [...projectors]
		.map((projector) => {
			const id = requireIdentifier(projector.id, "projector id");
			if (ids.has(id)) throw new Error(`Duplicate Runtime Tool projector id: ${id}`);
			ids.add(id);
			requireFiniteOrder(projector.order);
			return projector;
		})
		.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function assertBoundProjector(source: RuntimeToolProjector, bound: RuntimeToolProjector): void {
	if (!bound || typeof bound !== "object" || typeof bound.project !== "function") {
		throw new Error(`Runtime Tool projector ${source.id} returned an invalid Turn binding`);
	}
	if (bound.id !== source.id || bound.order !== source.order) {
		throw new Error(`Runtime Tool projector ${source.id} changed its stable identity while binding`);
	}
}

async function releaseProjectors(projectors: readonly RuntimeToolProjector[]): Promise<void> {
	const results = await Promise.allSettled(
		[...projectors].reverse().map((projector) => projector.releaseTurnBinding?.()),
	);
	const errors = results
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map(({ reason }) => reason);
	if (errors.length > 0) throw new AggregateError(errors, "Failed to release Runtime Tool projector bindings");
}

function requireIdentifier(value: string, label: string): string {
	if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
		throw new Error(`Runtime Tool projection ${label} must be a non-empty trimmed string`);
	}
	return value;
}

function requireFiniteOrder(order: number): number {
	if (!Number.isFinite(order)) throw new Error("Runtime Tool projector order must be finite");
	return order;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}
