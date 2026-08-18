import { afterEach, describe, expect, it, vi } from "vitest";

// 草稿模块经 chat-atoms 在导入期读一次 localStorage（node 环境没有），得先于 import 补上。
vi.hoisted(() => {
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
	};
});

import { loadSessionInputDraft, newSessionInputDraftKey } from "@shared/store/session-input-draft";
import {
	createOfficialNavigationApi,
	getOfficialNavigationHelp,
	resolveOfficialNavigationOpen,
} from "./plugin-official-navigation.js";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host.js";

const SESSION_ID = "navigation-session";

/** 测试跑在 node 环境：`window.location.hash` 得自己搭一个，顺便观测写入时机。 */
function stubWindowHash(onWrite: (hash: string) => void): void {
	const location = {
		_hash: "",
		get hash(): string {
			return this._hash;
		},
		set hash(value: string) {
			this._hash = value;
			onWrite(value);
		},
	};
	(globalThis as { window?: unknown }).window = { location };
}

afterEach(() => {
	pluginRendererCapabilityHost.closeSession(SESSION_ID);
	(globalThis as { window?: unknown }).window = undefined;
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

	it("writes the new-session draft before navigating, so the page restores it instead of a blank box", async () => {
		pluginRendererCapabilityHost.bindSession(SESSION_ID, {
			id: "navigation-plugin",
			enabled: true,
			trustLevel: "official",
		});
		const navigation = createOfficialNavigationApi(SESSION_ID);
		const cwd = "/w/design-a";
		const hashes: string[] = [];
		// 断言顺序：跳转发生时草稿必须已经在 map 里，否则新会话页的草稿恢复会把它冲掉。
		stubWindowHash((hash) => {
			hashes.push(hash);
			expect(loadSessionInputDraft(newSessionInputDraftKey(cwd)).text).toBe("@skill:vetta-ui-design ");
		});

		await navigation.open({ target: "new-session", cwd, draft: "@skill:vetta-ui-design " });

		expect(hashes).toHaveLength(1);
		expect(loadSessionInputDraft(newSessionInputDraftKey(cwd)).text).toBe("@skill:vetta-ui-design ");
	});

	it("ignores a blank draft and drafts on targets that have no input box", async () => {
		pluginRendererCapabilityHost.bindSession(SESSION_ID, {
			id: "navigation-plugin",
			enabled: true,
			trustLevel: "official",
		});
		const navigation = createOfficialNavigationApi(SESSION_ID);
		stubWindowHash(() => {});

		await navigation.open({ target: "new-session", cwd: "/w/blank", draft: "   " });
		await navigation.open({ target: "plugins", draft: "@skill:vetta-ui-design " });

		expect(loadSessionInputDraft(newSessionInputDraftKey("/w/blank")).text).toBe("");
	});
});
