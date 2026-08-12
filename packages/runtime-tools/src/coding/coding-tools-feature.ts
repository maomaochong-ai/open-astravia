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
		boundSelectedNames?: ReadonlySet<string>,
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
			// Admission refresh belongs to the control plane. Running the legacy
			// refresher here could await between independent domain captures and
			// produce a combination that was never published as one Turn.
			const activationResult = options.resolveActivation
				? options.resolveActivation(callContext)
				: (options.activation ?? { mode: "scope" });
			const catalogLease = options.catalog.acquireSnapshot(context);
			try {
				const activation = captureActivation(
					isPromiseLike(activationResult) ? await activationResult : activationResult,
				);
				const candidates = selectCodingToolRegistrations(catalogLease.snapshot.registrations, activation);
				const filterResults = candidates.map((registration) =>
					options.filterRegistration ? options.filterRegistration(registration, callContext) : true,
				);
				const selectedNames = new Set<string>();
				for (const [index, allowed] of (await Promise.all(filterResults)).entries()) {
					if (allowed) selectedNames.add(candidates[index]!.tool.name);
				}
				context.signal.throwIfAborted();
				return createProvider(catalogLease.snapshot, activation, selectedNames, catalogLease.release);
			} catch (error) {
				catalogLease.release();
				throw error;
			}
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
			const selectedNames = new Set(boundSelectedNames ?? []);
			if (!boundSelectedNames) {
				for (const registration of selectCodingToolRegistrations(snapshot.registrations, activation)) {
					if (!options.filterRegistration || (await options.filterRegistration(registration, callContext))) {
						selectedNames.add(registration.tool.name);
					}
				}
			}
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

function captureActivation(activation: CodingToolActivation): CodingToolActivation {
	return activation.mode === "explicit"
		? Object.freeze({
				mode: "explicit",
				toolNames: Object.freeze([...activation.toolNames]),
			})
		: Object.freeze({
				...activation,
				...(activation.additionallyEnabledToolNames
					? {
							additionallyEnabledToolNames: Object.freeze([...activation.additionallyEnabledToolNames]),
						}
					: {}),
				...(activation.capabilities ? { capabilities: new Set(activation.capabilities) } : {}),
			});
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	return typeof value === "object" && value !== null && "then" in value;
}
