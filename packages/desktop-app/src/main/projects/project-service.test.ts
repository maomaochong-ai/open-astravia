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
	const service = new ProjectService({
		allowProjectRoot,
		createDirectory,
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
