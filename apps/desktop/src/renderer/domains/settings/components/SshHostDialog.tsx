import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@astravia-org/ui";
import { SegmentedControl } from "@astravia-org/theme-ui/shared";
import { InputField } from "./SettingsFormFields";
import { composeTarget, type SshHostsSettingsModel, splitTarget } from "./useSshHostsSettingsModel";

/**
 * 新增/编辑主机的对话框。
 *
 * 字段只留这些。ProxyJump、跳板、IdentityAgent 这些一律交给 `~/.ssh/config`——
 * OpenSSH 会在连接时自己解析，在这里再抄一份只会与用户后续的修改漂移。
 *
 * 认证方式用 Tab 切换：私钥（含 ssh-agent 与默认身份）或密码。密码只在提交时传给主进程
 * 进加密凭据库，编辑时不回显；留空表示沿用已保存的口令。
 */
export function SshHostDialog({ model }: { model: SshHostsSettingsModel }): JSX.Element {
	const { labels, form, actions } = model;
	const open = model.editingId !== null;
	const editing = model.editingId !== null && model.editingId !== "new";
	const editedHost = editing ? model.hosts.find((host) => host.id === model.editingId) : undefined;
	const passwordSaved = editedHost?.authMethod === "password";
	const usingPassword = form.authMethod === "password";
	const canSubmit = form.host.trim().length > 0 && !model.saving;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) actions.cancelEdit();
			}}
		>
			<DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[480px]">
				<DialogHeader className="pr-6 text-left">
					<DialogTitle className="text-base font-semibold tracking-tight text-foreground">
						{editing ? labels.editTitle : labels.addTitle}
					</DialogTitle>
				</DialogHeader>
				<form
					className="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (canSubmit) void actions.submit();
					}}
				>
					<div className="flex gap-3">
						<div className="min-w-0 flex-1">
							<Field label={labels.fieldHost} hint={labels.fieldHostHint}>
								<InputField
									value={form.host}
									onChange={(value) => {
										// 直接粘贴 user@host 时自动拆到用户名里，省得用户再手动挪。
										const pasted = value.includes("@") && form.username === "";
										actions.setForm(pasted ? splitTarget(value) : { host: value });
									}}
									placeholder="192.168.1.10"
									aria-label={labels.fieldHost}
									autoFocus
								/>
							</Field>
						</div>
						<div className="w-24 shrink-0">
							<Field label={labels.fieldPort}>
								<InputField
									value={form.port}
									onChange={(value) => actions.setForm({ port: value.replace(/\D/g, "") })}
									placeholder="22"
									aria-label={labels.fieldPort}
								/>
							</Field>
						</div>
					</div>

					<Field label={labels.fieldUsername} hint={labels.fieldUsernameHint}>
						<InputField
							value={form.username}
							onChange={(value) => actions.setForm({ username: value })}
							placeholder="root"
							aria-label={labels.fieldUsername}
						/>
					</Field>

					<SegmentedControl
						className="self-start"
						items={[
							{ key: "key", label: labels.authKey },
							{ key: "password", label: labels.authPassword },
						]}
						value={form.authMethod}
						onChange={(authMethod) => actions.setForm({ authMethod })}
					/>

					{usingPassword ? (
						<Field
							label={labels.fieldPassword}
							hint={`${passwordSaved ? labels.fieldPasswordSavedHint : labels.fieldPasswordHint} ${labels.passwordIgnoresConfigKey}`}
						>
							<InputField
								type="password"
								value={form.password}
								onChange={(value) => actions.setForm({ password: value })}
								placeholder={passwordSaved ? "••••••••" : undefined}
								aria-label={labels.fieldPassword}
							/>
						</Field>
					) : (
						<Field label={labels.fieldIdentityFile} hint={labels.fieldIdentityFileHint}>
							<InputField
								value={form.identityFile}
								onChange={(value) => actions.setForm({ identityFile: value })}
								placeholder="~/.ssh/id_ed25519"
								aria-label={labels.fieldIdentityFile}
							/>
						</Field>
					)}

					<Field label={labels.fieldLabel} hint={labels.fieldLabelHint}>
						<InputField
							value={form.label}
							onChange={(value) => actions.setForm({ label: value })}
							placeholder={composeTarget(form.username, form.host)}
							aria-label={labels.fieldLabel}
						/>
					</Field>

					{model.formError !== null && (
						<p role="alert" className="text-[12px] text-destructive">
							{model.formError}
						</p>
					)}

					<div className="flex items-center justify-end gap-2 pt-1">
						<Button type="button" variant="ghost" size="sm" onClick={actions.cancelEdit}>
							{labels.cancel}
						</Button>
						<Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
							{labels.save}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** 可见 label + 可选说明。占位符不能替代 label——一开始输入它就消失了。 */
function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}): JSX.Element {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-[12px] font-medium text-foreground">{label}</span>
			{children}
			{hint !== undefined && <span className="text-[11px] text-muted-foreground">{hint}</span>}
		</label>
	);
}
