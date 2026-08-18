import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { cn } from "@shared/lib/utils";
import type { QuickPanelGlassMode } from "../../shared/quickpanel-ipc";
import { subscribeQuickPanelLanguage, useQuickPanelTranslation } from "./i18n";
import { RecentList } from "./RecentList";
import { useQuickPanelSessions, type QuickPanelItem } from "./useQuickPanelSessions";

export function QuickPanelApp(): JSX.Element {
	const t = useQuickPanelTranslation();
	const items = useQuickPanelSessions();
	const [input, setInput] = useState("");
	// 高亮行：0 = 输入行（Raycast row 0），1..N = 列表项。
	const [highlight, setHighlight] = useState(0);
	// 背景玻璃模式（主进程下发）：liquid/frosted 时卡片透明、露出原生玻璃；none 时不透明卡片。
	const [glassMode, setGlassMode] = useState<QuickPanelGlassMode>("none");
	const inputRef = useRef<HTMLInputElement>(null);

	// 列表项数量变化时夹紧高亮，避免指向已消失的行。
	useEffect(() => {
		setHighlight((h) => Math.min(h, items.length));
	}, [items.length]);

	// 面板每次被唤出：清空输入、复位高亮到输入行、重新聚焦输入框。
	useEffect(() => {
		const bridge = window.vettaQuickPanel;
		inputRef.current?.focus();
		if (!bridge) return;
		return bridge.onShown(() => {
			setInput("");
			setHighlight(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		});
	}, []);

	// 订阅主进程下发的玻璃模式。
	useEffect(() => {
		const bridge = window.vettaQuickPanel;
		if (!bridge) return;
		return bridge.onGlass(setGlassMode);
	}, []);

	// 跟随 App 语言切换实时刷新面板文案。
	useEffect(() => subscribeQuickPanelLanguage(), []);

	const submitNew = useCallback(() => {
		const text = input.trim();
		if (!text) return;
		void window.vettaQuickPanel?.createConversation(text);
	}, [input]);

	const openItem = useCallback((item: QuickPanelItem) => {
		void window.vettaQuickPanel?.openSession({ sessionPath: item.sessionPath, cwd: item.cwd });
	}, []);

	const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setInput(event.target.value);
		// 输入即回到输入行（Raycast：打字始终停在 row 0）。
		setHighlight(0);
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			switch (event.key) {
				case "ArrowDown":
					event.preventDefault();
					setHighlight((h) => Math.min(h + 1, items.length));
					break;
				case "ArrowUp":
					event.preventDefault();
					setHighlight((h) => Math.max(h - 1, 0));
					break;
				case "Enter": {
					event.preventDefault();
					if (highlight === 0) {
						submitNew();
					} else {
						const target = items[highlight - 1];
						if (target) openItem(target);
					}
					break;
				}
				case "Escape":
					event.preventDefault();
					window.vettaQuickPanel?.hide();
					break;
				default:
					break;
			}
		},
		[items, highlight, submitNew, openItem],
	);

	// 原生玻璃在 web 内容之下绘制，故玻璃模式下卡片须透明、去掉边框与阴影。
	const glass = glassMode !== "none";

	return (
		// outer 等于整个窗口（= 玻璃真实边缘，rounded-2xl 与原生 cornerRadius:16 对齐）。
		// 玻璃模式在此画一圈极淡的 1px 边缘描边，让玻璃片边缘干净利落、贴合启动台质感。
		// 仅单层内缘描边、无外投影、无强顶高光（顶部强高光在浅色下会发脏）；不占布局。
		// 描边色跟随 --foreground：深色主题≈白色、浅色主题≈深色，始终保持极淡。
		<div
			className="flex h-screen w-screen items-stretch justify-center rounded-2xl bg-transparent p-2"
			style={
				glass
					? {
							boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 12%, transparent)",
						}
					: undefined
			}
			onKeyDown={handleKeyDown}
		>
			<div
				className={cn(
					"flex h-full w-full flex-col overflow-hidden rounded-2xl text-popover-foreground",
					glass ? "bg-transparent" : "border border-border/60 bg-popover shadow-2xl",
				)}
			>
				<div className="flex items-center gap-2.5 px-4">
					<span className="icon-[solar--magnifer-linear] h-[18px] w-[18px] shrink-0 text-muted-foreground" />
					<input
						ref={inputRef}
						value={input}
						onChange={handleChange}
						onFocus={() => setHighlight(0)}
						placeholder={t("placeholder")}
						spellCheck={false}
						autoComplete="off"
						className="quickpanel-input h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60"
					/>
				</div>
				<div className="h-px shrink-0 bg-border/60" />
				<RecentList
					items={items}
					highlight={highlight}
					onHover={(index) => setHighlight(index + 1)}
					onSelect={openItem}
				/>
			</div>
		</div>
	);
}
