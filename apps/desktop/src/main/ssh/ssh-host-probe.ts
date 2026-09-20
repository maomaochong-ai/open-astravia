import { SshTransportError } from "@vetta/ssh-transport";
import { getSshConnection, getSshConnectionManager } from "./ssh-runtime.js";

export interface SshHostProbeResult {
	readonly ok: boolean;
	/** `uname -s`，例如 `Linux`。连不上时为空串。 */
	readonly os: string;
	readonly arch: string;
	/** 远端登录 shell，例如 `/bin/zsh`。 */
	readonly shell: string;
	readonly homeDirectory: string;
	/** 远端是否有 git；没有时远程项目仍能用，只是 Agent 跑 git 命令会失败。 */
	readonly hasGit: boolean;
	/** 远端是否有 ripgrep。没有时搜索降级为 grep，慢但可用。 */
	readonly hasRipgrep: boolean;
	/** 失败原因，成功时为空串。 */
	readonly error: string;
}

const EMPTY: Omit<SshHostProbeResult, "ok" | "error"> = {
	os: "",
	arch: "",
	shell: "",
	homeDirectory: "",
	hasGit: false,
	hasRipgrep: false,
};

/**
 * 「测试连接」按钮背后的探测。
 *
 * 一次往返把所有信息取回：连接建立本身就是最慢的一步，分成四条命令会让用户对着
 * 转圈等上好几秒。输出用固定前缀而不是位置约定，远端 profile 多打印一行也不会
 * 让整个结果错位。
 */
export async function probeSshHost(hostId: string, signal?: AbortSignal): Promise<SshHostProbeResult> {
	try {
		const connection = getSshConnection(hostId);
		const platform = await connection.probePlatform(signal);
		const result = await connection.exec(
			[
				// 模板串里写 `\${`：普通字符串里的 `${` 会被 lint 当成写漏的模板插值。
				`echo "vetta-shell=\${SHELL:-}"`,
				`echo "vetta-home=\${HOME:-}"`,
				'echo "vetta-git=$(command -v git >/dev/null 2>&1 && echo yes || echo no)"',
				'echo "vetta-rg=$(command -v rg >/dev/null 2>&1 && echo yes || echo no)"',
			].join("; "),
			{ signal, timeoutMs: 30_000 },
		);
		const output = new TextDecoder().decode(result.stdout);
		await getSshConnectionManager().probe(hostId, signal);
		return {
			ok: true,
			os: platform.os,
			arch: platform.arch,
			shell: readField(output, "vetta-shell"),
			homeDirectory: readField(output, "vetta-home"),
			hasGit: readField(output, "vetta-git") === "yes",
			hasRipgrep: readField(output, "vetta-rg") === "yes",
			error: "",
		};
	} catch (error) {
		// 探测失败不改变任何持久状态；它只回答「此刻能不能连上」。
		return {
			ok: false,
			...EMPTY,
			error: error instanceof SshTransportError ? error.message : String((error as Error)?.message ?? error),
		};
	}
}

function readField(output: string, key: string): string {
	for (const line of output.split("\n")) {
		if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
	}
	return "";
}
