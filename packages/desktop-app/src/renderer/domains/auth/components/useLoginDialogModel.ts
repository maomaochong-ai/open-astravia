import { loginDialogOpenAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { useOAuthLogin } from "../hooks/useOAuthLogin";
import type { LoginDialogViewProps } from "./LoginDialogView";

export type LoginDialogModel = LoginDialogViewProps;

export function useLoginDialogModel(): LoginDialogModel {
	const { t } = useTranslation("common");
	const [open, setOpen] = useAtom(loginDialogOpenAtom);
	const { phase, error, start, reopen, cancel } = useOAuthLogin();

	return {
		error,
		labels: {
			close: t("actions.close"),
			footerHint: t("loginDialog.footerHint"),
			oauthButton: t("loginDialog.oauthButton"),
			reopen: t("loginDialog.reopen"),
			subtitle: t("loginDialog.subtitle"),
			title: t("loginDialog.title"),
			waitingHint: t("loginDialog.waitingHint"),
			waitingTitle: t("loginDialog.waitingTitle"),
		},
		// 关闭只是收起弹窗：这次授权不取消，用户在浏览器里完成后照样登录成功。
		onClose: () => {
			cancel();
			setOpen(false);
		},
		onReopen: reopen,
		onStart: start,
		open,
		phase,
	};
}
