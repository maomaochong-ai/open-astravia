import type { PluginTrustLevel } from "@preload/api";
import { rendererCapabilityHost } from "@shared/capabilities/renderer-capability-host";
import type { CapabilityAccessSessionFactory } from "@vetta/capability-sdk";
import {
	createPluginRendererHostedRouteSession,
	type PluginRendererHostedRouteSession,
} from "./plugin-hosted-route-capability.js";

interface RendererPluginSubject {
	readonly enabled: boolean;
	readonly grantedPermissions?: readonly string[];
	readonly id: string;
	readonly permissions?: readonly string[];
	readonly trustLevel: PluginTrustLevel;
}

interface RendererPluginCapabilitySession {
	readonly official: boolean;
	readonly hostedRoutes: PluginRendererHostedRouteSession;
}

export class PluginRendererCapabilityHost {
	private readonly sessions = new Map<string, RendererPluginCapabilitySession>();

	constructor(private readonly accessSessionFactory: CapabilityAccessSessionFactory = rendererCapabilityHost) {}

	bindSession(sessionId: string, plugin: RendererPluginSubject): void {
		if (!sessionId.trim()) throw new Error("Plugin renderer capability session id is required");
		if (!plugin.id.trim()) throw new Error("Plugin renderer capability subject id is required");

		// PluginGlobalSlotHost 会先发布 replacement，再释放旧 activation；两个 session
		// 在这段事务窗口内都必须可用，并由各自的 LoadedPlugin.dispose() 精确关闭。
		this.sessions.set(sessionId, {
			official: plugin.enabled && plugin.trustLevel === "official",
			hostedRoutes: createPluginRendererHostedRouteSession(this.accessSessionFactory, sessionId, {
				id: plugin.id,
				enabled: plugin.enabled,
				permissions: plugin.permissions ?? [],
				grantedPermissions: plugin.grantedPermissions ?? [],
			}),
		});
	}

	closeSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.hostedRoutes.revoke();
		this.sessions.delete(sessionId);
	}

	assertOfficialSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error("Plugin renderer capability session is not active");
		if (!session.official) throw new Error("Plugin official renderer capability access denied");
	}

	invokeOfficial<T>(sessionId: string, operation: () => T): T {
		this.assertOfficialSession(sessionId);
		return operation();
	}

	openWorkspaceView(sessionId: string, viewId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return Promise.reject(new Error("Plugin renderer capability session is not active"));
		return session.hostedRoutes.openWorkspaceView(viewId);
	}
}

export const pluginRendererCapabilityHost = new PluginRendererCapabilityHost();
