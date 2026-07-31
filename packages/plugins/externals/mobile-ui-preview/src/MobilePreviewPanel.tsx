import { type PluginFsFileRef, useActivityTab, useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AndroidMockup, AndroidTabMockup, IPadMockup, IPhoneMockup } from "react-device-mockup";
import { DEFAULT_DEVICE_ID, DEVICE_PRESETS, findDevice, type DevicePreset } from "./devices";
import { getPluginCtx } from "./plugin-context";
import { StatusBar } from "./StatusBar";
import { isHtmlFile } from "./tab-visibility";

const STORAGE_DEVICE = "mobile-ui-preview:device";
const STORAGE_LANDSCAPE = "mobile-ui-preview:landscape";

function htmlStorageKey(cwd: string): string {
	return `mobile-ui-preview:html:${cwd}`;
}

/** 静态文件协议 URL（ADR-0027）：pathname 承载绝对路径，相对资源按目录解析。 */
function toFileProtocolUrl(filePath: string): string {
	return `vetta-file://local${encodeURI(filePath)}`;
}

function dirOf(filePath: string): string {
	const index = filePath.lastIndexOf("/");
	return index > 0 ? filePath.slice(0, index) : filePath;
}

const FRAME_COLOR = "#000000";

function DeviceFrame({
	device,
	landscape,
	screenWidth,
	children,
}: {
	device: DevicePreset;
	landscape: boolean;
	/** 物理渲染宽（缩放系数已乘入），库按此原生布局，无 transform 锯齿/接缝 */
	screenWidth: number;
	children: React.ReactNode;
}) {
	const common = {
		screenWidth,
		isLandscape: landscape,
		frameColor: FRAME_COLOR,
		// 状态栏区域并入屏幕，由我们在 children 顶部自绘仿真状态栏
		hideStatusBar: true,
		// 隐藏导航条（home indicator / 手势条），不渲染手势条，区域并入屏幕
		hideNavBar: true,
		// muip-mockup：给 frame 补黑底，消除 transform scale 下边框与内容间的亚像素接缝
		className: "muip-mockup",
	} as const;
	switch (device.frame.component) {
		case "iphone":
			return (
				<IPhoneMockup {...common} screenType={device.frame.screenType}>
					{children}
				</IPhoneMockup>
			);
		case "ipad":
			return (
				<IPadMockup {...common} screenType={device.frame.screenType}>
					{children}
				</IPadMockup>
			);
		case "android":
			return <AndroidMockup {...common}>{children}</AndroidMockup>;
		case "android-tab":
			return <AndroidTabMockup {...common}>{children}</AndroidTabMockup>;
	}
}

export function MobilePreviewPanel() {
	const { cwd } = useActivityTab();
	const { t } = useTranslation();
	const [deviceId, setDeviceId] = useState<string>(
		() => localStorage.getItem(STORAGE_DEVICE) ?? DEFAULT_DEVICE_ID,
	);
	const [landscape, setLandscape] = useState<boolean>(() => localStorage.getItem(STORAGE_LANDSCAPE) === "1");
	const [files, setFiles] = useState<PluginFsFileRef[]>([]);
	const [selectedRel, setSelectedRel] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	const device = findDevice(deviceId);

	const refreshFiles = useCallback(async () => {
		if (!cwd) {
			setFiles([]);
			return;
		}
		try {
			const all = await getPluginCtx()?.fs.listFilesRecursive(cwd);
			if (!all) {
				setFiles([]);
				return;
			}
			setFiles(all.filter((f) => isHtmlFile(f.name)));
		} catch {
			setFiles([]);
		}
	}, [cwd]);

	// 切换作用域：恢复该 cwd 记忆的 html 选择并重新扫描候选
	useEffect(() => {
		setSelectedRel(cwd ? localStorage.getItem(htmlStorageKey(cwd)) : null);
		void refreshFiles();
	}, [cwd, refreshFiles]);

	const selected = useMemo(
		() => files.find((f) => f.relPath === selectedRel) ?? null,
		[files, selectedRel],
	);
	const selectedPath = selected?.path ?? null;

	// 所选 html 所在目录变更（300ms 防抖）→ 自动 reload iframe
	useEffect(() => {
		if (!selectedPath) return;
		const dir = dirOf(selectedPath);
		const watch = getPluginCtx()?.fs.watchDirectory(dir, (changed) => {
			if (changed === dir) setReloadKey((k) => k + 1);
		});
		return () => watch?.dispose();
	}, [selectedPath]);

	const onSelectHtml = useCallback(
		(relPath: string) => {
			setSelectedRel(relPath);
			if (cwd) localStorage.setItem(htmlStorageKey(cwd), relPath);
		},
		[cwd],
	);

	const onSelectDevice = useCallback((id: string) => {
		setDeviceId(id);
		localStorage.setItem(STORAGE_DEVICE, id);
	}, []);

	const onToggleLandscape = useCallback(() => {
		setLandscape((prev) => {
			localStorage.setItem(STORAGE_LANDSCAPE, prev ? "0" : "1");
			return !prev;
		});
	}, []);

	const onRefresh = useCallback(() => {
		void refreshFiles();
		setReloadKey((k) => k + 1);
	}, [refreshFiles]);

	// 导出菜单：PNG（主进程 capturePage 截设备区域，iframe 跨源渲染端画不出）
	// 与工程化 Prompt（insertText 填入 AI 输入栏，不直接发送）
	const [exportOpen, setExportOpen] = useState(false);

	const onExportPng = useCallback(async () => {
		setExportOpen(false);
		const deviceEl = deviceRef.current;
		if (!deviceEl) return;
		// 等菜单关闭渲染完成，避免截进弹层
		await new Promise((resolve) => setTimeout(resolve, 80));
		const rect = deviceEl.getBoundingClientRect();
		const name = `${device.label.replace(/\s+/g, "-")}-${landscape ? "landscape" : "portrait"}.png`;
		await getPluginCtx()?.ui.captureRegion(
			{ x: rect.left, y: rect.top, width: rect.width, height: rect.height },
			name,
		);
	}, [device, landscape]);

	const onExportPrompt = useCallback(() => {
		setExportOpen(false);
		if (!selectedPath) return;
		getPluginCtx()?.conversation.insertText(
			`根据这个页面的html设计稿，转换成用于工程化的prompt：${selectedPath}`,
		);
	}, [selectedPath]);

	// 设备按物理尺寸原生渲染：缩放系数乘进 screenWidth，不再 transform 整机——
	// 整机 scale 会让边框/圆角先光栅化再重采样，产生圆角锯齿与层间细缝。
	// 外形尺寸与 screenWidth 成固定比例，用当前渲染的实测比例推目标宽，一次收敛。
	const containerRef = useRef<HTMLDivElement>(null);
	const deviceRef = useRef<HTMLDivElement>(null);
	const screenHostRef = useRef<HTMLDivElement>(null);
	const [renderWidth, setRenderWidth] = useState(device.width);
	const renderWidthRef = useRef(device.width);
	const [screenPhys, setScreenPhys] = useState<{ width: number; height: number } | null>(null);

	// 切机型/横竖屏：回到逻辑宽作为测量基准
	useLayoutEffect(() => {
		renderWidthRef.current = device.width;
		setRenderWidth(device.width);
		setScreenPhys(null);
	}, [device, landscape]);

	useLayoutEffect(() => {
		const container = containerRef.current;
		const deviceEl = deviceRef.current;
		if (!container || !deviceEl) return;
		const update = () => {
			const cw = container.clientWidth - 24;
			const ch = container.clientHeight - 24;
			const dw = deviceEl.offsetWidth;
			const dh = deviceEl.offsetHeight;
			const cur = renderWidthRef.current;
			if (cw <= 0 || ch <= 0 || dw <= 0 || dh <= 0 || cur <= 0) return;
			const target = Math.max(
				120,
				Math.min(Math.floor((cw * cur) / dw), Math.floor((ch * cur) / dh), device.width),
			);
			if (Math.abs(target - cur) > 1) {
				renderWidthRef.current = target;
				setRenderWidth(target);
				return; // 重布局后 ResizeObserver 会再次进来量屏幕区
			}
			const screenEl = screenHostRef.current;
			if (!screenEl) return;
			const width = screenEl.clientWidth;
			const height = screenEl.clientHeight;
			if (width <= 0 || height <= 0) return;
			setScreenPhys((prev) =>
				prev && prev.width === width && prev.height === height ? prev : { width, height },
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(container);
		observer.observe(deviceEl);
		return () => observer.disconnect();
	}, [device, landscape]);

	// iframe 保持设备逻辑分辨率视口，自身 scale 缩进物理屏幕区
	const scale = renderWidth / device.width;

	const groups = useMemo(() => {
		const map = new Map<string, DevicePreset[]>();
		for (const preset of DEVICE_PRESETS) {
			const list = map.get(preset.group) ?? [];
			list.push(preset);
			map.set(preset.group, list);
		}
		return [...map.entries()];
	}, []);

	const selectCls =
		"h-[26px] max-w-[160px] truncate rounded-[7px] border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-[var(--background)] px-[6px] text-[12px] text-[var(--foreground)] outline-none";
	const iconBtn =
		"flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-[13px] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]";

	// 沉浸式：HTML 内容占满整个屏幕区域（从最顶部开始），状态栏悬浮其上。
	// 容器黑底与设备边框同色；iframe 以逻辑分辨率渲染、自身 scale 缩放，
	// 四周保留 ≥1 物理 px 出血（被 overflow 裁掉）盖住缩放边缘的接缝线。
	const screenContent = (
		<div ref={screenHostRef} className="relative h-full w-full overflow-hidden bg-black">
			{selected && screenPhys && scale > 0 ? (
				<iframe
					key={reloadKey}
					src={toFileProtocolUrl(selected.path)}
					sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
					className="absolute border-0 bg-white outline-none"
					style={{
						left: -1,
						top: -1,
						width: Math.ceil((screenPhys.width + 2) / scale),
						height: Math.ceil((screenPhys.height + 2) / scale),
						transform: `scale(${scale})`,
						transformOrigin: "0 0",
						border: "none",
						outline: "none",
					}}
					title={t("panel.previewTitle")}
				/>
			) : !selected ? (
				<div
					className="flex h-full w-full flex-col items-center justify-center gap-[12px] overflow-y-auto p-[20px] text-[#999]"
					style={{ paddingTop: Math.round(device.statusBarHeight * scale) + 12 }}
				>
					<div className="text-[13px] text-[#bbb]">{t("panel.emptyHint")}</div>
					{files.length > 0 ? (
						<div className="flex max-h-[60%] w-full max-w-[320px] flex-col gap-[4px] overflow-y-auto">
							{files.map((file) => (
								<button
									key={file.relPath}
									type="button"
									className="truncate rounded-[8px] bg-[#1c1c1e] px-[10px] py-[6px] text-left text-[12px] text-[#ddd] hover:bg-[#2a2a2d]"
									onClick={() => onSelectHtml(file.relPath)}
								>
									{file.relPath}
								</button>
							))}
						</div>
					) : (
						<div className="text-[12px] text-[#777]">
							{cwd ? t("panel.noHtml") : t("panel.noScope")}
						</div>
					)}
				</div>
			) : null}
			{/* 状态栏按逻辑尺寸绘制、随设备等比缩放（包装层 scale），与屏幕内容比例一致 */}
			<div
				className="pointer-events-none absolute left-0 top-0 z-10"
				style={{ width: device.width, transform: `scale(${scale})`, transformOrigin: "0 0" }}
			>
				<StatusBar os={device.os} height={device.statusBarHeight} />
			</div>
		</div>
	);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--muted)]">
			<div className="flex shrink-0 items-center gap-[6px] border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] px-[10px] py-[7px]">
				<select
					className={`${selectCls} min-w-0 flex-1`}
					value={selectedRel ?? ""}
					onChange={(e) => onSelectHtml(e.target.value)}
					title={t("panel.selectHtmlTitle")}
				>
					<option value="" disabled>
						{t("panel.selectHtmlPlaceholder")}
					</option>
					{files.map((file) => (
						<option key={file.relPath} value={file.relPath}>
							{file.relPath}
						</option>
					))}
				</select>
				<select
					className={selectCls}
					value={device.id}
					onChange={(e) => onSelectDevice(e.target.value)}
					title={t("panel.selectDeviceTitle")}
				>
					{groups.map(([group, presets]) => (
						<optgroup key={group} label={t(`group.${group}`)}>
							{presets.map((preset) => (
								<option key={preset.id} value={preset.id}>
									{preset.labelKey ? t(preset.labelKey) : preset.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
				<button
					type="button"
					className={iconBtn}
					title={landscape ? t("panel.toPortrait") : t("panel.toLandscape")}
					onClick={onToggleLandscape}
				>
					<svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8">
						<rect x="7.5" y="3.5" width="9" height="17" rx="2" />
						<path d="M3.5 12a8.5 8.5 0 0 1 2.5-6M20.5 12a8.5 8.5 0 0 1-2.5 6" strokeLinecap="round" />
						<path d="M5 3.5 6 6l-2.6.6M19 20.5 18 18l2.6-.6" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
				<button type="button" className={iconBtn} title={t("panel.refresh")} onClick={onRefresh}>
					<svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8">
						<path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
						<path d="M20 3v4h-4" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
				<div className="relative shrink-0">
					<button type="button" className={iconBtn} title={t("panel.export")} onClick={() => setExportOpen((v) => !v)}>
						<svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8">
							<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
							<path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" strokeLinecap="round" />
						</svg>
					</button>
					{exportOpen && (
						<>
							<div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} aria-hidden />
							<div className="absolute right-0 top-[30px] z-20 flex w-[168px] flex-col gap-[2px] rounded-[9px] border border-[var(--border)] bg-[var(--popover,var(--background))] p-[4px] shadow-lg">
								<button
									type="button"
									className="rounded-[6px] px-[10px] py-[6px] text-left text-[12px] text-[var(--foreground)] hover:bg-[var(--accent)]"
									onClick={() => void onExportPng()}
								>
									{t("panel.exportPng")}
								</button>
								<button
									type="button"
									disabled={!selectedPath}
									className="rounded-[6px] px-[10px] py-[6px] text-left text-[12px] text-[var(--foreground)] hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
									onClick={onExportPrompt}
								>
									{t("panel.exportPrompt")}
								</button>
							</div>
						</>
					)}
				</div>
			</div>

			<div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
				<div ref={deviceRef}>
					<DeviceFrame device={device} landscape={landscape} screenWidth={renderWidth}>
						{screenContent}
					</DeviceFrame>
				</div>
			</div>
		</div>
	);
}
