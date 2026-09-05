import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@vetta/ui";
import { lazy, Suspense, useCallback, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { AbilitiesModel } from "../../types";
import { shouldCloseAbilityDetailDrawer } from "./ability-detail-modal-guard";
import { loadAbilityDetailView } from "./loadAbilityDetailView";

const AbilityDetailView = lazy(loadAbilityDetailView);

/** 窄于此宽度改为从底部弹出：右侧抽屉占 60% 时剩余列表已不足以阅读。 */
const NARROW_VIEWPORT_QUERY = "(max-width: 768px)";

function useNarrowViewport(): boolean {
	const subscribe = useCallback((onChange: () => void) => {
		const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);
	return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW_VIEWPORT_QUERY).matches);
}

/**
 * 能力详情：能力页右侧滑出的抽屉，由来源感知的 `?detail=<catalog-id>` 驱动。
 * 复用页面的 model 实例，安装/启停结果直接反映到身后的列表。
 */
export function AbilityDetailSheet({
	detailId,
	model,
	onClose,
	onExited,
}: {
	detailId: string | null;
	model: AbilitiesModel;
	onClose: () => void;
	onExited?: () => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const item = detailId ? model.findById(detailId) : null;
	const lastItemRef = useRef(item);
	if (item) lastItemRef.current = item;
	const visibleItem = item ?? lastItemRef.current;
	const narrow = useNarrowViewport();
	const open = detailId !== null;

	return (
		<Drawer
			direction={narrow ? "bottom" : "right"}
			open={open}
			onAnimationEnd={(open) => {
				if (!open && detailId === null) onExited?.();
			}}
			onOpenChange={(next) => {
				if (shouldCloseAbilityDetailDrawer(next, document)) onClose();
			}}
		>
			{/* 宽屏右侧占 60vw，窄屏改为底部弹出占 85vh；宽高都用百分比跟随窗口 */}
			<DrawerContent
				overlayClassName={open ? undefined : "!pointer-events-none"}
				className="flex flex-col border-l-0 outline-none focus-visible:outline-none data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:h-[85vh] data-[vaul-drawer-direction=bottom]:max-h-[85vh] data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:max-h-screen data-[vaul-drawer-direction=right]:w-[60vw] data-[vaul-drawer-direction=right]:sm:max-w-none"
			>
				{/* 标题由详情正文自己呈现，这里只喂无障碍读屏 */}
				<DrawerTitle className="sr-only">{visibleItem ? visibleItem.title : t("detail.notFound")}</DrawerTitle>
				<DrawerDescription className="sr-only">{visibleItem?.description ?? ""}</DrawerDescription>

				{visibleItem ? (
					<div className="min-h-0 flex-1 overflow-hidden">
						<Suspense
							fallback={
								<div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
									<span className="icon-[solar--refresh-linear] h-6 w-6 animate-spin" />
									<span className="text-[12px]">{t("loading")}</span>
								</div>
							}
						>
							<AbilityDetailView item={visibleItem} model={model} onBack={onClose} />
						</Suspense>
					</div>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
						{model.loading ? (
							<span className="icon-[solar--refresh-linear] h-8 w-8 animate-spin text-muted-foreground/60" />
						) : (
							<>
								<span className="icon-[solar--ghost-linear] h-10 w-10 text-muted-foreground/50" />
								<p className="text-[13px] text-muted-foreground/70">{t("detail.notFound")}</p>
							</>
						)}
					</div>
				)}
			</DrawerContent>
		</Drawer>
	);
}
