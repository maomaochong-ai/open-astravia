import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui/select";
import { Switch } from "@shared/components/ui/switch";
import { Textarea } from "@shared/components/ui/textarea";
import type {
	PluginDeclarativeActionEvent,
	PluginDeclarativeInput,
	PluginDeclarativeNode,
	PluginDeclarativeSelect,
	PluginDeclarativeSwitch,
	PluginDeclarativeTextarea,
} from "@vetta-org/plugin-sdk";
import { useEffect, useState, useSyncExternalStore } from "react";

export interface QuickJsDeclarativeViewStore {
	getView(tabId: string): PluginDeclarativeNode | null;
	subscribe(tabId: string, listener: () => void): () => void;
	dispatch(event: PluginDeclarativeActionEvent): void;
}

function FieldLabel({ children }: { children: string }): JSX.Element {
	return <span className="text-[12px] font-medium text-foreground">{children}</span>;
}

function DeclarativeInput({
	node,
	tabId,
	dispatch,
}: {
	node: PluginDeclarativeInput;
	tabId: string;
	dispatch: (event: PluginDeclarativeActionEvent) => void;
}): JSX.Element {
	const [value, setValue] = useState(node.value ?? "");
	useEffect(() => setValue(node.value ?? ""), [node.value]);
	return (
		<label className="flex min-w-0 flex-1 flex-col gap-1.5">
			{node.label ? <FieldLabel>{node.label}</FieldLabel> : null}
			<Input
				type={node.inputType ?? "text"}
				value={value}
				placeholder={node.placeholder}
				disabled={node.disabled}
				onChange={(event) => {
					const nextValue = event.currentTarget.value;
					setValue(nextValue);
					dispatch({
						tabId,
						action: node.action,
						kind: "change",
						value: node.inputType === "number" && nextValue !== "" ? Number(nextValue) : nextValue,
					});
				}}
			/>
		</label>
	);
}

function DeclarativeTextarea({
	node,
	tabId,
	dispatch,
}: {
	node: PluginDeclarativeTextarea;
	tabId: string;
	dispatch: (event: PluginDeclarativeActionEvent) => void;
}): JSX.Element {
	const [value, setValue] = useState(node.value ?? "");
	useEffect(() => setValue(node.value ?? ""), [node.value]);
	return (
		<label className="flex min-w-0 flex-1 flex-col gap-1.5">
			{node.label ? <FieldLabel>{node.label}</FieldLabel> : null}
			<Textarea
				value={value}
				placeholder={node.placeholder}
				disabled={node.disabled}
				onChange={(event) => {
					const nextValue = event.currentTarget.value;
					setValue(nextValue);
					dispatch({ tabId, action: node.action, kind: "change", value: nextValue });
				}}
			/>
		</label>
	);
}

function DeclarativeSelect({
	node,
	tabId,
	dispatch,
}: {
	node: PluginDeclarativeSelect;
	tabId: string;
	dispatch: (event: PluginDeclarativeActionEvent) => void;
}): JSX.Element {
	const [value, setValue] = useState(node.value);
	useEffect(() => setValue(node.value), [node.value]);
	return (
		<label className="flex min-w-0 flex-1 flex-col gap-1.5">
			{node.label ? <FieldLabel>{node.label}</FieldLabel> : null}
			<Select
				value={value}
				disabled={node.disabled}
				onValueChange={(nextValue) => {
					setValue(nextValue);
					dispatch({ tabId, action: node.action, kind: "change", value: nextValue });
				}}
			>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={node.placeholder} />
				</SelectTrigger>
				<SelectContent>
					{node.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</label>
	);
}

function DeclarativeSwitch({
	node,
	tabId,
	dispatch,
}: {
	node: PluginDeclarativeSwitch;
	tabId: string;
	dispatch: (event: PluginDeclarativeActionEvent) => void;
}): JSX.Element {
	const [checked, setChecked] = useState(node.checked ?? false);
	useEffect(() => setChecked(node.checked ?? false), [node.checked]);
	return (
		<label className="flex min-h-8 items-center justify-between gap-3">
			<FieldLabel>{node.label}</FieldLabel>
			<Switch
				checked={checked}
				disabled={node.disabled}
				onCheckedChange={(nextChecked) => {
					setChecked(nextChecked);
					dispatch({ tabId, action: node.action, kind: "change", value: nextChecked });
				}}
			/>
		</label>
	);
}

const gapClass = {
	small: "gap-2",
	medium: "gap-3",
	large: "gap-4",
} as const;

const toneClass = {
	default: "text-foreground",
	muted: "text-muted-foreground",
	success: "text-emerald-400",
	warning: "text-amber-400",
	danger: "text-destructive",
} as const;

function DeclarativeNodeView({
	node,
	tabId,
	dispatch,
}: {
	node: PluginDeclarativeNode;
	tabId: string;
	dispatch: (event: PluginDeclarativeActionEvent) => void;
}): JSX.Element {
	switch (node.type) {
		case "stack":
			return (
				<div
					className={`flex min-w-0 ${node.direction === "horizontal" ? "flex-row flex-wrap items-end" : "flex-col"} ${gapClass[node.gap ?? "medium"]}`}
				>
					{node.children.map((child, index) => (
						<DeclarativeNodeView key={`${child.type}:${index}`} node={child} tabId={tabId} dispatch={dispatch} />
					))}
				</div>
			);
		case "section":
			return (
				<section className="flex min-w-0 flex-col gap-3 border-b border-border/50 pb-4 last:border-b-0 last:pb-0">
					{node.title || node.description ? (
						<header className="flex flex-col gap-1">
							{node.title ? <h3 className="text-[14px] font-semibold text-foreground">{node.title}</h3> : null}
							{node.description ? <p className="text-[12px] text-muted-foreground">{node.description}</p> : null}
						</header>
					) : null}
					<div className="flex min-w-0 flex-col gap-3">
						{node.children.map((child, index) => (
							<DeclarativeNodeView key={`${child.type}:${index}`} node={child} tabId={tabId} dispatch={dispatch} />
						))}
					</div>
				</section>
			);
		case "text": {
			const tone = toneClass[node.tone ?? "default"];
			if (node.style === "heading") return <h3 className={`text-[15px] font-semibold ${tone}`}>{node.text}</h3>;
			if (node.style === "caption") return <p className={`text-[11px] ${tone}`}>{node.text}</p>;
			if (node.style === "code") {
				return (
					<pre className={`max-w-full overflow-auto rounded-lg bg-muted/50 p-3 text-[12px] whitespace-pre-wrap ${tone}`}>
						<code>{node.text}</code>
					</pre>
				);
			}
			return <p className={`text-[13px] whitespace-pre-wrap ${tone}`}>{node.text}</p>;
		}
		case "button":
			return (
				<Button
					variant={node.variant ?? "default"}
					disabled={node.disabled}
					onClick={() => dispatch({ tabId, action: node.action, kind: "press" })}
				>
					{node.label}
				</Button>
			);
		case "input":
			return <DeclarativeInput node={node} tabId={tabId} dispatch={dispatch} />;
		case "textarea":
			return <DeclarativeTextarea node={node} tabId={tabId} dispatch={dispatch} />;
		case "select":
			return <DeclarativeSelect node={node} tabId={tabId} dispatch={dispatch} />;
		case "switch":
			return <DeclarativeSwitch node={node} tabId={tabId} dispatch={dispatch} />;
		case "divider":
			return <div className="h-px w-full bg-border/50" />;
	}
}

export function QuickJsDeclarativePanel({
	tabId,
	store,
}: {
	tabId: string;
	store: QuickJsDeclarativeViewStore;
}): JSX.Element | null {
	const view = useSyncExternalStore(
		(listener) => store.subscribe(tabId, listener),
		() => store.getView(tabId),
		() => store.getView(tabId),
	);
	if (!view) return null;
	return (
		<div className="min-h-0 flex-1 overflow-auto p-4">
			<DeclarativeNodeView node={view} tabId={tabId} dispatch={(event) => store.dispatch(event)} />
		</div>
	);
}
