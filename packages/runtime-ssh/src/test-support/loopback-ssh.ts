import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeSshProcessRunner, SshConnection, type SshHost } from "@vetta/ssh-transport";

/**
 * 一条「连到本机」的 SSH 连接，不需要 sshd。
 *
 * 顶替 `ssh` 的是一个只认最后一个参数的脚本：丢掉连接选项与目标主机，把远端命令串交给
 * `/bin/sh -c`——这正是 sshd 对它做的事。于是命令构造、两层引用、stdin/stdout 的字节
 * 往返、退出码都跑在真实 shell 上，测试证明的是「这条命令真的能用」，而不是「我们拼出
 * 了预期的字符串」。
 */
export function createLoopbackSshConnection(): SshConnection {
	const directory = mkdtempSync(join(tmpdir(), "vetta-loopback-ssh-"));
	const fakeSsh = join(directory, "ssh");
	writeFileSync(fakeSsh, '#!/bin/sh\nfor last; do :; done\nexec /bin/sh -c "$last"\n');
	chmodSync(fakeSsh, 0o755);
	const host: SshHost = { id: "loopback", label: "loopback", target: "loopback", source: "manual" };
	return new SshConnection(host, {
		// 固定用 /bin/sh 当登录 shell：开发者自己的 zsh profile 既慢，又会让结果因人而异。
		runner: createNodeSshProcessRunner({ sshBinary: fakeSsh, baseEnv: { ...process.env, SHELL: "/bin/sh" } }),
		controlPath: join(directory, "cp"),
	});
}
