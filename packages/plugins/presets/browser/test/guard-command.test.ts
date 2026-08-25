/**
 * shim 门禁的行为测试。
 *
 * 这层判定是把 PreToolUse Hook（拿结构化工具名与参数）换成 argv 解析后的等价物，所以旧 Hook
 * 覆盖过的每条规则——危险动作、域名白名单、非法地址——这里都要继续钉住，另外补上 CLI 模式
 * 独有的两类：会顶掉插件策略的托管标志，以及不该由模型执行的子命令。
 */
import { describe, expect, it } from "vitest";
import {
	collectCandidateUrls,
	evaluateBrowserCommand,
	extractHost,
	matchesAllowedDomain,
	parseAllowedDomains,
	parseCommandLine,
	// @ts-expect-error -- shim 侧是无构建的 .mjs，没有类型声明。
} from "../agent/skills/browser-use/scripts/lib/guard.mjs";

const permissive = { allowedDomains: [], denyEval: false, denyDownload: false, denyUpload: false };
const restricted = { ...permissive, allowedDomains: ["example.com", "*.docs.example.org"] };

describe("parseCommandLine", () => {
	it("带值标志的值不会被当成子命令", () => {
		const parsed = parseCommandLine(["--max-output", "500", "open", "example.com"]);
		expect(parsed.positionals[0]).toBe("open");
		expect(parsed.flags).toContainEqual({ name: "--max-output", value: "500" });
	});

	it("--flag=value 形式同样能取到值", () => {
		expect(parseCommandLine(["--url=https://a.com"]).flags).toContainEqual({
			name: "--url",
			value: "https://a.com",
		});
	});

	it("布尔标志不吞掉后面的位置参数", () => {
		expect(parseCommandLine(["--json", "snapshot", "-i"]).positionals).toEqual(["snapshot"]);
	});
});

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
		expect(extractHost(undefined)).toBeNull();
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

describe("collectCandidateUrls", () => {
	it("只取上游明确接受 URL 的位置", () => {
		expect(collectCandidateUrls("open", ["open", "example.com"], [])).toEqual(["example.com"]);
		expect(collectCandidateUrls("tab", ["tab", "new", "a.com"], [])).toEqual(["a.com"]);
		expect(collectCandidateUrls("diff", ["diff", "url", "a.com", "b.com"], [])).toEqual(["a.com", "b.com"]);
		expect(collectCandidateUrls("record", ["record", "start", "./out.webm", "a.com"], [])).toEqual(["a.com"]);
	});

	it("不猜位置参数 —— screenshot 的文件名不是导航目标", () => {
		expect(collectCandidateUrls("screenshot", ["screenshot", "home.png"], [])).toEqual([]);
	});

	it("--url 标志无论出现在哪都要检查", () => {
		expect(collectCandidateUrls("auth", ["auth", "save", "gh"], [{ name: "--url", value: "a.com" }])).toEqual(["a.com"]);
	});
});

describe("evaluateBrowserCommand", () => {
	it("常规命令放行", () => {
		expect(evaluateBrowserCommand(["snapshot", "-i"], permissive)).toEqual({ action: "allow" });
		expect(evaluateBrowserCommand([], permissive)).toEqual({ action: "allow" });
	});

	it("托管标志一律拒绝 —— 否则用户设置会被命令行整个顶掉", () => {
		for (const flag of ["--config", "--session", "--profile", "--allowed-domains", "--cdp", "--auto-connect"]) {
			const decision = evaluateBrowserCommand([flag, "x", "open", "example.com"], permissive);
			expect(decision).toMatchObject({ action: "block", code: "managed-flag" });
		}
	});

	it("--no-pin-tab 会解除标签钉住，同样拒绝", () => {
		expect(evaluateBrowserCommand(["--no-pin-tab", "open", "a.com"], permissive)).toMatchObject({
			code: "managed-flag",
		});
	});

	it("安装与升级归面板管，模型不许自己下几百 MB", () => {
		expect(evaluateBrowserCommand(["install"], permissive)).toMatchObject({
			action: "block",
			code: "subcommand-blocked",
		});
		expect(evaluateBrowserCommand(["upgrade"], permissive)).toMatchObject({ code: "subcommand-blocked" });
	});

	it("chat / plugin / mcp / connect 不允许 —— 会跳出本会话的策略边界", () => {
		for (const sub of ["chat", "plugin", "mcp", "connect"]) {
			expect(evaluateBrowserCommand([sub, "x"], permissive)).toMatchObject({ code: "subcommand-blocked" });
		}
	});

	it("skills 子命令放行 —— 模型要靠它读上游用法参考", () => {
		expect(evaluateBrowserCommand(["skills", "get", "core"], restricted)).toEqual({ action: "allow" });
	});

	it("禁用 eval 时拦下页面脚本执行，并说明去哪改", () => {
		const decision = evaluateBrowserCommand(["eval", "document.cookie"], { ...permissive, denyEval: true });
		expect(decision).toMatchObject({ action: "block", code: "action-denied" });
		expect(decision.action === "block" && decision.reason).toContain("浏览器操作");
	});

	it("危险动作判定与白名单无关 —— 白名单为空也照样拦", () => {
		expect(evaluateBrowserCommand(["upload", "@e1", "/etc/passwd"], { ...permissive, denyUpload: true })).toMatchObject(
			{ code: "action-denied" },
		);
	});

	it("未禁用的类别放行", () => {
		expect(evaluateBrowserCommand(["download", "@e1", "./a.pdf"], permissive)).toEqual({ action: "allow" });
	});

	it("白名单为空时不限制导航", () => {
		expect(evaluateBrowserCommand(["open", "https://anything.test"], permissive)).toEqual({ action: "allow" });
	});

	it("白名单外的域名被拦，理由点名 host", () => {
		const decision = evaluateBrowserCommand(["open", "https://evil.com/steal"], restricted);
		expect(decision).toMatchObject({ action: "block", code: "domain-not-allowed" });
		expect(decision.action === "block" && decision.reason).toContain("evil.com");
	});

	it("白名单内的域名放行，含通配子域", () => {
		expect(evaluateBrowserCommand(["read", "example.com/a"], restricted)).toEqual({ action: "allow" });
		expect(evaluateBrowserCommand(["open", "https://api.docs.example.org"], restricted)).toEqual({ action: "allow" });
	});

	it("省略 url 不算越界 —— read 读的是当前页", () => {
		expect(evaluateBrowserCommand(["read"], restricted)).toEqual({ action: "allow" });
	});

	it("白名单开启时无法解析的地址一律拦下", () => {
		expect(evaluateBrowserCommand(["open", "javascript:alert(1)"], restricted)).toMatchObject({
			code: "invalid-url",
		});
	});

	it("多个 URL 的命令里任意一个越界就拦", () => {
		expect(evaluateBrowserCommand(["diff", "url", "example.com", "evil.com"], restricted)).toMatchObject({
			code: "domain-not-allowed",
		});
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
		expect(parseAllowedDomains(undefined)).toEqual([]);
	});
});
