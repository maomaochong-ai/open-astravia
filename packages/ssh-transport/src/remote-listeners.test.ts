import { describe, expect, it } from "vitest";
import { buildListListeningPortsCommand, parseRemoteListeners, selectForwardablePorts } from "./remote-listeners.js";

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
