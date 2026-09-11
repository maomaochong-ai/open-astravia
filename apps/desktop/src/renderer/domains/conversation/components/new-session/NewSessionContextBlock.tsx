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
 * 多个贡献同时上屏时顶部出 tabbar；只有一个时直接渲染内容——为单个来源画一排 tab 是
 * 纯粹的噪音。
 */
export function NewSessionContextBlock({
	contexts,
	renderContext,
	hidden = false,
	className,
}: NewSessionContextBlockProps): JSX.Element | null {
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

	const activeIds = useMemo(() => contexts.map((entry) => entry.contribution.contextId), [contexts]);

	useEffect(() => {
		// 用户选中的 tab 不随打字跳走；只有它自己退出激活集合时才回落到第一个。
		setSelectedId((current) => (current && activeIds.includes(current) ? current : activeIds[0]));
	}, [activeIds]);

	if (hidden || contexts.length === 0) return null;

	const selected = contexts.find((entry) => entry.contribution.contextId === selectedId) ?? contexts[0];
	if (!selected) return null;

	return (
		<section
			data-new-session-context="true"
			className={cn("mt-3 w-full rounded-xl border border-border/50 bg-card/30", className)}
		>
			{contexts.length > 1 && (
				<div role="tablist" className="flex items-center gap-1 border-b border-border/40 px-2 py-1.5">
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
									"inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors",
									active
										? "bg-accent/60 text-foreground"
										: "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
								)}
							>
								{entry.contribution.icon}
								<span className="truncate">{entry.contribution.label}</span>
							</button>
						);
					})}
				</div>
			)}
			<div className="p-3">{renderContext(selected)}</div>
		</section>
	);
}
