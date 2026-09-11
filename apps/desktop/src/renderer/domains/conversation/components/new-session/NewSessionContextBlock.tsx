import { PluginI18nBoundary, usePluginTextResolver } from "@domains/plugins/runtime/plugin-i18n";
import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ActiveNewSessionContext } from "./new-session-context-activation";

export interface NewSessionContextBlockProps {
	readonly contexts: readonly ActiveNewSessionContext[];
	/** 渲染单个贡献的内容；由容器注入，便于把上下文组装留在 model 层。 */
	readonly renderContext: (context: ActiveNewSessionContext) => ReactNode;
	/** 命令面板展开时让位：那是打断式交互，此刻资源列表没有意义。 */
	readonly hidden?: boolean;
	readonly className?: string;
}

/**
 * 新会话页输入框下方的插件上下文区。
 *
 * 宿主这一层不画卡片：这块区域紧贴输入框，再套一个描边盒子就成了「框里还有框」。留白
 * 和内容自身的层次足够把它和输入框分开，边框只会把注意力从内容上引开。
 *
 * 多个贡献同时上屏时顶部出一排轻量 tab；只有一个时连 tab 都不出——为单一来源画一排
 * 标签是纯粹的噪音。
 */
export function NewSessionContextBlock({
	contexts,
	renderContext,
	hidden = false,
	className,
}: NewSessionContextBlockProps): JSX.Element | null {
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const resolvePluginText = usePluginTextResolver();

	const activeIds = useMemo(() => contexts.map((entry) => entry.contribution.contextId), [contexts]);

	useEffect(() => {
		// 用户选中的 tab 不随打字跳走；只有它自己退出激活集合时才回落到第一个。
		setSelectedId((current) => (current && activeIds.includes(current) ? current : activeIds[0]));
	}, [activeIds]);

	if (hidden || contexts.length === 0) return null;

	const selected = contexts.find((entry) => entry.contribution.contextId === selectedId) ?? contexts[0];
	if (!selected) return null;

	return (
		<section data-new-session-context="true" className={cn("mt-5 w-full", className)}>
			{contexts.length > 1 && (
				<div role="tablist" className="mb-2.5 flex items-center gap-1">
					{contexts.map((entry) => {
						const active = entry.contribution.contextId === selected.contribution.contextId;
						return (
							<button
								key={entry.contribution.contextId}
								type="button"
								role="tab"
								aria-selected={active}
								onClick={() => setSelectedId(entry.contribution.contextId)}
								className={cn(
									"inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors",
									active
										? "bg-accent/50 text-foreground"
										: "text-muted-foreground/70 hover:bg-accent/25 hover:text-foreground",
								)}
							>
								{entry.contribution.icon}
								<span className="truncate">
									{/* 标签由插件提供，多半是 `%key%`：交给插件语料现场解析，切语言才跟得上。 */}
									{resolvePluginText(entry.contribution.pluginId, entry.contribution.label)}
								</span>
							</button>
						);
					})}
				</div>
			)}
			{/* 插件组件由宿主渲染，必须套上这层边界：`useTranslation()` 要靠它找到插件自己的
			    语料，插件 CSS 的 @scope 也认这个 data 属性，否则文案退化成 key、样式全丢。 */}
			<PluginI18nBoundary pluginId={selected.contribution.pluginId}>{renderContext(selected)}</PluginI18nBoundary>
		</section>
	);
}
