import { Input } from "@shared/components/ui/input";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import type { ImChannelConfigTransport, ImChannelDialogModel } from "./useImBridgeSettingsModel";

const CHANNEL_NAMES: Record<ImChannelConfigTransport, string> = {
	telegram: "Telegram",
	slack: "Slack",
	discord: "Discord",
	signal: "Signal",
	whatsapp: "WhatsApp",
	imessage: "iMessage",
};

export function ImChannelConfigDialog({ model }: { model: ImChannelDialogModel }): JSX.Element | null {
	const { t } = useTranslation("settings");
	if (!model.transport) return null;
	const transport = model.transport;
	const isSecret = transport === "telegram" || transport === "slack" || transport === "discord";
	const isSignal = transport === "signal";
	const isWhatsApp = transport === "whatsapp";
	const isIMessage = transport === "imessage";
	const update = model.updateField;
	const field = (label: string, key: keyof typeof model.form, type = "text", placeholder?: string) => (
		<label className="grid gap-1.5">
			<span className="text-[12px] font-medium text-foreground">{label}</span>
			<Input
				type={type === "secret" && !model.showSecret ? "password" : "text"}
				value={model.form[key]}
				placeholder={placeholder}
				onChange={(event: React.ChangeEvent<HTMLInputElement>) => update(key, event.target.value)}
				autoComplete="off"
			/>
		</label>
	);

	return (
		<Dialog open={model.open} onOpenChange={model.setOpen}>
			<DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>{t("imChannelDialogTitle", { channel: CHANNEL_NAMES[transport] })}</DialogTitle>
					<DialogDescription>{t(`imChannelDialogDesc.${transport}`)}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3 py-2">
					{isSecret && (
						<>
							{field(t("imBotToken"), "botToken", "secret")}
							{transport === "slack" && field(t("imAppToken"), "appToken", "secret")}
							<div className="flex justify-end">
								<Button variant="ghost" size="sm" onClick={() => model.setShowSecret((value) => !value)}>
									{model.showSecret ? t("hide") : t("show")}
								</Button>
							</div>
						</>
					)}
					{isSignal && (
						<>
							{field(t("imSignalEndpoint"), "endpoint", "text", "http://127.0.0.1:8080")}
							{field(t("imSignalAccount"), "account", "text", "+8613800000000")}
							{field(t("imSignalAttachments"), "attachmentsDir")}
						</>
					)}
					{isIMessage && field(t("imMessageDbPath"), "path", "text", "~/Library/Messages/chat.db")}
					{!isWhatsApp && (
						<label className="grid gap-1.5">
							<span className="text-[12px] font-medium text-foreground">{t("imAllowlist")}</span>
							<Input value={model.form.allowlist} onChange={(event: React.ChangeEvent<HTMLInputElement>) => update("allowlist", event.target.value)} placeholder={t("imAllowlistPlaceholder")} />
							<span className="text-[11px] text-muted-foreground">{t("imAllowlistDesc")}</span>
						</label>
					)}
					{isWhatsApp && <p className="rounded-lg border border-border/50 bg-card/40 p-3 text-[12px] text-muted-foreground">{t("imWhatsappBindDesc")}</p>}
					{(model.error || model.message) && <p className={`text-[12px] ${model.error ? "text-destructive" : "text-emerald-400"}`}>{model.error ?? model.message}</p>}
				</div>
				<DialogFooter>
					{isWhatsApp && (
						<>
							<Button variant="outline" onClick={() => void model.onBind()} disabled={model.busy}>{t("imWhatsappBind")}</Button>
							<Button variant="outline" onClick={() => void model.onLogout()} disabled={model.busy}>{t("imWhatsappLogout")}</Button>
						</>
					)}
					{!isWhatsApp && !isIMessage && <Button variant="outline" onClick={() => void model.onTest()} disabled={model.busy}>{t("testConnection")}</Button>}
					{!isWhatsApp && <Button onClick={() => void model.onSave()} disabled={model.busy}>{t("saveLabel")}</Button>}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
