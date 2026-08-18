import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import { type Disposable, DOMAIN_MEDIA_CAPABILITIES } from "@vetta/capability-sdk";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { JobManager } from "../jobs/job-manager.js";
import { MediaArtifactStore } from "../media-generation/media-artifact-store.js";
import { MediaProviderRegistry } from "../media-generation/media-provider-registry.js";
import { createVettaImageProvider } from "../media-generation/vetta-image-provider.js";

const DOMAIN_MEDIA_PROVIDER_OWNER = "vetta.domain.media";

export interface DesktopMediaRuntime {
	readonly providers: MediaProviderRegistry;
	readonly artifacts: MediaArtifactStore;
}

let desktopMediaRuntime: DesktopMediaRuntime | undefined;

export function getDesktopMediaRuntime(): DesktopMediaRuntime {
	if (!desktopMediaRuntime) throw new Error("Desktop media runtime is not initialized");
	return desktopMediaRuntime;
}

export function registerDesktopMediaProviders(
	registry: CapabilityRegistry,
	artifactStore: ArtifactStore,
	jobs: JobManager,
): Disposable {
	const providers = new MediaProviderRegistry(jobs);
	const artifacts = new MediaArtifactStore(artifactStore);
	desktopMediaRuntime = { providers, artifacts };
	const vettaRegistration = providers.registerProvider(createVettaImageProvider(artifacts));
	const capabilityRegistration = registry.registerOwner(DOMAIN_MEDIA_PROVIDER_OWNER, [
		bindCapability(DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS, {
			execute: async () => providers.listProviders(),
		}),
		bindCapability(DOMAIN_MEDIA_CAPABILITIES.SUBMIT, {
			execute: (input, context) => providers.submit(input, context.signal),
		}),
	]);
	return {
		dispose: () => {
			if (desktopMediaRuntime?.providers === providers) desktopMediaRuntime = undefined;
			capabilityRegistration.dispose();
			vettaRegistration.dispose();
		},
	};
}
