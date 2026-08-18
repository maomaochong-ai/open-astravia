import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { getAppLogger } from "../logger.js";
import { showMainWindow } from "../window-manager.js";
import {
	type ActionApprovalDecision,
	type ActionApprovalRequest,
	type ActionApprovalRequester,
	ActionError,
	type JsonValue,
} from "./types.js";

const log = getAppLogger("action-approval");

const ACTION_APPROVAL_REQUEST_CHANNEL = "vetta:action-approval:request";
const ACTION_APPROVAL_TIMEOUT_CHANNEL = "vetta:action-approval:timeout";
const DEFAULT_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;

export interface DesktopActionApprovalRequest extends ActionApprovalRequest {
	approvalId: string;
	expiresAt: number;
}

interface PendingApproval {
	actionId: string;
	approvalPresentation: string;
	startedAt: number;
	finish: (decision: ActionApprovalDecision) => void;
	cancel: (error: ActionError) => void;
}

export class ActionApprovalBroker implements ActionApprovalRequester {
	private readonly pending = new Map<string, PendingApproval>();
	private readonly onRenderProcessGone = (): void => {
		this.cancelAll();
	};

	constructor(
		private readonly webContents: WebContents,
		private readonly timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
	) {
		this.webContents.on("render-process-gone", this.onRenderProcessGone);
	}

	request(request: ActionApprovalRequest, signal?: AbortSignal): Promise<ActionApprovalDecision> {
		if (this.webContents.isDestroyed()) {
			log.warn("request: webContents destroyed", { actionId: request.actionId });
			return Promise.reject(new ActionError("ACTION_APPROVAL_UNAVAILABLE", "Vetta Desktop 授权界面不可用。"));
		}

		const approvalId = randomUUID();
		const expiresAt = Date.now() + this.timeoutMs;
		const startedAt = Date.now();
		return new Promise<ActionApprovalDecision>((resolve, reject) => {
			let settled = false;
			const cleanup = (): void => {
				this.pending.delete(approvalId);
				clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
			};
			const finish = (decision: ActionApprovalDecision): void => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(decision);
			};
			const cancel = (error: ActionError): void => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			};
			const onAbort = (): void => {
				log.warn("request: aborted by signal", { approvalId, actionId: request.actionId });
				cancel(new ActionError("ACTION_CANCELLED", "Vetta action 请求已取消。", { actionId: request.actionId }));
			};
			const timeout = setTimeout(() => {
				log.warn("request: approval timeout", {
					approvalId,
					actionId: request.actionId,
					timeoutMs: this.timeoutMs,
				});
				if (!this.webContents.isDestroyed()) {
					this.webContents.send(ACTION_APPROVAL_TIMEOUT_CHANNEL, { approvalId });
				}
				cancel(
					new ActionError(
						"ACTION_APPROVAL_TIMEOUT",
						"等待用户授权 Vetta action 超时。可能用户并不在线，你需要询问用户发生了什么情况",
						{
							actionId: request.actionId,
						},
					),
				);
			}, this.timeoutMs);

			if (signal?.aborted) {
				log.warn("request: signal already aborted", { actionId: request.actionId, approvalId });
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(approvalId, {
				actionId: request.actionId,
				approvalPresentation: request.approvalPresentation,
				startedAt,
				finish,
				cancel,
			});
			log.info("request: sent", {
				approvalId,
				actionId: request.actionId,
				approvalPresentation: request.approvalPresentation,
				expiresAt,
				timeoutMs: this.timeoutMs,
			});
			showMainWindow();
			this.webContents.send(ACTION_APPROVAL_REQUEST_CHANNEL, { approvalId, expiresAt, ...request });
		});
	}

	respond(approvalId: string, approved: boolean, input?: JsonValue): boolean {
		const pending = this.pending.get(approvalId);
		log.info("respond: received", {
			approvalId,
			actionId: pending?.actionId,
			approvalPresentation: pending?.approvalPresentation,
			approved,
			inputChanged: input !== undefined,
			pending: Boolean(pending),
			durationMs: pending ? Date.now() - pending.startedAt : undefined,
		});
		if (!pending) return false;
		pending.finish(input === undefined ? { approved } : { approved, input });
		return true;
	}

	cancelAll(): void {
		const count = this.pending.size;
		if (count > 0) {
			log.warn("cancelAll: cancelling pending approvals", { count });
		}
		for (const pending of this.pending.values()) {
			pending.cancel(new ActionError("ACTION_CANCELLED", "Vetta Desktop 授权请求已取消。"));
		}
		this.pending.clear();
	}

	dispose(): void {
		this.webContents.removeListener("render-process-gone", this.onRenderProcessGone);
		this.cancelAll();
	}
}
