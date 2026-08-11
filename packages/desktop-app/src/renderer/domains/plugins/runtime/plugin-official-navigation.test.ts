import { afterEach, describe, expect, it } from "vitest";
import {
	createOfficialNavigationApi,
	getOfficialNavigationHelp,
	resolveOfficialNavigationOpen,
} from "./plugin-official-navigation.js";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host.js";

const SESSION_ID = "navigation-session";

afterEach(() => {
	pluginRendererCapabilityHost.closeSession(SESSION_ID);
});

describe("createOfficialNavigationApi", () => {
	it("routes catalog and resolution through the bound renderer session", () => {
		pluginRendererCapabilityHost.bindSession(SESSION_ID, {
			id: "navigation-plugin",
			enabled: true,
			trustLevel: "official",
		});
		const navigation = createOfficialNavigationApi(SESSION_ID);

		expect(navigation.help()).toHaveProperty("type", "help");
		expect(navigation.resolveOpen({ target: "plugins" })).toMatchObject({
			hashPath: "/abilities",
			resolved: { kind: "page", id: "plugins" },
		});

		pluginRendererCapabilityHost.closeSession(SESSION_ID);
		expect(() => navigation.help()).toThrow("Plugin renderer capability session is not active");
	});

	it("resolves the parameterised new-session target back to the original cwd", () => {
		// 项目路径带空格/百分号是常态（"/Users/a b/100% done"）。这条路径要经过两次解码
		// 才回到页面手里（路由参数一次、NewSessionPage 自己一次），编码错了会静默跳错项目。
		const cwd = "/Users/a b/100% done";
		const resolved = resolveOfficialNavigationOpen({ target: "new-session", cwd });
		expect(resolved.resolved).toMatchObject({ kind: "new-session", cwd });
		const [, , encoded] = resolved.hashPath.split("/");
		expect(decodeURIComponent(decodeURIComponent(encoded))).toBe(cwd);
	});

	it("refuses a new-session target without an absolute cwd instead of opening a blank page", () => {
		expect(() => resolveOfficialNavigationOpen({ target: "new-session" })).toThrow("requires an absolute cwd");
		expect(() => resolveOfficialNavigationOpen({ target: "new-session", cwd: "relative/path" })).toThrow(
			"requires an absolute cwd",
		);
	});

	it("lists new-session in the catalog so callers can discover it", () => {
		const help = getOfficialNavigationHelp() as { catalog: { pages: Array<{ id: string }> } };
		expect(help.catalog.pages.some((page) => page.id === "new-session")).toBe(true);
	});
});
