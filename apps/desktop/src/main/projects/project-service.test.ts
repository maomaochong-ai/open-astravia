import { describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { ProjectService } from "./project-service.js";

function createFixture(initial?: Partial<DesktopConfig>) {
	let config: DesktopConfig = {
		projects: [],
		archivedProjects: [],
		workspacePath: "C:\\workspace",
		defaultExecutionMode: "full-access",
		...initial,
	};
	const createDirectory = vi.fn(async () => {});
	const allowProjectRoot = vi.fn();
	const broadcastChanged = vi.fn();
	const nonDirectoryPaths = new Set<string>();
	const knownSshHosts = new Set<string>(["build-01"]);
	const service = new ProjectService({
		allowProjectRoot,
		createDirectory,
		isKnownSshHost: async (hostId) => knownSshHosts.has(hostId),
		readConfig: async () => structuredClone(config),
		writeConfig: async (next) => {
			config = structuredClone(next);
		},
		broadcastChanged,
		isExistingNonDirectory: async (path) => nonDirectoryPaths.has(path),
	});
	return {
		allowProjectRoot,
		broadcastChanged,
		knownSshHosts,
		nonDirectoryPaths,
		createDirectory,
		getConfig: () => config,
		service,
	};
}

describe("ProjectService", () => {
	it("creates a project under the configured workspace and registers its root", async () => {
		const fixture = createFixture();

		await expect(fixture.service.create("demo")).resolves.toEqual({
			path: "C:\\workspace\\demo",
			name: "demo",
		});
		expect(fixture.createDirectory).toHaveBeenCalledWith("C:\\workspace\\demo");
		expect(fixture.allowProjectRoot).toHaveBeenCalledWith("C:\\workspace\\demo");
		expect(fixture.getConfig().projects).toEqual([{ path: "C:\\workspace\\demo", name: "demo" }]);
	});

	it("rejects invalid project names before creating a directory", async () => {
		const fixture = createFixture();

		await expect(fixture.service.create("../escape")).rejects.toThrow("Invalid project name.");
		expect(fixture.createDirectory).not.toHaveBeenCalled();
	});

	it("moves projects between active and archived lists without changing disk data", async () => {
		const fixture = createFixture({
			projects: [{ path: "C:\\workspace\\demo", name: "demo" }],
		});

		await fixture.service.archive("C:\\workspace\\demo");
		expect(fixture.getConfig().projects).toEqual([]);
		expect(fixture.getConfig().archivedProjects).toEqual([{ path: "C:\\workspace\\demo", name: "demo" }]);

		await fixture.service.unarchive("C:\\workspace\\demo");
		expect(fixture.getConfig().projects).toEqual([{ path: "C:\\workspace\\demo", name: "demo" }]);
		expect(fixture.getConfig().archivedProjects).toEqual([]);
	});

	it("broadcasts once per landed write so out-of-renderer changes reach the sidebar", async () => {
		const fixture = createFixture();

		await fixture.service.create("demo");
		expect(fixture.broadcastChanged).toHaveBeenCalledTimes(1);

		// 重复 create 命中「已存在就不写」的分支：没落盘就不该广播，否则侧边栏白刷。
		await fixture.service.create("demo");
		expect(fixture.broadcastChanged).toHaveBeenCalledTimes(1);

		await fixture.service.archive("C:\\workspace\\demo");
		expect(fixture.broadcastChanged).toHaveBeenCalledTimes(2);
	});

	it("does not broadcast when the write is rejected", async () => {
		const fixture = createFixture();

		await expect(fixture.service.remove("C:\\workspace\\missing")).rejects.toThrow("Project not found");
		expect(fixture.broadcastChanged).not.toHaveBeenCalled();
	});

	it("refuses to register a file as a project", async () => {
		// 现场原型：v1 时代的 `x.vetd` 是个**文件**，被登记成项目后每轮扫描都 ENOTDIR。
		const fixture = createFixture();
		fixture.nonDirectoryPaths.add("C:\\workspace\\design.vetd");

		await expect(fixture.service.open("C:\\workspace\\design.vetd")).rejects.toThrow(
			"Project path must be a directory.",
		);
		expect(fixture.getConfig().projects).toEqual([]);
		expect(fixture.broadcastChanged).not.toHaveBeenCalled();
	});

	it("still registers a path that does not exist yet", async () => {
		const fixture = createFixture();

		await expect(fixture.service.open("C:\\workspace\\later")).resolves.toEqual({
			path: "C:\\workspace\\later",
			name: "later",
		});
	});

	it("removes a project from the sidebar without deleting its directory", async () => {
		const fixture = createFixture({
			archivedProjects: [{ path: "C:\\workspace\\demo", name: "demo" }],
		});

		await fixture.service.remove("C:\\workspace\\demo");

		expect(fixture.getConfig().archivedProjects).toEqual([]);
		expect(fixture.createDirectory).not.toHaveBeenCalled();
	});
});

describe("ProjectService 与远程项目", () => {
	it("登记远端目录，显示名取远端路径的最后一段", async () => {
		const fixture = createFixture();

		await expect(fixture.service.open("ssh://build-01/srv/app")).resolves.toEqual({
			path: "ssh://build-01/srv/app",
			name: "app",
		});
		expect(fixture.getConfig().projects).toEqual([{ path: "ssh://build-01/srv/app", name: "app" }]);
	});

	it("远端项目同样登记授权根，由文件服务决定进哪一套", async () => {
		// 不登记的话文件树展开远端目录会被判成「不在任何已知项目内」。
		const fixture = createFixture();

		await fixture.service.open("ssh://build-01/srv/app");

		expect(fixture.allowProjectRoot).toHaveBeenCalledWith("ssh://build-01/srv/app");
	});

	it("主机不存在时拒绝登记，而不是留下一条永远打不开的条目", async () => {
		const fixture = createFixture();

		await expect(fixture.service.open("ssh://ghost/srv/app")).rejects.toThrow("Unknown SSH host: ghost");
		expect(fixture.getConfig().projects).toEqual([]);
		expect(fixture.broadcastChanged).not.toHaveBeenCalled();
	});

	it("畸形的 ssh:// 串被拒绝，不会当成本地相对路径落到本机目录上", async () => {
		const fixture = createFixture();

		await expect(fixture.service.open("ssh://build-01")).rejects.toThrow("Invalid project path");
	});

	it("远端的文件不能登记成项目", async () => {
		const fixture = createFixture();
		fixture.nonDirectoryPaths.add("ssh://build-01/srv/notes.txt");

		await expect(fixture.service.open("ssh://build-01/srv/notes.txt")).rejects.toThrow(
			"Project path must be a directory.",
		);
	});

	it("新建项目只发生在本地工作区，远端目录必须走 open", async () => {
		const fixture = createFixture();

		await expect(fixture.service.create("demo", "ssh://build-01/srv/demo")).rejects.toThrow(
			"Remote projects must be registered with open()",
		);
		expect(fixture.createDirectory).not.toHaveBeenCalled();
	});

	it("同路径的本地项目与远端项目互不干扰", async () => {
		// 本机很可能真的存在 /srv/app；若两者被判为同一个项目，归档远端项目会连本地
		// 一起摘掉，会话历史也会串到一起。
		const fixture = createFixture();

		await fixture.service.open("/srv/app");
		await fixture.service.open("ssh://build-01/srv/app");
		expect(fixture.getConfig().projects).toHaveLength(2);

		await fixture.service.archive("ssh://build-01/srv/app");
		expect(fixture.getConfig().projects).toEqual([{ path: "/srv/app", name: "app" }]);
		expect(fixture.getConfig().archivedProjects).toEqual([{ path: "ssh://build-01/srv/app", name: "app" }]);
	});

	it("远端路径大小写敏感——Linux 上 App 与 app 是两个目录", async () => {
		const fixture = createFixture();

		await fixture.service.open("ssh://build-01/srv/App");
		await fixture.service.open("ssh://build-01/srv/app");

		expect(fixture.getConfig().projects).toHaveLength(2);
	});
});
