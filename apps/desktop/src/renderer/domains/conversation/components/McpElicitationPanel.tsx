import type {
	DesktopMcpElicitationField,
	DesktopMcpElicitationRequest,
	DesktopMcpElicitationValue,
} from "@preload/api";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import { Switch } from "@shared/components/ui/switch";
import { pendingMcpElicitationsAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type FieldState = string | number | boolean | string[] | undefined;

export function McpElicitationPanel({ request }: { request: DesktopMcpElicitationRequest }): JSX.Element {
	const { t } = useTranslation(["chat", "common"]);
	const setPending = useSetAtom(pendingMcpElicitationsAtom);
	const [values, setValues] = useState<Record<string, FieldState>>(() => initialValues(request));
	const [submitting, setSubmitting] = useState(false);
	const isValid = useMemo(
		() => request.mode === "url" || request.fields.every((field) => validateField(field, values[field.key])),
		[request, values],
	);
	const remove = (): void => {
		setPending((previous) => {
			if (previous[request.sessionId]?.requestId !== request.requestId) return previous;
			const next = { ...previous };
			delete next[request.sessionId];
			return next;
		});
	};
	const respond = (action: "accept" | "decline" | "cancel", content?: Record<string, DesktopMcpElicitationValue>): void => {
		if (submitting) return;
		setSubmitting(true);
		void window.vetta.session
			.respondToMcpElicitation(request.requestId, { action, ...(content ? { content } : {}) })
			.then(remove)
			.catch(() => setSubmitting(false));
	};
	const accept = (): void => {
		if (!isValid) return;
		if (request.mode === "url") {
			setSubmitting(true);
			void (async () => {
				try {
					await window.vetta.shell.openExternal(request.url);
					await window.vetta.session.respondToMcpElicitation(request.requestId, { action: "accept" });
					remove();
				} catch {
					try {
						await window.vetta.session.respondToMcpElicitation(request.requestId, { action: "cancel" });
						remove();
					} catch {
						setSubmitting(false);
					}
				}
			})();
			return;
		}
		respond("accept", collectValues(request.fields, values));
	};

	return (
		<section
			aria-label={t("mcpElicitation.title")}
			className="mx-auto max-h-[60vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border/60 bg-popover p-4 shadow-lg"
		>
			<div className="flex items-start gap-3">
				<span className="icon-[solar--clipboard-text-linear] mt-0.5 size-4 shrink-0 text-primary" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between gap-3">
						<h2 className="text-[14px] font-medium text-foreground">{t("mcpElicitation.title")}</h2>
						<span className="truncate text-[11px] text-muted-foreground">
							{t("mcpElicitation.source", { server: request.serverName })}
						</span>
					</div>
					<p className="mt-1 text-[13px] leading-5 text-muted-foreground">{request.message}</p>
				</div>
			</div>

			{request.mode === "url" ? (
				<div className="mt-4 rounded-lg border border-border/50 bg-card/40 px-3 py-2.5">
					<p className="break-all text-[12px] text-foreground">{request.url}</p>
					<p className="mt-1 text-[11px] text-muted-foreground">{t("mcpElicitation.urlNotice")}</p>
				</div>
			) : (
				<div className="mt-4 grid gap-3">
					{request.fields.map((field) => (
						<ElicitationField
							key={field.key}
							field={field}
							value={values[field.key]}
							onChange={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))}
						/>
					))}
				</div>
			)}

			<div className="mt-4 flex flex-wrap justify-end gap-2">
				<Button variant="ghost" onClick={() => respond("cancel")} disabled={submitting}>
					{t("common:actions.cancel")}
				</Button>
				<Button variant="outline" onClick={() => respond("decline")} disabled={submitting}>
					{t("mcpElicitation.decline")}
				</Button>
				<Button onClick={accept} disabled={submitting || !isValid}>
					{request.mode === "url" ? t("mcpElicitation.openAndContinue") : t("mcpElicitation.submit")}
				</Button>
			</div>
		</section>
	);
}

function ElicitationField({
	field,
	value,
	onChange,
}: {
	field: DesktopMcpElicitationField;
	value: FieldState;
	onChange: (value: FieldState) => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const label = `${field.title}${field.required ? ` ${t("mcpElicitation.required")}` : ""}`;
	return (
		<label className="grid gap-1.5 text-[12px] text-foreground">
			<span>{label}</span>
			{field.description && <span className="text-[11px] text-muted-foreground">{field.description}</span>}
			{field.kind === "boolean" ? (
				<span className="flex items-center gap-2">
					<Switch checked={value === true} onCheckedChange={onChange} aria-label={field.title} />
					<span className="text-[11px] text-muted-foreground">
						{value === true ? t("mcpElicitation.enabled") : t("mcpElicitation.disabled")}
					</span>
				</span>
			) : field.kind === "single-select" ? (
				<Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
					<SelectTrigger aria-label={field.title}>
						<SelectValue placeholder={t("mcpElicitation.selectPlaceholder")} />
					</SelectTrigger>
					<SelectContent>
						{field.options?.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : field.kind === "multi-select" ? (
				<span className="grid gap-1.5 rounded-lg border border-border/50 bg-card/30 p-2.5">
					{field.options?.map((option) => {
						const selected = Array.isArray(value) && value.includes(option.value);
						return (
							<label key={option.value} className="flex items-center gap-2 text-[12px]">
								<input
									type="checkbox"
									checked={selected}
									onChange={() => {
										const current = Array.isArray(value) ? value : [];
										onChange(
											selected ? current.filter((item) => item !== option.value) : [...current, option.value],
										);
									}}
								/>
								{option.label}
							</label>
						);
					})}
				</span>
			) : (
				<Input
					aria-label={field.title}
					type={inputType(field)}
					value={typeof value === "string" || typeof value === "number" ? value : ""}
					min={field.minimum}
					max={field.maximum}
					minLength={field.minLength}
					maxLength={field.maxLength}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</label>
	);
}

function initialValues(request: DesktopMcpElicitationRequest): Record<string, FieldState> {
	if (request.mode === "url") return {};
	return Object.fromEntries(
		request.fields.map((field) => [
			field.key,
			field.defaultValue ?? (field.kind === "multi-select" ? [] : field.kind === "boolean" ? false : ""),
		]),
	);
}

function validateField(field: DesktopMcpElicitationField, value: FieldState): boolean {
	if (field.kind === "boolean") return typeof value === "boolean";
	if (field.kind === "multi-select") {
		const count = Array.isArray(value) ? value.length : 0;
		return (!field.required || count > 0) &&
			(field.minItems === undefined || count >= field.minItems) &&
			(field.maxItems === undefined || count <= field.maxItems);
	}
	if (field.kind === "number" || field.kind === "integer") {
		if (value === "" || value === undefined) return !field.required;
		const number = typeof value === "number" ? value : Number(value);
		return Number.isFinite(number) &&
			(field.kind !== "integer" || Number.isInteger(number)) &&
			(field.minimum === undefined || number >= field.minimum) &&
			(field.maximum === undefined || number <= field.maximum);
	}
	const text = typeof value === "string" ? value : "";
	return (!field.required || text.length > 0) &&
		(field.minLength === undefined || text.length >= field.minLength) &&
		(field.maxLength === undefined || text.length <= field.maxLength);
}

function collectValues(
	fields: readonly DesktopMcpElicitationField[],
	values: Record<string, FieldState>,
): Record<string, DesktopMcpElicitationValue> {
	const result: Record<string, DesktopMcpElicitationValue> = {};
	for (const field of fields) {
		const value = values[field.key];
		if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0 && !field.required)) continue;
		result[field.key] =
			field.kind === "number" || field.kind === "integer" ? Number(value) : (value as DesktopMcpElicitationValue);
	}
	return result;
}

function inputType(field: DesktopMcpElicitationField): string {
	if (field.kind === "number" || field.kind === "integer") return "number";
	if (field.format === "email") return "email";
	if (field.format === "uri") return "url";
	if (field.format === "date") return "date";
	if (field.format === "date-time") return "datetime-local";
	return "text";
}
