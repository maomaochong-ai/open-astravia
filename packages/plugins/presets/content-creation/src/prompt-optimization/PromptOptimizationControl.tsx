import { ModelPicker, useTranslation } from "@astravia-org/plugin-sdk";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@astravia-org/ui";
import { useState } from "react";

export interface PromptOptimizationControlProps {
	selectedModelKey?: string;
	isOptimizing: boolean;
	canOptimize: boolean;
	disabled?: boolean;
	onModelChange: (modelKey: string) => void;
	onOptimize: () => void | Promise<void>;
}

export function PromptOptimizationControl({
	selectedModelKey,
	isOptimizing,
	canOptimize,
	disabled = false,
	onModelChange,
	onOptimize,
}: PromptOptimizationControlProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const title = isOptimizing ? t("action.optimizingPrompt") : t("nodeEditor.promptOptimization.title");

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					size="icon-xs"
					variant="ghost"
					disabled={disabled || isOptimizing}
					title={title}
					aria-label={title}
					onMouseDown={(event) => event.preventDefault()}
				>
					<span
						className={`icon-[lucide--wand-sparkles] block size-3.5 ${isOptimizing ? "animate-pulse" : ""}`}
						aria-hidden="true"
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				data-astravia-plugin-root="content-creation"
				align="end"
				side="bottom"
				className="w-72"
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<div className="flex items-center gap-1.5 px-0.5 text-xs font-medium text-foreground">
					<span className="icon-[lucide--wand-sparkles] block size-3.5 text-muted-foreground" aria-hidden="true" />
					<span>{t("nodeEditor.promptOptimization.title")}</span>
				</div>
				{/* 宿主的模型选择器，与会话输入栏同一份清单；未选时自动带上用户的默认模型。 */}
				<ModelPicker
					value={selectedModelKey ?? null}
					onChange={(modelKey) => {
						if (modelKey) onModelChange(modelKey);
					}}
					autoSelectDefault
					placeholder={t("nodeEditor.promptOptimization.model")}
					ariaLabel={t("nodeEditor.promptOptimization.model")}
					className="w-full"
					menuClassName="z-[110]"
				/>
				<Button
					type="button"
					size="sm"
					variant="primary"
					className="w-full"
					disabled={!selectedModelKey || !canOptimize || isOptimizing}
					onClick={() => {
						setOpen(false);
						void onOptimize();
					}}
				>
					<span className="icon-[lucide--sparkles] block size-3.5" aria-hidden="true" />
					<span>{t("action.optimizePrompt")}</span>
				</Button>
			</PopoverContent>
		</Popover>
	);
}
