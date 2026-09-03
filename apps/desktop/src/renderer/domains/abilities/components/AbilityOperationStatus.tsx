import { cn } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import type { AbilityOperation } from "../types";

/** 列表与详情共用的异步操作反馈；文字同时作为 live region 与按钮可访问名称。 */
export function AbilityOperationStatus({
	operation,
	className,
	iconClassName,
}: {
	operation?: AbilityOperation;
	className?: string;
	iconClassName?: string;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5", className)}>
			<span
				aria-hidden="true"
				className={cn("icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin", iconClassName)}
			/>
			{operation ? t(`operation.${operation}`) : t("operation.processing")}
		</span>
	);
}
