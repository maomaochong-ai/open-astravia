import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentTracePanel } from "./AgentTracePanel";

export function AgentTraceButton(): JSX.Element | null {
	const { t } = useTranslation("chat");
	const active = useAtomValue(activeSessionAtom);
	const [open, setOpen] = useState(false);
	if (!active?.runtimeId) return null;
	return (
		<>
			<Button variant="outline" size="sm" title={t("agentTraces.title")} onClick={() => setOpen(true)}>
				<span className="icon-[solar--pulse-linear] h-3.5 w-3.5" aria-hidden="true" />
				{t("agentTraces.title")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t("agentTraces.title")}</DialogTitle>
						<DialogDescription>{t("agentTraces.subtitle")}</DialogDescription>
					</DialogHeader>
					{open && <AgentTracePanel key={active.runtimeId} sessionId={active.runtimeId} />}
				</DialogContent>
			</Dialog>
		</>
	);
}
