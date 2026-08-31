import { hostApi } from "@shared/host-api";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentTracePage } from "@/shared/agent-traces";

export function useAgentTraces(sessionId: string, errorsOnly: boolean, turnId: string) {
	const [page, setPage] = useState<AgentTracePage | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [version, setVersion] = useState(0);
	const request = useMemo(
		() => ({ sessionId, errorsOnly, turnId, version }),
		[sessionId, errorsOnly, turnId, version],
	);
	const currentRequest = useRef<typeof request | null>(null);
	useEffect(() => {
		currentRequest.current = request;
		setLoading(true);
		setError(false);
		setPage(null);
		void hostApi.agentTraces
			.query({
				sessionId: request.sessionId,
				errorsOnly: request.errorsOnly,
				...(request.turnId.trim() ? { turnId: request.turnId.trim() } : {}),
			})
			.then((result) => {
				if (currentRequest.current === request) setPage(result);
			})
			.catch(() => {
				if (currentRequest.current === request) setError(true);
			})
			.finally(() => {
				if (currentRequest.current === request) setLoading(false);
			});
		return () => {
			currentRequest.current = null;
		};
	}, [request]);
	const loadMore = async () => {
		if (loading || !page?.nextCursor) return;
		const current = currentRequest.current;
		setLoading(true);
		setError(false);
		try {
			const result = await hostApi.agentTraces.query({
				sessionId,
				errorsOnly,
				...(turnId.trim() ? { turnId: turnId.trim() } : {}),
				cursor: page.nextCursor,
			});
			if (currentRequest.current === current)
				setPage({
					...result,
					records: [
						...new Map([...page.records, ...result.records].map((record) => [record.id, record])).values(),
					],
				});
		} catch {
			if (currentRequest.current === current) setError(true);
		} finally {
			if (currentRequest.current === current) setLoading(false);
		}
	};
	return { page, loading, error, loadMore, refresh: () => setVersion((value) => value + 1) };
}
