import { describe, expect, it } from "vitest";
import {
	type BrowserGuardConfig,
	GUARDED_HOST_TOOL_NAMES,
	evaluateBrowserToolCall,
	extractHost,
	hostToolName,
	matchesAllowedDomain,
	toAgentBrowserTool,
} from "../src/guard/policy";

const permissive: BrowserGuardConfig = {
	allowedDomains: [],
	denyEval: false,
	denyDownload: false,
	denyUpload: false,
};

describe("extractHost", () => {
	it("补全裸域名的 scheme —— agent-browser 自己也会把裸 host 当 https", () => {
		expect(extractHost("example.com/path")).toBe("example.com");
	});

	it("剥掉端口、大小写与凭据", () => {
		expect(extractHost("HTTPS://User:Pass@Example.COM:8443/x")).toBe("example.com");
	});

	it("非 http(s) 一律不参与域名判定", () => {
		expect(extractHost("about:blank")).toBeNull();
		expect(extractHost("data:text/html,<b>x</b>")).toBeNull();
		expect(extractHost("file:///etc/passwd")).toBeNull();
	});

	it("空串与纯空白不是地址", () => {
		expect(extractHost("   ")).toBeNull();
	});
});

describe("matchesAllowedDomain", () => {
	it("精确匹配不吃子域", () => {
		expect(matchesAllowedDomain("evil.example.com", ["example.com"])).toBe(false);
		expect(matchesAllowedDomain("example.com", ["example.com"])).toBe(true);
	});

	it("通配前缀同时匹配裸域与子域", () => {
		expect(matchesAllowedDomain("example.com", ["*.example.com"])).toBe(true);
		expect(matchesAllowedDomain("a.b.example.com", ["*.example.com"])).toBe(true);
	});

	it("通配不匹配同后缀的其他域 —— notexample.com 不属于 example.com", () => {
		expect(matchesAllowedDomain("notexample.com", ["*.example.com"])).toBe(false);
	});
});

describe("evaluateBrowserToolCall", () => {
	it("放行不属于本插件的工具", () => {
		expect(evaluateBrowserToolCall("bash", { command: "ls" }, permissive)).toEqual({ action: "continue" });
	});

	it("白名单为空时不限制导航", () => {
		const decision = evaluateBrowserToolCall(hostToolName("agent_browser_open"), { url: "https://x.com" }, permissive);
		expect(decision.action).toBe("continue");
	});

	it("白名单外的域名被拦，并给出可操作理由", () => {
		const decision = evaluateBrowserToolCall(
			hostToolName("agent_browser_open"),
			{ url: "https://evil.com/steal" },
			{ ...permissive, allowedDomains: ["example.com"] },
		);
		expect(decision).toMatchObject({ action: "block", code: "domain-not-allowed" });
		expect(decision.action === "block" && decision.reason).toContain("evil.com");
	});

	it("白名单内的域名放行", () => {
		const decision = evaluateBrowserToolCall(
			hostToolName("agent_browser_read"),
			{ url: "docs.example.com/a" },
			{ ...permissive, allowedDomains: ["*.example.com"] },
		);
		expect(decision.action).toBe("continue");
	});

	it("省略 url 不算越界 —— open 不带 url 只是启动浏览器", () => {
		const decision = evaluateBrowserToolCall(
			hostToolName("agent_browser_open"),
			{},
			{ ...permissive, allowedDomains: ["example.com"] },
		);
		expect(decision.action).toBe("continue");
	});

	it("白名单开启时无法解析的地址一律拦下", () => {
		const decision = evaluateBrowserToolCall(
			hostToolName("agent_browser_open"),
			{ url: "javascript:alert(1)" },
			{ ...permissive, allowedDomains: ["example.com"] },
		);
		expect(decision).toMatchObject({ action: "block", code: "invalid-url" });
	});

	it("禁用 eval 时拦下页面脚本执行", () => {
		const decision = evaluateBrowserToolCall(
			hostToolName("agent_browser_eval"),
			{ code: "document.cookie" },
			{ ...permissive, denyEval: true },
		);
		expect(decision).toMatchObject({ action: "block", code: "action-denied" });
	});

	it("危险动作判定与白名单无关 —— 白名单为空也照样拦", () => {
		const decision = evaluateBrowserToolCall(hostToolName("agent_browser_upload"), { path: "/x" }, {
			...permissive,
			denyUpload: true,
		});
		expect(decision.action).toBe("block");
	});

	it("未禁用的类别放行", () => {
		const decision = evaluateBrowserToolCall(hostToolName("agent_browser_download"), {}, permissive);
		expect(decision.action).toBe("continue");
	});

	it("工具输入不是对象时不崩，按无 url 处理", () => {
		const decision = evaluateBrowserToolCall(hostToolName("agent_browser_open"), "not-an-object", {
			...permissive,
			allowedDomains: ["example.com"],
		});
		expect(decision.action).toBe("continue");
	});
});

describe("工具名映射", () => {
	it("还原宿主工具名到 agent-browser 原始名", () => {
		expect(toAgentBrowserTool(hostToolName("agent_browser_click"))).toBe("agent_browser_click");
		expect(toAgentBrowserTool("mcp_other-server_x")).toBeNull();
	});

	it("订阅列表覆盖导航类与危险动作类，且都是宿主可见全名", () => {
		expect(GUARDED_HOST_TOOL_NAMES).toContain(hostToolName("agent_browser_open"));
		expect(GUARDED_HOST_TOOL_NAMES).toContain(hostToolName("agent_browser_eval"));
		expect(GUARDED_HOST_TOOL_NAMES.every((name) => name.startsWith("mcp_plugin-browser-chrome_"))).toBe(true);
	});
});
