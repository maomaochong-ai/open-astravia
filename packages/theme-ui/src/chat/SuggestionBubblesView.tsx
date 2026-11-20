import { AnimatePresence, motion } from "motion/react";
import type { JSX } from "react";

export interface SuggestionBubblesViewProps {
	suggestions: readonly string[];
	/** 点条目本体 / 点「直接发送」的提示。 */
	sendTooltip: string;
	/** 点「编辑」的提示：把建议填进输入框再改。 */
	editTooltip: string;
	onSend: (text: string) => void;
	/**
	 * 把建议填进输入框让用户继续改。
	 *
	 * 预测内容常常只差几个字，只能「原样直发」会逼用户重新打一遍；悬停浮出「编辑」
	 * 就能先落到输入框里再改。
	 */
	onEdit: (text: string) => void;
}

const BUBBLE_INITIAL = { opacity: 0, y: 6 };
const BUBBLE_ANIMATE = { opacity: 1, y: 0 };
const BUBBLE_EXIT = { opacity: 0, y: 4 };
const SOFT = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

/**
 * 输入预测建议气泡：垂直排列 0-3 个。建议为空时仅渲染占位壳 + AnimatePresence。
 *
 * 两种用法并存：点条目本体 = 直接发送（保持原来的快捷路径）；悬停/聚焦时浮出两枚小按钮，
 * 分别是「直接发送」与「编辑」。浮在右侧而不是替换正文，正文宽度不变，鼠标移动时不会有
 * 文字重排的抖动。
 */
export function SuggestionBubblesView({
	suggestions,
	sendTooltip,
	editTooltip,
	onSend,
	onEdit,
}: SuggestionBubblesViewProps): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-3xl px-5">
			<div className="w-full">
				<AnimatePresence initial={false}>
					{suggestions.length > 0 && (
						<motion.div
							key="suggestion-bubbles"
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={SOFT}
							className="mt-3 flex flex-col items-start gap-1.5 overflow-hidden pt-1 pb-2"
						>
							{suggestions.map((s, i) => (
								<motion.div
									key={`${i}-${s}`}
									initial={BUBBLE_INITIAL}
									animate={BUBBLE_ANIMATE}
									exit={BUBBLE_EXIT}
									transition={{ ...SOFT, delay: i * 0.03 }}
									className="group/bubble flex max-w-full items-center gap-1"
								>
									<button
										type="button"
										onClick={() => onSend(s)}
										title={sendTooltip}
										className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent/60 hover:text-foreground"
									>
										<span className="icon-[solar--magic-stick-3-linear] h-3.5 w-3.5 shrink-0 text-primary/70" />
										<span className="truncate">{s}</span>
									</button>
									{/*
									 * 动作按钮常驻占位、只切透明度与宽度：出现/消失时不改变这行的高度，
									 * 相邻气泡不会跟着上下跳。
									 */}
									<span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/bubble:opacity-100 group-hover/bubble:opacity-100">
										<button
											type="button"
											onClick={() => onSend(s)}
											title={sendTooltip}
											aria-label={sendTooltip}
											className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
										>
											<span aria-hidden="true" className="icon-[solar--plain-2-linear] h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={() => onEdit(s)}
											title={editTooltip}
											aria-label={editTooltip}
											className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
										>
											<span aria-hidden="true" className="icon-[solar--pen-linear] h-3.5 w-3.5" />
										</button>
									</span>
								</motion.div>
							))}
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}
