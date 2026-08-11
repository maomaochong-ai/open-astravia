import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn, Popover, PopoverAnchor, PopoverContent } from "@vetta/ui";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type FocusEvent,
	type JSX,
	type KeyboardEvent,
} from "react";
import type { KanbanSkillOption } from "../board/board-controller";
import { appendSkillToken, insertSkillToken, mentionAtCursor, splitPromptSegments } from "../board/prompt-tokens";

/**
 * 需求正文输入框：普通 textarea + 两层增强，Composer / 编辑弹窗 / 打回反馈共用。
 *
 * - **`@` 技能提及**：光标处敲 `@` 弹出技能列表，继续敲字过滤，回车 / 点击插入
 *   `@skill:名字` 行内 token（与宿主输入栏同一文本形态，派单 prompt 原样携带，
 *   会话页会把它渲染成 skill 胶囊）。
 * - **token 高亮**：textarea 背后铺一层同字体同排版的镜像层，只给 token 段画底色
 *   胶囊；文字本身仍由 textarea 渲染，镜像层全透明，错半像素也不影响可读性。
 *
 * 宿主输入栏本体是 Lexical 编辑器且深度绑定会话状态，无法跨 Module Federation
 * 复用，所以这里按同一套 token 规则做了个轻量替身。
 */

/** 字体与排版必须在 textarea 与镜像层之间逐类一致，抽出来免得两边改漂了。 */
const TYPOGRAPHY = "text-[13px] leading-relaxed";

export interface PromptTextareaHandle {
	focus: () => void;
	/** 打开技能选择器（工具栏按钮路径；插入点为当前光标）。 */
	openSkillPicker: () => void;
}

export interface PromptTextareaProps {
	value: string;
	onChange: (value: string) => void;
	/** 可提及的技能；空数组时 `@` 不弹层，输入框退化为普通 textarea。 */
	skills: KanbanSkillOption[];
	placeholder?: string;
	autoFocus?: boolean;
	/** 外层容器类（宽度、圆角、边框由调用方定）。 */
	className?: string;
	/** textarea 与镜像层共用的内边距类，两层必须一致所以单独收。 */
	paddingClassName?: string;
	/** 仅加在 textarea 上的尺寸类（min-h / max-h / resize）。 */
	textareaClassName?: string;
	/** 随内容自适应高度（px 范围）；不传则由 textareaClassName 控制。 */
	autoGrow?: { min: number; max: number };
	/** 提及弹层未消费的按键会透传到这里（Composer 的回车语义在父层）。 */
	onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
	onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
}

type PickerState = { mode: "mention"; start: number; query: string } | { mode: "append" };

export const PromptTextarea = forwardRef<PromptTextareaHandle, PromptTextareaProps>(function PromptTextarea(
	{
		autoFocus,
		autoGrow,
		className,
		onBlur,
		onChange,
		onFocus,
		onKeyDown,
		paddingClassName = "px-2.5 py-2",
		placeholder,
		skills,
		textareaClassName,
		value,
	},
	ref,
): JSX.Element {
	const { t } = useTranslation();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const [picker, setPicker] = useState<PickerState | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	/** 程序性插入后要恢复的光标位；React 受控更新会把光标甩到末尾。 */
	const pendingCursor = useRef<number | null>(null);

	const filtered = useMemo(() => {
		if (picker?.mode !== "mention" || !picker.query) return skills;
		const query = picker.query.toLowerCase();
		return skills.filter(
			(skill) => skill.name.toLowerCase().includes(query) || skill.alias?.toLowerCase().includes(query),
		);
	}, [picker, skills]);

	useEffect(() => {
		setActiveIndex(0);
	}, [filtered]);

	const segments = useMemo(() => splitPromptSegments(value), [value]);

	const grow = useCallback(() => {
		const element = textareaRef.current;
		if (!element || !autoGrow) return;
		element.style.height = "0px";
		element.style.height = `${Math.min(autoGrow.max, Math.max(autoGrow.min, element.scrollHeight))}px`;
	}, [autoGrow]);

	useLayoutEffect(() => {
		grow();
		if (pendingCursor.current !== null && textareaRef.current) {
			textareaRef.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
			pendingCursor.current = null;
		}
		// 内容变化可能改变滚动位置，镜像层跟上。
		if (backdropRef.current && textareaRef.current) {
			backdropRef.current.scrollTop = textareaRef.current.scrollTop;
		}
	}, [value, grow]);

	useImperativeHandle(
		ref,
		() => ({
			focus: () => textareaRef.current?.focus(),
			openSkillPicker: () => {
				if (skills.length === 0) return;
				textareaRef.current?.focus();
				setPicker({ mode: "append" });
			},
		}),
		[skills.length],
	);

	const applyChange = (next: string, cursor: number): void => {
		onChange(next);
		const mention = skills.length > 0 ? mentionAtCursor(next, cursor) : null;
		setPicker(mention ? { mode: "mention", ...mention } : null);
	};

	const insertSkill = (skill: KanbanSkillOption): void => {
		const element = textareaRef.current;
		const cursor = element?.selectionStart ?? value.length;
		const result =
			picker?.mode === "mention"
				? insertSkillToken(value, picker.start, cursor, skill.name)
				: appendSkillToken(value, cursor, skill.name);
		pendingCursor.current = result.cursor;
		onChange(result.text);
		setPicker(null);
		element?.focus();
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (picker !== null && filtered.length > 0) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				setActiveIndex((prev) => (prev + delta + filtered.length) % filtered.length);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				insertSkill(filtered[activeIndex] ?? filtered[0]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setPicker(null);
				return;
			}
		}
		onKeyDown?.(event);
	};

	return (
		<Popover open={picker !== null && filtered.length > 0} onOpenChange={(open) => !open && setPicker(null)}>
			<PopoverAnchor asChild>
				<div className={cn("relative", className)}>
					<div
						ref={backdropRef}
						aria-hidden
						className={cn(
							"pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent",
							TYPOGRAPHY,
							paddingClassName,
						)}
					>
						{segments.map((segment, index) =>
							segment.kind === "skill" ? (
								<span
									key={index}
									className="rounded-[5px] bg-primary/12 box-decoration-clone ring-1 ring-inset ring-primary/25"
								>
									{segment.text}
								</span>
							) : (
								<span key={index}>{segment.text}</span>
							),
						)}
					</div>
					<textarea
						ref={textareaRef}
						value={value}
						autoFocus={autoFocus}
						placeholder={placeholder}
						rows={autoGrow ? 1 : undefined}
						onChange={(event) => applyChange(event.target.value, event.target.selectionStart)}
						onKeyDown={handleKeyDown}
						onFocus={onFocus}
						onBlur={onBlur}
						onScroll={() => {
							if (backdropRef.current && textareaRef.current) {
								backdropRef.current.scrollTop = textareaRef.current.scrollTop;
							}
						}}
						className={cn(
							"relative z-10 block w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/45",
							TYPOGRAPHY,
							paddingClassName,
							textareaClassName,
							autoGrow && "resize-none",
						)}
					/>
				</div>
			</PopoverAnchor>
			<PopoverContent
				data-vetta-plugin-root="kanban"
				align="start"
				side="top"
				sideOffset={6}
				onOpenAutoFocus={(event) => event.preventDefault()}
				className="max-h-64 w-80 gap-0 overflow-y-auto p-1"
			>
				<p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
					{t("skillPicker.title")}
				</p>
				{filtered.map((skill, index) => (
					<button
						key={skill.name}
						type="button"
						// mousedown 就插入并保持 textarea 焦点；等 click 的话 blur 已经把弹层关了。
						onMouseDown={(event) => {
							event.preventDefault();
							insertSkill(skill);
						}}
						onMouseEnter={() => setActiveIndex(index)}
						className={cn(
							"flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
							index === activeIndex ? "bg-accent" : "hover:bg-accent/60",
						)}
					>
						<span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
							<span className="icon-[solar--stars-minimalistic-linear] h-3.5 w-3.5 shrink-0 text-primary" />
							{skill.alias?.trim() || skill.name}
						</span>
						{skill.description && (
							<span className="line-clamp-1 pl-5 text-[10px] text-muted-foreground/80">{skill.description}</span>
						)}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
});
