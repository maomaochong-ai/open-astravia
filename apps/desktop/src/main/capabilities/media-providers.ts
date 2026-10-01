import { bindCapability, type CapabilityRegistry } from "@astravia/capability-runtime";
import { type Disposable, DOMAIN_MEDIA_CAPABILITIES } from "@astravia-org/capability-sdk";
import { isCloudBuildEnabled } from "../../shared/feature-flags.js";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { JobManager } from "../jobs/job-manager.js";
import { getAppLogger } from "../logger.js";
import { createAstraviaImageProvider } from "../media-generation/astravia-image-provider.js";
import { MediaArtifactStore } from "../media-generation/media-artifact-store.js";
import { MediaProviderRegistry } from "../media-generation/media-provider-registry.js";

const DOMAIN_MEDIA_PROVIDER_OWNER = "astravia.domain.media";

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
	const providers = new MediaProviderRegistry(jobs, getAppLogger("media-generation"));
	const artifacts = new MediaArtifactStore(artifactStore);
	desktopMediaRuntime = { providers, artifacts };
	// Astravia 图像生成走云端网关：lite 构建不注册，provider 列表中不出现。
	const astraviaRegistration = isCloudBuildEnabled()
		? providers.registerProvider(createAstraviaImageProvider(artifacts))
		: undefined;
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
			astraviaRegistration?.dispose();
		},
	};
}
