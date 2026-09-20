import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeSshProcessRunner } from "./node-process-runner.js";
import { SshConnection, type SshConnectionOptions } from "./ssh-connection.js";

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
			// 固定 /bin/sh 当登录 shell：开发者自己的 zsh profile 既慢，又让结果因人而异。
			runner: createNodeSshProcessRunner({
				sshBinary: fakeSsh,
				baseEnv: { ...process.env, SHELL: "/bin/sh", HOME: home },
			}),
			controlPath: join(directory, "cp"),
			...options,
		},
	);
}
