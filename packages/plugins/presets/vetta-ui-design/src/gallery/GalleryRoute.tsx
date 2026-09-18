import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { GalleryHeroShell } from "./GalleryHeroShell";

function loadGalleryView(): Promise<{ GalleryView: ComponentType }> {
	return import("./GalleryView");
}

/**
 * 工作区注册的必须是同步组件。React 19 把侧栏 navigate 放进 startTransition：
 * 新树里一旦有 React.lazy，即使包了 Suspense fallback，也会等 chunk 就绪才露出
 * 新页（实测 hash ~37ms、标题仍 ~330ms）。首帧只交同步薄壳；useEffect 里再
 * import GalleryView（不要 React.lazy），解析完成后才挂本体。切页过渡不再吃
 * 画廊 chunk。
 */
export function GalleryRoute() {
	const [View, setView] = useState<ComponentType | null>(null);
	const [error, setError] = useState<unknown>(null);

	useEffect(() => {
		if (View || error) return;
		let cancelled = false;
		void Promise.all([loadGalleryView(), import("./DesignSystemGrid")]).then(
			([mod]) => {
				if (!cancelled) setView(() => mod.GalleryView);
			},
			(reason: unknown) => {
				if (!cancelled) setError(reason);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [View, error]);

	if (error) throw error;
	if (!View) return <GalleryHeroShell />;
	return <View />;
}
