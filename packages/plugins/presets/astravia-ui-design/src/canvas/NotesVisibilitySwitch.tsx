import { useTranslation } from "@astravia-org/plugin-sdk";

interface NotesVisibilitySwitchProps {
	visible: boolean;
	onToggle(): void;
}

/**
 * 右上角按钮组里的「显示/隐藏备注」开关。做成真开关（而不是又一个按下态图标按钮）：
 * 这一格控制的是画布上一整层内容在不在，开合状态必须一眼可读，不能只靠底色深浅。
 * 尺寸对齐同组的图标按钮（h-7 / rounded-md）。
 */
export function NotesVisibilitySwitch({ visible, onToggle }: NotesVisibilitySwitchProps) {
	const { t } = useTranslation();
	const label = t(visible ? "notes.visibility.hide" : "notes.visibility.show");
	return (
		<button
			type="button"
			role="switch"
			aria-checked={visible}
			title={label}
			aria-label={label}
			onClick={onToggle}
			className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 transition-colors ${
				visible ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
			}`}
		>
			<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
				<path
					d="M21 11.5a8.5 8.5 0 01-8.5 8.5H4l1.6-3.2A8.5 8.5 0 1121 11.5z"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<span
				className="relative block h-[14px] w-6 rounded-full transition-colors"
				style={{ background: visible ? "currentColor" : "color-mix(in oklab, currentColor 35%, transparent)" }}
				aria-hidden
			>
				<span
					className="absolute top-[2px] left-[2px] block size-[10px] rounded-full bg-background transition-transform"
					style={{ transform: visible ? "translateX(10px)" : "translateX(0)" }}
				/>
			</span>
		</button>
	);
}
