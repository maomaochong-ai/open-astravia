import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SettingsMenuSettingsItem } from "@vetta/theme-ui/sidebar";
import { PopoverContent } from "@vetta/ui";
import type { SettingsMenuModel } from "./types";
import { SettingsMenuAccountSection } from "./SettingsMenuAccountSection";
import { SettingsMenuAgentModeSection } from "./SettingsMenuAgentModeSection";
import { SettingsMenuDivider } from "./SettingsMenuDivider";
import { SettingsMenuQuotaSection } from "./SettingsMenuQuotaSection";
import { SettingsMenuThemeSection } from "./SettingsMenuThemeSection";

interface SettingsMenuPopoverProps {
	model: SettingsMenuModel;
}

export function SettingsMenuPopover({ model }: SettingsMenuPopoverProps): JSX.Element {
	return (
		<PopoverContent
			forceMount
			asChild
			side="top"
			align="start"
			sideOffset={6}
			className="w-[180px] gap-0 overflow-hidden rounded-lg border border-border p-1"
			style={{ animation: "none" }}
		>
			<motion.div
				initial={{ opacity: 0, scale: 0.96, y: 8 }}
				animate={{ opacity: 1, scale: 1, y: 0 }}
				exit={{ opacity: 0, scale: 0.96, y: 8 }}
				transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
			>
				<SettingsMenuAgentModeSection />
				<SettingsMenuDivider />
				<SettingsMenuThemeSection model={model} />
				<SettingsMenuQuotaSection model={model} />
				<SettingsMenuDivider />
				<SettingsMenuAccountSection model={model} />
				<SettingsMenuDivider />
				<SettingsMenuSettingsItemHost model={model} />
			</motion.div>
		</PopoverContent>
	);
}

function SettingsMenuSettingsItemHost({ model }: { model: SettingsMenuModel }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<SettingsMenuSettingsItem label={t("sidebar.settings")} onOpenSettings={model.actions.openSettings} />
	);
}
