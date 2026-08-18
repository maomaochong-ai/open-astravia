import { describe, expect, it } from "vitest";
import { pluginWorkspaceRoute } from "../../domains/plugins/runtime/plugin-hosted-route-capability.js";
import { themePageRoute } from "../theme/pages/theme-hosted-route-capability.js";
import {
	PLUGIN_HOSTED_ROUTE_PATH,
	pluginHostedRouteNavigationTarget,
	pluginHostedRoutePath,
	THEME_HOSTED_ROUTE_PATH,
	themeHostedRouteNavigationTarget,
	themeHostedRoutePath,
} from "./hosted-route-descriptors.js";

describe("Desktop hosted route descriptors", () => {
	it("maps Plugin and Theme namespaces to their compatible static routes", () => {
		expect(pluginHostedRouteNavigationTarget(pluginWorkspaceRoute("plugin.example", "main"))).toEqual({
			to: PLUGIN_HOSTED_ROUTE_PATH,
			params: { pluginId: "plugin.example", viewId: "main" },
		});
		expect(pluginHostedRoutePath(pluginWorkspaceRoute("plugin.example", "main"))).toBe(
			"/workspace/plugin.example/main",
		);

		expect(themeHostedRouteNavigationTarget(themePageRoute("theme.example", "settings"))).toEqual({
			to: THEME_HOSTED_ROUTE_PATH,
			params: { themeId: "theme.example", pageId: "settings" },
		});
		expect(themeHostedRoutePath(themePageRoute("theme.example", "settings"))).toBe("/theme/theme.example/settings");
	});
});
