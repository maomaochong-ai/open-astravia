import { AGENT_TINT_PRESETS, agentTintPresetStyle, agentTintValue } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

const DEFAULT_CUSTOM_COLOR = "#7c8cf8";

export interface AgentAvatarBackgroundPickerProps {
	/** 档案里存的底座值：`tint:<preset>` 或 `#rrggbb`；未设置时按身份自动分配。 */
	readonly value: string | undefined;
	readonly onChange: (value: string | undefined) => void;
}

/** 头像底座选择：预设渐变 + 自定义纯色，第一项是「跟随身份自动分配」。 */
export function AgentAvatarBackgroundPicker({ value, onChange }: AgentAvatarBackgroundPickerProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const customColor = value?.startsWith("#") ? value : undefined;

	return (
		<fieldset>
			<legend className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
				{t("profile.avatarBackground")}
			</legend>
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-card/20 p-2.5">
				<button
					type="button"
					aria-label={t("profile.avatarBackgroundAuto")}
					aria-pressed={value === undefined}
					title={t("profile.avatarBackgroundAuto")}
					onClick={() => onChange(undefined)}
					className={[
						"flex h-7 w-7 items-center justify-center rounded-full bg-accent/60 text-muted-foreground outline-none transition-colors",
						value === undefined ? "ring-1 ring-primary" : "hover:text-foreground",
					].join(" ")}
				>
					<span className="icon-[solar--magic-stick-3-linear] h-3.5 w-3.5" aria-hidden="true" />
				</button>

				{AGENT_TINT_PRESETS.map((preset) => {
					const presetValue = agentTintValue(preset);
					return (
						<button
							key={preset}
							type="button"
							aria-label={t("profile.avatarBackgroundOption", { name: preset })}
							aria-pressed={value === presetValue}
							title={preset}
							onClick={() => onChange(presetValue)}
							style={agentTintPresetStyle(preset)}
							className={[
								"h-7 w-7 rounded-full outline-none transition-transform",
								value === presetValue ? "ring-1 ring-primary" : "ring-1 ring-border/60",
							].join(" ")}
						/>
					);
				})}

				<label
					className={[
						"relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full outline-none",
						customColor ? "ring-1 ring-primary" : "ring-1 ring-border/60",
					].join(" ")}
					style={customColor ? { backgroundColor: customColor } : undefined}
					title={t("profile.avatarBackgroundCustom")}
				>
					{!customColor && (
						<span className="icon-[solar--palette-linear] h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
					)}
					<input
						type="color"
						value={customColor ?? DEFAULT_CUSTOM_COLOR}
						aria-label={t("profile.avatarBackgroundCustom")}
						onChange={(event) => onChange(event.target.value)}
						className="absolute inset-0 cursor-pointer opacity-0"
					/>
				</label>
			</div>
		</fieldset>
	);
}
