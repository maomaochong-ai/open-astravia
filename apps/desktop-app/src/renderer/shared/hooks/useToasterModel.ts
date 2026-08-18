import type { ToasterViewProps } from "@vetta/theme-ui/overlays";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { dismissToast, toastsAtom } from "../store/toast-atoms";

export function useToasterModel(): ToasterViewProps {
	const toasts = useAtomValue(toastsAtom);
	const { t } = useTranslation("common");

	return useMemo(
		() => ({
			closeTitle: t("actions.close"),
			onAction: (id: string) => {
				const toast = toasts.find((item) => item.id === id);
				toast?.action?.onClick();
				dismissToast(id);
			},
			onDismiss: dismissToast,
			toasts: toasts.map((toast) => ({
				actionLabel: toast.action?.label,
				id: toast.id,
				message: toast.message,
				title: toast.title,
				variant: toast.variant,
			})),
		}),
		[t, toasts],
	);
}
