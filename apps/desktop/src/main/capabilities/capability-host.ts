import { type CapabilityAccessAuditEvent, CapabilityAccessController, CapabilityHub } from "@vetta/capability-runtime";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { JobManager } from "../jobs/job-manager.js";
import { getAppLogger } from "../logger.js";
import { listPlugins } from "../plugins/plugin-catalog.js";
import { registerDesktopDomainProviders } from "./domain-providers.js";
import { registerDesktopFoundationProviders } from "./foundation-providers.js";
import { PluginCapabilityAdapter } from "./integrations/plugin/index.js";
import { ThemeCapabilityAdapter } from "./integrations/theme-capability-adapter.js";

const log = getAppLogger("capability-access");

export interface DesktopCapabilityHost {
	readonly access: CapabilityAccessController;
	readonly adapters: {
		readonly plugin: PluginCapabilityAdapter;
		readonly theme: ThemeCapabilityAdapter;
	};
	readonly hub: CapabilityHub;
	dispose(): void;
}

function auditCapabilityAccess(event: CapabilityAccessAuditEvent): void {
	log.debug("access decision", {
		capabilityId: event.capabilityId,
		decision: event.decision,
		reason: event.reason,
		sessionId: event.subject.sessionId,
		subjectId: event.subject.id,
	});
}

function createDesktopCapabilityHost(): DesktopCapabilityHost {
	const hub = new CapabilityHub();
	const artifacts = new ArtifactStore();
	const jobs = new JobManager();
	const foundationRegistration = registerDesktopFoundationProviders(hub.foundation, artifacts, jobs);
	const domainRegistration = registerDesktopDomainProviders(hub.domain, artifacts, jobs);
	const access = new CapabilityAccessController(hub, { audit: auditCapabilityAccess });
	const pluginAdapter = new PluginCapabilityAdapter(access, {
		resolvePermissions: (pluginId) => {
			const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
			if (!plugin || !plugin.enabled) return [];
			return plugin.permissions.filter((permission) => plugin.grantedPermissions.includes(permission));
		},
		isOfficialPlugin: (pluginId) => {
			const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
			return plugin?.enabled === true && plugin.trustLevel === "official";
		},
		// Jobs and temporary artifacts are owned by the stable plugin id, not by a
		// renderer capability session. They must survive renderer reloads so the
		// replacement session can reconcile an in-flight media operation.
	});
	const themeAdapter = new ThemeCapabilityAdapter(access);
	return {
		access,
		adapters: Object.freeze({ plugin: pluginAdapter, theme: themeAdapter }),
		hub,
		dispose: () => {
			pluginAdapter.dispose();
			themeAdapter.dispose();
			domainRegistration.dispose();
			foundationRegistration.dispose();
			jobs.dispose();
			artifacts.dispose();
		},
	};
}

let desktopCapabilityHost: DesktopCapabilityHost | undefined;

export function getDesktopCapabilityHost(): DesktopCapabilityHost {
	desktopCapabilityHost ??= createDesktopCapabilityHost();
	return desktopCapabilityHost;
}
