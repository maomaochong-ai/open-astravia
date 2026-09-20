import { isRememberableSshPrompt, type SshPromptKind } from "@vetta/ssh-transport";
import type { CredentialRef } from "../credentials/credential-vault.js";
import type { SshAskpassRequest, SshPromptAnswer } from "./askpass-server.js";

export const SSH_CREDENTIAL_NAMESPACE = "ssh";

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
}

export function sshCredentialRef(hostId: string, kind: SshPromptKind): CredentialRef {
	return { namespace: SSH_CREDENTIAL_NAMESPACE, ownerId: hostId, name: kind };
}

/**
 * 回答 OpenSSH 的交互提示。
 *
 * 已保存的凭据**每轮认证只用一次**。OpenSSH 密码错了会连问三次，若每次都把同一个
 * 存着的密码递回去，用户看到的是「卡住然后失败」，完全看不出是存的密码过期了。
 * 所以同一台主机、同一类提示第二次问过来时，一定转成问用户，并把那条失效的记录删掉。
 */
export class SshPromptService {
	/** 本轮已经用过存档凭据的 `hostId:kind`。连接成功后由 {@link reset} 清掉。 */
	private readonly usedStored = new Set<string>();

	constructor(private readonly dependencies: SshPromptServiceDependencies) {}

	reset(hostId: string): void {
		for (const key of [...this.usedStored]) {
			if (key.startsWith(`${hostId}:`)) this.usedStored.delete(key);
		}
	}

	resolve = async (request: SshAskpassRequest): Promise<SshPromptAnswer> => {
		const rememberable = isRememberableSshPrompt(request.kind);
		const key = `${request.hostId}:${request.kind}`;
		const ref = sshCredentialRef(request.hostId, request.kind);

		if (rememberable && !this.usedStored.has(key)) {
			const stored = this.dependencies.readStoredSecret(ref);
			if (stored !== undefined) {
				this.usedStored.add(key);
				return { ok: true, value: stored };
			}
		} else if (rememberable) {
			// 又问了一次，说明刚才那条存档是错的。留着它只会让下次连接重复失败一遍。
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
			this.usedStored.add(key);
		}
		// 确认类提示没有值，答案完全由 ok 表达。
		return request.kind === "confirm" ? { ok: true } : { ok: true, value: answer.value ?? "" };
	};
}
