import { ModelSelect } from "@shared/components/ModelSelect";
import { reasoningByModelAtom } from "@shared/store/atoms";
import { SettingRow, SettingSection } from "@astravia-org/theme-ui/settings";
import { useAtom } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

/**
 * 默认模型：新会话、定时任务等没有显式选模型时使用。
 *
 * 选择器与输入栏同源，预设与自定义服务商一视同仁——原先只有自定义服务商的模型行能设星标，
 * 预设服务商没有入口，两处对不上。
 */
export function ModelsDefaultModelSection({ model }: { model: ModelsSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	// 档位与输入栏共用「按模型记忆」的那份：这里改了，新会话发消息时就按这个档位走。
	const [reasoningByModel, setReasoningByModel] = useAtom(reasoningByModelAtom);
	const defaultModel = model.config?.defaultModel;
	const reasoning = useMemo(
		() => ({
			value: defaultModel ? reasoningByModel[defaultModel] : undefined,
			onChange: (level: string) => {
				if (defaultModel) setReasoningByModel({ ...reasoningByModel, [defaultModel]: level });
			},
		}),
		[defaultModel, reasoningByModel, setReasoningByModel],
	);

	return (
		<SettingSection
			title={t("section_models-default")}
			section={SETTINGS_SECTION["models-default"]}
			description={t("defaultModelSection.description")}
		>
			<SettingRow
				title={t("defaultModelSection.rowTitle")}
				description={t("defaultModelSection.rowDescription")}
				border={false}
			>
				<ModelSelect
					value={model.config?.defaultModel ?? null}
					onChange={(key) => void model.onChangeDefaultModel(key)}
					allowClear
					reasoning={reasoning}
					clearLabel={t("defaultModelSection.unset")}
					ariaLabel={t("defaultModelSection.rowTitle")}
				/>
			</SettingRow>
		</SettingSection>
	);
}
