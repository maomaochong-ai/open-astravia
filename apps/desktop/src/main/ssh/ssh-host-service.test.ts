import { describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { SshHostAlreadyExistsError, SshHostInUseError, SshHostService } from "./ssh-host-service.js";

function createFixture(initial?: Partial<DesktopConfig>) {
	let config: DesktopConfig = {
		projects: [],
		archivedProjects: [],
		workspacePath: "/workspace",
		defaultExecutionMode: "full-access",
		...initial,
	};
	const broadcastChanged = vi.fn();
	const invalidateConnection = vi.fn();
	let nextId = 0;
	const service = new SshHostService({
		readConfig: async () => structuredClone(config),
		writeConfig: async (next) => {
			config = structuredClone(next);
		},
		broadcastChanged,
		invalidateConnection,
		countProjectsOnHost: async (hostId) =>
			[...config.projects, ...config.archivedProjects].filter((entry) => entry.path.startsWith(`ssh://${hostId}/`))
				.length,
		generateId: () => `host-${++nextId}`,
	});
	return { broadcastChanged, invalidateConnection, getConfig: () => config, service };
}

describe("SshHostService", () => {
	it("创建主机并生成稳定 id，凭据不落配置", async () => {
		const fixture = createFixture();

		const host = await fixture.service.create({ label: "构建机", target: "build-01" });

		expect(host).toEqual({ id: "host-1", label: "构建机", target: "build-01", source: "manual" });
		expect(fixture.getConfig().sshHosts).toEqual([host]);
		expect(fixture.broadcastChanged).toHaveBeenCalledTimes(1);
	});

	it("同一个连接目标不能登记两次", async () => {
		// 否则「这个项目在哪台机器上」会出现两个都说得通的答案。
		const fixture = createFixture();
		await fixture.service.create({ label: "A", target: "build-01" });

		await expect(fixture.service.create({ label: "B", target: "build-01" })).rejects.toBeInstanceOf(
			SshHostAlreadyExistsError,
		);
		expect(fixture.getConfig().sshHosts).toHaveLength(1);
	});

	it("拒绝会被 OpenSSH 当成选项解析的目标", async () => {
		const fixture = createFixture();

		await expect(fixture.service.create({ label: "x", target: "-oProxyCommand=id" })).rejects.toThrow(
			"must not start with '-'",
		);
	});

	it("改完主机要作废缓存连接，否则改了端口仍连着旧机器", async () => {
		const fixture = createFixture();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });

		await fixture.service.update(host.id, { label: "构建机", target: "build-01", port: 2222 });

		expect(fixture.getConfig().sshHosts?.[0]).toMatchObject({ port: 2222 });
		expect(fixture.invalidateConnection).toHaveBeenCalledWith(host.id);
	});

	it("仍被项目引用的主机不能删除", async () => {
		// 删掉的话那些项目会变成永远打不开的悬空条目，而用户在删主机时看不到这一点。
		const fixture = createFixture();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });
		fixture.getConfig().projects.push({ path: `ssh://${host.id}/srv/app`, name: "app" });

		const error = await fixture.service.remove(host.id).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SshHostInUseError);
		expect((error as SshHostInUseError).projectCount).toBe(1);
		expect(fixture.getConfig().sshHosts).toHaveLength(1);
	});

	it("没有项目引用时正常删除并作废连接", async () => {
		const fixture = createFixture();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });

		await fixture.service.remove(host.id);

		expect(fixture.getConfig().sshHosts).toEqual([]);
		expect(fixture.invalidateConnection).toHaveBeenCalledWith(host.id);
	});
});

describe("从 ssh config 导入", () => {
	it("只新增，不覆盖用户手工调过的同名条目", async () => {
		const fixture = createFixture();
		await fixture.service.create({ label: "我改过的", target: "build-01", port: 2222 });

		const added = await fixture.service.importFromSshConfig(["build-01", "lab"]);

		expect(added.map((host) => host.target)).toEqual(["lab"]);
		expect(fixture.getConfig().sshHosts?.[0]).toMatchObject({ label: "我改过的", port: 2222 });
	});

	it("导入的条目标记来源，便于后续区分是否可被再次导入刷新", async () => {
		const fixture = createFixture();

		const [host] = await fixture.service.importFromSshConfig(["lab"]);

		expect(host).toMatchObject({ target: "lab", label: "lab", source: "ssh-config" });
	});

	it("没有新增时不落盘也不广播", async () => {
		const fixture = createFixture();
		await fixture.service.importFromSshConfig(["lab"]);
		fixture.broadcastChanged.mockClear();

		await fixture.service.importFromSshConfig(["lab"]);

		expect(fixture.broadcastChanged).not.toHaveBeenCalled();
	});
});
