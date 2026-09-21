import type {
	CodingAgentPlanReviewRequest,
	CodingAgentPlanReviewResult,
} from "@vetta/coding-agent/function-extensions";

/** Renderer 侧审批面板的接入点；窗口重建时可替换，挂起的审批不随之丢失。 */
export interface DesktopPlanReviewPresenter {
	present(request: CodingAgentPlanReviewRequest): void;
	resolved(event: { readonly requestId: string; readonly sessionId: string }): void;
}

const CANCELLED: CodingAgentPlanReviewResult = { decision: "cancelled" };
/** 与输入框同量级的上限：审批意见是给模型的一段话，不是附件通道。 */
const MAX_FEEDBACK_LENGTH = 20_000;
const MAX_PLAN_LENGTH = 200_000;

interface PendingReview {
	readonly request: CodingAgentPlanReviewRequest;
	finish(result: CodingAgentPlanReviewResult): void;
}

/** 拥有「计划等待审批」的生命周期：挂起、应答、中断与窗口失效都在这里收口。 */
export class DesktopPlanReviewBroker {
	private presenter: DesktopPlanReviewPresenter | undefined;
	private readonly pending = new Map<string, PendingReview>();

	readonly handle = (
		request: CodingAgentPlanReviewRequest,
		signal?: AbortSignal,
	): Promise<CodingAgentPlanReviewResult> => {
		const presenter = this.presenter;
		if (signal?.aborted || !presenter) return Promise.resolve(CANCELLED);
		return new Promise<CodingAgentPlanReviewResult>((resolve) => {
			const onAbort = (): void => finish(CANCELLED);
			const finish = (result: CodingAgentPlanReviewResult): void => {
				if (this.pending.get(request.requestId)?.request !== request) return;
				this.pending.delete(request.requestId);
				signal?.removeEventListener("abort", onAbort);
				resolve(result);
				this.presenter?.resolved({ requestId: request.requestId, sessionId: request.sessionId });
			};
			this.pending.set(request.requestId, { request, finish });
			signal?.addEventListener("abort", onAbort, { once: true });
			presenter.present(request);
		});
	};

	isAvailable(): boolean {
		return this.presenter !== undefined;
	}

	listPending(): CodingAgentPlanReviewRequest[] {
		return [...this.pending.values()].map(({ request }) => request);
	}

	/** Renderer 的应答是不可信输入：结构不合法一律按「未决定」处理，闸门保持关闭。 */
	respond(requestId: string, result: unknown): void {
		this.pending.get(requestId)?.finish(normalizePlanReviewResult(result));
	}

	/** 渲染进程失效或窗口销毁：没有人能再做决定。 */
	cancelAll(): void {
		for (const review of [...this.pending.values()]) review.finish(CANCELLED);
	}

	setPresenter(presenter: DesktopPlanReviewPresenter): () => void {
		this.presenter = presenter;
		return () => {
			if (this.presenter === presenter) this.presenter = undefined;
		};
	}
}

export function normalizePlanReviewResult(value: unknown): CodingAgentPlanReviewResult {
	if (typeof value !== "object" || value === null) return CANCELLED;
	const { decision, plan, feedback } = value as { decision?: unknown; plan?: unknown; feedback?: unknown };
	const editedPlan =
		typeof plan === "string" && plan.trim().length > 0 && plan.length <= MAX_PLAN_LENGTH ? { plan } : {};
	if (decision === "approve") return { decision, ...editedPlan };
	if (decision === "revise") {
		return {
			decision,
			feedback: typeof feedback === "string" ? feedback.slice(0, MAX_FEEDBACK_LENGTH) : "",
			...editedPlan,
		};
	}
	return CANCELLED;
}

const sharedPlanReviewBroker = new DesktopPlanReviewBroker();

export function getDesktopPlanReviewBroker(): DesktopPlanReviewBroker {
	return sharedPlanReviewBroker;
}
