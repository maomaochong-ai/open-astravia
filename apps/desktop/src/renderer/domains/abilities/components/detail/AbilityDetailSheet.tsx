import { DetailDrawer } from "@vetta/theme-ui/overlays";
import { lazy, Suspense, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AbilitiesModel } from "../../types";
import { loadAbilityDetailView } from "./loadAbilityDetailView";

const AbilityDetailView = lazy(loadAbilityDetailView);

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

	return (
		<DetailDrawer
			open={detailId !== null}
			title={visibleItem ? visibleItem.title : t("detail.notFound")}
			description={visibleItem?.description ?? ""}
			onClose={onClose}
			onExited={onExited}
		>
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
		</DetailDrawer>
	);
}
