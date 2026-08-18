import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { LoginPopover } from "@domains/auth/components/LoginPopover";
import { Popover, PopoverTrigger } from "@shared/components/ui/popover";
import { useThemeComponent } from "@vetta/theme-sdk";
import { SettingsMenuPopover } from "./SettingsMenuPopover";
import { SettingsMenuTrigger } from "./SettingsMenuTrigger";
import { useRefreshBillingOnOpen, useSettingsMenuModel } from "./useSettingsMenuModel";

export function SettingsMenu(): JSX.Element {
	const [open, setOpen] = useState(false);
	const model = useSettingsMenuModel(open, setOpen);
	const refreshBillingOnOpen = useRefreshBillingOnOpen();
	const ThemeSettingsMenuTrigger = useThemeComponent("sidebar.settingsTrigger", SettingsMenuTrigger);
	const ThemedLoginPopover = useThemeComponent("root.loginPopover", LoginPopover);

	const handleOpenChange = (next: boolean): void => {
		model.actions.setOpen(next);
		refreshBillingOnOpen(next, model.user !== null);
	};

	return (
		// min-w-0 w-full：底栏 flex 中昵称过长时可收缩，不把 MessageCenter 挤出
		<div className="min-w-0 w-full">
			<Popover open={open} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<ThemeSettingsMenuTrigger model={model} />
				</PopoverTrigger>
				<AnimatePresence>
					{open && <SettingsMenuPopover model={model} />}
				</AnimatePresence>
			</Popover>
			{/* 授权登录浮层：与设置菜单同锚在侧边栏底部，点「登录」后接替它显示 */}
			<ThemedLoginPopover />
		</div>
	);
}

