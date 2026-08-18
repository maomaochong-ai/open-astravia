import {
	PetSettingsView as ThemePetSettingsView,
} from "@vetta/theme-ui/settings";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { PetBubbleStylePreview } from "./PetBubbleStylePreview";
import type { PetSettingsModel } from "./usePetSettingsModel";

export function PetSettingsView({ model }: { model: PetSettingsModel }): JSX.Element {
	return (
		<ThemePetSettingsView
			labels={model.labels}
			sections={{
				display: SETTINGS_SECTION["pet-display"],
				decoration: SETTINGS_SECTION["pet-decoration"],
				bubble: SETTINGS_SECTION["pet-bubble"],
				developer: SETTINGS_SECTION["pet-developer"],
			}}
			enabled={model.config.enabled}
			alwaysOnTop={model.config.alwaysOnTop}
			debugFrame={model.config.debugFrame}
			decorations={model.decorations}
			// 装饰分区暂时隐藏；组件、数据与注册项均保留，恢复时改回 true 即可。
			showDecorationSection={false}
			aiAssistSlot={<SettingsAiAssist tabId="pet" />}
			bubbleGrid={
				<div className="grid grid-cols-2 gap-3 p-4">
					{model.bubbleStyles.map((style) => (
						<PetBubbleStylePreview
							key={style.id}
							decorUrl={style.decorUrl}
							description={style.description}
							disabled={!model.config.enabled}
							label={style.label}
							onSelect={model.actions.changeBubbleStyle}
							selected={model.config.bubbleStyleId === style.id}
							styleId={style.id}
						/>
					))}
				</div>
			}
			onChangeEnabled={model.actions.changeEnabled}
			onChangeAlwaysOnTop={model.actions.changeAlwaysOnTop}
			onChangeDebugFrame={model.actions.changeDebugFrame}
		/>
	);
}
