import { Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@vetta/ui";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

export interface ConversationTagEditorTagView {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	/** 已翻译好的「将从 N 个会话中移除」提示；视图层不碰 i18n。 */
	readonly removeHint: string;
}

export interface ConversationTagEditorDialogViewLabels {
	readonly createTitle: string;
	readonly manageTitle: string;
	readonly namePlaceholder: string;
	readonly colorLabel: string;
	readonly customColor: string;
	readonly emptyNameError: string;
	readonly cancel: string;
	readonly create: string;
	readonly done: string;
	readonly newTag: string;
	readonly remove: string;
	readonly empty: string;
}

export interface ConversationTagEditorDialogViewProps {
	/** create 自右键菜单的「新标签」进入，直接展开表单；manage 自「管理标签…」进入。 */
	readonly mode: "create" | "manage";
	readonly tags: readonly ConversationTagEditorTagView[];
	readonly presetColors: readonly string[];
	readonly labels: ConversationTagEditorDialogViewLabels;
	readonly onCreate: (input: { name: string; color: string }) => void;
	readonly onRename: (input: { id: string; name: string }) => void;
	readonly onRecolor: (input: { id: string; color: string }) => void;
	readonly onRemove: (tagId: string) => void;
	readonly onClose: () => void;
}

function ColorSwatch({
	color,
	selected,
	label,
	onSelect,
}: {
	color: string;
	selected: boolean;
	label: string;
	onSelect: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"h-6 w-6 shrink-0 rounded-full transition-transform",
				selected ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : "hover:scale-110",
			)}
			style={{ backgroundColor: color }}
		/>
	);
}

/**
 * 自定义色走原生 `<input type="color">`：在 macOS 上打开的就是系统取色面板
 * （色轮 / 吸管 / 调色板），跨平台都落到各自的系统实现，无需自研 HSV 取色器。
 */
function CustomColorSwatch({
	color,
	selected,
	label,
	onSelect,
}: {
	color: string;
	selected: boolean;
	label: string;
	onSelect: (color: string) => void;
}): JSX.Element {
	return (
		<label
			aria-label={label}
			title={label}
			className={cn(
				"relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border",
				selected ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : "hover:scale-110",
			)}
			style={selected ? { backgroundColor: color } : undefined}
		>
			{selected ? null : (
				<span aria-hidden="true" className="icon-[solar--palette-linear] h-3.5 w-3.5 text-muted-foreground" />
			)}
			<input
				type="color"
				value={color}
				onChange={(event) => onSelect(event.target.value)}
				className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
			/>
		</label>
	);
}

export function ConversationTagEditorDialogView({
	mode,
	tags,
	presetColors,
	labels,
	onCreate,
	onRename,
	onRecolor,
	onRemove,
	onClose,
}: ConversationTagEditorDialogViewProps): JSX.Element {
	const [creating, setCreating] = useState(mode === "create");
	const [name, setName] = useState("");
	const [color, setColor] = useState(presetColors[0] ?? "#ff5f57");
	const [error, setError] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	// 中文输入法下 Enter 是「上屏候选词」，不该直接提交；与新建项目弹窗同样的两道兜底。
	const composingRef = useRef(false);
	const composedAtRef = useRef(0);

	useEffect(() => {
		if (creating) inputRef.current?.focus();
	}, [creating]);

	const submit = useCallback(() => {
		const trimmed = name.trim();
		if (!trimmed) {
			setError(labels.emptyNameError);
			return;
		}
		onCreate({ name: trimmed, color });
		setName("");
		setError("");
		if (mode === "create") onClose();
		else setCreating(false);
	}, [color, labels.emptyNameError, mode, name, onClose, onCreate]);

	const isCustomColor = !presetColors.includes(color);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				showCloseButton={false}
				onEscapeKeyDown={(event) => {
					event.preventDefault();
					onClose();
				}}
				onInteractOutside={(event) => event.preventDefault()}
			>
				<DialogHeader className="gap-1.5">
					<DialogTitle>{mode === "create" ? labels.createTitle : labels.manageTitle}</DialogTitle>
				</DialogHeader>

				{mode === "manage" ? (
					<div className="flex max-h-[46vh] flex-col gap-1 overflow-y-auto">
						{tags.length === 0 ? (
							<p className="py-4 text-center text-[12px] text-muted-foreground">{labels.empty}</p>
						) : (
							tags.map((tag) => (
								<div key={tag.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/40">
									<CustomColorSwatch
										color={tag.color}
										selected
										label={labels.colorLabel}
										onSelect={(next) => onRecolor({ id: tag.id, color: next })}
									/>
									<Input
										defaultValue={tag.name}
										className="h-8 flex-1"
										onBlur={(event) => {
											const next = event.target.value.trim();
											if (next && next !== tag.name) onRename({ id: tag.id, name: next });
											else event.target.value = tag.name;
										}}
										onKeyDown={(event) => {
											if (event.key === "Enter") event.currentTarget.blur();
										}}
									/>
									<Button
										variant="ghost"
										size="sm"
										title={tag.removeHint}
										aria-label={`${labels.remove} ${tag.name}`}
										onClick={() => onRemove(tag.id)}
									>
										<span aria-hidden="true" className="icon-[solar--trash-bin-trash-linear] h-4 w-4" />
									</Button>
								</div>
							))
						)}
					</div>
				) : null}

				{creating ? (
					<div className="flex flex-col gap-2.5">
						<Input
							ref={inputRef}
							type="text"
							value={name}
							aria-invalid={error ? true : undefined}
							placeholder={labels.namePlaceholder}
							className="h-9"
							onChange={(event) => {
								setName(event.target.value);
								setError("");
							}}
							onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								if (composingRef.current || event.nativeEvent.isComposing || Date.now() - composedAtRef.current < 80) {
									return;
								}
								submit();
							}}
							onCompositionStart={() => {
								composingRef.current = true;
							}}
							onCompositionEnd={() => {
								composingRef.current = false;
								composedAtRef.current = Date.now();
							}}
						/>
						<div className="flex flex-wrap items-center gap-2" aria-label={labels.colorLabel}>
							{presetColors.map((preset) => (
								<ColorSwatch
									key={preset}
									color={preset}
									selected={preset === color}
									label={preset}
									onSelect={() => setColor(preset)}
								/>
							))}
							<CustomColorSwatch
								color={color}
								selected={isCustomColor}
								label={labels.customColor}
								onSelect={setColor}
							/>
						</div>
						{error ? (
							<p role="alert" className="text-[12px] leading-snug text-destructive">
								{error}
							</p>
						) : null}
					</div>
				) : null}

				<DialogFooter>
					{mode === "manage" && !creating ? (
						<Button variant="outline" onClick={() => setCreating(true)}>
							{labels.newTag}
						</Button>
					) : null}
					<Button variant="outline" onClick={onClose}>
						{mode === "create" ? labels.cancel : labels.done}
					</Button>
					{creating ? (
						<Button variant="primary" onClick={submit}>
							{labels.create}
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
