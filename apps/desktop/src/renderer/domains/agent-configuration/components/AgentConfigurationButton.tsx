import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentConfigurationPanel } from "./AgentConfigurationPanel";

export function AgentConfigurationButton({
	newSession = false,
}: {
	readonly newSession?: boolean;
}): JSX.Element | null {
	const { t } = useTranslation("chat");
	const active = useAtomValue(activeSessionAtom);
	const sessionId = newSession ? undefined : active?.runtimeId;
	const [open, setOpen] = useState(false);
	if (!newSession && !sessionId) return null;
	return (
		<>
			<Button variant="outline" size="sm" title={t("agentConfiguration.title")} onClick={() => setOpen(true)}>
				<span className="icon-[solar--settings-linear] h-3.5 w-3.5" aria-hidden="true" />
				{t("agentConfiguration.title")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t("agentConfiguration.title")}</DialogTitle>
						<DialogDescription>{t("agentConfiguration.subtitle")}</DialogDescription>
					</DialogHeader>
					{open && (
						<AgentConfigurationPanel key={sessionId ?? "new"} sessionId={sessionId} onApplied={() => setOpen(false)} />
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
