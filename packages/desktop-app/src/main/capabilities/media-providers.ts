import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import { type Disposable, DOMAIN_MEDIA_CAPABILITIES } from "@vetta/capability-sdk";
import { MediaProviderRegistry } from "../media-generation/media-provider-registry.js";
import { createVettaImageProvider } from "../media-generation/vetta-image-provider.js";

const DOMAIN_MEDIA_PROVIDER_OWNER = "vetta.domain.media";

export function registerDesktopMediaProviders(registry: CapabilityRegistry): Disposable {
	const providers = new MediaProviderRegistry();
	const vettaRegistration = providers.registerProvider(createVettaImageProvider());
	const capabilityRegistration = registry.registerOwner(DOMAIN_MEDIA_PROVIDER_OWNER, [
		bindCapability(DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS, {
			execute: async () => providers.listProviders(),
		}),
		bindCapability(DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB, {
			execute: (input, context) => providers.createJob(input, context.signal),
		}),
		bindCapability(DOMAIN_MEDIA_CAPABILITIES.GET_JOB, {
			execute: (input, context) => providers.getJob(input, context.signal),
		}),
		bindCapability(DOMAIN_MEDIA_CAPABILITIES.CANCEL_JOB, {
			execute: (input, context) => providers.cancelJob(input, context.signal),
		}),
	]);
	return {
		dispose: () => {
			capabilityRegistration.dispose();
			vettaRegistration.dispose();
		},
	};
}
