import { randomUUID } from "node:crypto";
import type { ImHostBridge } from "./rpc-session-capabilities.js";
import type { RpcHostRequest, RpcHostResponse } from "./rpc-types.js";

const DEFAULT_HOST_REQUEST_TIMEOUT_MS = 30_000;

interface PendingHostRequest {
	readonly resolve: (value: { messageId?: string }) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export class RpcHostBridge {
	private readonly pending = new Map<string, PendingHostRequest>();

	constructor(
		private readonly output: (request: RpcHostRequest) => void,
		private readonly timeoutMs = DEFAULT_HOST_REQUEST_TIMEOUT_MS,
	) {}

	createBridge(): ImHostBridge {
		return {
			sendAttachment: (params) =>
				new Promise<{ messageId?: string }>((resolve, reject) => {
					const id = randomUUID();
					const timer = setTimeout(() => {
						this.pending.delete(id);
						reject(new Error(`im_send_attachment: host did not respond within ${this.timeoutMs}ms`));
					}, this.timeoutMs);
					this.pending.set(id, { resolve, reject, timer });
					this.output({
						type: "host_request",
						id,
						method: "send_attachment",
						params,
					});
				}),
		};
	}

	handle(response: RpcHostResponse): boolean {
		const request = this.pending.get(response.id);
		if (!request) return false;
		this.pending.delete(response.id);
		clearTimeout(request.timer);
		if (response.success) {
			request.resolve({ messageId: response.data?.messageId });
		} else {
			const code = response.errorCode ? ` [${response.errorCode}]` : "";
			request.reject(new Error(`${response.error}${code}`));
		}
		return true;
	}

	dispose(reason = "RPC host bridge closed"): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error(reason));
		}
		this.pending.clear();
	}
}
