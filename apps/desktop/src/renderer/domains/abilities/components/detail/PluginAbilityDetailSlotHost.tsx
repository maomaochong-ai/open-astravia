import { pluginAbilityDetailSlotsAtom } from "@shared/store/atoms";
import { Button } from "@shared/components/ui/button";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { PluginSlotErrorBoundary } from "../../../plugins/components/PluginSlotErrorBoundary";
import { PluginI18nBoundary } from "../../../plugins/runtime/plugin-i18n";
import type { AbilityItem } from "../../types";

export function PluginAbilityDetailSlotHost({
	item,
	onOpenPermissions,
}: {
	item: AbilityItem;
	onOpenPermissions: () => void;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const slots = useAtomValue(pluginAbilityDetailSlotsAtom).filter((slot) => slot.abilityId === item.slug);
	const needsDetailPermission =
		item.type === "plugin" &&
		item.installed &&
		item.enabled &&
		item.permissions.includes("ui.slot.ability-detail") &&
		!item.grantedPermissions.includes("ui.slot.ability-detail");
	if (slots.length === 0 && !needsDetailPermission) return null;
	return (
		<div className="flex flex-col gap-3 vetta-plugin-host" data-testid="plugin-ability-detail-slots">
			{needsDetailPermission ? (
				<div className="flex flex-wrap items-start gap-3 rounded-xl border border-border/50 bg-muted/40 p-4">
					<span aria-hidden="true" className="icon-[solar--shield-keyhole-linear] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					<div role="status" className="min-w-0 flex-1 basis-56">
						<p className="text-[13px] font-medium text-foreground">{t("permission.detailUnavailable.title")}</p>
						<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
							{t("permission.detailUnavailable.description")}
						</p>
					</div>
					<Button variant="secondary" size="sm" onClick={onOpenPermissions}>
						{t("permission.detailUnavailable.review")}
					</Button>
				</div>
			) : null}
			{slots.map((slot) => {
				const SlotComponent = slot.component;
				return (
					<PluginSlotErrorBoundary key={slot.id} pluginSlotId={slot.id}>
						<div className="vetta-plugin" data-vetta-plugin-slot={slot.id}>
							<PluginI18nBoundary pluginId={slot.pluginId}>
								<SlotComponent abilityId={item.slug} installed={item.installed} enabled={item.enabled} />
							</PluginI18nBoundary>
						</div>
					</PluginSlotErrorBoundary>
				);
			})}
		</div>
	);
}
