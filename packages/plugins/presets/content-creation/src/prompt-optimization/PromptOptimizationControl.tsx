import { type PluginAiModel, useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vetta/ui";
import { useState } from "react";

export interface PromptOptimizationControlProps {
	models: readonly PluginAiModel[];
	selectedModelKey?: string;
	isLoadingModels: boolean;
	isOptimizing: boolean;
	canOptimize: boolean;
	disabled?: boolean;
	onModelChange: (modelKey: string) => void;
	onOptimize: () => void | Promise<void>;
}

export function PromptOptimizationControl({
	models,
	selectedModelKey,
	isLoadingModels,
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
				data-vetta-plugin-root="content-creation"
				align="end"
				side="bottom"
				className="w-72"
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<div className="flex items-center gap-1.5 px-0.5 text-xs font-medium text-foreground">
					<span className="icon-[lucide--wand-sparkles] block size-3.5 text-muted-foreground" aria-hidden="true" />
					<span>{t("nodeEditor.promptOptimization.title")}</span>
				</div>
				<Select value={selectedModelKey} onValueChange={onModelChange} disabled={isLoadingModels}>
					<SelectTrigger className="w-full" aria-label={t("nodeEditor.promptOptimization.model")}>
						<SelectValue
							placeholder={
								isLoadingModels
									? t("nodeEditor.promptOptimization.loadingModels")
									: t("nodeEditor.modelUnavailable")
							}
						/>
					</SelectTrigger>
					<SelectContent className="z-[110]">
						{models.map((model) => (
							<SelectItem key={model.modelKey} value={model.modelKey}>
								{model.provider} · {model.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
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
