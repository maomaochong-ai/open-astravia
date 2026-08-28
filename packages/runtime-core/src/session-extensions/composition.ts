import { createRuntimeId } from "../id-generator.js";
import type {
	AgentFeatureDefinition,
	ContinuationMessage,
	ContinuationPolicy,
	ContinuationPolicyContext,
} from "../kernel/contracts.js";
import { SystemClock } from "../kernel/defaults.js";
import type { RuntimeDocumentParticipant } from "../runtime-host/runtime-document-participant.js";
import type {
	SessionExtensionContext,
	SessionExtensionContinuationSource,
	SessionExtensionContribution,
	SessionExtensionDefinition,
	SessionExtensionEndpointContribution,
	SessionExtensionEndpointHost,
	SessionExtensionEndpointToken,
	SessionExtensionFunctionDependency,
	SessionExtensionFunctionSource,
	SessionExtensionInitialObservationSource,
	SessionExtensionInstance,
	SessionExtensionObservation,
	SessionExtensionServiceResolver,
	SessionExtensionServiceToken,
} from "./contracts.js";
import { SessionExtensionSignalBus } from "./signal-bus.js";

export interface SessionExtensionCompositionOptions {
	readonly definitions: readonly SessionExtensionDefinition[];
	readonly functions?: SessionExtensionFunctionSource;
	readonly signal?: AbortSignal;
	readonly clock?: SessionExtensionContext["clock"];
	readonly createId?: () => string;
}

interface PreparedExtension {
	readonly definition: SessionExtensionDefinition;
	readonly instance: SessionExtensionInstance;
}

export class SessionExtensionComposition implements SessionExtensionEndpointHost {
	readonly features: readonly AgentFeatureDefinition[];
	readonly documentParticipants: readonly RuntimeDocumentParticipant[];
	readonly continuationSources: readonly SessionExtensionContinuationSource[];
	readonly services: SessionExtensionServiceResolver;
	readonly signals: SessionExtensionSignalBus;

	private disposed = false;
	private readonly pendingDisposals: Set<PreparedExtension>;

	private constructor(
		private readonly prepared: readonly PreparedExtension[],
		features: readonly SessionExtensionContribution[],
		documentParticipants: readonly RuntimeDocumentParticipant[],
		continuationSources: readonly SessionExtensionContinuationSource[],
		private readonly initialObservationSources: readonly SessionExtensionInitialObservationSource[],
		services: SessionExtensionServiceResolver,
		signals: SessionExtensionSignalBus,
		private readonly endpoints: ReadonlyMap<string, SessionExtensionEndpointContribution>,
	) {
		this.pendingDisposals = new Set(prepared);
		this.features = Object.freeze(
			features.flatMap((contribution) => (contribution.kind === "agent-feature" ? [contribution.feature] : [])),
		);
		this.documentParticipants = Object.freeze([...documentParticipants]);
		this.continuationSources = Object.freeze([...continuationSources]);
		this.services = services;
		this.signals = signals;
	}

	static async create(options: SessionExtensionCompositionOptions): Promise<SessionExtensionComposition> {
		const definitions = orderDefinitions(options.definitions);
		const signal = options.signal ?? new AbortController().signal;
		const clock = options.clock ?? new SystemClock();
		const createId = options.createId ?? createRuntimeId;
		const signalBus = new SessionExtensionSignalBus();
		const functions = options.functions ?? EMPTY_FUNCTION_SOURCE;
		const serviceValues = new Map<string, unknown>();
		const services = createServiceResolver(serviceValues);
		const prepared: PreparedExtension[] = [];
		const contributions: SessionExtensionContribution[] = [];
		const participants: RuntimeDocumentParticipant[] = [];
		const continuationSources: SessionExtensionContinuationSource[] = [];
		const initialObservationSources: SessionExtensionInitialObservationSource[] = [];
		const initialObservationSourcesById = new Map<string, SessionExtensionInitialObservationSource>();
		const endpoints = new Map<string, SessionExtensionEndpointContribution>();

		try {
			for (const definition of definitions) {
				signal.throwIfAborted();
				const allowedDependencies = new Set(definition.dependencies ?? []);
				const functionDependencies = indexFunctionDependencies(definition);
				assertRequiredFunctionsAvailable(definition.id, functionDependencies, functions);
				const instance = await definition.create({
					signal,
					clock,
					createId,
					services: createRestrictedServiceResolver(definition.id, allowedDependencies, serviceValues),
					functions: createRestrictedFunctionSource(definition.id, functionDependencies, functions),
					signals: {
						publish: (token, payload) => {
							if (token.extensionId !== definition.id) {
								throw new Error(
									`Extension ${definition.id} cannot publish signal owned by ${token.extensionId}`,
								);
							}
							signalBus.publish(token, payload);
						},
					},
				});
				prepared.push({ definition, instance });
				for (const contribution of instance.contributions) {
					assertContributionOwner(definition.id, contribution);
					contributions.push(contribution);
					switch (contribution.kind) {
						case "service":
							addUnique(serviceValues, contribution.token.id, contribution.value, "service");
							break;
						case "endpoint":
							addUnique(endpoints, contribution.token.id, contribution, "endpoint");
							break;
						case "document-participant":
							participants.push(contribution.participant);
							break;
						case "continuation-source":
							continuationSources.push(contribution.source);
							break;
						case "initial-observation-source":
							addUnique(
								initialObservationSourcesById,
								contribution.source.id,
								contribution.source,
								"initial observation source",
							);
							initialObservationSources.push(contribution.source);
							break;
					}
				}
			}
		} catch (error) {
			try {
				await disposePrepared(prepared, signalBus);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], "Session extension initialization and rollback failed");
			}
			throw error;
		}

		return new SessionExtensionComposition(
			prepared,
			contributions,
			participants,
			orderContinuationSources(continuationSources),
			initialObservationSources,
			services,
			signalBus,
			endpoints,
		);
	}

	createContinuationPolicy(): ContinuationPolicy | undefined {
		return this.continuationSources.length > 0
			? new SessionExtensionContinuationPolicy(this.continuationSources)
			: undefined;
	}

	readInitialObservations(): readonly SessionExtensionObservation[] {
		if (this.disposed) throw new Error("Session extension composition is disposed");
		return this.initialObservationSources.flatMap((source) => source.read());
	}

	hasEndpoint<Input, Output>(token: SessionExtensionEndpointToken<Input, Output>): boolean {
		return !this.disposed && this.endpoints.has(token.id);
	}

	async invoke<Input, Output>(
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal: AbortSignal = new AbortController().signal,
	): Promise<Output> {
		if (this.disposed) throw new Error("Session extension composition is disposed");
		const endpoint = this.endpoints.get(token.id);
		if (!endpoint) throw new Error(`Session extension endpoint is not registered: ${token.id}`);
		signal.throwIfAborted();
		return (await endpoint.handle(input, signal)) as Output;
	}

	invokeSync<Input, Output>(
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal: AbortSignal = new AbortController().signal,
	): Output {
		if (this.disposed) throw new Error("Session extension composition is disposed");
		const endpoint = this.endpoints.get(token.id);
		if (!endpoint) throw new Error(`Session extension endpoint is not registered: ${token.id}`);
		signal.throwIfAborted();
		const output = endpoint.handle(input, signal);
		if (isPromiseLike(output)) {
			throw new Error(`Session extension endpoint is asynchronous: ${token.id}`);
		}
		return output as Output;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.pendingDisposals.size === 0) {
			this.signals.clear();
			return;
		}
		const errors: unknown[] = [];
		for (const extension of [...this.prepared].reverse()) {
			if (!this.pendingDisposals.has(extension)) continue;
			try {
				await extension.instance.dispose();
				this.pendingDisposals.delete(extension);
			} catch (error) {
				errors.push(error);
			}
		}
		this.signals.clear();
		if (errors.length > 0) throw new AggregateError(errors, "Failed to dispose one or more session extensions");
	}
}

const EMPTY_FUNCTION_SOURCE: SessionExtensionFunctionSource = {
	has: () => false,
	invoke: async (token) => {
		throw new Error(`Session extension function is not registered: ${token.id}`);
	},
};

class SessionExtensionContinuationPolicy implements ContinuationPolicy {
	constructor(private readonly sources: readonly SessionExtensionContinuationSource[]) {}

	async collect(context: ContinuationPolicyContext): Promise<readonly ContinuationMessage[]> {
		if (context.signal.aborted) return [];
		for (const source of this.sources) {
			const messages = await source.collect(context);
			if (messages.length > 0) return messages.map((message) => ({ message, source: source.id }));
			if (context.signal.aborted) return [];
		}
		return [];
	}
}

function createServiceResolver(values: ReadonlyMap<string, unknown>): SessionExtensionServiceResolver {
	return {
		optional: <T>(token: SessionExtensionServiceToken<T>) => values.get(token.id) as T | undefined,
		require: <T>(token: SessionExtensionServiceToken<T>) => {
			if (!values.has(token.id)) throw new Error(`Session extension service is not registered: ${token.id}`);
			return values.get(token.id) as T;
		},
	};
}

function createRestrictedServiceResolver(
	extensionId: string,
	allowedDependencies: ReadonlySet<string>,
	values: ReadonlyMap<string, unknown>,
): SessionExtensionServiceResolver {
	const assertAllowed = <T>(token: SessionExtensionServiceToken<T>): void => {
		if (token.extensionId !== extensionId && !allowedDependencies.has(token.extensionId)) {
			throw new Error(`Extension ${extensionId} must declare dependency on ${token.extensionId}`);
		}
	};
	const resolver = createServiceResolver(values);
	return {
		optional: <T>(token: SessionExtensionServiceToken<T>) => {
			assertAllowed(token);
			return resolver.optional(token);
		},
		require: <T>(token: SessionExtensionServiceToken<T>) => {
			assertAllowed(token);
			return resolver.require(token);
		},
	};
}

function indexFunctionDependencies(
	definition: SessionExtensionDefinition,
): ReadonlyMap<string, SessionExtensionFunctionDependency> {
	const dependencies = new Map<string, SessionExtensionFunctionDependency>();
	for (const dependency of definition.functionDependencies ?? []) {
		if (dependencies.has(dependency.token.id)) {
			throw new Error(`Duplicate session extension function dependency id: ${dependency.token.id}`);
		}
		dependencies.set(dependency.token.id, dependency);
	}
	return dependencies;
}

function assertRequiredFunctionsAvailable(
	extensionId: string,
	dependencies: ReadonlyMap<string, SessionExtensionFunctionDependency>,
	functions: SessionExtensionFunctionSource,
): void {
	for (const dependency of dependencies.values()) {
		if (dependency.availability === "required" && !functions.has(dependency.token)) {
			throw new Error(`Session extension ${extensionId} requires missing function ${dependency.token.id}`);
		}
	}
}

function createRestrictedFunctionSource(
	extensionId: string,
	dependencies: ReadonlyMap<string, SessionExtensionFunctionDependency>,
	functions: SessionExtensionFunctionSource,
): SessionExtensionFunctionSource {
	const assertAllowed = (tokenId: string): void => {
		if (!dependencies.has(tokenId)) {
			throw new Error(`Session extension ${extensionId} must declare function dependency on ${tokenId}`);
		}
	};
	return {
		has: (token) => {
			assertAllowed(token.id);
			return functions.has(token);
		},
		invoke: (token, input, signal) => {
			assertAllowed(token.id);
			return functions.invoke(token, input, signal);
		},
	};
}

function orderDefinitions(definitions: readonly SessionExtensionDefinition[]): SessionExtensionDefinition[] {
	const byId = new Map<string, SessionExtensionDefinition>();
	for (const definition of definitions) addUnique(byId, definition.id, definition, "extension");
	for (const definition of definitions) {
		for (const dependency of definition.dependencies ?? []) {
			if (!byId.has(dependency))
				throw new Error(`Extension ${definition.id} requires missing extension ${dependency}`);
		}
		for (const conflict of definition.conflicts ?? []) {
			if (byId.has(conflict)) throw new Error(`Extension ${definition.id} conflicts with ${conflict}`);
		}
	}

	const ordered: SessionExtensionDefinition[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (definition: SessionExtensionDefinition): void => {
		if (visited.has(definition.id)) return;
		if (visiting.has(definition.id)) throw new Error(`Session extension dependency cycle includes ${definition.id}`);
		visiting.add(definition.id);
		for (const dependency of [...(definition.dependencies ?? [])].sort()) visit(byId.get(dependency)!);
		visiting.delete(definition.id);
		visited.add(definition.id);
		ordered.push(definition);
	};
	for (const definition of [...definitions].sort((left, right) => left.id.localeCompare(right.id))) visit(definition);
	return ordered;
}

function orderContinuationSources(
	sources: readonly SessionExtensionContinuationSource[],
): SessionExtensionContinuationSource[] {
	const byId = new Map<string, SessionExtensionContinuationSource>();
	for (const source of sources) addUnique(byId, source.id, source, "continuation source");
	return [...sources].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function assertContributionOwner(extensionId: string, contribution: SessionExtensionContribution): void {
	if (
		(contribution.kind === "service" || contribution.kind === "endpoint") &&
		contribution.token.extensionId !== extensionId
	) {
		throw new Error(
			`Extension ${extensionId} cannot register ${contribution.kind} owned by ${contribution.token.extensionId}`,
		);
	}
}

function addUnique<T>(target: Map<string, T>, id: string, value: T, kind: string): void {
	if (target.has(id)) throw new Error(`Duplicate session extension ${kind} id: ${id}`);
	target.set(id, value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}

async function disposePrepared(
	prepared: readonly PreparedExtension[],
	signals: SessionExtensionSignalBus,
): Promise<void> {
	const errors: unknown[] = [];
	for (const extension of [...prepared].reverse()) {
		try {
			await extension.instance.dispose();
		} catch (error) {
			errors.push(error);
		}
	}
	signals.clear();
	if (errors.length > 0) throw new AggregateError(errors, "Failed to dispose one or more session extensions");
}
