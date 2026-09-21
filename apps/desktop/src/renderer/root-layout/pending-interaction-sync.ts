/** 主进程持有的一类「等待用户处理」的请求；每个会话同一时刻至多一条。 */
export interface PendingInteraction {
	readonly requestId: string;
	readonly sessionId: string;
}

export interface PendingInteractionSource<Request extends PendingInteraction> {
	onRequest(handler: (request: Request) => void): () => void;
	onResolved(handler: (event: PendingInteraction) => void): () => void;
	listPending(): Promise<readonly Request[]>;
}

export type PendingInteractionUpdate<Request> = (previous: Record<string, Request>) => Record<string, Request>;

/**
 * 把主进程的待处理请求同步成「按 sessionId 索引」的 Renderer 状态。
 *
 * 主进程是真相源：先订阅增量事件、再读取快照，快照返回时用期间收到的事件修正它。
 * 这样窗口重载、晚打开的窗口以及由别处（远程、调试）解决的请求都会收敛到同一状态，
 * 不会出现快照把已解决的请求又放回面板的竞态。
 */
export function syncPendingInteractions<Request extends PendingInteraction>(
	source: PendingInteractionSource<Request>,
	apply: (update: PendingInteractionUpdate<Request>) => void,
	onSyncError: (error: unknown) => void,
): () => void {
	let active = true;
	const liveRequests = new Map<string, Request>();
	const resolvedRequestIds = new Set<string>();

	const unsubscribeRequest = source.onRequest((request) => {
		liveRequests.set(request.requestId, request);
		apply((previous) => ({ ...previous, [request.sessionId]: request }));
	});
	const unsubscribeResolved = source.onResolved((event) => {
		resolvedRequestIds.add(event.requestId);
		liveRequests.delete(event.requestId);
		apply((previous) => {
			if (previous[event.sessionId]?.requestId !== event.requestId) return previous;
			const next = { ...previous };
			delete next[event.sessionId];
			return next;
		});
	});

	void source
		.listPending()
		.then((snapshot) => {
			if (!active) return;
			const pendingByRequestId = new Map(snapshot.map((request) => [request.requestId, request]));
			for (const [requestId, request] of liveRequests) pendingByRequestId.set(requestId, request);
			for (const requestId of resolvedRequestIds) pendingByRequestId.delete(requestId);
			const next: Record<string, Request> = {};
			for (const request of pendingByRequestId.values()) next[request.sessionId] = request;
			apply(() => next);
		})
		.catch(onSyncError);

	return () => {
		active = false;
		unsubscribeRequest();
		unsubscribeResolved();
	};
}
