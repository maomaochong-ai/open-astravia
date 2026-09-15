// @vitest-environment jsdom
import { getDefaultStore } from "jotai";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pluginWorkspaceRoute } from "./domains/plugins/runtime/plugin-hosted-route-capability.js";
import { initializeHostedRoutes } from "./initialize-hosted-routes.js";
import { router } from "./router.js";
import { desktopHostedRouteService } from "./shared/hosted-routes/hosted-route-service.js";
import { pluginWorkspaceViewsAtom } from "./shared/store/atoms.js";

vi.mock("./router.js", () => ({ router: { navigate: vi.fn(async () => undefined) } }));

describe("plugin workspace navigation", () => {
	beforeAll(() => initializeHostedRoutes());

	it("opens off-sidebar account settings within More options and keeps sidebar views on their workspace route", async () => {
		const store = getDefaultStore();
		const previous = store.get(pluginWorkspaceViewsAtom);
		store.set(pluginWorkspaceViewsAtom, [
			{
				pluginId: "jsk-map",
				pluginName: "JSK Map",
				viewId: "settings",
				label: "JSK account settings",
				sidebar: false,
				navOrder: 0,
				component: () => null,
			},
			{
				pluginId: "jsk-map",
				pluginName: "JSK Map",
				viewId: "map",
				label: "Map",
				sidebar: true,
				navOrder: 0,
				component: () => null,
			},
		]);
		try {
			await desktopHostedRouteService.open(pluginWorkspaceRoute("jsk-map", "settings"));
			expect(router.navigate).toHaveBeenLastCalledWith({
				to: "/settings/$tab",
				params: { tab: "extensions" },
				search: { view: "jsk-map/settings" },
			});
			await desktopHostedRouteService.open(pluginWorkspaceRoute("jsk-map", "map"));
			expect(router.navigate).toHaveBeenLastCalledWith({
				to: "/workspace/$pluginId/$viewId",
				params: { pluginId: "jsk-map", viewId: "map" },
			});
			// A removed view still follows the ordinary route's missing-view recovery.
			store.set(pluginWorkspaceViewsAtom, []);
			await desktopHostedRouteService.open(pluginWorkspaceRoute("jsk-map", "settings"));
			expect(router.navigate).toHaveBeenLastCalledWith({
				to: "/workspace/$pluginId/$viewId",
				params: { pluginId: "jsk-map", viewId: "settings" },
			});
		} finally {
			store.set(pluginWorkspaceViewsAtom, previous);
		}
	});
});
