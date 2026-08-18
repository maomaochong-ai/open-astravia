import { useThemeComponent } from "@vetta/theme-sdk";
import { AppearancePickerApprovalView as ThemeAppearancePickerApprovalView } from "@vetta/theme-ui/action-approval";
import { AppearanceActionPicker } from "./AppearanceActionPicker";
import { AppearanceApprovalDrawerView } from "./AppearanceApprovalDrawerView";
import type { AppearancePickerApprovalModel } from "./useAppearancePickerApprovalModel";

export function AppearancePickerApprovalView(model: AppearancePickerApprovalModel): JSX.Element {
	const ThemedAppearanceApprovalDrawerView = useThemeComponent(
		"root.approval.appearanceDrawerView",
		AppearanceApprovalDrawerView,
	);

	return (
		<ThemeAppearancePickerApprovalView
			Drawer={ThemedAppearanceApprovalDrawerView}
			drawerProps={model.drawer}
			hasInput={model.hasInput}
			rawInput={model.rawInput}
			picker={
				<AppearanceActionPicker
					mode={model.mode}
					themeId={model.themeId}
					cursorStyle={model.cursorStyle}
					onModeChange={model.onModeChange}
					onThemeChange={model.onThemeChange}
					onCursorStyleChange={model.onCursorStyleChange}
				/>
			}
		/>
	);
}
