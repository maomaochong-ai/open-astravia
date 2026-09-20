/**
 * 一台可作为项目宿主的 SSH 主机。
 *
 * 这里只存「怎么连上去」的最小信息，不存口令和私钥口令——凭据由宿主的凭据库持有，
 * 配置里只留一个引用。历史上这类配置文件被整份同步或贴进 issue 的情况太常见，
 * 明文口令进了配置就等于泄漏。
 */
export interface SshHost {
	/** 稳定 id。项目通过它引用主机，改标签或改主机名都不会让已登记的项目失联。 */
	readonly id: string;
	/** 用户可见名称。 */
	readonly label: string;
	/**
	 * 连接目标：`~/.ssh/config` 里的别名，或 `user@host`。
	 *
	 * 优先让用户填别名：别名背后的 ProxyJump、ProxyCommand、IdentityAgent 等一整套
	 * 配置由 OpenSSH 自己解析，Vetta 不需要复刻一份必然与之漂移的实现。
	 */
	readonly target: string;
	/** 仅在未使用 ssh config 别名、且端口非 22 时需要。 */
	readonly port?: number;
	/** 私钥路径。留空表示交给 ssh-agent 与 OpenSSH 的默认身份。 */
	readonly identityFile?: string;
	/**
	 * 条目来源。`ssh-config` 的条目每次导入都按 `~/.ssh/config` 刷新，
	 * `manual` 的条目永不被导入覆盖——否则用户手工改过的端口会在下次导入时被悄悄改回去。
	 */
	readonly source: "ssh-config" | "manual";
	/** 凭据库中的引用（私钥口令或登录口令）。配置里不出现明文。 */
	readonly credentialRef?: string;
}

/** 连接生命周期。`unverifiable` 不能与 `disconnected` 合并，见 ADR-0120 的执行边界。 */
export type SshConnectionStatus = "disconnected" | "connecting" | "connected" | "unverifiable";

export interface SshHostInput {
	readonly label: string;
	readonly target: string;
	readonly port?: number;
	readonly identityFile?: string;
	readonly source?: SshHost["source"];
	readonly credentialRef?: string;
}

const TARGET_PATTERN = /^[A-Za-z0-9._@-]+$/;

/**
 * 校验并归一化用户输入。
 *
 * target 限制在别名和 `user@host` 允许的字符集内：它会作为参数交给 `ssh`，虽然
 * 我们用的是 argv 而不是 shell 拼接（所以没有注入风险），但以 `-` 开头的值会被
 * OpenSSH 当成选项解析，`--` 之后的选项注入同样能改变连接目标。
 */
export function normalizeSshHostInput(input: SshHostInput): Omit<SshHost, "id"> {
	const label = input.label.trim();
	const target = input.target.trim();
	if (label.length === 0) throw new Error("SSH host label must not be empty.");
	if (target.length === 0) throw new Error("SSH host target must not be empty.");
	if (target.startsWith("-")) throw new Error("SSH host target must not start with '-'.");
	if (!TARGET_PATTERN.test(target)) throw new Error(`Invalid SSH host target: ${target}`);
	if (input.port !== undefined && !isValidPort(input.port)) {
		throw new Error(`Invalid SSH port: ${input.port}`);
	}
	return {
		label,
		target,
		...(input.port === undefined ? {} : { port: input.port }),
		...(input.identityFile?.trim() ? { identityFile: input.identityFile.trim() } : {}),
		source: input.source ?? "manual",
		...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
	};
}

function isValidPort(port: number): boolean {
	return Number.isInteger(port) && port > 0 && port <= 65535;
}
