import {
	CAPABILITY_CONSTRAINT_KINDS,
	type CapabilityAccessHandle,
	type CapabilityAccessSessionFactory,
	createCapabilityGrant,
	DOMAIN_NAVIGATION_CAPABILITIES,
	type HostedRouteRef,
	isValidHostedRouteSegment,
} from "@vetta/capability-sdk";

export const PLUGIN_RENDERER_CAPABILITY_PERMISSIONS = {
	WORKSPACE_VIEW: "ui.slot.workspace-view",
} as const;

export const PLUGIN_RENDERER_ROUTE_NAMESPACE = "plugin-workspace";

export interface PluginRendererCapabilitySubject {
	readonly enabled: boolean;
	readonly grantedPermissions: readonly string[];
	readonly id: string;
	readonly permissions: readonly string[];
}

export interface PluginRendererHostedRouteSession {
	readonly pluginId: string;
	openWorkspaceView(viewId: string): Promise<void>;
	revoke(): void;
}

export function createPluginRendererHostedRouteSession(
	accessSessionFactory: CapabilityAccessSessionFactory,
	sessionId: string,
	plugin: PluginRendererCapabilitySubject,
): PluginRendererHostedRouteSession {
	if (!sessionId.trim()) throw new Error("Plugin renderer capability session id is required");
	if (!isValidHostedRouteSegment(plugin.id)) throw new Error(`Invalid plugin id: ${plugin.id}`);

	const permission = PLUGIN_RENDERER_CAPABILITY_PERMISSIONS.WORKSPACE_VIEW;
	const grants =
		plugin.enabled && plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission)
			? [
					createCapabilityGrant(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE, {
						constraints: [
							{ kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE, value: PLUGIN_RENDERER_ROUTE_NAMESPACE },
						],
					}),
				]
			: [];
	const access = accessSessionFactory.createSession({
		subject: { id: `system-adapter:plugin-renderer:${plugin.id}`, sessionId },
		grants,
	});

	return createHostedRouteSession(plugin.id, access);
}

function createHostedRouteSession(pluginId: string, access: CapabilityAccessHandle): PluginRendererHostedRouteSession {
	return {
		pluginId,
		openWorkspaceView: (viewId) =>
			access.client.invoke(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE, pluginWorkspaceRoute(pluginId, viewId)),
		revoke: () => access.revoke(),
	};
}

export function pluginWorkspaceRoute(pluginId: string, viewId: string): HostedRouteRef {
	return { namespace: PLUGIN_RENDERER_ROUTE_NAMESPACE, ownerId: pluginId, pageId: viewId };
}
