import { Button } from "@shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import { Textarea } from "@shared/components/ui/textarea";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseResourceIds } from "../services/configuration-draft";

interface Props {
	readonly kind: "skills" | "tools" | "mcpServers" | "plugins";
	readonly value: string[] | null;
	readonly available: readonly string[];
	readonly onChange: (value: string[] | null) => void;
	readonly disabled: boolean;
}

export function ResourceSelectionField({ kind, value, available, onChange, disabled }: Props): JSX.Element {
	const { t } = useTranslation("chat");
	const id = useId();
	const [text, setText] = useState(value?.join("\n") ?? "");
	useEffect(() => {
		if (JSON.stringify(parseResourceIds(text)) !== JSON.stringify(value ?? [])) setText(value?.join("\n") ?? "");
	}, [value, text]);
	return (
		<fieldset className="space-y-2 rounded-xl border border-border/50 bg-card/40 p-3" disabled={disabled}>
			<legend className="px-1 text-[13px] font-medium">{t(`agentConfiguration.${kind}`)}</legend>
			<Select
				value={value === null ? "host" : "selected"}
				onValueChange={(mode) => onChange(mode === "host" ? null : [])}
				disabled={disabled}
			>
				<SelectTrigger aria-label={t(`agentConfiguration.${kind}`)}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="host">{t("agentConfiguration.hostResources")}</SelectItem>
					<SelectItem value="selected">{t("agentConfiguration.selectedResources")}</SelectItem>
				</SelectContent>
			</Select>
			{value !== null && (
				<>
					<label htmlFor={id} className="text-[12px] text-muted-foreground">
						{t("agentConfiguration.resourceIds")}
					</label>
					<Textarea
						id={id}
						value={text}
						onChange={(event) => {
							setText(event.target.value);
							onChange(parseResourceIds(event.target.value));
						}}
						className="min-h-16 text-[12px]"
						disabled={disabled}
					/>
					<p className="text-[11px] text-muted-foreground">{t("agentConfiguration.emptyDisables")}</p>
					<div className="flex max-h-28 flex-wrap gap-1 overflow-auto">
						{available.map((name) => (
							<Button
								key={name}
								type="button"
								size="sm"
								variant={value.includes(name) ? "secondary" : "outline"}
								aria-pressed={value.includes(name)}
								disabled={disabled}
								onClick={() => onChange(value.includes(name) ? value.filter((id) => id !== name) : [...value, name])}
							>
								{name}
							</Button>
						))}
					</div>
				</>
			)}
		</fieldset>
	);
}
