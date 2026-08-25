import { describe, expect, it } from "vitest";
import { normalizeBrowserSettings, normalizeToolsProfile, parseAllowedDomains } from "../src/config/settings";
import { detectSystemChrome, parseAuthProfiles, parseSessions, parseTabs } from "../src/runtime/parse";

describe("normalizeBrowserSettings", () => {
	it("空设置回落到保守默认", () => {
		expect(normalizeBrowserSettings({})).toMatchObject({
			browserSource: "managed",
			denyEval: true,
			denyUpload: true,
			denyDownload: false,
		});
	});

	it("未知的 browserSource 一律按托管处理，不会误开附着模式", () => {
		expect(normalizeBrowserSettings({ browserSource: "cdp" }).browserSource).toBe("managed");
	});

	it("设置页的数字输入可能是字符串", () => {
		expect(normalizeBrowserSettings({ maxOutput: "40000" }).maxOutput).toBe(40000);
	});
});

describe("normalizeToolsProfile", () => {
	it("保留合法的逗号组合并去重", () => {
		expect(normalizeToolsProfile("core, network ,core")).toBe("core,network");
	});

	it("非法 profile 会让 agent-browser 起不来，所以整体回落 core", () => {
		expect(normalizeToolsProfile("nonsense")).toBe("core");
		expect(normalizeToolsProfile("")).toBe("core");
		expect(normalizeToolsProfile(42)).toBe("core");
	});

	it("大小写与空白不敏感", () => {
		expect(normalizeToolsProfile(" ALL ")).toBe("all");
	});
});

describe("parseAllowedDomains", () => {
	it("逗号、分号、换行、空格都能分隔", () => {
		expect(parseAllowedDomains("a.com, b.com;c.com\n d.com")).toEqual(["a.com", "b.com", "c.com", "d.com"]);
	});

	it("去重并统一小写", () => {
		expect(parseAllowedDomains("A.com,a.COM")).toEqual(["a.com"]);
	});

	it("空白输入表示不限制", () => {
		expect(parseAllowedDomains("   \n ")).toEqual([]);
	});
});

describe("CLI 输出解析", () => {
	it("tabs 优先用 targetId —— 它跨 daemon 重启稳定，t<N> 不是", () => {
		const tabs = parseTabs(JSON.stringify({ tabs: [{ id: "t1", targetId: "ABC", title: "x", url: "https://x", active: true }] }));
		expect(tabs).toEqual([{ ref: "ABC", title: "x", url: "https://x", active: true }]);
	});

	it("没有 targetId 时退回 tabId（真实输出里的 per-daemon 计数 id）", () => {
		expect(parseTabs(JSON.stringify([{ tabId: "t2" }]))[0].ref).toBe("t2");
	});

	it("解析 agent-browser 0.34.0 `tab list --json` 的真实输出", () => {
		// 取自真机：外层是 {success,data:{lifecycle,tabs}}，tab 同时带 tabId 与 targetId。
		const real = JSON.stringify({
			success: true,
			data: {
				lifecycle: { launched: true },
				tabs: [
					{ active: true, label: null, tabId: "t1", targetId: "23AEF5BC", title: "Example", type: "page", url: "https://example.com" },
				],
			},
			error: null,
		});
		expect(parseTabs(real)).toEqual([
			{ ref: "23AEF5BC", title: "Example", url: "https://example.com", active: true },
		]);
	});

	it("解析真实的 `session list --json` 与 `auth list --json`", () => {
		expect(parseSessions(JSON.stringify({ success: true, data: { sessions: ["default", "vetta-probe"] } }))).toEqual([
			{ id: "default", active: false },
			{ id: "vetta-probe", active: false },
		]);
		expect(parseAuthProfiles(JSON.stringify({ success: true, data: { lifecycle: {}, profiles: [] }, error: null }))).toEqual([]);
	});

	it("包了一层 result 也认", () => {
		expect(parseTabs(JSON.stringify({ result: { tabs: [{ id: "t3" }] } }))).toHaveLength(1);
	});

	it("形状不认识时返回空列表而不是抛错 —— 面板显示空态好过整页崩掉", () => {
		expect(parseTabs("not json")).toEqual([]);
		expect(parseTabs(JSON.stringify({ unexpected: true }))).toEqual([]);
		expect(parseSessions("")).toEqual([]);
		expect(parseAuthProfiles("null")).toEqual([]);
	});

	it("会话列表可能是纯字符串数组", () => {
		expect(parseSessions(JSON.stringify(["default", "vetta-a"]))).toEqual([
			{ id: "default", active: false },
			{ id: "vetta-a", active: false },
		]);
	});

	it("凭据只解析名称与 URL，不期待也不接收密码字段", () => {
		const profiles = parseAuthProfiles(JSON.stringify({ profiles: [{ name: "github", url: "https://github.com", username: "u" }] }));
		expect(profiles).toEqual([{ name: "github", url: "https://github.com", username: "u" }]);
	});
});

describe("detectSystemChrome", () => {
	it("识别出已有系统 Chrome", () => {
		expect(detectSystemChrome("  ✓ System Chrome found: /Applications/Google Chrome.app")).toBe(true);
	});

	it("识别出没有 Chrome", () => {
		expect(detectSystemChrome("⚠ No Chrome installation detected.")).toBe(false);
	});

	it("上游文案变了就返回 null，不猜 —— 猜错的代价是白下几百 MB 或该下没下", () => {
		expect(detectSystemChrome("added 1 package in 3s")).toBeNull();
	});
});
