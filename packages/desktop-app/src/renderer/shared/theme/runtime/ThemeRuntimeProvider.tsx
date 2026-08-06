import type { DesktopThemePackage } from "@preload/api";
import { DEFAULT_THEME_MODULE, ThemeProvider, type ThemeModule } from "@vetta/theme-sdk";
import { AppBootLoadingView } from "@vetta/theme-ui/app";
import {
	type ErrorInfo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ThemeErrorBoundary } from "./ThemeErrorBoundary";
import { ThemeRuntimeContext } from "./ThemeRuntimeContext";
import { loadThemePackage } from "./themeLoader";
import type { ThemeRuntimeValue } from "./types";

const UI_THEME_STORAGE_KEY = "vetta-ui-theme";
const DEFAULT_UI_THEME_ID = "default";

function getStoredUiThemeId(): string {
	return localStorage.getItem(UI_THEME_STORAGE_KEY) ?? DEFAULT_UI_THEME_ID;
}

function formatMs(start: number): string {
	return `${(performance.now() - start).toFixed(1)}ms`;
}

export function ThemeRuntimeProvider({ children }: { children: ReactNode }): JSX.Element {
	const initialThemeIdRef = useRef(getStoredUiThemeId());
	const [activeTheme, setActiveTheme] = useState<ThemeModule>(DEFAULT_THEME_MODULE);
	const [availableThemes, setAvailableThemes] = useState<DesktopThemePackage[]>([]);
	const [status, setStatus] = useState<ThemeRuntimeValue["status"]>("loading");
	const [initialThemeReady, setInitialThemeReady] = useState(
		initialThemeIdRef.current === DEFAULT_THEME_MODULE.meta.id,
	);
	const didRestoreInitialThemeRef = useRef(false);
	const disposeRef = useRef<() => void>(() => {});

	const selectTheme = useCallback(async (themeId: string): Promise<void> => {
		const start = performance.now();
		console.info(`[theme-runtime] selectTheme "${themeId}"`);
		const listStart = performance.now();
		const themes = await window.vetta.themes.list();
		console.debug(`[theme-runtime] themes.list complete count=${themes.length} elapsed=${formatMs(listStart)}`);
		setAvailableThemes(themes);
		if (themeId === DEFAULT_THEME_MODULE.meta.id) {
			disposeRef.current();
			disposeRef.current = () => {};
			localStorage.setItem(UI_THEME_STORAGE_KEY, DEFAULT_THEME_MODULE.meta.id);
			setActiveTheme(DEFAULT_THEME_MODULE);
			setStatus("ready");
			console.info(`[theme-runtime] theme "${DEFAULT_THEME_MODULE.meta.id}" ready elapsed=${formatMs(start)}`);
			return;
		}
		const descriptor = themes.find((theme) => theme.id === themeId);
		if (!descriptor) {
			console.warn(`[theme-runtime] theme "${themeId}" not found elapsed=${formatMs(start)}, falling back to default`);
			disposeRef.current();
			disposeRef.current = () => {};
			localStorage.setItem(UI_THEME_STORAGE_KEY, DEFAULT_THEME_MODULE.meta.id);
			setActiveTheme(DEFAULT_THEME_MODULE);
			setStatus("error");
			return;
		}
		setStatus("loading");
		try {
			const loadStart = performance.now();
			const loaded = await loadThemePackage(descriptor);
			console.debug(`[theme-runtime] loadThemePackage awaited "${descriptor.id}" elapsed=${formatMs(loadStart)}`);
			disposeRef.current();
			disposeRef.current = loaded.dispose;
			localStorage.setItem(UI_THEME_STORAGE_KEY, descriptor.id);
			setActiveTheme(loaded.module);
			setStatus("ready");
			console.info(`[theme-runtime] theme "${descriptor.id}" ready elapsed=${formatMs(start)}`);
		} catch (error) {
			console.error(
				`[theme-runtime] theme "${themeId}" failed elapsed=${formatMs(start)}: ${error instanceof Error ? error.message : String(error)}`,
			);
			disposeRef.current();
			disposeRef.current = () => {};
			setActiveTheme(DEFAULT_THEME_MODULE);
			setStatus("error");
		}
	}, []);

	useEffect(() => {
		if (!didRestoreInitialThemeRef.current) {
			didRestoreInitialThemeRef.current = true;
			void selectTheme(initialThemeIdRef.current).finally(() => setInitialThemeReady(true));
		}
		return () => disposeRef.current();
	}, [selectTheme]);

	const handleThemeRenderError = useCallback(
		(error: Error, info: ErrorInfo): void => {
			console.error(`[theme-runtime] theme "${activeTheme.meta.id}" failed to render: ${error.message} ${JSON.stringify(info)}`);
			disposeRef.current();
			disposeRef.current = () => {};
			setActiveTheme(DEFAULT_THEME_MODULE);
			setStatus("error");
		},
		[activeTheme.meta.id],
	);

	const value = useMemo<ThemeRuntimeValue>(
		() => ({
			activeThemeId: activeTheme.meta.id,
			availableThemes: availableThemes.map((theme) => ({
				id: theme.id,
				source: theme.source,
				version: theme.version,
				sdkVersion: theme.sdkVersion,
				displayName: theme.displayName,
				entryUrl: theme.entryUrl,
			})),
			selectTheme,
			status,
		}),
		[activeTheme.meta.id, availableThemes, selectTheme, status],
	);

	const runtimeEffects = activeTheme.runtime ?? [];

	return (
		<ThemeRuntimeContext.Provider value={value}>
			<ThemeProvider theme={activeTheme}>
				<ThemeErrorBoundary key={activeTheme.meta.id} onError={handleThemeRenderError}>
					{initialThemeReady ? (
						<>
							{runtimeEffects.map((RuntimeEffect, index) => (
								<RuntimeEffect key={`${activeTheme.meta.id}:runtime:${index}`} />
							))}
							{children}
						</>
					) : (
						<AppBootLoadingView />
					)}
				</ThemeErrorBoundary>
			</ThemeProvider>
		</ThemeRuntimeContext.Provider>
	);
}
