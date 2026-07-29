import { useThemeSurface } from "@vetta/theme-sdk";
import { AnimatePresence, motion } from "motion/react";
import type { JSX, ReactNode } from "react";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface InputActionBarItemView {
	readonly active: boolean;
	readonly icon?: ReactNode;
	readonly id: string;
	readonly label: string;
}

export interface InputActionBarViewModel {
	readonly actions: {
		readonly toggleItem: (id: string) => void;
		readonly toggleKnowledge: () => void;
	};
	readonly items: readonly InputActionBarItemView[];
	readonly knowledge: {
		readonly active: boolean;
		readonly label: string;
		readonly tooltip: string;
	} | null;
}

export interface InputActionBarViewProps {
	readonly className?: string;
	readonly model: InputActionBarViewModel;
}

export function InputActionBarView({ className, model }: InputActionBarViewProps): JSX.Element {
	const surface = useThemeSurface("chat.inputActionBar");

	return (
		<motion.div
			initial={{ y: "-100%", opacity: 0 }}
			animate={{ y: 0, opacity: 1 }}
			transition={{ type: "spring", stiffness: 440, damping: 36, mass: 0.9 }}
			className={cn(
				// 单行：窄宽隐藏文案只留图标，避免阶梯区折行
				"input-ledge relative z-0 mx-auto flex w-[93%] flex-nowrap gap-0.5 overflow-x-auto rounded-b-[14px] bg-card/70 px-3 pt-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
				surface?.rootClassName,
				className,
			)}
			data-theme-surface-root="chat.inputActionBar"
		>
			<AnimatePresence initial={false}>
				{model.knowledge ? (
					<motion.button
						key="__builtin_knowledge_retrieval__"
						type="button"
						layout
						initial={{ scale: 0.7, opacity: 0, y: -6 }}
						animate={{ scale: 1, opacity: 1, y: 0 }}
						exit={{ scale: 0.7, opacity: 0, y: -4 }}
						transition={{ type: "spring", stiffness: 520, damping: 30 }}
						whileTap={{ scale: 0.95 }}
						onClick={model.actions.toggleKnowledge}
						title={model.knowledge.tooltip}
						className={cn(
							"flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-[12px] font-medium transition-colors",
							model.knowledge.active
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
						)}
					>
						<motion.span
							className="icon-[mdi--book-search-outline] flex h-3.5 w-3.5 items-center justify-center"
							animate={model.knowledge.active ? { rotate: [0, -8, 8, 0] } : { rotate: 0 }}
							transition={{ duration: 0.4 }}
						/>
						<span className="hidden @[22rem]:inline">{model.knowledge.label}</span>
					</motion.button>
				) : null}
				{model.items.map((item, index) => (
					<motion.button
						key={item.id}
						type="button"
						layout
						initial={{ scale: 0.7, opacity: 0, y: -6 }}
						animate={{ scale: 1, opacity: 1, y: 0 }}
						exit={{ scale: 0.7, opacity: 0, y: -4 }}
						transition={{ type: "spring", stiffness: 520, damping: 30, delay: index * 0.03 }}
						whileTap={{ scale: 0.95 }}
						onClick={() => model.actions.toggleItem(item.id)}
						title={item.label}
						className={cn(
							"flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-[12px] font-medium transition-colors",
							item.active
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
						)}
					>
						{item.icon ? (
							<motion.span
								className="flex h-3.5 w-3.5 items-center justify-center"
								animate={item.active ? { rotate: [0, -8, 8, 0] } : { rotate: 0 }}
								transition={{ duration: 0.4 }}
							>
								{item.icon}
							</motion.span>
						) : null}
						<span className="hidden @[22rem]:inline">{item.label}</span>
					</motion.button>
				))}
			</AnimatePresence>
		</motion.div>
	);
}
