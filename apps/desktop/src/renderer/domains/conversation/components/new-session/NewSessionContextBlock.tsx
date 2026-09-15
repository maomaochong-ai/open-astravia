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
 * 宽度由贡献自己声明：画廊类内容压在输入框宽度里，每一项都会小到看不清，所以 `wide`
 * 直接铺满页面可用宽度。
 *
 * 多个贡献同时上屏时顶部出一排轻量 tab，固定在输入框宽度内左对齐，不随内容宽度移动；
 * 只有一个时连 tab 都不出——为单一来源画一排标签是纯粹的噪音。
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
		<section
			data-new-session-context="true"
			data-width={selected.contribution.width}
			className={cn("mt-5 w-full", className)}
		>
			{/* tab 栏钉在输入框宽度里，左缘压着输入框卡片左缘：它是输入框的附属控件，
			    不能跟着内容宽度一会儿在输入框下、一会儿跑到页面边上，切 tab 时手要追着它走。 */}
			{contexts.length > 1 && (
				<div role="tablist" className="mx-auto mb-2.5 flex w-full max-w-2xl items-center gap-1">
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
			<div
				data-new-session-context-body="true"
				className={cn(
					"mx-auto w-full",
					// 宽度跟着当前选中的贡献走，而不是排第一的那个：几个贡献宽度声明不同时，
					// 切到 `wide` 的那栏就该铺开，切回 `input` 的那栏就该收回输入框宽度。
					// `wide`（画廊、素材墙）占页面宽度的八成：压回输入框那 672px，每一项都会
					// 小到看不清。八成只在宽屏成立——窄窗口上两侧各让出一成等于把本来就不够的
					// 宽度再砍一刀，所以窄屏铺满。
					selected.contribution.width === "wide" ? "max-w-none md:w-11/12 xl:w-4/5" : "max-w-2xl",
				)}
			>
				{/* 插件组件由宿主渲染，必须套上这层边界：`useTranslation()` 要靠它找到插件自己的
				    语料，插件 CSS 的 @scope 也认这个 data 属性，否则文案退化成 key、样式全丢。 */}
				<PluginI18nBoundary pluginId={selected.contribution.pluginId}>{renderContext(selected)}</PluginI18nBoundary>
			</div>
		</section>
	);
}
