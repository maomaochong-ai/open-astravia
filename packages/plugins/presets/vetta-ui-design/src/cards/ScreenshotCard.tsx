import type { PluginCardProps } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { getPluginCtx } from "../plugin-context";
import { ScreenshotSwiper } from "./ScreenshotSwiper";
import type { ScreenshotCardPayload } from "./screenshot-card";
import { listSnapshots, type Snapshot } from "./snapshots";

// 消息列表是虚拟化的：卡片滚出视野会卸载、滚回来会重挂载。没有缓存的话重挂载要先渲染
// 空态再等目录扫描回来，卡片高度会跳一下；用缓存同步画出上次的结果，扫描只做对账。
const snapshotCache = new Map<string, Snapshot[]>();

interface SnapshotsState {
	readonly snapshots: Snapshot[];
	/** 当前这轮（目录 + frame + pending）的扫描还没回来。 */
	readonly scanning: boolean;
}

function useSnapshots(dirPath: string | undefined, frameId: string | undefined, pending: boolean): SnapshotsState {
	const cacheKey = dirPath && frameId ? `${dirPath}#${frameId}` : "";
	const [snapshots, setSnapshots] = useState<Snapshot[]>(() => snapshotCache.get(cacheKey) ?? []);
	// 扫描按 (cacheKey, pending) 一轮轮触发，完成的那一轮记在这里。
	// 「有没有扫描在途」必须在 render 期就能算出来，不能等 effect 再 setState：
	// pending 落定的那一帧若先按「没有截图」渲染成 null，卡片区这一帧就已经塌了。
	const [scannedToken, setScannedToken] = useState<string | null>(null);
	const token = `${cacheKey}|${pending}`;

	// pending 落定（截图写盘完成）时重扫，把新版本接上。
	useEffect(() => {
		if (!dirPath || !frameId) {
			setSnapshots([]);
			setScannedToken(token);
			return;
		}
		const cached = snapshotCache.get(cacheKey);
		if (cached) setSnapshots(cached);
		let cancelled = false;
		void listSnapshots(getPluginCtx().fs, dirPath, frameId)
			.then((found) => {
				if (cancelled) return;
				// 截图只增不减（pruneSnapshots 也永远保留最新的若干版），所以「扫出空」
				// 只可能是截图还没落盘的竞态——不能拿它覆盖已经展示出来的版本。
				const previous = snapshotCache.get(cacheKey);
				const next = found.length === 0 && previous && previous.length > 0 ? previous : found;
				snapshotCache.set(cacheKey, next);
				setSnapshots(next);
				setScannedToken(token);
			})
			.catch(() => {
				if (cancelled) return;
				if (!cached) setSnapshots([]);
				setScannedToken(token);
			});
		return () => {
			cancelled = true;
		};
	}, [cacheKey, dirPath, frameId, token]);

	return { snapshots, scanning: cacheKey !== "" && scannedToken !== token };
}

/** 一个 frame 的截图卡：历史版本横排（最新在左），截图进行中最前面占一个骨架位。 */
export function ScreenshotCard({ descriptor, pending }: PluginCardProps) {
	const payload = (descriptor.payload ?? {}) as Partial<ScreenshotCardPayload>;
	const { snapshots, scanning } = useSnapshots(payload.dirPath, payload.frameId, pending);
	// 扫描在途时保留骨架位。卡片区一旦塌成 0 再弹回来，虚拟列表的总高度就跟着一缩一涨，
	// 整页会剧烈上下弹跳——窄屏下卡片占视口比例更大，更明显。
	const placeholder = pending || (scanning && snapshots.length === 0);
	if (snapshots.length === 0 && !placeholder) return null;
	return <ScreenshotSwiper snapshots={snapshots} leadingSkeleton={placeholder} />;
}
