import { isRememberableSshPrompt, type SshPromptKind } from "@vetta/ssh-transport";
import type { CredentialRef } from "../credentials/credential-vault.js";
import type { SshAskpassRequest, SshPromptAnswer } from "./askpass-server.js";

export const SSH_CREDENTIAL_NAMESPACE = "ssh";

/**
 * 一条「本轮已用过存档」的标记最多留多久。
 *
 * 一轮认证里的两次提示只隔毫秒级，所以这个值只需要足够长到不误伤，同时给 Map 一个上界——
 * 标记按 ssh 进程号分桶，进程退出后没有任何事件通知我们去清理。
 */
const ROUND_TTL_MS = 10 * 60 * 1000;

export interface SshPromptUserRequest {
	readonly hostId: string;
	readonly hostLabel: string;
	readonly kind: SshPromptKind;
	readonly prompt: string;
	/** 提供「记住」选项吗。一次性验证码和确认类不提供。 */
	readonly rememberable: boolean;
}

export interface SshPromptUserAnswer {
	readonly ok: boolean;
	readonly value?: string;
	readonly remember?: boolean;
}

export interface SshPromptServiceDependencies {
	readonly resolveHostLabel: (hostId: string) => string;
	readonly readStoredSecret: (ref: CredentialRef) => string | undefined;
	readonly writeStoredSecret: (ref: CredentialRef, value: string) => void;
	readonly removeStoredSecret: (ref: CredentialRef) => void;
	/** 弹给用户。返回 ok=false 表示取消或拒绝。 */
	readonly askUser: (request: SshPromptUserRequest) => Promise<SshPromptUserAnswer>;
	/** 取当前时间，仅供测试注入。 */
	readonly now?: () => number;
}

export function sshCredentialRef(hostId: string, kind: SshPromptKind): CredentialRef {
	return { namespace: SSH_CREDENTIAL_NAMESPACE, ownerId: hostId, name: kind };
}

/**
 * 回答 OpenSSH 的交互提示。
 *
 * 已保存的凭据**每轮认证只用一次**。OpenSSH 密码错了会连问三次，若每次都把同一个
 * 存着的密码递回去，用户看到的是「卡住然后失败」，完全看不出是存的密码过期了。
 * 所以同一轮里同一类提示第二次问过来时，一定转成问用户，并把那条失效的记录删掉。
 *
 * 「一轮」以发起提示的那个 `ssh` 进程为界（{@link SshAskpassRequest.round}），不是以
 * 应用的生命周期为界。早先按 hostId 分桶、靠连接状态回调来清空，而那个回调只有「测试
 * 连接」按钮才会触发——日常打开项目根本不走它。于是标记只增不减，同一次运行里的第二次
 * 提示必然落进「存档是错的」分支，把用户刚勾选「记住」存下的密码当场删掉。用户看到的
 * 就是「勾了记住，下次还是问我」。
 */
export class SshPromptService {
	/** 已经用过存档凭据的轮次，值是这条标记的过期时刻。 */
	private readonly usedStored = new Map<string, number>();

	constructor(private readonly dependencies: SshPromptServiceDependencies) {}

	resolve = async (request: SshAskpassRequest): Promise<SshPromptAnswer> => {
		const rememberable = isRememberableSshPrompt(request.kind);
		const key = `${request.hostId}:${request.kind}:${request.round ?? "unknown"}`;
		const ref = sshCredentialRef(request.hostId, request.kind);
		const now = (this.dependencies.now ?? Date.now)();
		this.pruneExpired(now);

		if (rememberable && !this.usedStored.has(key)) {
			const stored = this.dependencies.readStoredSecret(ref);
			if (stored !== undefined) {
				this.usedStored.set(key, now + ROUND_TTL_MS);
				return { ok: true, value: stored };
			}
		} else if (rememberable) {
			// 同一轮里又问了一次，说明刚才那条存档是错的。留着它只会让下次连接重复失败一遍。
			this.dependencies.removeStoredSecret(ref);
		}

		const answer = await this.dependencies.askUser({
			hostId: request.hostId,
			hostLabel: this.dependencies.resolveHostLabel(request.hostId),
			kind: request.kind,
			prompt: request.prompt,
			rememberable,
		});
		if (!answer.ok) return { ok: false };

		if (rememberable && answer.remember === true && answer.value !== undefined) {
			this.dependencies.writeStoredSecret(ref, answer.value);
			// 用户刚给的值这轮已经用掉了，别再从存档里取第二次。
			this.usedStored.set(key, now + ROUND_TTL_MS);
		}
		// 确认类提示没有值，答案完全由 ok 表达。
		return request.kind === "confirm" ? { ok: true } : { ok: true, value: answer.value ?? "" };
	};

	private pruneExpired(now: number): void {
		for (const [key, expiresAt] of this.usedStored) {
			if (expiresAt <= now) this.usedStored.delete(key);
		}
	}
}
