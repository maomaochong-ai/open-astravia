import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { toProjectName } from "./gallery-actions";

interface CreateDesignDialogProps {
	/** 新项目会建在哪儿，直接显示给用户看，省得建完不知道东西去了哪。 */
	workspacePath: string;
	busy: boolean;
	onCreate(name: string): void;
	onClose(): void;
}

/** 新建设计稿：只问一个名字，落点固定在 workspace 下。 */
export function CreateDesignDialog({ workspacePath, busy, onCreate, onClose }: CreateDesignDialogProps) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const normalized = toProjectName(name);
	// 清洗后为空（全是分隔符之类）就不给建，否则会落成一个叫 "design" 的意外项目。
	const canSubmit = !busy && name.trim().length > 0 && normalized.length > 0;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
		<div
			className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 px-6"
			onClick={onClose}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: keeps backdrop clicks off the panel */}
			<form
				className="w-full max-w-80 rounded-xl border border-border bg-card p-4 shadow-2xl"
				onClick={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					if (canSubmit) onCreate(normalized);
				}}
			>
				<p className="text-sm font-medium text-foreground">{t("gallery.create.title")}</p>
				<input
					// biome-ignore lint/a11y/noAutofocus: 对话框只有这一个输入框，打开就该能直接敲
					autoFocus
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder={t("gallery.create.placeholder")}
					aria-label={t("gallery.create.title")}
					className="mt-3 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
				/>
				<p className="mt-2 truncate text-[11px] text-muted-foreground" title={workspacePath}>
					{t("gallery.create.location", { path: `${workspacePath}/${normalized || "…"}` })}
				</p>
				<div className="mt-4 flex items-center justify-end gap-1.5">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
					>
						{t("gallery.action.cancel")}
					</button>
					<button
						type="submit"
						disabled={!canSubmit}
						className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
					>
						{busy ? t("gallery.create.busy") : t("gallery.create.confirm")}
					</button>
				</div>
			</form>
		</div>
	);
}
