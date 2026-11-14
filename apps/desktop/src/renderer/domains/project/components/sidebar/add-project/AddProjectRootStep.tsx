import { SplashFooter, SplashOptionRow, SplashTitleHeader } from "@astravia-org/theme-ui/overlays";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AddProjectMenuItemModel } from "./types";
import { useEscapeKey } from "./useEscapeKey";

interface AddProjectRootStepProps {
	items: AddProjectMenuItemModel[];
	onClose: () => void;
}

/** 第一步：入口列表。↑↓ 在选项间移动，回车确认，与 ⌘K 的操作习惯一致。 */
export function AddProjectRootStep({ items, onClose }: AddProjectRootStepProps): JSX.Element {
	const { t } = useTranslation("project");
	const listRef = useRef<HTMLDivElement>(null);
	useEscapeKey(onClose);

	useEffect(() => {
		const frame = requestAnimationFrame(() => listRef.current?.querySelector("button")?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);

	const move = (delta: 1 | -1): void => {
		const buttons = Array.from(listRef.current?.querySelectorAll("button") ?? []);
		if (buttons.length === 0) return;
		const index = buttons.findIndex((button) => button === document.activeElement);
		buttons[(index + delta + buttons.length) % buttons.length]?.focus();
	};

	return (
		<>
			<SplashTitleHeader title={t("addProjectSplash.title")} />
			<div
				ref={listRef}
				className="flex flex-col gap-0.5 px-1.5 py-1.5"
				onKeyDown={(event) => {
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					event.preventDefault();
					move(event.key === "ArrowDown" ? 1 : -1);
				}}
			>
				{items.map((item) => (
					<SplashOptionRow
						key={item.action}
						icon={item.icon}
						title={t(item.labelKey)}
						description={t(item.descriptionKey)}
						onSelect={item.onSelect}
					/>
				))}
			</div>
			<SplashFooter>
				<span>{t("addProjectSplash.hintNavigate")}</span>
				<span>{t("addProjectSplash.hintSelect")}</span>
				<span className="ml-auto">{t("addProjectSplash.hintClose")}</span>
			</SplashFooter>
		</>
	);
}
