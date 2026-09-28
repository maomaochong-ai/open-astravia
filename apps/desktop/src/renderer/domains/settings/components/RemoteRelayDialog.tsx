import type { RemoteRelayTestResult } from "@preload/api-types/remote-pairing";
import { Input } from "@shared/components/ui/input";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta-org/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const RELAY_PATTERN = /^(wss?|https?):\/\/[^\s/]+/i;

/**
 * Settings for access away from this network: which relay carries it. Checks an
 * address on request and on save; an empty field means the default relay.
 */
export function RemoteRelayDialog({
	open,
	onOpenChange,
	relayBaseUrl,
	defaultRelayBaseUrl,
	onSave,
	onTest,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	relayBaseUrl?: string;
	defaultRelayBaseUrl?: string;
	onSave: (url: string | undefined) => Promise<boolean>;
	onTest: (url: string) => Promise<RemoteRelayTestResult>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const custom = relayBaseUrl && relayBaseUrl !== defaultRelayBaseUrl ? relayBaseUrl : "";
	const [draft, setDraft] = useState(custom);
	const [result, setResult] = useState<RemoteRelayTestResult | "testing" | "invalid">();
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setDraft(custom);
		setResult(undefined);
	}, [open, custom]);

	const address = draft.trim();
	const effective = address || defaultRelayBaseUrl || "";
	const valid = !address || RELAY_PATTERN.test(address);

	const test = async (): Promise<void> => {
		if (!valid || !effective) {
			setResult("invalid");
			return;
		}
		setResult("testing");
		setResult(await onTest(effective));
	};

	const save = async (url: string | undefined): Promise<void> => {
		if (url && !RELAY_PATTERN.test(url)) {
			setResult("invalid");
			return;
		}
		setSaving(true);
		const saved = await onSave(url);
		setSaving(false);
		if (saved) onOpenChange(false);
		else setResult("invalid");
	};

	const resultText =
		result === "testing"
			? t("remote.relay.testing")
			: result
				? t(`remote.relay.result.${result}`)
				: undefined;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle>{t("remote.relay.title")}</DialogTitle>
					<DialogDescription>{t("remote.relay.note")}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2 py-2">
					<label className="grid gap-1.5">
						<span className="text-[12px] font-medium text-foreground">{t("remote.relay.label")}</span>
						<Input
							value={draft}
							placeholder={defaultRelayBaseUrl}
							onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
								setDraft(event.target.value);
								setResult(undefined);
							}}
							spellCheck={false}
							autoComplete="off"
						/>
					</label>
					<div className="flex items-center gap-3 text-[12px] text-muted-foreground">
						<Button variant="outline" size="sm" disabled={saving || result === "testing"} onClick={() => void test()}>
							{t("remote.relay.test")}
						</Button>
						{resultText ? (
							<span
								role="status"
								className={result === "ok" ? "text-emerald-500" : result === "testing" ? "" : "text-destructive"}
							>
								{resultText}
							</span>
						) : defaultRelayBaseUrl ? (
							<span className="truncate">{t("remote.relay.defaultHint", { url: defaultRelayBaseUrl })}</span>
						) : null}
					</div>
				</div>
				<DialogFooter className="gap-2 sm:justify-between">
					<Button variant="ghost" size="sm" disabled={saving || !custom} onClick={() => void save(undefined)}>
						{t("remote.relay.restore")}
					</Button>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>
							{t("remote.relay.cancel")}
						</Button>
						<Button size="sm" disabled={saving || address === custom} onClick={() => void save(address || undefined)}>
							{t("remote.relay.save")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
