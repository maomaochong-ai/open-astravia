export type DesktopThemeMode = "light" | "dark" | "auto";
export type DesktopResolvedThemeMode = "light" | "dark";
export type DesktopCursorStyle = "default" | "stoat";

export interface DesktopThemeSnapshot {
	mode: DesktopThemeMode;
	themeId: string;
	resolved: DesktopResolvedThemeMode | null;
	appliedThemeId: string | null;
	cursorStyle: DesktopCursorStyle;
}

export interface DesktopThemeChangeRequest {
	mode?: DesktopThemeMode;
	themeId?: string;
	cursorStyle?: DesktopCursorStyle;
}

export interface DesktopThemeOption {
	id: string;
	label: string;
}

export interface DesktopThemeHelp {
	state: DesktopThemeSnapshot;
	themes: DesktopThemeOption[];
}

export interface DesktopThemeApi {
	set(mode: "light" | "dark" | "system"): Promise<void>;
	getNative(): Promise<{ source: string; shouldUseDarkColors: boolean }>;
	onNativeChanged(handler: (info: { shouldUseDarkColors: boolean }) => void): () => void;
	onModeRequested(handler: (info: { mode: DesktopThemeMode }) => void): () => void;
	onChangeRequested(
		handler: (info: DesktopThemeChangeRequest) => DesktopThemeSnapshot | Promise<DesktopThemeSnapshot>,
	): () => void;
	onStateRequested(handler: () => DesktopThemeSnapshot | Promise<DesktopThemeSnapshot>): () => void;
	onHelpRequested(handler: () => DesktopThemeHelp | Promise<DesktopThemeHelp>): () => void;
}
