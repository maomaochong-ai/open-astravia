import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useState } from "react";
import type { Side } from "../game/types";
import { ModelPicker } from "./ModelPicker";

interface NewGameScreenProps {
	onStart(side: Side, modelKey: string | null): void;
}

function SideCard({
	side,
	title,
	desc,
	selected,
	onSelect,
}: {
	side: Side;
	title: string;
	desc: string;
	selected: boolean;
	onSelect(): void;
}): JSX.Element {
	const red = side === "RED";
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={[
				"xq-side-card flex w-44 flex-col items-center gap-3 rounded-2xl border-2 px-5 py-6",
				selected
					? red
						? "border-[#c0392b] bg-[#c0392b0d] shadow-lg shadow-[#c0392b22]"
						: "border-[var(--foreground)] bg-[var(--accent)] shadow-lg"
					: "border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]",
			].join(" ")}
		>
			<span
				className={[
					"xq-cal flex size-16 items-center justify-center rounded-full border-4 text-3xl font-bold shadow-inner",
					red
						? "border-[#c0392b] bg-gradient-to-br from-[#fdf3d9] to-[#f0dcae] text-[#c0392b]"
						: "border-[#2f2a26] bg-gradient-to-br from-[#fdf3d9] to-[#f0dcae] text-[#2f2a26]",
				].join(" ")}
			>
				{red ? "帅" : "将"}
			</span>
			<span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
			<span className="text-center text-xs leading-relaxed text-[var(--muted-foreground)]">{desc}</span>
		</button>
	);
}

export function NewGameScreen(props: NewGameScreenProps): JSX.Element {
	const { t } = useTranslation();
	const [side, setSide] = useState<Side>("RED");
	const [modelKey, setModelKey] = useState<string | null>(null);
	return (
		<div className="flex h-full flex-col items-center justify-center gap-8 p-8">
			<div className="text-center">
				<div className="xq-cal text-3xl font-bold tracking-wide text-[var(--foreground)]">{t("newGame.title")}</div>
				<div className="mt-2 text-sm text-[var(--muted-foreground)]">{t("newGame.subtitle")}</div>
			</div>
			<div className="flex gap-5">
				<SideCard
					side="RED"
					title={t("newGame.red.title")}
					desc={t("newGame.red.desc")}
					selected={side === "RED"}
					onSelect={() => setSide("RED")}
				/>
				<SideCard
					side="BLACK"
					title={t("newGame.black.title")}
					desc={t("newGame.black.desc")}
					selected={side === "BLACK"}
					onSelect={() => setSide("BLACK")}
				/>
			</div>
			<div className="flex items-center gap-3">
				<span className="text-xs text-[var(--muted-foreground)]">{t("newGame.model")}</span>
				<ModelPicker value={modelKey} onChange={setModelKey} />
			</div>
			<button
				type="button"
				className="rounded-xl bg-[var(--primary)] px-8 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] shadow-md transition-transform hover:scale-[1.03] active:scale-[0.98]"
				onClick={() => props.onStart(side, modelKey)}
			>
				{t("newGame.start")}
			</button>
		</div>
	);
}
