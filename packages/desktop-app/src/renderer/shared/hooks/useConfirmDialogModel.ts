import { useShortcutScope } from "@shared/shortcuts";
import { useAtom } from "jotai";
import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ConfirmDialogViewProps } from "../components/ui/ConfirmDialogView";
import { confirmDialogAtom } from "../store/atoms";

export function useConfirmDialogModel(): ConfirmDialogViewProps {
	const { t } = useTranslation("common");
	const [state, setState] = useAtom(confirmDialogAtom);
	const overlayRef = useRef<HTMLDivElement>(null);

	const onCancel = useCallback(() => {
		state?.onCancel?.();
		setState(null);
	}, [setState, state]);

	const onConfirm = useCallback(() => {
		state?.onConfirm(state.checkbox?.checked ?? false);
		setState(null);
	}, [setState, state]);

	const onCheckboxCheckedChange = useCallback(
		(checked: boolean) => {
			setState((current) =>
				current?.checkbox ? { ...current, checkbox: { ...current.checkbox, checked } } : current,
			);
		},
		[setState],
	);

	useShortcutScope({
		id: "modal:confirm-dialog",
		kind: "modal",
		active: state != null,
		exclusive: true,
		bindings: [
			{
				key: "escape",
				run: () => {
					state?.onCancel?.();
					setState(null);
				},
			},
		],
	});

	return useMemo(
		() => ({
			labels: {
				cancel: t("actions.cancel"),
				confirm: t("actions.confirm"),
			},
			onCancel,
			onCheckboxCheckedChange,
			onConfirm,
			overlayRef,
			state: state
				? {
						cancelLabel: state.cancelLabel,
						checkbox: state.checkbox,
						confirmLabel: state.confirmLabel,
						message: state.message,
						title: state.title,
						variant: state.variant,
					}
				: null,
		}),
		[onCancel, onCheckboxCheckedChange, onConfirm, state, t],
	);
}
