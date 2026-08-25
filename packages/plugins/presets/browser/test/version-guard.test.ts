/**
 * 版本闸门的回归测试。
 *
 * 真实故障：机器上先有一个用户自己装的 agent-browser 0.25.4（nvm 全局，排在 PATH 上），
 * wrapper 找到它就直接 exec，而旧版不认识 `--pin-tab`，进程立刻以 "Unknown command" 退出。
 * 结果是会话里一个 agent_browser_* 工具都没有，模型静默退回 web search，面板还显示「就绪」。
 *
 * 所以这里同时钉住两件事：解析到二进制 ≠ 可用（必须比版本），以及插件自己装的那份要赢过
 * 机器上已有的全局安装。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- wrapper 侧是无构建的 .mjs，没有类型声明。
import { isAgentBrowserCompatible, MINIMUM_AGENT_BROWSER_VERSION, parseAgentBrowserVersion } from "../scripts/lib/version.mjs";
// @ts-expect-error -- 同上。
import { setupGuidance } from "../scripts/lib/stub-server.mjs";
// @ts-expect-error -- 同上。
import { resolveAgentBrowserBinary } from "../scripts/lib/resolve-binary.mjs";
import {
	isAgentBrowserCompatible as isCompatibleTs,
	parseAgentBrowserVersion as parseVersionTs,
} from "../src/runtime/runtime-controller";

describe("版本解析", () => {
	it("从 CLI 输出里取出版本号", () => {
		expect(parseAgentBrowserVersion("agent-browser 0.25.4\n")).toBe("0.25.4");
		expect(parseVersionTs("agent-browser 0.34.0")).toBe("0.34.0");
	});

	it("取不到版本号时返回 null", () => {
		expect(parseAgentBrowserVersion("command not found")).toBeNull();
		expect(parseVersionTs("")).toBeNull();
	});
});

describe("兼容性判定", () => {
	it("0.25.4 不满足要求 —— 这就是导致工具面整个消失的那个版本", () => {
		expect(isAgentBrowserCompatible("0.25.4")).toBe(false);
		expect(isCompatibleTs("0.25.4")).toBe(false);
	});

	it("恰好等于最低版本算兼容", () => {
		expect(isAgentBrowserCompatible(MINIMUM_AGENT_BROWSER_VERSION)).toBe(true);
	});

	it("更高版本算兼容，且按数值而不是字典序比较", () => {
		expect(isAgentBrowserCompatible("0.34.1")).toBe(true);
		expect(isAgentBrowserCompatible("0.100.0", "0.34.0")).toBe(true);
		expect(isAgentBrowserCompatible("1.0.0")).toBe(true);
	});

	it("次版本相同时比修订号", () => {
		expect(isAgentBrowserCompatible("0.34.0", "0.34.1")).toBe(false);
	});

	it("版本判不出来时 fail-closed —— 宁可提示重装也不要静默失败", () => {
		expect(isAgentBrowserCompatible(null)).toBe(false);
		expect(isAgentBrowserCompatible("unknown")).toBe(false);
		expect(isCompatibleTs(null)).toBe(false);
	});
});

describe("版本过旧的引导文案", () => {
	it("点名实际版本与要求版本，并说明不会动用户已有的全局安装", () => {
		const text = setupGuidance("version-too-old", { version: "0.25.4" });
		expect(text).toContain("0.25.4");
		expect(text).toContain(MINIMUM_AGENT_BROWSER_VERSION);
		expect(text).toContain("升级");
	});

	it("连版本都读不出来时也给得出可操作的话", () => {
		expect(setupGuidance("version-too-old", {})).toContain("升级");
	});
});

describe("二进制解析优先级", () => {
	it("宿主托管前缀赢过 PATH 上已有的全局安装", () => {
		const found = resolveAgentBrowserBinary({
			preferredDirs: ["/vetta/.npm-global/bin"],
			pathValue: "/home/u/.nvm/bin",
			platform: "darwin",
			arch: "arm64",
			exists: () => true,
		});
		expect(found).toBe("/vetta/.npm-global/bin/agent-browser");
	});

	it("托管前缀里没有时才回落到 PATH", () => {
		const found = resolveAgentBrowserBinary({
			preferredDirs: ["/vetta/.npm-global/bin"],
			pathValue: "/home/u/.nvm/bin",
			platform: "darwin",
			arch: "arm64",
			exists: (p: string) => p === "/home/u/.nvm/bin/agent-browser",
		});
		expect(found).toBe("/home/u/.nvm/bin/agent-browser");
	});
});
