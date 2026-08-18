import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type Disposable,
	DOMAIN_MODEL_CAPABILITIES,
} from "@vetta/capability-sdk";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import { probeModelProvider } from "../models/probe.js";

const DOMAIN_MODEL_PROVIDER_OWNER = "vetta.domain.model";

function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Capability invocation was aborted");
	}
}

export function registerDesktopModelProviders(registry: CapabilityRegistry): Disposable {
	const models = getDesktopModelSettingsService();
	return registry.registerOwner(DOMAIN_MODEL_PROVIDER_OWNER, [
		bindCapability(DOMAIN_MODEL_CAPABILITIES.LIST, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return models.list();
			},
		}),
		bindCapability(DOMAIN_MODEL_CAPABILITIES.GET_CONFIG, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return models.getSanitizedConfig();
			},
		}),
		bindCapability(DOMAIN_MODEL_CAPABILITIES.GET_PROVIDER, {
			execute: async ({ provider }, context) => {
				assertNotAborted(context.signal);
				return models.getSanitizedProvider(provider);
			},
		}),
		bindCapability(DOMAIN_MODEL_CAPABILITIES.PROBE, {
			execute: async (input, context) => {
				assertNotAborted(context.signal);
				return probeModelProvider(input);
			},
		}),
		bindCapability(DOMAIN_MODEL_CAPABILITIES.VALIDATE_KEY, {
			execute: async ({ modelKey, operation }, context) => {
				assertNotAborted(context.signal);
				await models.validateModelKey(modelKey, operation);
			},
		}),
		bindCapability(DOMAIN_MODEL_CAPABILITIES.SET_DEFAULT, {
			execute: async ({ modelKey }, context) => {
				assertNotAborted(context.signal);
				return models.setDefault(modelKey);
			},
		}),
		bindCapability(DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER, {
			execute: async ({ provider, data }, context) => {
				assertNotAborted(context.signal);
				return models.upsertProvider(provider, data);
			},
		}),
		bindCapability(DOMAIN_MODEL_CAPABILITIES.REMOVE_PROVIDER, {
			execute: async ({ provider }, context) => {
				assertNotAborted(context.signal);
				await models.removeProvider(provider);
			},
		}),
	]);
}
