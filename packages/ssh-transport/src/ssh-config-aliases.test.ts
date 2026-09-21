import { describe, expect, it } from "vitest";
import { parseSshConfigAliases } from "./ssh-config-aliases.js";

describe("parseSshConfigAliases", () => {
	it("提取别名，忽略注释与缩进", () => {
		const content = ["# 公司", "Host build-01", "  HostName 10.0.0.1", "", "Host lab", "  User dev"].join("\n");
		expect(parseSshConfigAliases(content)).toEqual(["build-01", "lab"]);
	});

	it("一行多个别名全部收下", () => {
		expect(parseSshConfigAliases("Host a b c")).toEqual(["a", "b", "c"]);
	});

	it("跳过通配与取反条目——它们是给一组主机配默认值，不是可连接的目标", () => {
		const content = ["Host *", "  ServerAliveInterval 60", "Host !bad *.internal", "Host real"].join("\n");
		expect(parseSshConfigAliases(content)).toEqual(["real"]);
	});

	it("Host 关键字大小写不敏感，也允许 = 分隔", () => {
		expect(parseSshConfigAliases("HOST=alpha\nhost beta")).toEqual(["alpha", "beta"]);
	});

	it("重复别名只保留一次", () => {
		expect(parseSshConfigAliases("Host dup\nHost dup")).toEqual(["dup"]);
	});

	it("不把 HostName 当成 Host", () => {
		// `^host[\s=]+` 若写成 `^host` 就会把 HostName 的值当别名收进来。
		expect(parseSshConfigAliases("Host real\n  HostName 10.0.0.1")).toEqual(["real"]);
	});
});
