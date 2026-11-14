import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import { AutomationDetailPaneView } from "@astravia-org/theme-ui/scheduler";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@astravia-org/ui";
import { useTranslation } from "react-i18next";
import type { ScheduledTask } from "../../../../shared/automation";
import { type AutomationPane } from "../hooks/useAutomationPageModel";
import { useAutomationDetailModel } from "../hooks/useAutomationDetailModel";
import { ExecutionHistory } from "./ExecutionHistory";
import { SchedulerTaskFields } from "./SchedulerTaskFields";

interface AutomationDetailPaneProps {
	readonly pane: Exclude<AutomationPane, { kind: "none" }>;
	readonly onClose: () => void;
	readonly onCreated: (task: ScheduledTask) => void;
}

/** 右侧分屏：编辑已有自动化（含执行历史）或新建一个。 */
export function AutomationDetailPane({ pane, onClose, onCreated }: AutomationDetailPaneProps): JSX.Element {
	const { t } = useTranslation("automation");
	const model = useAutomationDetailModel({ pane, onClose, onCreated });
	const editing = model.mode === "edit";

	return (
		<AutomationDetailPaneView
			statusLabel={model.statusLabel}
			statusTone={model.tone}
			closeLabel={t("detail.close")}
			onClose={onClose}
			headerActions={
				editing ? (
					<>
						{/* 三个操作合成一颗胶囊：与顶栏、详情页同一套外观。 */}
						<ButtonGroup>
							<ButtonGroupItem
								icon={<span className="icon-[mdi--play-outline] h-4 w-4" />}
								title={t("detail.runNow")}
								aria-label={t("detail.runNow")}
								disabled={model.running}
								onClick={model.onRunNow}
							/>
							<ButtonGroupItem
								icon={
									<span
										className={`${model.enabled ? "icon-[mdi--pause-circle-outline]" : "icon-[mdi--play-circle-outline]"} h-4 w-4`}
									/>
								}
								title={model.enabled ? t("detail.pause") : t("detail.enable")}
								aria-label={model.enabled ? t("detail.pause") : t("detail.enable")}
								onClick={model.onToggleEnabled}
							/>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<ButtonGroupItem
										icon={<span className="icon-[mdi--dots-horizontal] h-4 w-4" />}
										title={t("detail.more")}
										aria-label={t("detail.more")}
									/>
								</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onSelect={model.onDelete} className="text-destructive">
									<span className="icon-[mdi--delete-outline] h-4 w-4" />
									{t("detail.delete")}
								</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</ButtonGroup>
					</>
				) : null
			}
			body={
				<SchedulerTaskFields
					value={model.draft}
					onChange={model.onChange}
					namePlaceholder={t("form.namePlaceholder")}
				/>
			}
			history={editing && model.taskId ? <ExecutionHistory taskId={model.taskId} /> : undefined}
			footer={
				<>
					{model.error ? (
						<p className="mr-auto min-w-0 truncate text-[12px] text-destructive" title={model.error}>
							{model.error}
						</p>
					) : null}
					{editing && !model.dirty ? (
						<Button type="button" variant="outline" disabled={!model.canOpenChat} onClick={model.onOpenChat}>
							{t("detail.openChat")}
							<span className="icon-[mdi--arrow-top-right] h-3.5 w-3.5" />
						</Button>
					) : null}
					{editing && model.dirty ? (
						<Button type="button" variant="ghost" onClick={model.onDiscard}>
							{t("detail.discard")}
						</Button>
					) : null}
					{!editing || model.dirty ? (
						<Button type="button" variant="primary" disabled={!model.canSubmit} onClick={model.onSubmit}>
							{editing ? t("detail.save") : t("detail.create")}
						</Button>
					) : null}
				</>
			}
		/>
	);
}
