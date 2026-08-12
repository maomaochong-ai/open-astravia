import type {
	AgentFeatureDefinition,
	ModelCallContributionContext,
	ModelCallContributionProvider,
	RuntimeSnapshotAcquireContext,
} from "@vetta/runtime-core/kernel";
import { guardCodingToolRegistration } from "./coding-tool-availability.js";
import type { CodingToolCatalog } from "./coding-tool-catalog.js";
import {
	type CodingToolActivation,
	type CodingToolRegistration,
	selectCodingToolRegistrations,
} from "./tool-registration.js";

export const CODING_TOOLS_FEATURE_ID = "coding-tools";

export type CodingToolActivationResolver = (
	context: ModelCallContributionContext,
) => Promise<CodingToolActivation> | CodingToolActivation;

export type CodingToolCatalogRefresher = (context: ModelCallContributionContext) => Promise<void> | void;

export type CodingToolRegistrationFilter = (
	registration: CodingToolRegistration,
	context: ModelCallContributionContext,
) => Promise<boolean> | boolean;

export interface CodingToolsFeatureOptions {
	readonly id?: string;
	readonly catalog: CodingToolCatalog;
	readonly activation?: CodingToolActivation;
	readonly resolveActivation?: CodingToolActivationResolver;
	readonly refreshCatalog?: CodingToolCatalogRefresher;
	readonly filterRegistration?: CodingToolRegistrationFilter;
}

export function createCodingToolsFeature(options: CodingToolsFeatureOptions): AgentFeatureDefinition {
	const featureId = options.id ?? CODING_TOOLS_FEATURE_ID;
	const createProvider = (
		catalogSnapshot?: ReturnType<CodingToolCatalog["snapshot"]>,
		boundActivation?: CodingToolActivation,
		releaseTurnBinding?: () => void,
	): ModelCallContributionProvider => ({
		id: featureId,
		...(releaseTurnBinding ? { releaseTurnBinding } : {}),
		async bindForTurn(context: RuntimeSnapshotAcquireContext) {
			const callContext: ModelCallContributionContext = {
				sessionId: context.sessionId,
				turnId: context.operationId,
				signal: context.signal,
				...(context.input ? { input: context.input } : {}),
			};
			await options.refreshCatalog?.(callContext);
			context.signal.throwIfAborted();
			const activation = options.resolveActivation
				? await options.resolveActivation(callContext)
				: (options.activation ?? { mode: "scope" });
			const catalogLease = options.catalog.acquireSnapshot();
			return createProvider(catalogLease.snapshot, activation, catalogLease.release);
		},
		async contribute(callContext: ModelCallContributionContext) {
			callContext.signal.throwIfAborted();
			if (!catalogSnapshot) await options.refreshCatalog?.(callContext);
			callContext.signal.throwIfAborted();
			const snapshot = catalogSnapshot ?? options.catalog.snapshot();
			const activation =
				boundActivation ??
				(options.resolveActivation
					? await options.resolveActivation(callContext)
					: (options.activation ?? { mode: "scope" }));
			callContext.signal.throwIfAborted();
			const registrations: CodingToolRegistration[] = [];
			for (const registration of selectCodingToolRegistrations(snapshot.registrations, activation)) {
				if (!options.filterRegistration || (await options.filterRegistration(registration, callContext))) {
					registrations.push(registration);
				}
			}
			const selectedNames = new Set(registrations.map(({ tool }) => tool.name));
			return {
				tools: snapshot.entries
					.filter(({ binding }) => selectedNames.has(binding.capabilityId))
					.map((entry) => guardCodingToolRegistration(options.catalog, entry)),
			};
		},
	});
	return {
		id: featureId,
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { modelCallProviders: [createProvider()] };
				},
				async dispose() {},
			};
		},
	};
}
