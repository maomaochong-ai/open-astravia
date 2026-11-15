import { ModelSelect } from "@shared/components/ModelSelect";
import type { JSX } from "react";

export interface TeamMemberModelSelectorProps {
	readonly value: string | null;
	readonly reasoning?: string;
	readonly disabled?: boolean;
	readonly placeholder: string;
	readonly emptyLabel: string;
	readonly ariaLabel: string;
	readonly onChange: (value: string | null) => void;
	readonly onReasoningChange: (reasoning: string) => void;
}

/**
 * 团队成员模型。成员模型允许空值（跟随会话），所以不用会自动补默认值、并写入全局最近模型的
 * 输入栏选择器，而用同源的受控 ModelSelect。
 */
export function TeamMemberModelSelector({
	value,
	reasoning,
	disabled = false,
	placeholder,
	emptyLabel,
	ariaLabel,
	onChange,
	onReasoningChange,
}: TeamMemberModelSelectorProps): JSX.Element {
	return (
		<ModelSelect
			value={value}
			onChange={onChange}
			allowClear
			clearLabel={emptyLabel}
			ariaLabel={ariaLabel}
			disabled={disabled}
			placeholder={placeholder}
			triggerClassName="w-full"
			reasoning={{ value: reasoning, onChange: onReasoningChange }}
		/>
	);
}
