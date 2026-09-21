import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	buildListListeningPortsCommand,
	buildProcessInfoCommand,
	buildTerminateProcessCommand,
	fromHelperListener,
	isSensitiveListenerPort,
	PROCESS_STILL_ALIVE_EXIT_CODE,
	parseProcessInfo,
	parseRemoteListeners,
	selectForwardablePorts,
} from "./remote-listeners.js";

describe("远端 LISTEN 端口的扫描命令", () => {
	it("Linux 上按 ss → netstat → lsof 退让，并把选中的工具名打在第一行", () => {
		const command = buildListListeningPortsCommand("gnu");
		expect(command).toContain("if command -v ss");
		expect(command).toContain("elif command -v netstat");
		expect(command).toContain("elif command -v lsof");
		expect(command.indexOf("ss -ltnp")).toBeLessThan(command.indexOf("netstat -ltnp"));
		expect(command).toContain("@vetta-listeners ss");
		expect(command).toContain("@vetta-listeners none");
	});

	it("macOS 只用 lsof：那里的 netstat 是第四种格式，不进降级链", () => {
		const command = buildListListeningPortsCommand("bsd");
		expect(command).toContain("lsof -nP -iTCP -sTCP:LISTEN");
		expect(command).not.toContain("netstat");
	});
});

describe("解析三种工具的输出", () => {
	it("读 ss 的输出，带上进程名与 pid", () => {
		const output = [
			"@vetta-listeners ss",
			"State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process",
			'LISTEN 0      511          0.0.0.0:3000       0.0.0.0:*     users:(("node",pid=1234,fd=23))',
			'LISTEN 0      4096            [::]:22            [::]:*     users:(("sshd",pid=800,fd=4))',
			'ESTAB  0      0        127.0.0.1:5432    127.0.0.1:41234   users:(("postgres",pid=9,fd=1))',
		].join("\n");

		const scan = parseRemoteListeners(output);

		expect(scan.tool).toBe("ss");
		expect(scan.ports).toEqual([
			{ port: 3000, address: "0.0.0.0", processName: "node", pid: 1234 },
			{ port: 22, address: "::", processName: "sshd", pid: 800 },
		]);
	});

	it("busybox 的 ss 没有进程那一列，端口照样读得出来", () => {
		const output = [
			"@vetta-listeners ss",
			"State      Recv-Q Send-Q  Local Address:Port    Peer Address:Port",
			"LISTEN     0      0             0.0.0.0:5173          0.0.0.0:*",
			"LISTEN     0      0                   *:8080                *:*",
		].join("\n");

		const scan = parseRemoteListeners(output);

		expect(scan.ports).toEqual([
			{ port: 5173, address: "0.0.0.0", processName: undefined, pid: undefined },
			{ port: 8080, address: "*", processName: undefined, pid: undefined },
		]);
	});

	it("读 netstat 的输出，IPv6 的 `:::22` 与无权限时的 `-` 都不出错", () => {
		const output = [
			"@vetta-listeners netstat",
			"Active Internet connections (only servers)",
			"Proto Recv-Q Send-Q Local Address    Foreign Address  State    PID/Program name",
			"tcp        0      0 127.0.0.1:3000   0.0.0.0:*        LISTEN   1234/node",
			"tcp6       0      0 :::22            :::*             LISTEN   -",
			"udp        0      0 0.0.0.0:68       0.0.0.0:*                 700/dhclient",
		].join("\n");

		const scan = parseRemoteListeners(output);

		expect(scan.tool).toBe("netstat");
		expect(scan.ports).toEqual([
			{ port: 3000, address: "127.0.0.1", processName: "node", pid: 1234 },
			{ port: 22, address: "::", processName: undefined, pid: undefined },
		]);
	});

	it("读 lsof 的输出", () => {
		const output = [
			"@vetta-listeners lsof",
			"COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
			"node    1234   me   23u  IPv4 0x9a1b2c3d4e5f6071      0t0  TCP 127.0.0.1:3000 (LISTEN)",
			"rapportd 456   me    4u  IPv6 0x9a1b2c3d4e5f6072      0t0  TCP *:49152 (LISTEN)",
			"node    1234   me   25u  IPv4 0x9a1b2c3d4e5f6073      0t0  TCP 127.0.0.1:55001->127.0.0.1:3000 (ESTABLISHED)",
		].join("\n");

		const scan = parseRemoteListeners(output);

		expect(scan.tool).toBe("lsof");
		expect(scan.ports).toEqual([
			{ port: 3000, address: "127.0.0.1", processName: "node", pid: 1234 },
			{ port: 49152, address: "*", processName: "rapportd", pid: 456 },
		]);
	});

	it("远端一个工具都没有时如实报告 none，不伪装成「扫到 0 个端口」", () => {
		expect(parseRemoteListeners("@vetta-listeners none\n")).toEqual({ tool: "none", ports: [] });
		expect(parseRemoteListeners("")).toEqual({ tool: "none", ports: [] });
	});
});

describe("整理成可以摆给用户的候选清单", () => {
	it("滤掉转不过去的地址、按端口去重、排除指定端口", () => {
		const ports = selectForwardablePorts(
			[
				{ port: 3000, address: "10.0.0.5" },
				{ port: 5173, address: "0.0.0.0" },
				{ port: 5173, address: "::", processName: "vite" },
				{ port: 22, address: "0.0.0.0", processName: "sshd" },
				{ port: 8080, address: "127.0.0.1", processName: "api" },
				{ port: 4000, address: "::1", processName: "docs" },
			],
			{ excludePorts: [22] },
		);

		expect(ports).toEqual([
			{ port: 4000, address: "::1", processName: "docs" },
			{ port: 5173, address: "::", processName: "vite" },
			{ port: 8080, address: "127.0.0.1", processName: "api" },
		]);
	});
});

describe("helper 的线上格式", () => {
	it("进程名在 helper 那边叫 process，要换成 processName", () => {
		expect(fromHelperListener({ port: 3000, address: "127.0.0.1", process: "node", pid: 42 })).toMatchObject({
			port: 3000,
			address: "127.0.0.1",
			processName: "node",
			pid: 42,
		});
	});

	it("别人的进程读不到 pid 与进程名时两项都留空", () => {
		expect(fromHelperListener({ port: 22, address: "0.0.0.0" })).toEqual({
			port: 22,
			address: "0.0.0.0",
			processName: undefined,
			pid: undefined,
			command: undefined,
			startedAt: undefined,
		});
	});

	it("带上 helper 从 /proc 读出的命令行与启动时间", () => {
		expect(
			fromHelperListener({
				port: 5173,
				address: "::",
				process: "node",
				pid: 7,
				command: "node vite --port 5173",
				startedAt: 1_700_000_000_000,
			}),
		).toMatchObject({ command: "node vite --port 5173", startedAt: 1_700_000_000_000 });
	});
});

describe("系统端口", () => {
	it("特权端口与这条连接自己的 ssh 端口算敏感，用户起的服务不算", () => {
		expect(isSensitiveListenerPort(22)).toBe(true);
		expect(isSensitiveListenerPort(80)).toBe(true);
		expect(isSensitiveListenerPort(2222, 2222)).toBe(true);
		expect(isSensitiveListenerPort(3000, 2222)).toBe(false);
		expect(isSensitiveListenerPort(1024)).toBe(false);
	});
});

describe("进程信息", () => {
	it("把 ps 的已运行时长换成启动时间，命令行保留空格", () => {
		const now = 1_700_000_000_000;
		const output = [
			"  1234       05:07 node /srv/app/node_modules/.bin/vite --port 5173",
			"   800 3-02:00:01 /usr/sbin/sshd -D",
			"  9001    01:02:03 python -m http.server 8000",
			"garbage line",
		].join("\n");

		const info = parseProcessInfo(output, now);

		expect(info.get(1234)).toEqual({
			command: "node /srv/app/node_modules/.bin/vite --port 5173",
			startedAt: now - (5 * 60 + 7) * 1000,
		});
		expect(info.get(800)?.startedAt).toBe(now - ((3 * 24 + 2) * 3600 + 1) * 1000);
		expect(info.get(9001)?.startedAt).toBe(now - 3723 * 1000);
		expect(info.size).toBe(3);
	});

	it("命令在本机的 ps 上跑得通", () => {
		const result = spawnSync("/bin/sh", ["-c", buildProcessInfoCommand([process.pid])], { encoding: "utf8" });
		const info = parseProcessInfo(result.stdout, Date.now());
		expect(info.get(process.pid)?.command).toBeTruthy();
		expect(info.get(process.pid)?.startedAt).toBeLessThanOrEqual(Date.now());
	});
});

describe("终止进程", () => {
	it("拒绝对 0、1 与负数发信号——那是进程组与 init", () => {
		expect(() => buildTerminateProcessCommand(0, false)).toThrow();
		expect(() => buildTerminateProcessCommand(1, false)).toThrow();
		expect(() => buildTerminateProcessCommand(-5, true)).toThrow();
	});

	it("发完 SIGTERM 等到进程真的退出才返回 0", () => {
		const child = spawn("sleep", ["30"], { stdio: "ignore" });
		const pid = child.pid ?? 0;
		const result = spawnSync("/bin/sh", ["-c", buildTerminateProcessCommand(pid, false)], { encoding: "utf8" });
		expect(result.status).toBe(0);
		expect(child.signalCode ?? "SIGTERM").toBe("SIGTERM");
	});

	it("不理 SIGTERM 的进程报「还活着」，SIGKILL 才收得掉", () => {
		const child = spawn("/bin/sh", ["-c", "trap '' TERM; while :; do sleep 0.05; done"], { stdio: "ignore" });
		const pid = child.pid ?? 0;
		try {
			const term = spawnSync("/bin/sh", ["-c", buildTerminateProcessCommand(pid, false)], { encoding: "utf8" });
			expect(term.status).toBe(PROCESS_STILL_ALIVE_EXIT_CODE);
			const kill = spawnSync("/bin/sh", ["-c", buildTerminateProcessCommand(pid, true)], { encoding: "utf8" });
			expect(kill.status).toBe(0);
		} finally {
			child.kill("SIGKILL");
		}
	});

	it("进程不存在时 kill 自己报错，退出码非零且不是「还活着」", () => {
		const result = spawnSync("/bin/sh", ["-c", buildTerminateProcessCommand(999_999, false)], { encoding: "utf8" });
		expect(result.status).not.toBe(0);
		expect(result.status).not.toBe(PROCESS_STILL_ALIVE_EXIT_CODE);
	});
});
