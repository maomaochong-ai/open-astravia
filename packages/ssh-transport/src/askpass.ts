/**
 * OpenSSH 的交互提示分类。
 *
 * 系统 `ssh` 要口令时不读 stdin，而是执行 `SSH_ASKPASS` 指向的程序，把提示文本作为
 * 第一个参数传进去。程序把答案打到 stdout、退出码 0 表示可用。没有这条通道时，需要
 * 口令、私钥密码、2FA 或首次主机指纹确认的连接会一直挂到超时，而且看不出原因。
 *
 * 分类只看提示文本和 OpenSSH 8.4+ 提供的 `SSH_ASKPASS_PROMPT` 提示，不依赖具体版本。
 */

export type SshPromptKind =
	/** 是/否确认。典型是首次连接的主机指纹核对。答案由退出码表达，不走 stdout。 */
	| "confirm"
	/** 私钥密码。属于本机密钥，和远端账号无关。 */
	| "passphrase"
	/** 远端账号登录口令。 */
	| "password"
	/** 一次性验证码（2FA）。永远不该被记住。 */
	| "verification-code";

export interface SshPromptRequest {
	readonly kind: SshPromptKind;
	/** OpenSSH 给出的原始提示文本，原样展示给用户——它带着主机名等关键上下文。 */
	readonly prompt: string;
}

/**
 * 判断这次提示要用户做什么。
 *
 * `askpassPromptEnv` 是 OpenSSH 8.4+ 通过 `SSH_ASKPASS_PROMPT` 传的提示类型，
 * 取 `confirm` 时退出码就是答案；老版本没有这个变量，只能靠文本判断。
 */
export function classifySshPrompt(prompt: string, askpassPromptEnv?: string): SshPromptKind {
	if (askpassPromptEnv === "confirm") return "confirm";
	const text = prompt.toLowerCase();
	// 首次连接的主机指纹核对。必须由用户确认，不能默认放行（ADR-0124）。
	if (text.includes("(yes/no") || text.includes("authenticity of host") || text.includes("fingerprint)?")) {
		return "confirm";
	}
	if (text.includes("passphrase")) return "passphrase";
	// 放在 password 之前：某些 PAM 配置的提示同时含 "verification code" 和 "password"。
	if (
		text.includes("verification code") ||
		text.includes("one-time") ||
		text.includes("otp") ||
		text.includes("token") ||
		text.includes("2fa")
	) {
		return "verification-code";
	}
	return "password";
}

/**
 * 这种提示的答案可以记住吗。
 *
 * 一次性验证码记住没有意义且危险；确认类根本没有「答案」可存。
 */
export function isRememberableSshPrompt(kind: SshPromptKind): boolean {
	return kind === "passphrase" || kind === "password";
}

export interface SshAskpassEnvironment {
	readonly SSH_ASKPASS: string;
	readonly SSH_ASKPASS_REQUIRE: string;
	readonly DISPLAY?: string;
}

/**
 * 交给 `ssh` 子进程的 askpass 环境变量。
 *
 * `SSH_ASKPASS_REQUIRE=force` 让 OpenSSH 8.4+ 无论有没有 tty、有没有 DISPLAY 都走
 * askpass；老版本不认这个变量，只在 `DISPLAY` 非空时才用 askpass，所以在缺省时补一个。
 */
export function buildAskpassEnvironment(scriptPath: string, currentDisplay?: string): SshAskpassEnvironment {
	return {
		SSH_ASKPASS: scriptPath,
		SSH_ASKPASS_REQUIRE: "force",
		...(currentDisplay ? {} : { DISPLAY: ":0" }),
	};
}
