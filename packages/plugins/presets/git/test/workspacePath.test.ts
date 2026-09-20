import { describe, expect, it } from "vitest";
import { rebaseOntoWorkspace } from "../src/git/workspacePath";

describe("rebaseOntoWorkspace", () => {
	it("远程项目里，git 给出的仓库根带回同一台主机的归属", () => {
		// 裸的 /srv/app 会被宿主当成本机路径，后续 git 命令随之落到本机。
		expect(rebaseOntoWorkspace("ssh://host-1/srv/app/packages/web", "/srv/app")).toBe("ssh://host-1/srv/app");
	});

	it("本地项目原样返回", () => {
		expect(rebaseOntoWorkspace("/work/app/packages/web", "/work/app")).toBe("/work/app");
		expect(rebaseOntoWorkspace("C:\\work\\app", "C:/work/app")).toBe("C:/work/app");
	});
});
