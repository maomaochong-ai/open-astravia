import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeSshProcessRunner } from "./node-process-runner.js";
import type { SshProcessRunner } from "./process-runner.js";
import { formatSshProjectUri } from "./project-uri.js";
import { SshConnection, type SshConnectionOptions } from "./ssh-connection.js";

/** Map a local fixture to the POSIX path seen by the loopback shell. */
export function toLoopbackRemotePath(localPath: string): string {
	if (process.platform !== "win32") return localPath;
	const drivePath = /^([A-Za-z]):[\\/](.*)$/.exec(localPath);
	if (!drivePath) throw new Error(`Expected an absolute Windows path: ${localPath}`);
	return `/${drivePath[1].toLowerCase()}/${drivePath[2].replaceAll("\\", "/")}`;
}

export function formatLoopbackProjectUri(hostId: string, localPath: string): string {
	return formatSshProjectUri(hostId, toLoopbackRemotePath(localPath));
}

function windowsLoopbackShell(): string {
	const result = spawnSync("where.exe", ["git.exe"], { encoding: "utf8" });
	for (const git of result.stdout.split(/\r?\n/).filter(Boolean)) {
		const shell = resolve(dirname(git), "../bin/sh.exe");
		if (existsSync(shell)) return shell;
	}
	throw new Error("Git for Windows sh.exe is required for loopback SSH tests");
}

function createWindowsLoopbackRunner(home: string): SshProcessRunner {
	const shell = windowsLoopbackShell();
	const baseEnv = { ...process.env, HOME: toLoopbackRemotePath(home), SHELL: "/bin/sh" };
	const wrapper = [
		'const { spawn } = require("node:child_process");',
		'const child = spawn(process.argv[1], ["-c", process.argv[2]], { stdio: ["pipe", "pipe", "pipe"] });',
		"process.stdin.pipe(child.stdin);",
		"child.stdout.pipe(process.stdout);",
		"child.stderr.pipe(process.stderr);",
		'child.on("error", () => { process.exitCode = 1; });',
		'child.on("close", (code) => { process.exitCode = code ?? 1; });',
	].join("\n");
	return {
		run: (invocation) =>
			new Promise((resolveRun, rejectRun) => {
				if (invocation.signal?.aborted) {
					resolveRun({ exitCode: null, stdout: new Uint8Array(), stderr: "", aborted: true });
					return;
				}
				const command = invocation.argv.at(-1) ?? "";
				// A wrapper keeps a stable Windows PID for cancellable commands. Ordinary
				// file operations use sh directly to avoid starting Node for every stat.
				const needsWrapper = invocation.signal !== undefined || invocation.timeoutMs !== undefined;
				const child = spawn(
					needsWrapper ? process.execPath : shell,
					needsWrapper ? ["-e", wrapper, shell, command] : ["-c", command],
					{
						env: { ...baseEnv, ...invocation.env },
						stdio: ["pipe", "pipe", "pipe"],
					},
				);
				const stdout: Buffer[] = [];
				const stderr: Buffer[] = [];
				let aborted = false;
				let timedOut = false;
				const stop = (timeout: boolean): void => {
					if (child.exitCode !== null || child.killed) return;
					aborted = true;
					timedOut = timeout;
					// Git Bash children inherit the pipe handles. Killing only sh.exe leaves a
					// sleeping grandchild alive and prevents the SSH channel from closing.
					if (child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
					child.kill();
				};
				const timer =
					invocation.timeoutMs === undefined ? undefined : setTimeout(() => stop(true), invocation.timeoutMs);
				timer?.unref();
				const onAbort = (): void => stop(false);
				invocation.signal?.addEventListener("abort", onAbort, { once: true });
				child.stdout.on("data", (chunk: Buffer) => {
					if (invocation.onStdout) invocation.onStdout(chunk);
					else stdout.push(chunk);
				});
				child.stderr.on("data", (chunk: Buffer) => {
					invocation.onStderr?.(chunk);
					stderr.push(chunk);
				});
				child.once("error", rejectRun);
				child.once("close", (exitCode) => {
					if (timer) clearTimeout(timer);
					invocation.signal?.removeEventListener("abort", onAbort);
					resolveRun({
						exitCode,
						stdout: Buffer.concat(stdout),
						stderr: Buffer.concat(stderr).toString("utf8"),
						aborted,
						timedOut,
					});
				});
				child.stdin.on("error", () => {});
				child.stdin.end(invocation.stdin);
			}),
	};
}

/**
 * 一条「连到本机」的 SSH 连接，不需要 sshd。仅供测试使用。
 *
 * 顶替 `ssh` 的脚本只认最后一个参数并把它交给 `/bin/sh -c`——这正是 sshd 对远端命令做的
 * 事。于是「远端」就是本机的一个临时目录，命令构造、两层引用、字节往返与退出码都跑在真实
 * shell 上：测试证明的是功能真的可用，而不是我们拼出了预期的字符串、调用了自己写的 mock。
 * 它已经抓出过 BSD stat 不解释 `\t` 这类只有真跑才会暴露的问题。
 */
export function createLoopbackSshConnection(
	hostId = "loopback",
	options: Pick<SshConnectionOptions, "helper"> = {},
): SshConnection {
	const directory = mkdtempSync(join(tmpdir(), "vetta-loopback-ssh-"));
	// 「远端」有自己的家目录：helper 会往 ~/.cache 里装东西，不能装进开发者真实的家目录。
	const home = join(directory, "home");
	mkdirSync(home);
	const fakeSsh = join(directory, "ssh");
	// sshd 为每条无 pty 的会话调用 setsid()；远端命令的「整组终止」依赖这一点。回环里用 perl
	// 补上同样的一步，否则命令会落在测试运行器自己的进程组里。没有 perl 时不建新会话——
	// 终止逻辑自带保险，只会退化为杀单个进程，不会误伤。
	writeFileSync(
		fakeSsh,
		[
			"#!/bin/sh",
			"for last; do :; done",
			"if command -v perl >/dev/null 2>&1; then",
			"  exec perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' /bin/sh -c \"$last\"",
			"fi",
			'exec /bin/sh -c "$last"',
			"",
		].join("\n"),
	);
	chmodSync(fakeSsh, 0o755);
	return new SshConnection(
		{ id: hostId, label: hostId, target: hostId, source: "manual" },
		{
			// Windows cannot spawn a shebang script directly. Git Bash provides the POSIX shell
			// used by the remote host while the runner still executes the assembled SSH command.
			runner:
				process.platform === "win32"
					? createWindowsLoopbackRunner(home)
					: createNodeSshProcessRunner({
							sshBinary: fakeSsh,
							baseEnv: { ...process.env, SHELL: "/bin/sh", HOME: home },
						}),
			controlPath: join(directory, "cp"),
			...options,
		},
	);
}

let builtHelper: string | undefined | null = null;

/**
 * 编译一份本机平台的远端 helper 供端到端测试使用；没有 Go 工具链时返回 undefined，
 * 调用方据此跳过。同一进程内只编一次。
 */
export function buildSshHelperForTests(): string | undefined {
	if (builtHelper !== null) return builtHelper;
	const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/ssh-helper");
	const output = join(mkdtempSync(join(tmpdir(), "vetta-helper-build-")), "vetta-ssh-helper");
	const result = spawnSync("go", ["build", "-o", output, "./cmd/vetta-ssh-helper"], {
		cwd: source,
		env: { ...process.env, CGO_ENABLED: "0" },
	});
	builtHelper = result.status === 0 ? output : undefined;
	return builtHelper;
}
