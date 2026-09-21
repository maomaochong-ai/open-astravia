import { describe, expect, it } from "vitest";
import type { SshChannelInvocation, SshProcessChannel, SshProcessResult, SshProcessRunner } from "./process-runner.js";
import { buildTtyShellCommand } from "./remote-pty.js";
import { SshConnection } from "./ssh-connection.js";
import type { SshHost } from "./ssh-host.js";

const host: SshHost = { id: "build-01", label: "构建机", target: "build", source: "manual" };

function ok(stdout = ""): SshProcessResult {
	return { exitCode: 0, stdout: new TextEncoder().encode(stdout), stderr: "", aborted: false };
}

/** 记录打开的通道，便于断言真正发出去的 argv 与远端命令。 */
function createChannelRunner(): { runner: SshProcessRunner; channels: SshChannelInvocation[] } {
	const channels: SshChannelInvocation[] = [];
	const runner: SshProcessRunner = {
		run: async () => ok(),
		open: (invocation) => {
			channels.push(invocation);
			const channel: SshProcessChannel = {
				write: () => {},
				end: () => {},
				kill: () => {},
				exited: Promise.resolve({ exitCode: 0, stderr: "" }),
			};
			return channel;
		},
	};
	return { runner, channels };
}

describe("buildTtyShellCommand", () => {
	it("先切目录、设一次尺寸，再 exec 登录 shell", () => {
		const command = buildTtyShellCommand({ cwd: "/srv/app", cols: 100, rows: 30 });

		expect(command).toContain("cd '/srv/app'");
		expect(command).toContain("stty rows 30 cols 100");
		// exec 换掉外层 sh，SIGHUP 才能直达用户 shell。
		// biome-ignore lint/suspicious/noTemplateCurlyInString: 断言的就是交给远端 shell 展开的写法。
		expect(command).toContain('exec "${SHELL:-/bin/sh}" -l');
	});

	it("目录里的引号与空格被正确转义，不构成注入面", () => {
		const command = buildTtyShellCommand({ cwd: "/srv/it's here", cols: 80, rows: 24 });

		expect(command.startsWith("cd '/srv/it'\\''s here'")).toBe(true);
	});

	it("指定 shell 时用它，并透传环境变量", () => {
		const command = buildTtyShellCommand({
			cwd: "/srv/app",
			cols: 80,
			rows: 24,
			shell: "/bin/zsh",
			env: { LANG: "zh_CN.UTF-8" },
		});

		expect(command).toContain("export LANG='zh_CN.UTF-8';");
		expect(command).toContain("exec '/bin/zsh' -l");
	});

	it("尺寸取整，不把小数写进 stty", () => {
		const command = buildTtyShellCommand({ cwd: "/srv/app", cols: 99.7, rows: 24.2 });

		expect(command).toContain("stty rows 24 cols 99");
	});
});

describe("openPty 降级到 ssh -tt", () => {
	it("没有 helper 时走双向通道，并请求分配 tty", async () => {
		const { runner, channels } = createChannelRunner();
		const connection = new SshConnection(host, { runner, controlPath: "/tmp/cp" });

		const session = await connection.openPty({ cwd: "/srv/app", cols: 90, rows: 25 });

		expect(session.backend).toBe("tty");
		// 这条路送不进尺寸变化，必须如实上报，否则界面会假装能自适应。
		expect(session.canResize).toBe(false);
		expect(channels).toHaveLength(1);
		expect(channels[0]?.argv).toContain("-tt");
		expect(String(channels[0]?.argv.at(-1))).toContain("exec");
	});

	it("降级路径上 resize 是 no-op，不往用户正在敲的那行里注入 stty", async () => {
		const { runner, channels } = createChannelRunner();
		const connection = new SshConnection(host, { runner, controlPath: "/tmp/cp" });
		const session = await connection.openPty({ cwd: "/srv/app", cols: 90, rows: 25 });

		session.resize(120, 40);

		expect(channels).toHaveLength(1);
	});

	it("runner 不支持双向通道时明确报错，而不是静默什么都不做", async () => {
		const runner: SshProcessRunner = { run: async () => ok() };
		const connection = new SshConnection(host, { runner, controlPath: "/tmp/cp" });

		await expect(connection.openPty({ cwd: "/srv/app", cols: 80, rows: 24 })).rejects.toThrow(/interactive terminal/);
	});

	// 这条同时盯住时序：通道可能在调用方注册 onExit 之前就已经结束，
	// 直接广播会把退出丢掉，界面就永远停在「启动中」。
	it("退出先于注册也能收到退出码", async () => {
		const { runner } = createChannelRunner();
		const connection = new SshConnection(host, { runner, controlPath: "/tmp/cp" });
		const session = await connection.openPty({ cwd: "/srv/app", cols: 80, rows: 24 });

		const exit = await new Promise<{ exitCode: number | null }>((resolve) => {
			session.onExit(resolve);
		});

		expect(exit.exitCode).toBe(0);
	});
});
