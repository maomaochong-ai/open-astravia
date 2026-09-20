import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	buildKillCommand,
	buildListDirectoryCommand,
	buildRemoteCommand,
	buildRemoteScript,
	buildStatCommand,
	buildWriteFileCommand,
	quoteShellArgument,
} from "./remote-command.js";

describe("quoteShellArgument", () => {
	it("中和掉远端 shell 会解释的每一类元字符", () => {
		// 路径来自用户选目录、模型给的参数和远端目录列表，任何一类漏掉都是任意命令执行。
		const cases = [
			"$(whoami)",
			"`id`",
			"a; rm -rf /",
			"a && rm -rf /",
			"a | tee /tmp/x",
			"a > /tmp/x",
			"$HOME",
			"a\nrm -rf /",
			"*",
			"~/secret",
			"a\\b",
		];
		for (const value of cases) {
			expect(quoteShellArgument(value)).toBe(`'${value}'`);
		}
	});

	it("用闭合再重开的方式处理单引号，引号逃不出字面量", () => {
		expect(quoteShellArgument("it's")).toBe("'it'\\''s'");
		// 经典逃逸尝试：靠一个单引号结束引用，后面接命令。
		expect(quoteShellArgument("'; rm -rf / #")).toBe("''\\''; rm -rf / #'");
	});

	it("保留空串与空白", () => {
		expect(quoteShellArgument("")).toBe("''");
		expect(quoteShellArgument("a b")).toBe("'a b'");
	});
});

describe("buildRemoteCommand（在真实 /bin/sh 上执行）", () => {
	// 引用有两层，断言字符串只能证明「长得像」。真正的合同是：交给 shell 之后，用户命令
	// 在正确的目录里、由登录 shell 执行，退出码原样回来。
	const run = (remoteCommand: string, env: NodeJS.ProcessEnv = {}) =>
		spawnSync("/bin/sh", ["-c", remoteCommand], { encoding: "utf8", env: { ...process.env, ...env } });

	it("走账号的登录 shell，让 nvm、pyenv 这类只改 profile 的 PATH 生效", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-shell-"));
		const fakeShell = join(dir, "fake-shell");
		writeFileSync(fakeShell, '#!/bin/sh\nprintf "%s|" "$@"\n');
		chmodSync(fakeShell, 0o755);
		expect(run(buildRemoteCommand("node -v"), { SHELL: fakeShell }).stdout).toBe("-l|-c|node -v|");
	});

	it("cd 与用户命令作为一个整体执行，&& 不会落到外层", () => {
		// 直接把 `cd x && cmd` 摊在 -c 外面，cmd 就跑在了家目录而不是项目里。
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "vetta it's-")));
		const result = run(buildRemoteCommand("pwd; exit 3", { cwd: dir }), { SHELL: "/bin/sh" });
		expect(result.stdout.trim()).toBe(dir);
		expect(result.status).toBe(3);
	});

	it("带 processToken 时退出码照旧，结束后不留记号文件", () => {
		const tmp = mkdtempSync(join(tmpdir(), "vetta-token-"));
		const result = run(buildRemoteCommand("exit 7", { processToken: "vetta-exec-t1" }), {
			SHELL: "/bin/sh",
			TMPDIR: tmp,
		});
		expect(result.status).toBe(7);
		expect(readdirSync(tmp)).toEqual([]);
	});

	it("processToken 只能是文件名，不能借它写到别处", () => {
		expect(() => buildRemoteCommand("ls", { processToken: "../x" })).toThrow(/Invalid remote process token/);
		expect(() => buildKillCommand("a b")).toThrow(/Invalid remote process token/);
	});
});

describe("buildKillCommand（在真实 /bin/sh 上执行）", () => {
	it("连同派生的子进程一起杀掉——只杀领头进程会把 dev server 留成孤儿", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "vetta-kill-"));
		const env = { ...process.env, SHELL: "/bin/sh", TMPDIR: tmp };
		const marker = join(tmp, "child.pid");
		// detached 让它自成一个会话，与 sshd 为无 pty 会话做的 setsid() 同构。
		const child = spawn(
			"/bin/sh",
			[
				"-c",
				buildRemoteCommand(`sh -c 'echo $$ > ${marker}; sleep 60' & sleep 60`, { processToken: "vetta-exec-k1" }),
			],
			{ env, detached: true, stdio: "ignore" },
		);
		const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
		await vi.waitFor(() => expect(existsSync(marker) && readFileSync(marker, "utf8").trim()).toBeTruthy());
		const grandchildPid = Number(readFileSync(marker, "utf8").trim());

		execFileSync("/bin/sh", ["-c", buildKillCommand("vetta-exec-k1")], { env });

		await exited;
		await vi.waitFor(() => expect(() => process.kill(grandchildPid, 0)).toThrow());
		expect(readdirSync(tmp)).toEqual(["child.pid"]);
	});

	it("记号文件不存在或内容不是进程号时什么都不做", () => {
		const tmp = mkdtempSync(join(tmpdir(), "vetta-kill-"));
		const env = { ...process.env, TMPDIR: tmp };
		expect(() => execFileSync("/bin/sh", ["-c", buildKillCommand("vetta-exec-none")], { env })).not.toThrow();
		// `kill -- -1` 会杀掉该用户的全部进程，必须被挡在外面。
		writeFileSync(join(tmp, "vetta-exec-bad"), "1");
		expect(() => execFileSync("/bin/sh", ["-c", buildKillCommand("vetta-exec-bad")], { env })).not.toThrow();
	});
});

describe("buildRemoteScript", () => {
	it("cd 用 && 连接，目录不存在就整条失败而不是落到家目录执行", () => {
		expect(buildRemoteScript("npm test", { cwd: "/srv/app" })).toBe("cd '/srv/app' && npm test");
	});

	it("工作目录里的引号不会把命令截断", () => {
		expect(buildRemoteScript("ls", { cwd: "/srv/it's here" })).toBe("cd '/srv/it'\\''s here' && ls");
	});

	it("环境变量值被引用，变量名非法时拒绝构造", () => {
		expect(buildRemoteScript("go build", { env: { GOFLAGS: "-tags 'a b'" } })).toBe(
			"export GOFLAGS='-tags '\\''a b'\\''' && go build",
		);
		expect(() => buildRemoteScript("ls", { env: { "A;B": "x" } })).toThrow("Invalid environment variable name");
	});
});

describe("buildListDirectoryCommand", () => {
	it("按远端 stat 方言选格式，不在远端用 || 试错", () => {
		// 试错会在第一条命令部分成功时给出半截输出，解析不出来也发现不了。
		expect(buildListDirectoryCommand("/srv", "gnu")).toContain("--printf=");
		expect(buildListDirectoryCommand("/srv", "bsd")).toContain("-f ");
		expect(buildListDirectoryCommand("/srv", "gnu")).not.toContain("||");
	});

	it("目录路径被引用", () => {
		expect(buildListDirectoryCommand("/srv/a b", "gnu")).toContain("cd '/srv/a b'");
	});

	it("锁死 C locale，否则中文系统上 stat 会输出「目录」而不是 directory", () => {
		// 现场故障：远端是中文 locale，每个条目都被判成未知类型，目录列表显示为空，
		// 而且没有任何报错——从现象完全反推不到原因。
		expect(buildListDirectoryCommand("/srv", "gnu")).toContain("LC_ALL=C");
		expect(buildStatCommand("/srv/app", "gnu")).toContain("LC_ALL=C");
	});

	it("用 env 设置 locale，而不是 POSIX 的前缀赋值", () => {
		// `LC_ALL=C cmd` 是 POSIX shell 语法，远端登录 shell 若是 fish 就会报错；
		// `env` 在任何 shell 里都只是一个普通命令。
		expect(buildListDirectoryCommand("/srv", "gnu")).toContain("env LC_ALL=C");
	});
});

describe("buildWriteFileCommand（在真实 /bin/sh 上执行）", () => {
	// 这段脚本的正确性取决于 shell 的真实语义（截断是否保留 mode、mv 对符号链接做什么），
	// 断言字符串证明不了任何事，所以直接在本机 sh 上跑。
	function write(target: string, content: string): void {
		execFileSync("/bin/sh", ["-c", buildWriteFileCommand(target, ".vetta-tmp-test")], { input: content });
	}

	it("新文件直接落盘，不留临时文件", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-write-"));
		write(join(dir, "a b'c.txt"), "hello");
		expect(readFileSync(join(dir, "a b'c.txt"), "utf8")).toBe("hello");
		expect(readdirSync(dir)).toEqual(["a b'c.txt"]);
	});

	it("覆盖可执行脚本后仍然可执行", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-write-"));
		const script = join(dir, "run.sh");
		writeFileSync(script, "old");
		chmodSync(script, 0o755);
		write(script, "new");
		expect(readFileSync(script, "utf8")).toBe("new");
		expect(statSync(script).mode & 0o777).toBe(0o755);
	});

	it("写符号链接时改的是它指向的文件，链接本身保持为链接", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-write-"));
		const real = join(dir, "real.txt");
		const link = join(dir, "link.txt");
		writeFileSync(real, "old");
		symlinkSync(real, link);
		write(link, "new");
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
		expect(readFileSync(real, "utf8")).toBe("new");
	});

	it("目录不存在时失败，且不留下临时文件", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-write-"));
		expect(() => write(join(dir, "missing", "a.txt"), "x")).toThrow();
		expect(readdirSync(dir)).toEqual([]);
	});
});
