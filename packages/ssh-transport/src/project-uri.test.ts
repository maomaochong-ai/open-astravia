import { describe, expect, it } from "vitest";
import {
	formatSshProjectUri,
	isSshProjectUri,
	normalizeProjectCwd,
	normalizeRemotePath,
	parseProjectLocation,
	sameProjectLocation,
} from "./project-uri.js";

describe("项目位置解析", () => {
	it("本地路径原样透传，包括 Windows 盘符", () => {
		expect(parseProjectLocation("/Users/me/app")).toEqual({ kind: "local", path: "/Users/me/app" });
		expect(parseProjectLocation("C:\\work\\app")).toEqual({ kind: "local", path: "C:\\work\\app" });
	});

	it("解析远程 URI 出主机与绝对路径", () => {
		expect(parseProjectLocation("ssh://build-01/srv/app")).toEqual({
			kind: "ssh",
			hostId: "build-01",
			remotePath: "/srv/app",
		});
	});

	it("拒绝缺主机或缺路径的畸形 URI", () => {
		for (const value of ["ssh://", "ssh:///srv/app", "ssh://host", "ssh://ho st/srv"]) {
			expect(() => parseProjectLocation(value)).toThrow();
		}
	});

	it("往返不改变字符串——主键一旦漂移，远程项目会分裂成两条会话历史", () => {
		const uri = "ssh://build-01/srv/项目 a/b";
		const parsed = parseProjectLocation(uri);
		if (parsed.kind !== "ssh") throw new Error("expected ssh");
		expect(formatSshProjectUri(parsed.hostId, parsed.remotePath)).toBe(uri);
	});

	it("非法 hostId 与相对路径无法构造出 URI", () => {
		expect(() => formatSshProjectUri("a/b", "/srv")).toThrow("Invalid SSH host id");
		expect(() => formatSshProjectUri("host", "srv/app")).toThrow("must be absolute");
	});

	it("归一化重复斜杠与结尾斜杠，但保留根", () => {
		expect(normalizeRemotePath("/srv//app/")).toBe("/srv/app");
		expect(normalizeRemotePath("/")).toBe("/");
	});
});

describe("项目身份比较", () => {
	it("本地按 Desktop 既有约定大小写不敏感、分隔符无关", () => {
		expect(sameProjectLocation("C:\\Work\\App", "c:/work/app/")).toBe(true);
	});

	it("远端路径大小写敏感——Linux 上 App 和 app 是两个目录", () => {
		expect(sameProjectLocation("ssh://h/srv/App", "ssh://h/srv/app")).toBe(false);
		expect(sameProjectLocation("ssh://h/srv/app/", "ssh://h/srv/app")).toBe(true);
	});

	it("同路径不同主机不是同一个项目", () => {
		expect(sameProjectLocation("ssh://a/srv/app", "ssh://b/srv/app")).toBe(false);
	});

	it("本地与远程同名路径绝不相等", () => {
		// 本机很可能真的存在 /srv/app。两者若判定相等，远程项目的操作会落到本地仓库上。
		expect(sameProjectLocation("/srv/app", "ssh://h/srv/app")).toBe(false);
	});
});

describe("normalizeProjectCwd", () => {
	const resolveLocal = (value: string): string => `/resolved${value}`;

	it("远程 URI 原样保留，不交给本地路径解析", () => {
		// resolve("ssh://h/srv/app") 会得到 "<进程目录>/ssh:/h/srv/app"——既不是远端路径，
		// 也不再以 ssh:// 开头，下游会把远程会话当成本地会话，工具悄悄换回本地实现。
		expect(normalizeProjectCwd("ssh://build-01/srv/app", resolveLocal)).toBe("ssh://build-01/srv/app");
	});

	it("顺带归一化远端路径，写法不同不会分裂成两个主键", () => {
		expect(normalizeProjectCwd("ssh://build-01/srv//app/", resolveLocal)).toBe("ssh://build-01/srv/app");
	});

	it("本地路径照常交给调用方的解析函数", () => {
		expect(normalizeProjectCwd("/srv/app", resolveLocal)).toBe("/resolved/srv/app");
	});
});

describe("isSshProjectUri", () => {
	it("只认 ssh:// 前缀", () => {
		expect(isSshProjectUri("ssh://h/p")).toBe(true);
		expect(isSshProjectUri("/srv/ssh://x")).toBe(false);
	});
});
