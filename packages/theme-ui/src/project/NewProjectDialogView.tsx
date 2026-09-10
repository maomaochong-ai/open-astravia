import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
} from "@vetta/ui";

export interface NewProjectDialogViewLabels {
	readonly title: string;
	readonly description: string;
	readonly placeholder: string;
	readonly cancel: string;
	readonly create: string;
	readonly emptyError: string;
	readonly invalidError: string;
	readonly duplicateError: string;
}

export interface NewProjectDialogViewProps {
	readonly onConfirm: (name: string) => void;
	readonly onCancel: () => void;
	readonly labels: NewProjectDialogViewLabels;
	/**
	 * 已被占用的项目名。命中时在确认那一刻就拦下来——否则重名会一路走到落盘，
	 * 静默复用同名项目，用户以为新建了一个却发现会话进了旧项目。
	 */
	readonly isNameTaken?: (name: string) => boolean;
}

export function NewProjectDialogView({
	onConfirm,
	onCancel,
	labels,
	isNameTaken,
}: NewProjectDialogViewProps): JSX.Element {
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	/**
	 * 输入法组合中。中文/日文输入时 Enter 是「上屏第一个候选词」，不该走到创建——
	 * 否则用户名字还没打完，项目就按半成品建出去了。
	 *
	 * 两道判断都要：`isComposing` 是标准信号，但 compositionend 与随后那次 keydown
	 * 的先后顺序各引擎不一致（确认候选词的那一下就落在这个缝里），所以再用
	 * compositionend 之后的一小段时间兜底。
	 */
	const composingRef = useRef(false);
	const composedAtRef = useRef(0);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSubmit = useCallback(() => {
		const trimmed = name.trim();
		if (!trimmed) {
			setError(labels.emptyError);
			return;
		}
		if (/[/\\:*?"<>|]/.test(trimmed)) {
			setError(labels.invalidError);
			return;
		}
		if (isNameTaken?.(trimmed)) {
			setError(labels.duplicateError);
			return;
		}
		onConfirm(trimmed);
	}, [name, onConfirm, isNameTaken, labels.emptyError, labels.invalidError, labels.duplicateError]);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<DialogContent
				showCloseButton={false}
				onEscapeKeyDown={(e) => {
					e.preventDefault();
					onCancel();
				}}
				onInteractOutside={(e) => e.preventDefault()}
			>
				<DialogHeader className="gap-1.5">
					<DialogTitle>{labels.title}</DialogTitle>
					<DialogDescription>{labels.description}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Input
						ref={inputRef}
						type="text"
						value={name}
						// 有错时借 Input 自带的 aria-invalid 样式染边框，不用再写一套红框。
						aria-invalid={error ? true : undefined}
						onChange={(e) => {
							setName(e.target.value);
							setError("");
						}}
						onKeyDown={(e) => {
							if (e.key !== "Enter") return;
							if (composingRef.current || e.nativeEvent.isComposing || Date.now() - composedAtRef.current < 80) {
								return;
							}
							handleSubmit();
						}}
						onCompositionStart={() => {
							composingRef.current = true;
						}}
						onCompositionEnd={() => {
							composingRef.current = false;
							composedAtRef.current = Date.now();
						}}
						placeholder={labels.placeholder}
						className="h-9"
					/>
					{error && (
						<p role="alert" className="text-[12px] leading-snug text-destructive">
							{error}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						{labels.cancel}
					</Button>
					<Button variant="primary" onClick={handleSubmit}>
						{labels.create}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
