import { describe, expect, it } from "vitest";
import { createTerminalEnvironment, resolveTerminalShell } from "./resolve-terminal-shell.js";

function exists(...paths: string[]): (path: string) => boolean {
	const set = new Set(paths);
	return (path) => set.has(path);
}

describe("resolveTerminalShell（posix）", () => {
	it("优先用 $SHELL，并以登录 shell 启动", () => {
		const shell = resolveTerminalShell({
			platform: "darwin",
			env: { SHELL: "/opt/homebrew/bin/fish" },
			fileExists: exists("/opt/homebrew/bin/fish"),
		});

		expect(shell).toEqual({ file: "/opt/homebrew/bin/fish", args: ["-l"] });
	});

	it("$SHELL 指向不存在的文件时按候选顺序回退", () => {
		const shell = resolveTerminalShell({
			platform: "linux",
			env: { SHELL: "/usr/bin/gone" },
			fileExists: exists("/bin/bash", "/bin/sh"),
		});

		expect(shell.file).toBe("/bin/bash");
	});

	it("什么都找不到时退到 /bin/sh 而不是抛错", () => {
		const shell = resolveTerminalShell({ platform: "linux", env: {}, fileExists: () => false });

		expect(shell).toEqual({ file: "/bin/sh", args: ["-l"] });
	});

	it("绝不带 -c：那是一次性非交互调用的形状", () => {
		const shell = resolveTerminalShell({
			platform: "darwin",
			env: { SHELL: "/bin/zsh" },
			fileExists: exists("/bin/zsh"),
		});

		expect(shell.args).not.toContain("-c");
	});
});

describe("resolveTerminalShell（windows）", () => {
	it("优先 pwsh，且不带 -NonInteractive / -Command", () => {
		const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
		const shell = resolveTerminalShell({ platform: "win32", env: {}, fileExists: exists(pwsh) });

		expect(shell.file).toBe(pwsh);
		expect(shell.args).toEqual(["-NoLogo"]);
	});

	it("没有 pwsh 时退到系统 powershell", () => {
		const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
		const shell = resolveTerminalShell({ platform: "win32", env: {}, fileExists: exists(powershell) });

		expect(shell.file).toBe(powershell);
	});

	it("都没有时用 COMSPEC，cmd 不需要额外参数", () => {
		const shell = resolveTerminalShell({
			platform: "win32",
			env: { COMSPEC: "D:\\cmd.exe" },
			fileExists: () => false,
		});

		expect(shell).toEqual({ file: "D:\\cmd.exe", args: [] });
	});
});

describe("自定义 shell", () => {
	it("路径存在时直接采用", () => {
		const shell = resolveTerminalShell({
			platform: "darwin",
			customShellPath: "/usr/local/bin/nu",
			fileExists: exists("/usr/local/bin/nu"),
		});

		expect(shell.file).toBe("/usr/local/bin/nu");
	});

	it("路径不存在时报错，不悄悄换成别的 shell", () => {
		expect(() =>
			resolveTerminalShell({ platform: "darwin", customShellPath: "/nope", fileExists: () => false }),
		).toThrow(/\/nope/);
	});
});

describe("createTerminalEnvironment", () => {
	it("剔除 Vetta 内部变量与 askpass 注入", () => {
		const env = createTerminalEnvironment({
			PATH: "/usr/bin",
			VETTA_CONFIG_DIR: "/tmp/.vetta",
			ELECTRON_RUN_AS_NODE: "1",
			NODE_OPTIONS: "--import tsx",
			SSH_ASKPASS: "/tmp/askpass",
		});

		expect(env.PATH).toBe("/usr/bin");
		expect(env.VETTA_CONFIG_DIR).toBeUndefined();
		expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
		expect(env.NODE_OPTIONS).toBeUndefined();
		expect(env.SSH_ASKPASS).toBeUndefined();
	});

	it("声明真彩色终端，否则 TUI 会走降级渲染", () => {
		const env = createTerminalEnvironment({ TERM: "dumb" });

		expect(env.TERM).toBe("xterm-256color");
		expect(env.COLORTERM).toBe("truecolor");
	});
});
