import { describe, expect, it, vi } from "vitest";
import { SshOperationAbortedError, SshRemoteCommandError, SshTransportError } from "./errors.js";
import type { SshProcessInvocation, SshProcessResult, SshProcessRunner } from "./process-runner.js";
import { buildRemoteCommand } from "./remote-command.js";
import { SshConnection } from "./ssh-connection.js";
import type { SshHost } from "./ssh-host.js";

const host: SshHost = { id: "build-01", label: "构建机", target: "build", source: "manual" };

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function ok(stdout: string): SshProcessResult {
	return { exitCode: 0, stdout: encode(stdout), stderr: "", aborted: false };
}

/** 按远端命令内容依次应答，并记录每次调用，便于断言真正发出去的是什么。 */
function createRunner(reply: (remoteCommand: string) => SshProcessResult): {
	runner: SshProcessRunner;
	calls: SshProcessInvocation[];
} {
	const calls: SshProcessInvocation[] = [];
	const runner: SshProcessRunner = {
		run: async (invocation) => {
			calls.push(invocation);
			return reply(String(invocation.argv[invocation.argv.length - 1]));
		},
	};
	return { runner, calls };
}

function connect(reply: (remoteCommand: string) => SshProcessResult) {
	const { runner, calls } = createRunner(reply);
	return { connection: new SshConnection(host, { runner, controlPath: "/tmp/cp" }), calls };
}

describe("远端平台探测", () => {
	it("Linux 用 GNU stat，macOS 用 BSD stat", async () => {
		const linux = connect(() => ok("Linux\nx86_64\n"));
		await expect(linux.connection.probePlatform()).resolves.toMatchObject({
			os: "Linux",
			arch: "x86_64",
			statFlavor: "gnu",
		});

		const mac = connect(() => ok("Darwin\narm64\n"));
		await expect(mac.connection.probePlatform()).resolves.toMatchObject({ statFlavor: "bsd" });
	});

	it("结果缓存，不会每次操作都多一次往返", async () => {
		const { connection, calls } = connect(() => ok("Linux\nx86_64\n"));
		await connection.probePlatform();
		await connection.probePlatform();
		expect(calls).toHaveLength(1);
	});
});

describe("远端文件读写", () => {
	it("读文件走原始字节，不经登录 shell——profile 的输出会混进文件内容", async () => {
		const { connection, calls } = connect(() => ok("file body"));
		await expect(connection.readFile("/srv/a.txt")).resolves.toEqual(encode("file body"));
		const remoteCommand = String(calls[0].argv[calls[0].argv.length - 1]);
		expect(remoteCommand).toBe("cat -- '/srv/a.txt'");
		expect(remoteCommand).not.toContain("SHELL");
	});

	it("写文件先写同目录临时文件再 mv，内容走 stdin 而不是命令行", async () => {
		const { connection, calls } = connect(() => ok(""));
		await connection.writeFile("/srv/a.txt", encode("hello"));
		const remoteCommand = String(calls[0].argv[calls[0].argv.length - 1]);
		expect(remoteCommand).toMatch(/^cat > '\/srv\/a\.txt\.vetta-tmp-[a-z0-9]+' && mv -f -- /);
		expect(remoteCommand).toContain(`'/srv/a.txt'`);
		expect(calls[0].stdin).toEqual(encode("hello"));
	});

	it("读一个不存在的文件，报的是远端命令失败而不是传输故障", async () => {
		const { connection } = connect(() => ({
			exitCode: 1,
			stdout: new Uint8Array(),
			stderr: "cat: /srv/x: No such file or directory",
			aborted: false,
		}));
		await expect(connection.readFile("/srv/x")).rejects.toBeInstanceOf(SshRemoteCommandError);
	});
});

describe("目录列举", () => {
	it("解析出类型、大小与修改时间，并去掉 find 的 ./ 前缀", async () => {
		const { connection } = connect((remoteCommand) =>
			remoteCommand.includes("uname")
				? ok("Linux\nx86_64\n")
				: ok("directory\t4096\t1700000000\t./src\nregular file\t12\t1700000001\t./a b.txt\n"),
		);
		await expect(connection.listDirectory("/srv")).resolves.toEqual([
			{ name: "src", kind: "directory", sizeBytes: 4096, modifiedAtSeconds: 1700000000 },
			{ name: "a b.txt", kind: "file", sizeBytes: 12, modifiedAtSeconds: 1700000001 },
		]);
	});

	it("路径不存在时 stat 返回 null——这是远端给出的答复", async () => {
		const { connection } = connect((remoteCommand) =>
			remoteCommand.includes("uname") ? ok("Linux\nx86_64\n") : ok(""),
		);
		await expect(connection.stat("/srv/missing")).resolves.toBeNull();
	});
});

describe("失败分类（ADR-0124 执行边界）", () => {
	it("ssh 退出 255 判为传输故障，判定是 unverifiable 而不是 exited", async () => {
		const { connection } = connect(() => ({
			exitCode: 255,
			stdout: new Uint8Array(),
			stderr: "ssh: connect to host build port 22: Connection refused",
			aborted: false,
		}));
		const error = await connection.readFile("/srv/a").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SshTransportError);
		expect((error as SshTransportError).verdict).toBe("unverifiable");
	});

	it("取消同样是 unverifiable：远端可能已经执行完了", async () => {
		const { connection } = connect(() => ({
			exitCode: null,
			stdout: new Uint8Array(),
			stderr: "",
			aborted: true,
		}));
		const error = await connection.exec("make").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SshOperationAbortedError);
		expect((error as SshOperationAbortedError).verdict).toBe("unverifiable");
	});

	it("命令返回非零是 exited——远端确实回答了", async () => {
		const { connection } = connect(() => ({
			exitCode: 2,
			stdout: new Uint8Array(),
			stderr: "boom",
			aborted: false,
		}));
		const error = await connection.makeDirectory("/srv/x").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SshRemoteCommandError);
		expect((error as SshRemoteCommandError).verdict).toBe("exited");
		expect((error as SshRemoteCommandError).exitCode).toBe(2);
	});
});

describe("用户命令执行", () => {
	it("先建立连接再跑命令：认证不能受调用方那条短超时的约束", async () => {
		// 口令、2FA 和指纹确认只发生在第一条命令上。若它跟着「这条命令该跑多久」的
		// 超时走，用户还在输密码时 ssh 就被杀了，表现为输完密码却提示连接失败。
		const { connection, calls } = connect((remoteCommand) =>
			remoteCommand.includes("uname") ? ok("Linux\nx86_64\n") : ok(""),
		);

		await connection.exec("npm test", { timeoutMs: 1_000 });

		expect(String(calls[0].argv[calls[0].argv.length - 1])).toContain("uname");
		expect(calls[0].timeoutMs).toBeGreaterThan(60_000);
	});

	it("带工作目录与流式输出，退出码原样返回而不抛", async () => {
		const onStdout = vi.fn();
		const { connection, calls } = connect((remoteCommand) =>
			// 第一条命令是建立连接的平台探测；用户命令才是被测的那一条。
			remoteCommand.includes("uname")
				? ok("Linux\nx86_64\n")
				: { exitCode: 1, stdout: encode("test failed"), stderr: "", aborted: false },
		);
		await expect(connection.exec("npm test", { cwd: "/srv/app", onStdout })).resolves.toMatchObject({
			exitCode: 1,
		});
		// 引用语义由 remote-command 的测试守住，这里只证明 cwd 确实被透传下去。
		const userCommand = calls.map((call) => String(call.argv[call.argv.length - 1])).at(-1);
		expect(userCommand).toBe(buildRemoteCommand("npm test", { cwd: "/srv/app" }));
	});
});
