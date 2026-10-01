import { bindCapability, type CapabilityRegistry } from "@astravia/capability-runtime";
import { type Disposable, FOUNDATION_JOB_CAPABILITIES } from "@astravia-org/capability-sdk";
import type { JobManager } from "../jobs/job-manager.js";

const FOUNDATION_JOB_PROVIDER_OWNER = "astravia.foundation.job";

export function registerDesktopJobProvider(registry: CapabilityRegistry, jobs: JobManager): Disposable {
	return registry.registerOwner(FOUNDATION_JOB_PROVIDER_OWNER, [
		bindCapability(FOUNDATION_JOB_CAPABILITIES.GET, {
			execute: ({ ownerId, id }, context) => jobs.get(ownerId, id, context.signal),
		}),
		bindCapability(FOUNDATION_JOB_CAPABILITIES.CANCEL, {
			execute: ({ ownerId, id }, context) => jobs.cancel(ownerId, id, context.signal),
		}),
	]);
}
