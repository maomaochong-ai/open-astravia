import { describe, expect, it, vi } from "vitest";

/**
 * 单独成文件：同一文件里被 mock 的 "undici" 模块只会求值一次并缓存，
 * 没法在用例之间切换「加载成功 / 加载抛错」两种工厂结果。
 */
vi.mock("undici", () => {
	throw Object.assign(new Error("No such built-in module: node:sqlite"), {
		code: "ERR_UNKNOWN_BUILTIN_MODULE",
	});
});

describe("http-proxy（undici 加载失败）", () => {
	it("只告警，不产生未捕获的 promise rejection", async () => {
		// 回归点：打包器曾把 undici 里惰性的 require("node:sqlite") 提升成顶层静态
		// import，Electron 没有该内置模块 → chunk 加载失败 → 这条 promise 变成
		// UnhandledPromiseRejectionWarning 刷进 RPC 宿主 stderr，而代理失效毫无提示。
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);

		await import("../src/utils/http-proxy.js");
		for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
		process.off("unhandledRejection", unhandled);

		expect(unhandled).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP proxy support disabled"));
	});
});
