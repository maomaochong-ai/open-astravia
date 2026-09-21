import type { SshConnectionStatus } from "@vetta/ssh-transport";

/**
 * SSH 主机相关的跨进程广播。
 *
 * 与 `projects-ipc.ts` 同样的理由：主机列表和连接状态的事实源在主进程，渲染进程
 * 只有一份快照。状态变化由工具调用、文件树刷新等后台动作触发，不经过渲染进程，
 * 没有广播就只能停在旧状态上。
 */
export const SSH_CHANNELS = {
	/** main → renderer：无载荷，通知「主机列表已变，去重读」。 */
	HOSTS_CHANGED: "vetta:ssh:hosts-changed",
	/** main → renderer：单台主机的连接状态变化。 */
	HOST_STATUS: "vetta:ssh:host-status",
	/** main → renderer：无载荷，通知「端口转发清单已变，去重读」。 */
	PORT_FORWARDS_CHANGED: "vetta:ssh:port-forwards-changed",
} as const;

export interface SshHostStatusEvent {
	readonly hostId: string;
	readonly status: SshConnectionStatus;
}
