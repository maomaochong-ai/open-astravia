import { describe, expect, it } from "vitest";
import { hasExplicitProxyEnv, proxyUrlFromPacResult, resolveSidecarProxyEnv } from "./proxy-env.js";

describe("proxyUrlFromPacResult", () => {
	it("直连时不产生代理", () => {
		expect(proxyUrlFromPacResult("DIRECT")).toBeUndefined();
		expect(proxyUrlFromPacResult("")).toBeUndefined();
	});

	it("解析 Electron 返回的常见形态", () => {
		expect(proxyUrlFromPacResult("PROXY 127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
		expect(proxyUrlFromPacResult("HTTPS proxy.corp:443")).toBe("https://proxy.corp:443");
		expect(proxyUrlFromPacResult("SOCKS5 127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
		expect(proxyUrlFromPacResult("SOCKS 127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
	});

	it("取回退链里第一个可用项，跳过 Go 不支持的 SOCKS4", () => {
		expect(proxyUrlFromPacResult("SOCKS4 1.2.3.4:1080;PROXY 127.0.0.1:7890;DIRECT")).toBe("http://127.0.0.1:7890");
	});

	it("整条链都不可用时退回直连", () => {
		expect(proxyUrlFromPacResult("SOCKS4 1.2.3.4:1080;DIRECT")).toBeUndefined();
	});

	it("忽略无法解析的条目而不是抛错", () => {
		expect(proxyUrlFromPacResult("GARBAGE;PROXY 127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
	});
});

describe("hasExplicitProxyEnv", () => {
	it("识别大小写两种写法", () => {
		expect(hasExplicitProxyEnv({ HTTPS_PROXY: "http://p:1" })).toBe(true);
		expect(hasExplicitProxyEnv({ https_proxy: "http://p:1" })).toBe(true);
		expect(hasExplicitProxyEnv({ ALL_PROXY: "socks5://p:1" })).toBe(true);
	});

	it("空串不算显式设置", () => {
		expect(hasExplicitProxyEnv({ HTTPS_PROXY: "", HTTP_PROXY: "  " })).toBe(false);
		expect(hasExplicitProxyEnv({})).toBe(false);
	});
});

describe("resolveSidecarProxyEnv", () => {
	it("系统配了代理时注入 HTTPS_PROXY / HTTP_PROXY / NO_PROXY", async () => {
		const resolved = await resolveSidecarProxyEnv(async () => "PROXY 127.0.0.1:7890", {});
		expect(resolved.source).toBe("system");
		expect(resolved.env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
		expect(resolved.env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
		expect(resolved.env.NO_PROXY).toContain("127.0.0.1");
		expect(resolved.env.NO_PROXY).toContain("localhost");
	});

	it("系统直连时不注入任何变量", async () => {
		const resolved = await resolveSidecarProxyEnv(async () => "DIRECT", {});
		expect(resolved.source).toBe("direct");
		expect(resolved.env).toEqual({});
	});

	it("父进程已有显式代理时不覆盖，也不去解析系统代理", async () => {
		let called = false;
		const resolved = await resolveSidecarProxyEnv(
			async () => {
				called = true;
				return "PROXY 127.0.0.1:7890";
			},
			{ HTTPS_PROXY: "http://mine:8080" },
		);
		expect(resolved.source).toBe("inherited");
		expect(resolved.env).toEqual({});
		expect(called).toBe(false);
	});

	it("解析失败按直连处理，不阻塞桥接启动", async () => {
		const resolved = await resolveSidecarProxyEnv(async () => {
			throw new Error("no session");
		}, {});
		expect(resolved.source).toBe("direct");
		expect(resolved.env).toEqual({});
	});
});
