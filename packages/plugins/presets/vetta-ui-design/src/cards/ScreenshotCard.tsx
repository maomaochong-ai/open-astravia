import type { PluginCardProps } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { getPluginCtx } from "../plugin-context";
import { ScreenshotSwiper } from "./ScreenshotSwiper";
import type { ScreenshotCardPayload } from "./screenshot-card";
import { listSnapshots, type Snapshot } from "./snapshots";

// 消息列表是虚拟化的：卡片滚出视野会卸载、滚回来会重挂载。没有缓存的话重挂载要先渲染
// 空态再等目录扫描回来，卡片高度会跳一下；用缓存同步画出上次的结果，扫描只做对账。
const snapshotCache = new Map<string, Snapshot[]>();

function useSnapshots(dirPath: string | undefined, frameId: string | undefined, pending: boolean): Snapshot[] {
	const cacheKey = dirPath && frameId ? `${dirPath}#${frameId}` : "";
	const [snapshots, setSnapshots] = useState<Snapshot[]>(() => snapshotCache.get(cacheKey) ?? []);

	// pending 落定（截图写盘完成）时重扫，把新版本接上。
	useEffect(() => {
		if (!dirPath || !frameId) {
			setSnapshots([]);
			return;
		}
		const cached = snapshotCache.get(cacheKey);
		if (cached) setSnapshots(cached);
		let cancelled = false;
		void listSnapshots(getPluginCtx().fs, dirPath, frameId)
			.then((found) => {
				snapshotCache.set(cacheKey, found);
				if (!cancelled) setSnapshots(found);
			})
			.catch(() => {
				if (!cancelled && !cached) setSnapshots([]);
			});
		return () => {
			cancelled = true;
		};
	}, [cacheKey, dirPath, frameId, pending]);

	return snapshots;
}

/** 一个 frame 的截图卡：历史版本横排（最新在左），截图进行中最前面占一个骨架位。 */
export function ScreenshotCard({ descriptor, pending }: PluginCardProps) {
	const payload = (descriptor.payload ?? {}) as Partial<ScreenshotCardPayload>;
	const snapshots = useSnapshots(payload.dirPath, payload.frameId, pending);
	if (snapshots.length === 0 && !pending) return null;
	return <ScreenshotSwiper snapshots={snapshots} leadingSkeleton={pending} />;
}
