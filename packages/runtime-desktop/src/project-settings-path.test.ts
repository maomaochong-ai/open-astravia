import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectSettingsPath } from "./project-settings-path.js";

describe("项目级设置的落点", () => {
	it("本地项目仍在项目自己的 .astravia 下", () => {
		expect(resolveProjectSettingsPath("/work/app", "/home/me/.astravia/agent")).toBe(
			join("/work/app", ".astravia", "settings.json"),
		);
	});

	it("远程项目落在本机 agent 目录里，不会在进程 cwd 下拼出一棵 ssh: 目录", () => {
		const path = resolveProjectSettingsPath("ssh://h1/srv/app", "/home/me/.astravia/agent");
		expect(isAbsolute(path)).toBe(true);
		expect(path.startsWith(join("/home/me/.astravia/agent", "remote-projects"))).toBe(true);
		expect(path).not.toContain("ssh:");
	});

	it("同一个远程项目写法不同也落到同一份，不同项目互不相干", () => {
		const agentDir = "/home/me/.astravia/agent";
		expect(resolveProjectSettingsPath("ssh://h1/srv/app/", agentDir)).toBe(
			resolveProjectSettingsPath("ssh://h1/srv//app", agentDir),
		);
		expect(resolveProjectSettingsPath("ssh://h1/srv/app", agentDir)).not.toBe(
			resolveProjectSettingsPath("ssh://h2/srv/app", agentDir),
		);
	});
});
