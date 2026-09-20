import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SshHelperClient } from "./helper-client.js";
import { createLoopbackSshConnection } from "./testing.js";

const helperSource = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/ssh-helper");
const hasGo = spawnSync("go", ["version"]).status === 0;
let helperBinary = "";

interface TaskStatus {
	readonly id: string;
	readonly state: "live" | "exited" | "unverifiable";
	readonly exitCode?: number;
}

/** 真的把 helper 编出来、经回环 SSH 上传并运行：协议两端一起测，不是对着一份假的应答。 */
describe.skipIf(!hasGo)("远端 helper（真实二进制，经回环 SSH）", () => {
	beforeAll(() => {
		helperBinary = join(mkdtempSync(join(tmpdir(), "vetta-helper-build-")), "vetta-ssh-helper");
		execFileSync("go", ["build", "-o", helperBinary, "./cmd/vetta-ssh-helper"], {
			cwd: helperSource,
			env: { ...process.env, CGO_ENABLED: "0" },
		});
	}, 120_000);

	const connect = (diagnostics: string[] = []) =>
		createLoopbackSshConnection("loopback", {
			helper: { resolveBinary: () => helperBinary, onDiagnostic: (message) => diagnostics.push(message) },
		});

	async function requireHelper(connection: ReturnType<typeof connect>): Promise<SshHelperClient> {
		const helper = await connection.helper();
		if (!helper) throw new Error("helper did not come up");
		return helper;
	}

	it("首次连接时上传并握手，之后不再重复上传", async () => {
		const diagnostics: string[] = [];
		const connection = connect(diagnostics);
		const helper = await requireHelper(connection);

		await expect(helper.call("hello")).resolves.toMatchObject({ protocolVersion: "1.0.0" });
		expect(diagnostics.filter((line) => line.includes("installed helper"))).toHaveLength(1);

		// 同一连接复用同一个客户端；断开后重连也不需要再传一遍。
		expect(await connection.helper()).toBe(helper);
		helper.close();
		await requireHelper(connection);
		expect(diagnostics.filter((line) => line.includes("installed helper"))).toHaveLength(1);
	});

	it("带修订号的写入一次往返完成编辑，且不覆盖别人刚做的修改", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "vetta-helper-fs-")));
		const file = join(dir, "run.sh");
		writeFileSync(file, "echo old\n", { mode: 0o755 });
		const helper = await requireHelper(connect());

		const read = await helper.call<{ data: string; revision: string }>("fs.readFile", { path: file, length: -1 });
		expect(Buffer.from(read.data, "base64").toString()).toBe("echo old\n");

		await helper.call("fs.writeFile", {
			path: file,
			data: Buffer.from("echo new\n").toString("base64"),
			expectedRevision: read.revision,
		});
		expect(readFileSync(file, "utf8")).toBe("echo new\n");
		expect(statSync(file).mode & 0o777).toBe(0o755);

		// 拿着过期的修订号再写：远端文件已经变了，必须拒绝。
		await expect(
			helper.call("fs.writeFile", {
				path: file,
				data: Buffer.from("stale").toString("base64"),
				expectedRevision: read.revision,
			}),
		).rejects.toMatchObject({ code: "ECONFLICT" });
		expect(readFileSync(file, "utf8")).toBe("echo new\n");
	});

	it("订阅的目录有变化时推送通知", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "vetta-helper-watch-")));
		const helper = await requireHelper(connect());
		const changed = vi.fn();
		helper.on("watch.changed", changed);
		await helper.call("watch.subscribe", { path: dir });

		writeFileSync(join(dir, "new.txt"), "x");

		await vi.waitFor(() => expect(changed).toHaveBeenCalledWith({ path: dir }), { timeout: 5000 });
	});

	it("后台任务在连接断开后继续跑，重连后能接管并读回完整输出", async () => {
		const cwd = realpathSync(mkdtempSync(join(tmpdir(), "vetta-helper-task-")));
		const connection = connect();
		const first = await requireHelper(connection);
		const started = await first.call<TaskStatus>("proc.spawn", {
			command: "echo started; sleep 0.5; echo finished; exit 4",
			cwd,
		});
		expect(started.state).toBe("live");
		first.close(); // 合上笔记本。

		const second = await requireHelper(connection);
		expect(second).not.toBe(first);
		const { tasks } = await second.call<{ tasks: TaskStatus[] }>("proc.list");
		expect(tasks.map((task) => task.id)).toContain(started.id);

		let output = "";
		let offset = 0;
		let status: TaskStatus = started;
		do {
			const read = await second.call<{ data: string; nextOffset: number; status: TaskStatus }>("proc.read", {
				id: started.id,
				offset,
				waitMs: 5000,
			});
			output += read.data;
			offset = read.nextOffset;
			status = read.status;
		} while (status.state === "live" || output.length < "started\nfinished\n".length);
		expect(output).toBe("started\nfinished\n");
		expect(status).toMatchObject({ state: "exited", exitCode: 4 });
	});

	it("没有对应平台的构建、或上传的内容跑不起来时，安静地降级而不是抛错", async () => {
		const noBuild: string[] = [];
		const withoutBuild = createLoopbackSshConnection("loopback", {
			helper: { resolveBinary: () => undefined, onDiagnostic: (message) => noBuild.push(message) },
		});
		await expect(withoutBuild.helper()).resolves.toBeUndefined();
		expect(noBuild.join("\n")).toContain("using ssh exec");

		const garbage = join(mkdtempSync(join(tmpdir(), "vetta-helper-bad-")), "vetta-ssh-helper");
		writeFileSync(garbage, "#!/bin/sh\necho not json\n");
		const broken = createLoopbackSshConnection("loopback", {
			helper: { resolveBinary: () => garbage, handshakeTimeoutMs: 1500 },
		});
		await expect(broken.helper()).resolves.toBeUndefined();
		// 降级之后连接本身照常可用。
		await expect(broken.stat("/")).resolves.toMatchObject({ kind: "directory" });
	});

	it("执行器不支持长驻通道时同样降级", async () => {
		const connection = connect();
		expect(existsSync(helperBinary)).toBe(true);
		const runner = (connection as unknown as { options: { runner: { open?: unknown } } }).options.runner;
		runner.open = undefined;
		await expect(connection.helper()).resolves.toBeUndefined();
	});
});
