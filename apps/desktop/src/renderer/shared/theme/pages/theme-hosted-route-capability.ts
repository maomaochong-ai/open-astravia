import {
	CAPABILITY_CONSTRAINT_KINDS,
	type CapabilityAccessHandle,
	type CapabilityAccessSessionFactory,
	createCapabilityGrant,
	DOMAIN_NAVIGATION_CAPABILITIES,
	type HostedRouteRef,
	isValidHostedRouteSegment,
} from "@vetta/capability-sdk";

export const THEME_RENDERER_ROUTE_NAMESPACE = "theme-page";

export interface ThemeRendererHostedRouteSession {
	readonly themeId: string;
	openPage(pageId: string): Promise<void>;
	revoke(): void;
}

export function createThemeRendererHostedRouteSession(
	accessSessionFactory: CapabilityAccessSessionFactory,
	sessionId: string,
	themeId: string,
): ThemeRendererHostedRouteSession {
	if (!sessionId.trim()) throw new Error("Theme renderer capability session id is required");
	if (!isValidHostedRouteSegment(themeId)) throw new Error(`Invalid theme id: ${themeId}`);

	const access = accessSessionFactory.createSession({
		subject: { id: `system-adapter:theme-renderer:${themeId}`, sessionId },
		grants: [
			createCapabilityGrant(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE, {
				constraints: [{ kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE, value: THEME_RENDERER_ROUTE_NAMESPACE }],
			}),
		],
	});
	return createHostedRouteSession(themeId, access);
}

function createHostedRouteSession(themeId: string, access: CapabilityAccessHandle): ThemeRendererHostedRouteSession {
	return {
		themeId,
		openPage: (pageId) =>
			access.client.invoke(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE, themePageRoute(themeId, pageId)),
		revoke: () => access.revoke(),
	};
}

export function themePageRoute(themeId: string, pageId: string): HostedRouteRef {
	return { namespace: THEME_RENDERER_ROUTE_NAMESPACE, ownerId: themeId, pageId };
}
