export interface DesktopAppLifecycleApi {
	reportRendererBootPainted(): void;
	reportRendererContentPainted(): void;
	whenReady(): Promise<void>;
}
