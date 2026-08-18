import type { DesktopActionApprovalRequest } from "@preload/api.js";
import type { CursorStyle, ThemeMode } from "@shared/store/atoms";
import { cursorStyleAtom, themeModeAtom, themeNameAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatApprovalWhyConfirm } from "../approvalCopy";
import { useActionApproval } from "../useActionApproval";
import type { AppearanceApprovalDrawerViewProps } from "./AppearanceApprovalDrawerView";

function isThemeSetInput(input: DesktopActionApprovalRequest["input"]): input is {
	type: "set";
	mode?: ThemeMode;
	themeId?: string;
	cursorStyle?: CursorStyle;
	approvalUi?: string;
} {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
	const value = input as Record<string, unknown>;
	return (
		value.type === "set" &&
		(value.mode === undefined || value.mode === "light" || value.mode === "dark" || value.mode === "auto") &&
		(value.themeId === undefined || typeof value.themeId === "string") &&
		(value.cursorStyle === undefined || value.cursorStyle === "default" || value.cursorStyle === "stoat")
	);
}

export interface AppearancePickerApprovalModel {
	readonly approvalId: string;
	readonly drawer: Omit<AppearanceApprovalDrawerViewProps, "children">;
	readonly hasInput: boolean;
	readonly mode: ThemeMode;
	readonly themeId: string;
	readonly cursorStyle: CursorStyle;
	readonly rawInput: unknown;
	readonly onModeChange: (mode: ThemeMode) => void;
	readonly onThemeChange: (themeId: string) => void;
	readonly onCursorStyleChange: (cursorStyle: CursorStyle) => void;
}

export function useAppearancePickerApprovalModel(): AppearancePickerApprovalModel | null {
	const approval = useActionApproval("appearance.picker");
	const { t } = useTranslation("common");
	const currentMode = useAtomValue(themeModeAtom);
	const currentThemeId = useAtomValue(themeNameAtom);
	const currentCursorStyle = useAtomValue(cursorStyleAtom);
	const input = approval && isThemeSetInput(approval.request.input) ? approval.request.input : null;
	const [mode, setMode] = useState<ThemeMode>(input?.mode ?? currentMode);
	const [themeId, setThemeId] = useState(input?.themeId ?? currentThemeId);
	const [cursorStyle, setCursorStyle] = useState<CursorStyle>(input?.cursorStyle ?? currentCursorStyle);

	if (!approval) return null;

	const { request, responding, error, approve, reject } = approval;
	return {
		approvalId: request.approvalId,
		drawer: {
			canConfirm: input !== null,
			countdown: approval.countdown.formatted,
			error,
			labels: {
				confirm: t("appearanceApproval.apply"),
				permission: formatApprovalWhyConfirm(t, request.permission),
				reject: t("actionApproval.reject"),
				responding: t("appearanceApproval.submitting"),
			},
			onConfirm: () =>
				approve({
					type: "set",
					mode,
					themeId,
					cursorStyle,
					approvalUi: "appearance.picker",
				}),
			onReject: reject,
			responding,
			summary: request.summary,
			title: t("appearanceApproval.pickerTitle"),
		},
		hasInput: input !== null,
		mode,
		themeId,
		cursorStyle,
		rawInput: request.input,
		onModeChange: setMode,
		onThemeChange: setThemeId,
		onCursorStyleChange: setCursorStyle,
	};
}
