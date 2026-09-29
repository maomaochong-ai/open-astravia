import { describe, expect, it } from "vitest";
import {
	claimTerminalLaunch,
	isPathWithinCwd,
	parseTerminalLaunch,
	readTerminalLaunchPayload,
	toTerminalLaunchPayload,
} from "./terminal-launch";

describe("isPathWithinCwd", () => {
	it("本地路径：会话目录本身和子目录放行，同前缀的兄弟目录与 .. 拒绝", () => {
		expect(isPathWithinCwd("/repo", "/repo")).toBe(true);
		expect(isPathWithinCwd("/repo/apps/web/", "/repo/")).toBe(true);
		expect(isPathWithinCwd("/repo-other", "/repo")).toBe(false);
		expect(isPathWithinCwd("/repo/../etc", "/repo")).toBe(false);
		expect(isPathWithinCwd("/etc", "/repo")).toBe(false);
	});

	it("Windows 路径不区分大小写和分隔符", () => {
		expect(isPathWithinCwd("c:/Repo/apps", "C:\\repo")).toBe(true);
		expect(isPathWithinCwd("C:\\repo2", "C:\\repo")).toBe(false);
	});

	it("远程路径要求同一台主机，且不能在本地与远程之间混用", () => {
		expect(isPathWithinCwd("ssh://build-01/srv/app/pkg", "ssh://build-01/srv/app")).toBe(true);
		expect(isPathWithinCwd("ssh://other/srv/app/pkg", "ssh://build-01/srv/app")).toBe(false);
		expect(isPathWithinCwd("/srv/app/pkg", "ssh://build-01/srv/app")).toBe(false);
		expect(isPathWithinCwd("ssh://build-01/srv/app", "/srv/app")).toBe(false);
	});
});

describe("parseTerminalLaunch", () => {
	it("规整命令与名字，省略的字段不写键", () => {
		expect(parseTerminalLaunch({ command: "  bun run dev  " }, "/repo")).toEqual({ command: "bun run dev" });
		expect(
			parseTerminalLaunch({ command: "make test", cwd: "/repo/tools", label: " tools: test " }, "/repo"),
		).toEqual({ command: "make test", cwd: "/repo/tools", label: "tools: test" });
	});

	it.each([
		[{ command: "" }, /non-empty/],
		[{ command: "echo a\nrm -rf /" }, /single line/],
		[{ command: "echo \u001b[2J" }, /single line/],
		[{ command: "ls", cwd: "/etc" }, /inside it/],
		[{ command: "ls", label: 1 }, /label/],
		[null, /object/],
	])("拒绝不合规的请求 %#", (input, message) => {
		expect(() => parseTerminalLaunch(input, "/repo")).toThrow(message);
	});

	it("面板没有绑定项目目录时拒绝", () => {
		expect(() => parseTerminalLaunch({ command: "ls" }, null)).toThrow(/not bound/);
	});
});

describe("载荷读回与命令只敲一次", () => {
	it("读回合法载荷；越出会话目录或形状不对的载荷当作没有", () => {
		const payload = toTerminalLaunchPayload({ command: "bun run dev", cwd: "/repo/web" });
		expect(readTerminalLaunchPayload(payload, "/repo")).toEqual(payload);
		expect(readTerminalLaunchPayload(payload, "/other")).toBeNull();
		expect(readTerminalLaunchPayload({ command: "ls" }, "/repo")).toBeNull();
		expect(readTerminalLaunchPayload(undefined, "/repo")).toBeNull();
	});

	it("没敲过就给出输入并标记已敲，敲过之后（重开会话）不再给", () => {
		const fresh = toTerminalLaunchPayload({ command: "bun run build" });
		const claimed = claimTerminalLaunch(fresh);
		expect(claimed).toEqual({ payload: { ...fresh, issued: true }, input: "bun run build\r" });
		expect(claimTerminalLaunch(claimed?.payload ?? null)).toBeNull();
		expect(claimTerminalLaunch(null)).toBeNull();
	});
});
