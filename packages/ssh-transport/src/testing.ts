import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeSshProcessRunner } from "./node-process-runner.js";
import { SshConnection } from "./ssh-connection.js";

/**
 * 一条「连到本机」的 SSH 连接，不需要 sshd。仅供测试使用。
 *
 * 顶替 `ssh` 的脚本只认最后一个参数并把它交给 `/bin/sh -c`——这正是 sshd 对远端命令做的
 * 事。于是「远端」就是本机的一个临时目录，命令构造、两层引用、字节往返与退出码都跑在真实
 * shell 上：测试证明的是功能真的可用，而不是我们拼出了预期的字符串、调用了自己写的 mock。
 * 它已经抓出过 BSD stat 不解释 `\t` 这类只有真跑才会暴露的问题。
 */
export function createLoopbackSshConnection(hostId = "loopback"): SshConnection {
	const directory = mkdtempSync(join(tmpdir(), "vetta-loopback-ssh-"));
	const fakeSsh = join(directory, "ssh");
	writeFileSync(fakeSsh, '#!/bin/sh\nfor last; do :; done\nexec /bin/sh -c "$last"\n');
	chmodSync(fakeSsh, 0o755);
	return new SshConnection(
		{ id: hostId, label: hostId, target: hostId, source: "manual" },
		{
			// 固定 /bin/sh 当登录 shell：开发者自己的 zsh profile 既慢，又让结果因人而异。
			runner: createNodeSshProcessRunner({ sshBinary: fakeSsh, baseEnv: { ...process.env, SHELL: "/bin/sh" } }),
			controlPath: join(directory, "cp"),
		},
	);
}
