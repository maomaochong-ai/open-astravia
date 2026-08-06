import { authTokenAtom } from "@shared/store/atoms";
import { Button, Spin } from "@vetta/ui";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useOAuthLogin } from "../../../auth/hooks/useOAuthLogin";

interface LoginStepProps {
	/** 授权成功后步进到下一步，不展示成功态。 */
	onSuccess: () => void;
}

export function LoginStep({ onSuccess }: LoginStepProps): JSX.Element {
	const { t } = useTranslation("common");
	const token = useAtomValue(authTokenAtom);
	const { phase, error, start, reopen } = useOAuthLogin();
	const advancedRef = useRef(false);

	// 登录成功（OAuth 回跳写 token）后直接下一步；已登录进入本步也直接跳过。
	useEffect(() => {
		if (!token || advancedRef.current) return;
		advancedRef.current = true;
		onSuccess();
	}, [token, onSuccess]);

	const waiting = phase === "waiting";

	return (
		<div className="mx-auto flex w-full max-w-[340px] flex-col gap-5">
			<div className="text-center">
				<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-card/40">
					{waiting ? (
						<Spin size="md" className="text-primary" />
					) : (
						<span className="icon-[solar--user-circle-linear] h-6 w-6 text-primary" />
					)}
				</div>
				<h2 className="text-[15px] font-semibold text-foreground">
					{waiting ? t("login.waitingTitle") : t("setupWizard.login.title")}
				</h2>
				<p className="mt-1 text-[12px] text-muted-foreground">
					{waiting ? t("login.waitingHint") : t("setupWizard.login.subtitle")}
				</p>
			</div>

			<AnimatePresence>
				{error && (
					<motion.p
						initial={{ opacity: 0, y: -4 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -4 }}
						className="flex items-center justify-center gap-1.5 text-[12px] text-destructive"
					>
						<span className="icon-[solar--danger-circle-linear] h-3.5 w-3.5" />
						{error}
					</motion.p>
				)}
			</AnimatePresence>

			{waiting ? (
				<Button variant="outline" className="h-10 w-full rounded-lg text-[13px]" onClick={reopen}>
					<span className="flex items-center gap-2">
						<span className="icon-[solar--square-top-down-linear] h-4 w-4" />
						{t("login.reopen")}
					</span>
				</Button>
			) : (
				<Button className="h-10 w-full rounded-lg text-[13px]" onClick={start}>
					<span className="flex items-center gap-2">
						<span className="icon-[solar--login-2-linear] h-4 w-4" />
						{t("login.oauthButton")}
					</span>
				</Button>
			)}

			<p className="text-center text-[11px] text-muted-foreground/70">{t("setupWizard.login.optionalHint")}</p>
		</div>
	);
}
