/**
 * SSH 交互提示的跨进程通道。
 *
 * 提示由 OpenSSH 在任意时刻发起——用户点「测试连接」时会，Agent 在后台调一次远端
 * 命令时也会。所以它不能挂在某个页面上，只能由主进程广播、由全局浮层接。
 */
export const SSH_PROMPT_CHANNELS = {
	/** main → renderer：需要用户回答一次提示。 */
	REQUEST: "vetta:ssh:prompt-request",
	/** renderer → main：用户的回答。 */
	RESPOND: "vetta:ssh:prompt-respond",
	/** main → renderer：该提示已失效（连接被取消或超时），关掉界面。 */
	CANCEL: "vetta:ssh:prompt-cancel",
} as const;

export type SshPromptKindWire = "confirm" | "passphrase" | "password" | "verification-code";

export interface SshPromptRequestEvent {
	/** 一次提示的唯一标识，回答时带回来。 */
	readonly id: string;
	readonly hostId: string;
	readonly hostLabel: string;
	readonly kind: SshPromptKindWire;
	/** OpenSSH 的原始提示文本，原样展示——它带着主机名与指纹等关键上下文。 */
	readonly prompt: string;
	readonly rememberable: boolean;
}

export interface SshPromptResponse {
	readonly id: string;
	readonly ok: boolean;
	readonly value?: string;
	readonly remember?: boolean;
}
