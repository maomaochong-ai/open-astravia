import type { AgentFeatureDefinition, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
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
	return {
		id: featureId,
		async prepare(context) {
			context.signal.throwIfAborted();
			const modelCallProvider = {
				id: featureId,
				async contribute(callContext: ModelCallContributionContext) {
					callContext.signal.throwIfAborted();
					await options.refreshCatalog?.(callContext);
					callContext.signal.throwIfAborted();
					const catalogSnapshot = options.catalog.snapshot();
					const activation = options.resolveActivation
						? await options.resolveActivation(callContext)
						: (options.activation ?? { mode: "scope" });
					callContext.signal.throwIfAborted();
					const registrations: CodingToolRegistration[] = [];
					for (const registration of selectCodingToolRegistrations(catalogSnapshot.registrations, activation)) {
						if (!options.filterRegistration || (await options.filterRegistration(registration, callContext))) {
							registrations.push(registration);
						}
					}
					const selectedNames = new Set(registrations.map(({ tool }) => tool.name));
					return {
						tools: catalogSnapshot.entries
							.filter(({ binding }) => selectedNames.has(binding.capabilityId))
							.map((entry) => guardCodingToolRegistration(options.catalog, entry)),
					};
				},
			};
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { modelCallProviders: [modelCallProvider] };
				},
				async dispose() {},
			};
		},
	};
}
