import type { AbilityShowcase } from "@shared/lib/api";
import { renderAbilityShowcase } from "./templates/showcase-templates";

/**
 * `raw.detail.showcases`：结构化头图，由宿主呈现模板渲染（CSS 构图，非真实截图）。
 * 未知 template 直接跳过，保证服务端先行扩展不会炸客户端。
 */
export function AbilityShowcaseList({ showcases }: { showcases: AbilityShowcase[] }): JSX.Element | null {
	if (showcases.length === 0) return null;

	return (
		<div className="flex flex-col gap-4">
			{showcases.map((showcase, index) => renderAbilityShowcase(showcase, index))}
		</div>
	);
}
