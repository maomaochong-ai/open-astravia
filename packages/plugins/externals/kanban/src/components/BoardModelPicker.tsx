import { ModelPicker } from "@astravia-org/plugin-sdk";
import type { JSX } from "react";

export interface BoardModelPickerProps {
	/** 当前选择；空串表示「跟随默认」。 */
	readonly value: string;
	/** 空串表示用户选了「跟随默认」。 */
	readonly onChange: (modelKey: string) => void;
	/** 「跟随默认」这一项的文案（如「看板默认（Opus 5）」）。 */
	readonly inheritLabel: string;
	/** 打上「默认」徽章的模型 key（看板默认或宿主默认）。 */
	readonly defaultKey?: string;
	readonly ariaLabel: string;
	readonly className?: string;
}

/**
 * 看板的模型选择器：直接用宿主的那一个（`plugin-sdk` 的 `ModelPicker`），
 * 清单、分栏、收藏、搜索、模型详情与主题定制全部由宿主提供。
 *
 * 看板与宿主的差别只在语义层，且都在这一层适配掉：
 * - 宿主用 `null` 表示「不固定」，看板用空串表示「跟随默认」，进出都转换一次。
 * - 「跟随默认」是宿主的空值项（`emptyOption`），不再是混进模型列表的哨兵。
 * - 看板不按轮次调思考档位，因此不传 `reasoning`。
 */
export function BoardModelPicker({
	value,
	onChange,
	inheritLabel,
	defaultKey,
	ariaLabel,
	className,
}: BoardModelPickerProps): JSX.Element {
	return (
		<ModelPicker
			value={value || null}
			onChange={(modelKey) => onChange(modelKey ?? "")}
			emptyOption={{ label: inheritLabel }}
			placeholder={inheritLabel}
			{...(defaultKey ? { defaultModelKey: defaultKey } : {})}
			ariaLabel={ariaLabel}
			{...(className ? { className } : {})}
		/>
	);
}
