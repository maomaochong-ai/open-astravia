import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@shared/lib/utils";
import { ModelsModelForm } from "./ModelsModelForm";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

interface AsyncFeedback {
	status: "testing" | "ok" | "fail" | "syncing" | "not-found";
	message?: string;
}

const IDLE_FEEDBACK: AsyncFeedback | null = null;

/**
 * 「添加 / 编辑模型」对话框：表单从供应商行内移进弹层，并在此提供两个辅助动作——
 * 测试连通（复用主进程 probe）与从 models.dev 目录一键同步参数（只补空字段，不覆盖手填值）。
 */
export function ModelsModelDialog({ model }: { model: ModelsSettingsModel }): JSX.Element | null {
	const { t } = useTranslation("settings");
	const [feedback, setFeedback] = useState<AsyncFeedback | null>(IDLE_FEEDBACK);

	const providerName = model.addingModelFor ?? model.editingModel?.provider ?? null;
	const open = providerName !== null;

	// 每次打开（换服务商或换编辑对象）都清掉上一轮的测试/同步结果。
	useEffect(() => {
		setFeedback(IDLE_FEEDBACK);
	}, [providerName, model.editingModel?.modelId, model.addingModelFor]);

	if (!open || !providerName) return null;

	const modelId = model.modelForm.id.trim();
	const busy = feedback?.status === "testing" || feedback?.status === "syncing";

	const handleTest = async (): Promise<void> => {
		if (!modelId || feedback?.status === "testing") return;
		setFeedback({ status: "testing" });
		try {
			const result = await window.vetta.models.probe({ provider: providerName, model: modelId });
			setFeedback(
				result.ok
					? { status: "ok", message: result.message ?? t("testOk") }
					: { status: "fail", message: result.error ?? t("testFailed") },
			);
		} catch (err) {
			setFeedback({ status: "fail", message: err instanceof Error ? err.message : String(err) });
		}
	};

	const handleSync = async (): Promise<void> => {
		if (!modelId || feedback?.status === "syncing") return;
		setFeedback({ status: "syncing" });
		try {
			const meta = await window.vetta.models.lookupModelMetadata(modelId);
			if (!meta) {
				setFeedback({ status: "not-found", message: t("syncCatalogNotFound") });
				return;
			}
			// 与「从接口拉取」同一口径：目录只补空字段，用户已填的一律不覆盖。
			model.setModelForm((current) => ({
				...current,
				name: current.name.trim() || meta.name || current.name,
				reasoning: current.reasoning || Boolean(meta.reasoning),
				reasoningLevels:
					current.reasoningLevels.length === 0 && meta.reasoningLevels?.length
						? [...meta.reasoningLevels]
						: current.reasoningLevels,
				input: meta.vision && !current.input.includes("image") ? [...current.input, "image"] : current.input,
				contextWindow:
					!current.contextWindow.trim() && meta.contextWindow != null
						? String(meta.contextWindow)
						: current.contextWindow,
				maxTokens:
					!current.maxTokens.trim() && meta.maxTokens != null ? String(meta.maxTokens) : current.maxTokens,
			}));
			setFeedback({ status: "ok", message: t("syncCatalogDone", { provider: meta.provider }) });
		} catch (err) {
			setFeedback({ status: "fail", message: err instanceof Error ? err.message : String(err) });
		}
	};

	const close = (): void => {
		if (model.addingModelFor) model.onCancelAddModel();
		else model.onCancelEditModel();
	};

	const save = (): void => {
		if (model.addingModelFor) void model.onAddModel(providerName);
		else if (model.editingModel) void model.onUpdateModel(providerName, model.editingModel.modelId);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
		>
			<DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[560px] rounded-2xl p-6 gap-5 border border-border/60 bg-popover shadow-2xl">
				<DialogHeader className="gap-1 pr-6 text-left">
					<DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
						<span className="icon-[solar--cpu-bolt-linear] h-4.5 w-4.5 text-primary shrink-0" aria-hidden="true" />
						<span>{model.addingModelFor ? t("addModel") : t("editModel")}</span>
					</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground leading-normal">
						{t("modelDialogHint", { provider: providerName })}
					</DialogDescription>
				</DialogHeader>

				<ModelsModelForm form={model.modelForm} setForm={model.setModelForm} />

				<div className="space-y-2">
					{feedback?.message && (
						<div
							className={cn(
								"flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-medium animate-in fade-in-50 duration-150",
								feedback.status === "ok" && "bg-primary/10 text-primary",
								feedback.status === "not-found" && "bg-accent text-muted-foreground",
								feedback.status === "fail" && "bg-destructive/10 text-destructive",
							)}
							role="status"
						>
							<span
								className={cn(
									"mt-0.5 h-3.5 w-3.5 shrink-0",
									feedback.status === "ok" && "icon-[mdi--check-circle-outline]",
									feedback.status === "not-found" && "icon-[mdi--information-outline]",
									feedback.status === "fail" && "icon-[mdi--alert-circle-outline]",
								)}
								aria-hidden="true"
							/>
							<span className="min-w-0 break-all">{feedback.message}</span>
						</div>
					)}
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-1.5">
							<Button
								variant="outline"
								size="sm"
								disabled={!modelId || busy || model.saving}
								onClick={() => void handleTest()}
							>
								<span
									className={cn(
										"h-3.5 w-3.5",
										feedback?.status === "testing"
											? "icon-[mdi--loading] animate-spin"
											: "icon-[mdi--connection]",
									)}
									aria-hidden="true"
								/>
								{feedback?.status === "testing" ? t("testing") : t("testConnect")}
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={!modelId || busy || model.saving}
								onClick={() => void handleSync()}
							>
								<span
									className={cn(
										"h-3.5 w-3.5",
										feedback?.status === "syncing"
											? "icon-[mdi--loading] animate-spin"
											: "icon-[mdi--cloud-sync-outline]",
									)}
									aria-hidden="true"
								/>
								{feedback?.status === "syncing" ? t("syncingCatalog") : t("syncCatalogParams")}
							</Button>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={close}
								className="h-8 rounded-lg px-3.5 text-xs text-muted-foreground hover:text-foreground"
							>
								{t("cancel")}
							</Button>
							<Button
								variant="primary"
								size="sm"
								disabled={!modelId || model.saving}
								onClick={save}
								className="h-8 rounded-lg px-4 text-xs font-medium shadow-xs"
							>
								{model.addingModelFor ? t("add") : t("save")}
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
