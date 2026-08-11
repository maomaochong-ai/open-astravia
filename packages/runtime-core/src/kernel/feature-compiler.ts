import type {
	AgentFeature,
	AgentFeatureDefinition,
	AgentProfile,
	CompiledRuntimeSnapshot,
	FeatureContribution,
	IdGenerator,
	RuntimeSnapshot,
} from "./contracts.js";
import { featureConfigurationError, featureConflictError } from "./errors.js";
import { freezeInstruction, freezeTool, ImmutableReadonlyMap } from "./runtime-values.js";

export interface FeatureCompilerOptions {
	readonly idGenerator: IdGenerator;
}

interface PreparedFeature {
	readonly definition: AgentFeatureDefinition;
	readonly instance: AgentFeature;
}

export class FeatureCompiler {
	private readonly idGenerator: IdGenerator;

	constructor(options: FeatureCompilerOptions) {
		this.idGenerator = options.idGenerator;
	}

	async compile(profile: AgentProfile, signal: AbortSignal): Promise<CompiledRuntimeSnapshot> {
		const definitions = orderFeatureDefinitions(profile.features);
		const prepared: PreparedFeature[] = [];

		try {
			for (const definition of definitions) {
				signal.throwIfAborted();
				const instance = await definition.prepare({ signal });
				prepared.push({ definition, instance });
			}

			const contributions: FeatureContribution[] = [];
			for (const feature of prepared) {
				signal.throwIfAborted();
				contributions.push(
					await feature.instance.contribute({
						profileId: profile.id,
						signal,
					}),
				);
			}

			const snapshot = createSnapshot(profile, contributions, this.idGenerator.next("snapshot"));
			return createCompiledSnapshot(snapshot, prepared);
		} catch (error) {
			await disposePreparedFeatures(prepared, false);
			throw error;
		}
	}
}

function orderFeatureDefinitions(definitions: readonly AgentFeatureDefinition[]): readonly AgentFeatureDefinition[] {
	const definitionsById = new Map<string, AgentFeatureDefinition>();
	for (const definition of definitions) {
		if (definitionsById.has(definition.id)) {
			throw featureConfigurationError(`Duplicate feature id: ${definition.id}`);
		}
		definitionsById.set(definition.id, definition);
	}

	const sortedDefinitions = [...definitionsById.values()].sort(compareFeatureId);
	for (const definition of sortedDefinitions) {
		for (const dependency of definition.dependencies ?? []) {
			if (!definitionsById.has(dependency)) {
				throw featureConfigurationError(`Feature ${definition.id} requires missing dependency ${dependency}`);
			}
		}
		for (const conflict of definition.conflicts ?? []) {
			if (definitionsById.has(conflict)) {
				throw featureConflictError(`Feature ${definition.id} conflicts with ${conflict}`);
			}
		}
	}

	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const definition of sortedDefinitions) {
		const dependencies = [...new Set(definition.dependencies ?? [])];
		inDegree.set(definition.id, dependencies.length);
		for (const dependency of dependencies) {
			const entries = dependents.get(dependency) ?? [];
			entries.push(definition.id);
			dependents.set(dependency, entries);
		}
	}

	const ready = sortedDefinitions.filter((definition) => inDegree.get(definition.id) === 0).map(({ id }) => id);
	const ordered: AgentFeatureDefinition[] = [];
	while (ready.length > 0) {
		ready.sort(compareString);
		const id = ready.shift();
		if (!id) break;
		const definition = definitionsById.get(id);
		if (!definition) {
			throw featureConfigurationError(`Feature disappeared during compilation: ${id}`);
		}
		ordered.push(definition);
		for (const dependent of dependents.get(id) ?? []) {
			const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
			inDegree.set(dependent, nextDegree);
			if (nextDegree === 0) ready.push(dependent);
		}
	}

	if (ordered.length !== sortedDefinitions.length) {
		const cyclicIds = sortedDefinitions
			.filter((definition) => !ordered.includes(definition))
			.map(({ id }) => id)
			.sort(compareString);
		throw featureConfigurationError(`Feature dependency cycle: ${cyclicIds.join(", ")}`);
	}

	return ordered;
}

function createSnapshot(
	profile: AgentProfile,
	contributions: readonly FeatureContribution[],
	snapshotId: string,
): RuntimeSnapshot {
	const instructions = uniqueValues(
		"instruction",
		[...profile.instructions, ...contributions.flatMap((contribution) => contribution.instructions ?? [])],
		({ id }) => id,
	)
		.sort(compareInstruction)
		.map(freezeInstruction);
	const tools = uniqueValues(
		"tool",
		contributions.flatMap((contribution) => contribution.tools ?? []),
		({ name }) => name,
	).map(freezeTool);
	const contextProviders = uniqueValues(
		"context provider",
		contributions.flatMap((contribution) => contribution.contextProviders ?? []),
		({ id }) => id,
	);
	const observers = uniqueValues(
		"observer",
		[...(profile.observers ?? []), ...contributions.flatMap((contribution) => contribution.observers ?? [])],
		({ id }) => id,
	);
	const modelCallProviders = uniqueValues(
		"model call provider",
		contributions.flatMap((contribution) => contribution.modelCallProviders ?? []),
		({ id }) => id,
	);

	return Object.freeze({
		id: snapshotId,
		salvageTextToolCalls: profile.salvageTextToolCalls ? Object.freeze([...profile.salvageTextToolCalls]) : undefined,
		instructions: Object.freeze(instructions),
		tools: new ImmutableReadonlyMap(tools.map((tool) => [tool.name, tool])),
		modelCallProviders: Object.freeze(modelCallProviders),
		modelCallFrameComposer: profile.modelCallFrameComposer,
		contextCompositionPublisher: profile.contextCompositionPublisher,
		agentRunPreparer: profile.agentRunPreparer,
		continuationPolicy: profile.continuationPolicy,
		modelCallContextTransformer: profile.modelCallContextTransformer,
		modelCallMessageFinalizer: profile.modelCallMessageFinalizer,
		conversationContextProjector: profile.conversationContextProjector,
		contextProviders: Object.freeze(contextProviders),
		contextStrategy: profile.contextStrategy,
		toolPolicy: profile.toolPolicy,
		tokenBudget: profile.tokenBudget,
		reservedOutputTokens: profile.reservedOutputTokens,
		observers: Object.freeze(observers),
	});
}

function uniqueValues<T>(kind: string, values: readonly T[], getId: (value: T) => string): T[] {
	const byId = new Map<string, T>();
	for (const value of values) {
		const id = getId(value);
		if (byId.has(id)) {
			throw featureConflictError(`Duplicate ${kind} id: ${id}`);
		}
		byId.set(id, value);
	}
	return [...byId.values()];
}

function createCompiledSnapshot(
	snapshot: RuntimeSnapshot,
	prepared: readonly PreparedFeature[],
): CompiledRuntimeSnapshot {
	let disposed = false;
	return {
		snapshot,
		async dispose() {
			if (disposed) return;
			disposed = true;
			await disposePreparedFeatures(prepared, true);
		},
	};
}

async function disposePreparedFeatures(prepared: readonly PreparedFeature[], reportErrors: boolean): Promise<void> {
	const errors: unknown[] = [];
	for (const feature of [...prepared].reverse()) {
		try {
			await feature.instance.dispose();
		} catch (error) {
			errors.push(error);
		}
	}
	if (reportErrors && errors.length > 0) {
		throw new AggregateError(errors, "Failed to dispose one or more agent features");
	}
}

function compareFeatureId(left: AgentFeatureDefinition, right: AgentFeatureDefinition): number {
	return compareString(left.id, right.id);
}

function compareString(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function compareInstruction(
	left: { readonly id: string; readonly priority: number },
	right: { readonly id: string; readonly priority: number },
): number {
	return left.priority - right.priority || compareString(left.id, right.id);
}
