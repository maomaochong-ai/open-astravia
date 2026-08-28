import type {
	AgentFeatureDefinition,
	ModelCallContributionContext,
	ModelCallContributionProvider,
	RuntimeSnapshotAcquireContext,
} from "@vetta/runtime-core/kernel";
import { guardCodingToolRegistration } from "./coding-tool-availability.js";
import type { CodingToolCatalog } from "./coding-tool-catalog.js";
import type { CodingToolRegistration } from "./tool-registration.js";

export const CODING_TOOLS_FEATURE_ID = "coding-tools";

export type CodingToolCatalogRefresher = (context: ModelCallContributionContext) => Promise<void> | void;

export type CodingToolRegistrationSelector = (
	registrations: readonly CodingToolRegistration[],
	context: ModelCallContributionContext,
) => Promise<readonly CodingToolRegistration[]> | readonly CodingToolRegistration[];

export type CodingToolRegistrationFilter = (
	registration: CodingToolRegistration,
	context: ModelCallContributionContext,
) => Promise<boolean> | boolean;

export interface CodingToolsFeatureOptions {
	readonly id?: string;
	readonly catalog: CodingToolCatalog;
	/** 上层扩展负责场景、权限或其它业务选择；Runtime 只消费选择结果。 */
	readonly selectRegistrations?: CodingToolRegistrationSelector;
	readonly refreshCatalog?: CodingToolCatalogRefresher;
	readonly filterRegistration?: CodingToolRegistrationFilter;
}

export function createCodingToolsFeature(options: CodingToolsFeatureOptions): AgentFeatureDefinition {
	const featureId = options.id ?? CODING_TOOLS_FEATURE_ID;
	const createProvider = (
		catalogSnapshot?: ReturnType<CodingToolCatalog["snapshot"]>,
		boundSelectedNames?: ReadonlySet<string>,
		releaseTurnBinding?: () => void,
	): ModelCallContributionProvider => ({
		id: featureId,
		...(releaseTurnBinding ? { releaseTurnBinding } : {}),
		async bindForTurn(context: RuntimeSnapshotAcquireContext) {
			const callContext = toCallContext(context);
			const catalogLease = options.catalog.acquireSnapshot(context);
			try {
				const selected = await selectRegistrations(options, catalogLease.snapshot.registrations, callContext);
				const selectedNames = await filterSelectedNames(options, selected, callContext);
				context.signal.throwIfAborted();
				return createProvider(catalogLease.snapshot, selectedNames, catalogLease.release);
			} catch (error) {
				await catalogLease.release();
				throw error;
			}
		},
		async contribute(callContext: ModelCallContributionContext) {
			callContext.signal.throwIfAborted();
			if (!catalogSnapshot) await options.refreshCatalog?.(callContext);
			callContext.signal.throwIfAborted();
			const snapshot = catalogSnapshot ?? options.catalog.snapshot();
			const selectedNames =
				boundSelectedNames ??
				(await filterSelectedNames(
					options,
					await selectRegistrations(options, snapshot.registrations, callContext),
					callContext,
				));
			callContext.signal.throwIfAborted();
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

function toCallContext(context: RuntimeSnapshotAcquireContext): ModelCallContributionContext {
	return {
		sessionId: context.sessionId,
		turnId: context.operationId,
		signal: context.signal,
		...(context.input ? { input: context.input } : {}),
		...(context.request ? { request: context.request } : {}),
	};
}

async function selectRegistrations(
	options: CodingToolsFeatureOptions,
	registrations: readonly CodingToolRegistration[],
	context: ModelCallContributionContext,
): Promise<readonly CodingToolRegistration[]> {
	return options.selectRegistrations ? options.selectRegistrations(registrations, context) : registrations;
}

async function filterSelectedNames(
	options: CodingToolsFeatureOptions,
	registrations: readonly CodingToolRegistration[],
	context: ModelCallContributionContext,
): Promise<ReadonlySet<string>> {
	const filterResults = registrations.map((registration) =>
		options.filterRegistration ? options.filterRegistration(registration, context) : true,
	);
	const selectedNames = new Set<string>();
	for (const [index, allowed] of (await Promise.all(filterResults)).entries()) {
		if (allowed) selectedNames.add(registrations[index]!.tool.name);
	}
	return selectedNames;
}
