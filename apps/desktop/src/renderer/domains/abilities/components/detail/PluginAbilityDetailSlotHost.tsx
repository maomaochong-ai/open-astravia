import { pluginAbilityDetailSlotsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { PluginSlotErrorBoundary } from "../../../plugins/components/PluginSlotErrorBoundary";
import { PluginI18nBoundary } from "../../../plugins/runtime/plugin-i18n";
import type { AbilityItem } from "../../types";

export function PluginAbilityDetailSlotHost({ item }: { item: AbilityItem }): JSX.Element | null {
	const slots = useAtomValue(pluginAbilityDetailSlotsAtom).filter((slot) => slot.abilityId === item.slug);
	if (slots.length === 0) return null;
	return (
		<div className="flex flex-col gap-3 vetta-plugin-host" data-testid="plugin-ability-detail-slots">
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
