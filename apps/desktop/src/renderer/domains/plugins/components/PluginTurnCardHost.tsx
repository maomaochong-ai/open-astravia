import { currentScenarioAtom, pluginTurnCardsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { PluginI18nBoundary } from "../runtime/plugin-i18n";

class PluginTurnCardErrorBoundary extends Component<
	{ cardId: string; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error(`Plugin turn card failed: ${this.props.cardId}`, error, errorInfo.componentStack);
	}

	render(): ReactNode {
		if (this.state.failed) return null;
		return this.props.children;
	}
}

/**
 * 渲染消息列表底部的插件 turn 卡（不绑定 tool 调用）。每个 turn 卡组件零 props，
 * 自行用 SDK hooks（useActiveConversation / useConversationMessages /
 * conversation.on("turn-end")）读取上下文并决定可见性——不适用时自身 return null。
 * 这里仅按 scope_use 做 fail-closed 的会话场景过滤：scenario 未知或不在卡的
 * scope_use 内就不挂载（与活动面板标签卡、输入栏 toggle 同语义）。
 */
export function PluginTurnCardHost(): JSX.Element | null {
	const turnCards = useAtomValue(pluginTurnCardsAtom);
	const scenario = useAtomValue(currentScenarioAtom);

	const visible = turnCards.filter((card) => {
		const scope = card.scope_use;
		if (!scope || scope.length === 0) return false;
		return scenario !== null && scope.includes(scenario);
	});

	if (visible.length === 0) return null;

	return (
		<>
			{visible.map((card) => {
				const CardComponent = card.component;
				return (
					<PluginTurnCardErrorBoundary key={card.cardId} cardId={card.cardId}>
						<div className="contents vetta-plugin" data-vetta-plugin-turn-card={card.cardId}>
							<PluginI18nBoundary pluginId={card.pluginId}>
								<CardComponent />
							</PluginI18nBoundary>
						</div>
					</PluginTurnCardErrorBoundary>
				);
			})}
		</>
	);
}
