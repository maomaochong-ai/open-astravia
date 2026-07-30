import { Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";

export interface ActiveActionCapsule {
	id: string;
	label: string;
	icon?: ReactNode;
	onToggle: () => void;
}

export interface ActiveActionCapsulesProps {
	items: readonly ActiveActionCapsule[];
	/** 「点击移除」提示。 */
	removeHint: string;
	/** 折叠态的文案，如「3 个插件」。 */
	groupLabel: (count: number) => string;
}

/** 图标最多摞 4 格；超出时最后一格换成 `+n`，因此实际露脸的图标只有 3 个。 */
const MAX_STACK = 4;

const SOFT = { duration: 0.16, ease: [0.22, 0.61, 0.36, 1] as const };
const POP = { type: "spring" as const, stiffness: 520, damping: 34, mass: 0.7 };

/** 与执行模式（权限/沙箱）对齐的外观：h-7 / rounded-lg / 静默灰、hover 才上底色。 */
const CAPSULE_CLASS =
	"group flex h-7 min-w-0 shrink items-center gap-1 rounded-lg px-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground @[22rem]:gap-1.5 @[22rem]:px-2";

/**
 * 已激活的 input action（知识检索、插件开关）在工具栏里的常驻提示，
 * 紧跟在执行模式（权限/沙箱）右侧。
 *
 * 全量开关列表在命令面板里，但这些开关跨消息持续生效、还会随会话恢复，
 * 面板一关就完全不可见的话用户会忘记自己开着。
 *
 * 一个时平铺（图标 + 名称，hover 图标变关闭键，点一下即取消）；
 * 两个及以上折叠成一枚胶囊——工具栏是单行不换行的，平铺几个就把执行模式和模型挤没了。
 * 折叠态点开 popover 逐个关闭。
 */
export function ActiveActionCapsules({
	items,
	removeHint,
	groupLabel,
}: ActiveActionCapsulesProps): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<div className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden">
			{items.length === 1 && items[0] ? (
				<SingleCapsule item={items[0]} removeHint={removeHint} />
			) : (
				<GroupedCapsule items={items} removeHint={removeHint} groupLabel={groupLabel} />
			)}
		</div>
	);
}

function SingleCapsule({
	item,
	removeHint,
}: {
	item: ActiveActionCapsule;
	removeHint: string;
}): JSX.Element {
	return (
		<motion.div
			layout
			initial={{ opacity: 0, scale: 0.92 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={POP}
			title={item.label}
			className={CAPSULE_CLASS}
		>
			{/* 图标本身是取消按钮：hover 时原图标淡出、关闭图标淡入 */}
			<button type="button" onClick={item.onToggle} title={`${item.label} · ${removeHint}`} className="relative h-3.5 w-3.5 shrink-0">
				{item.icon ? (
					<span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
						{item.icon}
					</span>
				) : null}
				<span className="icon-[solar--close-circle-linear] absolute inset-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
			</button>
			{/* 与执行模式一致：窄容器只留图标，名称仍可由 title 悬停查看 */}
			<span className="hidden min-w-0 max-w-[6rem] truncate @[22rem]:inline">{item.label}</span>
		</motion.div>
	);
}

function GroupedCapsule({
	items,
	removeHint,
	groupLabel,
}: {
	items: readonly ActiveActionCapsule[];
	removeHint: string;
	groupLabel: (count: number) => string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const overflow = items.length > MAX_STACK ? items.length - (MAX_STACK - 1) : 0;
	const stacked = overflow > 0 ? items.slice(0, MAX_STACK - 1) : items;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<motion.button
					type="button"
					layout
					initial={{ opacity: 0, scale: 0.92 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={POP}
					title={groupLabel(items.length)}
					className={[CAPSULE_CLASS, open ? "bg-accent text-foreground" : ""].filter(Boolean).join(" ")}
				>
					{/* 摞在一起的图标：右边压左边，所以后面的要更低一层 */}
					<span className="flex shrink-0 items-center">
						<AnimatePresence initial={false}>
							{stacked.map((item, index) => (
								<motion.span
									key={item.id}
									layout
									initial={{ opacity: 0, scale: 0.6 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.6 }}
									transition={POP}
									style={{ zIndex: MAX_STACK - index }}
									className={`relative flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-card ${index === 0 ? "" : "-ml-1.5"}`}
								>
									<span className="flex h-3 w-3 items-center justify-center [&>*]:h-3 [&>*]:w-3">
										{item.icon}
									</span>
								</motion.span>
							))}
						</AnimatePresence>
						{overflow > 0 && (
							<motion.span
								layout
								initial={{ opacity: 0, scale: 0.6 }}
								animate={{ opacity: 1, scale: 1 }}
								transition={POP}
								className="relative -ml-1.5 flex h-[18px] items-center justify-center rounded-full border border-border bg-card px-1 text-[9px] font-semibold leading-none text-muted-foreground"
							>
								+{overflow}
							</motion.span>
						)}
					</span>
					<span className="hidden min-w-0 truncate @[22rem]:inline">{groupLabel(items.length)}</span>
				</motion.button>
			</PopoverTrigger>
			<AnimatePresence>
				{open && (
					<PopoverContent
						forceMount
						asChild
						side="top"
						align="start"
						sideOffset={6}
						className="w-[200px] overflow-hidden rounded-lg border border-border p-1"
						style={{ animation: "none" }}
					>
						<motion.div
							initial={{ opacity: 0, y: 4, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: 4, scale: 0.98 }}
							transition={SOFT}
						>
							<AnimatePresence initial={false}>
								{items.map((item) => (
									<motion.div
										key={item.id}
										layout
										initial={{ opacity: 0, height: 0 }}
										animate={{ opacity: 1, height: "auto" }}
										exit={{ opacity: 0, height: 0 }}
										transition={SOFT}
										className="overflow-hidden"
									>
										<div className="group/item flex items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent">
											<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground [&>*]:h-3.5 [&>*]:w-3.5">
												{item.icon}
											</span>
											<span className="min-w-0 flex-1 truncate">{item.label}</span>
											{/* 悬浮才露出关闭键，静默时这行只是一条状态提示 */}
											<button
												type="button"
												onClick={() => {
													// 关到只剩一个时 popover 自己收起：此时已经平铺可见，留着是空壳
													if (items.length <= 2) setOpen(false);
													item.onToggle();
												}}
												title={`${item.label} · ${removeHint}`}
												className="icon-[solar--close-circle-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/item:opacity-100"
											/>
										</div>
									</motion.div>
								))}
							</AnimatePresence>
						</motion.div>
					</PopoverContent>
				)}
			</AnimatePresence>
		</Popover>
	);
}
