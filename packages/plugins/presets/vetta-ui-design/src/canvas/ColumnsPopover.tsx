import { useTranslation } from "@vetta-org/plugin-sdk";
import { type RefObject, useEffect, useRef, useState } from "react";

interface ColumnsPopoverProps {
	/** 当前生效的列数，用来点亮对应格子。 */
	current: number;
	/** 选中集大小：列数超过它没有意义，输入框按它封顶。 */
	max: number;
	/**
	 * 工具条本体。判定「点到外面了」要连它一起算在内：不然点那颗宫格按钮会先被判成
	 * 外部点击而关闭，紧接着 click 又把它打开，浮层看着像关不掉。
	 */
	boundaryRef: RefObject<HTMLElement | null>;
	onPick(columns: number): void;
	onClose(): void;
}

const PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * 列数选择：九个预设格子 + 第十格「自定义」。
 *
 * 第十格点开后原地换成输入框而不是另开一层浮层——它只是这排格子的延伸，再叠一层
 * 浮层既遮住画布也让「选列数」这件小事显得很重。
 */
export function ColumnsPopover({ current, max, boundaryRef, onPick, onClose }: ColumnsPopoverProps) {
	const { t } = useTranslation();
	const [custom, setCustom] = useState(false);
	const [draft, setDraft] = useState(String(current));
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (custom) inputRef.current?.focus();
	}, [custom]);

	// 点到工具条之外就收起来。捕获阶段监听：画布自己会 stopPropagation，冒泡阶段收不到。
	useEffect(() => {
		const onPointerDown = (event: PointerEvent): void => {
			if (!boundaryRef.current?.contains(event.target as Node)) onClose();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		return () => window.removeEventListener("pointerdown", onPointerDown, true);
	}, [boundaryRef, onClose]);

	const submit = (): void => {
		const value = Number.parseInt(draft, 10);
		if (!Number.isFinite(value)) return;
		onPick(Math.min(Math.max(1, value), Math.max(1, max)));
	};

	return (
		<div
			// 不复用 .vetd-ask-popover：那套样式自带指向正下方中点的尖角，而这个浮层是
			// 贴着右端的宫格按钮弹出的，尖角会指在空处。
			className="absolute bottom-full right-0 mb-2 w-max rounded-xl border border-border bg-card p-2 shadow-lg"
			// 画布根节点会在 pointerdown 时接管框选/平移，浮层里的点击必须自己拦住。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			<div className="mb-1.5 px-0.5 text-[11px] text-muted-foreground">{t("canvas.arrange.columns")}</div>
			<div className="grid grid-cols-5 gap-1">
				{PRESETS.map((columns) => (
					<button
						key={columns}
						type="button"
						onClick={() => onPick(columns)}
						className={`flex size-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors ${
							!custom && columns === current
								? "bg-primary text-primary-foreground"
								: "text-foreground hover:bg-accent"
						}`}
					>
						{columns}
					</button>
				))}
				{custom ? (
					<input
						ref={inputRef}
						value={draft}
						inputMode="numeric"
						title={t("canvas.arrange.columns.custom")}
						aria-label={t("canvas.arrange.columns.custom")}
						onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 2))}
						onKeyDown={(event) => {
							if (event.key === "Enter") submit();
							else if (event.key === "Escape") setCustom(false);
						}}
						onBlur={submit}
						className="size-7 select-text rounded-md border border-[var(--vetd-selected)] bg-card text-center text-xs tabular-nums text-foreground outline-none"
					/>
				) : (
					<button
						type="button"
						title={t("canvas.arrange.columns.custom")}
						aria-label={t("canvas.arrange.columns.custom")}
						onClick={() => {
							setDraft(String(current));
							setCustom(true);
						}}
						className={`flex size-7 items-center justify-center rounded-md text-xs transition-colors ${
							current > PRESETS.length
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-accent"
						}`}
					>
						{current > PRESETS.length ? current : "…"}
					</button>
				)}
			</div>
		</div>
	);
}
