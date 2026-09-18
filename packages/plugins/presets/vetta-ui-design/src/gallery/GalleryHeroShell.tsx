import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect } from "react";

/**
 * 切页 transition 里 GalleryView 还在加载时的可见壳：只画标题，不拉风格墙、
 * 不扫项目。真正的 Hero 工具栏在 GalleryView 就绪后替换上来。
 *
 * 首帧提交后立刻预取 GalleryView / DesignSystemGrid chunk，不等第二道 rAF。
 * 项目扫描仍留给 GalleryView 的绘制门闩，避免和标题抢 IPC。
 */
export function GalleryHeroShell() {
	const { t } = useTranslation();
	useEffect(() => {
		void import("./GalleryView");
		void import("./DesignSystemGrid");
	}, []);
	return (
		<div className="relative flex h-full w-full flex-col overflow-hidden">
			<div className="vetd-gallery-scroll flex-1 overflow-y-auto overflow-x-hidden px-5 pb-8">
				<section className="vetd-hero relative isolate -mx-5 mb-7 overflow-hidden px-5 pb-6 pt-12">
					<h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
						{t("gallery.hero.title")}
					</h1>
				</section>
			</div>
		</div>
	);
}
