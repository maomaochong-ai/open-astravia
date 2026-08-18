import type { AbilityShowcase } from "@shared/lib/api";
import { ShowcaseChatOverCanvas, ShowcaseChatThread } from "./templates/ShowcaseChatOverCanvas";

/**
 * `raw.detail.showcases`：结构化头图，由宿主呈现模板渲染（CSS 构图，非真实截图）。
 * 未知 template 直接跳过，保证服务端先行扩展不会炸客户端。
 */
export function AbilityShowcaseList({ showcases }: { showcases: AbilityShowcase[] }): JSX.Element | null {
	if (showcases.length === 0) return null;

	return (
		<div className="flex flex-col gap-4">
			{showcases.map((showcase, index) => {
				const key = `${showcase.template}-${index}`;
				if (showcase.template === "chat-over-canvas") {
					return (
						<ShowcaseChatOverCanvas
							key={key}
							userPrompt={showcase.user_prompt}
							assistantReply={showcase.assistant_reply}
							canvas={showcase.canvas ?? "generic"}
						/>
					);
				}
				if (showcase.template === "chat-thread") {
					return (
						<ShowcaseChatThread
							key={key}
							userPrompt={showcase.user_prompt}
							assistantReply={showcase.assistant_reply}
						/>
					);
				}
				return null;
			})}
		</div>
	);
}
