import { fetchUsageSeries, type UsageSeriesPoint } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/auth-atoms";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

/** 序列跨度：图表按月刻度铺满一年，统计的「累计」也取同一份数据。 */
const USAGE_SERIES_DAYS = 365;

/**
 * 同一份 /usage/me/series 被活动图和用量统计同时消费，用 token 维度的 promise 缓存
 * 保证两个组件同时挂载时只发一次请求。
 */
const inflight = new Map<string, Promise<UsageSeriesPoint[]>>();

function loadSeries(token: string): Promise<UsageSeriesPoint[]> {
	const hit = inflight.get(token);
	if (hit) return hit;
	const pending = fetchUsageSeries(token, USAGE_SERIES_DAYS)
		.then((series) => series.points ?? [])
		.catch(() => [] as UsageSeriesPoint[]);
	inflight.set(token, pending);
	return pending;
}

export interface UsageSeriesState {
	loading: boolean;
	points: UsageSeriesPoint[];
}

export function useUsageSeries(): UsageSeriesState & { token: string | null } {
	const token = useAtomValue(authTokenAtom);
	const [points, setPoints] = useState<UsageSeriesPoint[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!token) {
			setPoints([]);
			return;
		}
		let stale = false;
		setLoading(true);
		void loadSeries(token)
			.then((next) => {
				if (!stale) setPoints(next);
			})
			.finally(() => {
				if (!stale) setLoading(false);
			});
		return () => {
			stale = true;
		};
	}, [token]);

	return { loading, points, token };
}
