import type { SshPromptRequestEvent } from "@/shared/ssh-prompt-ipc";
import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta-org/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * 回答 OpenSSH 的交互提示：远端账号口令、私钥密码、一次性验证码、首次主机指纹确认。
 *
 * 挂在全局浮层而不是设置页：提示可能由后台的一次工具调用触发，那时用户根本不在设置页。
 */
export function SshPromptDialog(): JSX.Element | null {
	const { t } = useTranslation("settings");
	const [request, setRequest] = useState<SshPromptRequestEvent | null>(null);
	const [value, setValue] = useState("");
	const [remember, setRemember] = useState(false);

	useEffect(() => {
		const offRequest = window.vetta.ssh.onPromptRequest((event) => {
			setValue("");
			setRemember(false);
			setRequest(event);
		});
		// 连接被取消或超时后主进程会收回提示；不关掉的话用户会对着一个答了也没用的框。
		const offCancel = window.vetta.ssh.onPromptCancelled((id) => {
			setRequest((current) => (current?.id === id ? null : current));
		});
		return () => {
			offRequest();
			offCancel();
		};
	}, []);

	const respond = useCallback(
		(ok: boolean) => {
			if (!request) return;
			window.vetta.ssh.respondToPrompt({
				id: request.id,
				ok,
				...(ok && request.kind !== "confirm" ? { value } : {}),
				...(ok && request.rememberable && remember ? { remember: true } : {}),
			});
			setRequest(null);
			setValue("");
		},
		[remember, request, value],
	);

	if (!request) return null;

	const isConfirm = request.kind === "confirm";
	return (
		<Dialog open onOpenChange={(open) => !open && respond(false)}>
			<DialogContent className="max-w-[480px]">
				<DialogHeader>
					<DialogTitle>{t(isConfirm ? "sshPromptConfirmTitle" : "sshPromptSecretTitle")}</DialogTitle>
					<DialogDescription>{t("sshPromptHost", { host: request.hostLabel })}</DialogDescription>
				</DialogHeader>

				{/* 原样展示 OpenSSH 的提示：主机名、密钥路径和指纹都在里面，改写就没法核对了。 */}
				<pre className="max-h-40 overflow-auto rounded-lg bg-muted px-3 py-2 text-[12px] whitespace-pre-wrap text-foreground">
					{request.prompt}
				</pre>

				{!isConfirm && (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							respond(true);
						}}
					>
						<label className="flex flex-col gap-1.5">
							<span className="text-[12px] font-medium text-foreground">
								{t(request.kind === "verification-code" ? "sshPromptCodeLabel" : "sshPromptSecretLabel")}
							</span>
							<input
								type="password"
								value={value}
								onChange={(event) => setValue(event.target.value)}
								// biome-ignore lint/a11y/noAutofocus: 对话框唯一的输入，弹出即可输入是这里的预期
								autoFocus
								className="h-8 w-full rounded-lg border border-border bg-input px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring"
							/>
						</label>
						{request.rememberable && (
							<label className="mt-2 flex items-center gap-2">
								<input
									type="checkbox"
									checked={remember}
									onChange={(event) => setRemember(event.target.checked)}
									className="size-3.5"
								/>
								<span className="text-[12px] text-muted-foreground">{t("sshPromptRemember")}</span>
							</label>
						)}
					</form>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => respond(false)}>
						{t(isConfirm ? "sshPromptReject" : "cancel")}
					</Button>
					<Button
						variant="primary"
						disabled={!isConfirm && value.length === 0}
						onClick={() => respond(true)}
					>
						{t(isConfirm ? "sshPromptAccept" : "sshPromptSubmit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
