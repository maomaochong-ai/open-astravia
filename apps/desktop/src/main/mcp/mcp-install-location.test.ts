import { describe, expect, it } from "vitest";
import { projectMcpConfigPath, resolveMcpInstallLocation } from "./mcp-install-location";

const base = { configDirName: ".astravia" } as const;

describe("MCP 安装位置解析", () => {
	it("缺省是全局，保持既有调用行为", () => {
		expect(resolveMcpInstallLocation(base)).toEqual({ ok: true, scope: "global" });
	});

	it("项目层要带绝对路径，相对路径直接拒", () => {
		expect(resolveMcpInstallLocation({ ...base, scope: "project", cwd: "relative/dir" })).toMatchObject({
			ok: false,
		});
		expect(resolveMcpInstallLocation({ ...base, scope: "project", cwd: "/Users/me/project" })).toEqual({
			ok: true,
			scope: "project",
			projectDir: "/Users/me/project",
		});
	});

	it("项目层不带 cwd 时报错，而不是悄悄写全局", () => {
		expect(resolveMcpInstallLocation({ ...base, scope: "project" })).toMatchObject({ ok: false });
	});

	it("远程项目不能装项目层：配置文件不在这台机器上", () => {
		const result = resolveMcpInstallLocation({
			...base,
			scope: "project",
			cwd: "ssh://host/srv/app",
			isRemoteProject: true,
		});
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.error).toContain("远程项目");
	});

	it("配置文件落在项目自己的配置目录里", () => {
		expect(projectMcpConfigPath("/Users/me/project/", ".astravia")).toBe("/Users/me/project/.astravia/mcp.json");
	});
});
