import type { ModelSelectorTriggerVariant } from "@astravia-org/theme-ui/chat";
import { ModelSelectorView } from "@astravia-org/theme-ui/chat";
import { useThemeComponent } from "@astravia-org/theme-sdk";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type ModelPickerReasoning, useModelPickerModel } from "./useModelPickerModel";
import type { ModelOption } from "./useModelOptions";

/** Optional reasoning-level column for a model picker. Controlled by the caller. */
export type ModelSelectReasoning = ModelPickerReasoning;

export interface ModelSelectProps {
	value: string | null;
	onChange: (key: string | null) => void;
	/** Show an explicit "unset" entry so the selection can be cleared */
	allowClear?: boolean;
	clearLabel?: string;
	ariaLabel?: string;
	disabled?: boolean;
	placeholder?: string;
	/** Extra classes for the trigger button (sizing/shape per call site) */
	triggerClassName?: string;
	/** Extra classes for the popup menu (e.g. a higher z-index inside a raised overlay) */
	menuClassName?: string;
	/** 触发器形态；表单里默认 `field`（带边框的选择框）。 */
	variant?: ModelSelectorTriggerVariant;
	/** 打「默认」徽章的模型；缺省为全局默认模型。 */
	defaultKey?: string;
	/** When value is empty, auto-apply the configured default model once */
	autoSelectDefault?: boolean;
	/** Fires whenever the resolved selected option changes (load + change) */
	onSelectedOptionChange?: (option: ModelOption | null) => void;
	/** When set, adds a reasoning-level column for the selected model. */
	reasoning?: ModelSelectReasoning;
}

/**
 * 宿主的模型选择器：与输入栏同一套面板（三栏、搜索、收藏、模型详情、推理档位）。
 *
 * 数据装配在 `useModelPickerModel`，这里只决定触发器形态并把解析出的选中项回报给调用方；
 * 设置页、定时任务、知识库、批量任务与插件（经 host bridge）都用它，因此各处的
 * 「选一个模型」是同一副样子。
 */
export function ModelSelect({
	value,
	onChange,
	allowClear = false,
	clearLabel,
	ariaLabel,
	disabled = false,
	placeholder,
	triggerClassName,
	menuClassName,
	variant = "field",
	defaultKey,
	autoSelectDefault = false,
	onSelectedOptionChange,
	reasoning,
}: ModelSelectProps): JSX.Element {
	const { t } = useTranslation("common");
	const ThemedModelSelectorView = useThemeComponent("chat.modelSelectorView", ModelSelectorView);
	const emptyLabel = allowClear ? (clearLabel ?? t("modelSelect.unset")) : undefined;
	const emptyOption = useMemo(() => (emptyLabel === undefined ? undefined : { label: emptyLabel }), [emptyLabel]);
	const model = useModelPickerModel({
		value,
		// 值写回由调用方决定；这里只把目录里的真实选中项一并交出去。
		onChange: (key) => onChange(key),
		...(reasoning ? { reasoning } : {}),
		...(emptyOption ? { emptyOption } : {}),
		...(placeholder ? { placeholder } : {}),
		...(defaultKey ? { defaultKey } : {}),
		autoSelectDefault,
	});

	// Surface the resolved selected option to consumers (e.g. image support).
	const onSelectedOptionChangeRef = useRef(onSelectedOptionChange);
	onSelectedOptionChangeRef.current = onSelectedOptionChange;
	const optionCount = model.options.length;
	useEffect(() => {
		if (optionCount === 0) return;
		onSelectedOptionChangeRef.current?.(model.catalogOption);
	}, [model.catalogOption, optionCount]);

	if (model.empty) return <></>;
	return (
		<ThemedModelSelectorView
			{...model.viewProps}
			ariaLabel={ariaLabel}
			disabled={disabled}
			triggerVariant={variant}
			classNames={{ trigger: triggerClassName, content: menuClassName }}
		/>
	);
}
