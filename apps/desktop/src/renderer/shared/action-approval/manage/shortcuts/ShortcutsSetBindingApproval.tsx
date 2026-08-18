import { ShortcutRecorder } from "@domains/settings/components/ShortcutRecorder";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalSettingGroup,
	ApprovalSettingRow,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
import {
	getShortcutActionDefault,
	resolveShortcutActionId,
	SHORTCUT_ACTIONS,
	SHORTCUTS_APPROVAL_ICON,
	type ShortcutActionId,
} from "./shortcutsApprovalShared";

interface InputData {
	operation: "set-binding";
	id: string;
	shortcut: string;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-binding") return null;
	if (typeof r.id !== "string" || typeof r.shortcut !== "string") return null;
	return {
		operation: "set-binding",
		id: r.id,
		shortcut: r.shortcut,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ShortcutsSetBindingApproval(): JSX.Element | null {
	const approval = useActionApproval("shortcuts.set-binding");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { t: tSettings } = useTranslation("settings");
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [actionId, setActionId] = useState<ShortcutActionId>(() => resolveShortcutActionId(input?.id));
	const [shortcut, setShortcut] = useState(() => input?.shortcut?.trim() || getShortcutActionDefault(actionId));

	const defaultShortcut = getShortcutActionDefault(actionId);
	const isDefault = shortcut === defaultShortcut;
	const selectedDef = useMemo(
		() => SHORTCUT_ACTIONS.find((action) => action.id === actionId) ?? SHORTCUT_ACTIONS[0],
		[actionId],
	);

	const handleActionChange = (nextId: string) => {
		const resolved = resolveShortcutActionId(nextId);
		setActionId(resolved);
		// 切换功能时：若当前仍是上一功能的默认键，则跟到新功能默认键；用户已录制的自定义键保留。
		setShortcut((prev) => {
			const prevDefault = getShortcutActionDefault(actionId);
			return prev === prevDefault ? getShortcutActionDefault(resolved) : prev;
		});
	};

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.shortcuts.ops.set-binding.title")}
			summary={t("manageApproval.shortcuts.ops.set-binding.summary")}
			icon={SHORTCUTS_APPROVAL_ICON}
			badge={t("manageApproval.shortcuts.ops.set-binding.badge")}
			labels={frameLabels(request.permission, t("manageApproval.shortcuts.ops.set-binding.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "set-binding",
							id: actionId,
							shortcut,
							approvalUi: input.approvalUi ?? "shortcuts.set-binding",
						})
					: approve()
			}
			canApprove={Boolean(input) && shortcut.length > 0}
		>
			{input ? (
				<>
					<ApprovalSettingGroup
						title={t("manageApproval.shortcuts.bindingSectionTitle")}
						description={t("manageApproval.shortcuts.bindingSectionDescription")}
					>
						<ApprovalSettingRow
							title={t("manageApproval.shortcuts.actionField")}
							description={tSettings(selectedDef.descriptionKey)}
						>
							<Select value={actionId} onValueChange={handleActionChange}>
								<SelectTrigger
									size="sm"
									className="h-8 min-w-[160px] border-border/70 bg-background/50 text-[12px]"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SHORTCUT_ACTIONS.map((action) => (
										<SelectItem key={action.id} value={action.id} className="text-[12px]">
											{tSettings(action.labelKey)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</ApprovalSettingRow>
						<ApprovalSettingRow
							title={t("manageApproval.shortcuts.comboField")}
							description={t("manageApproval.shortcuts.comboFieldHint")}
							border={false}
						>
							<ShortcutRecorder
								value={shortcut}
								onChange={setShortcut}
								onReset={() => setShortcut(defaultShortcut)}
								isDefault={isDefault}
								placeholder={tSettings("shortcutPlaceholder")}
								resetLabel={tSettings("reset")}
							/>
						</ApprovalSettingRow>
					</ApprovalSettingGroup>
					<ApprovalImpactCard
						icon={SHORTCUTS_APPROVAL_ICON}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.shortcuts.ops.set-binding.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
