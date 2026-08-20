import { createRequire } from "node:module";
import type { RemoteInputMessage } from "@vetta/remote-desktop";
import { systemPreferences } from "electron";
import type * as Koffi from "koffi";
import { getAppLogger } from "../logger.js";

export interface SystemInputAdapter {
	readonly supported: boolean;
	setEnabled(enabled: boolean): void;
	apply(message: RemoteInputMessage): void;
}

const log = (() => {
	try {
		return getAppLogger("remote-desktop-input");
	} catch {
		return {
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
		};
	}
})();

/**
 * System input is deliberately opt-in. Remote media can be enabled without
 * granting a relay peer the ability to control the local machine.
 */
export function createSystemInputAdapter(options: { readonly enabled: boolean }): SystemInputAdapter {
	try {
		const adapter =
			process.platform === "win32"
				? createWindowsInputAdapter()
				: process.platform === "darwin"
					? createMacInputAdapter()
					: process.platform === "linux"
						? createLinuxX11InputAdapter()
						: unsupportedInputAdapter("unsupported_platform");
		adapter.setEnabled(options.enabled);
		return adapter;
	} catch (error) {
		log.warn("remote input adapter initialization failed", {
			platform: process.platform,
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return unsupportedInputAdapter("unsupported_platform");
}

function unsupportedInputAdapter(reason: string): SystemInputAdapter {
	return {
		supported: false,
		setEnabled: () => undefined,
		apply(message) {
			log.debug("remote input ignored", { type: message.type, reason });
		},
	};
}

function createWindowsInputAdapter(): SystemInputAdapter {
	// Loaded lazily so Linux/macOS builds do not resolve the native DLL binding.
	const koffi = createRequire(import.meta.url)("koffi") as typeof Koffi;
	const user32 = koffi.load("user32.dll");
	const MOUSEINPUT = koffi.struct({
		dx: "long",
		dy: "long",
		mouseData: "uint32_t",
		dwFlags: "uint32_t",
		time: "uint32_t",
		dwExtraInfo: "uintptr_t",
	});
	const KEYBDINPUT = koffi.struct({
		wVk: "uint16_t",
		wScan: "uint16_t",
		dwFlags: "uint32_t",
		time: "uint32_t",
		dwExtraInfo: "uintptr_t",
	});
	const HARDWAREINPUT = koffi.struct({
		uMsg: "uint32_t",
		wParamL: "uint16_t",
		wParamH: "uint16_t",
	});
	const INPUT = koffi.struct("INPUT", {
		type: "uint32_t",
		u: koffi.union({ mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }),
	});
	const SendInput = user32.func("uint32 __stdcall SendInput(uint32, _In_ INPUT *, int)");
	const SetCursorPos = user32.func("int __stdcall SetCursorPos(int, int)");
	const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int)");
	const MapVirtualKey = user32.func("uint32 __stdcall MapVirtualKeyW(uint32, uint32)");

	let enabled = true;
	return {
		supported: true,
		setEnabled(value) {
			enabled = value;
			log.info("remote input grant changed", { enabled: value });
		},
		apply(message) {
			if (!enabled) return;
			if (message.type === "pointer.move" || message.type === "pointer.button") {
				const width = GetSystemMetrics(0);
				const height = GetSystemMetrics(1);
				SetCursorPos(
					Math.round(message.x * Math.max(1, width - 1)),
					Math.round(message.y * Math.max(1, height - 1)),
				);
				if (message.type === "pointer.button") {
					const flags = buttonFlag(message.button, message.action);
					SendInput(
						1,
						{ type: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } },
						koffi.sizeof(INPUT),
					);
				}
				return;
			}
			if (message.type === "pointer.scroll") {
				SendInput(
					1,
					{
						type: 0,
						u: {
							mi: { dx: 0, dy: 0, mouseData: message.deltaY >>> 0, dwFlags: 0x0800, time: 0, dwExtraInfo: 0 },
						},
					},
					koffi.sizeof(INPUT),
				);
				return;
			}
			if (message.type === "key") {
				const key = virtualKey(message.code);
				if (!key) return;
				const scan = MapVirtualKey(key.virtualKey, 0);
				const flags = 0x0008 | (key.extended ? 0x0001 : 0) | (message.action === "up" ? 0x0002 : 0);
				SendInput(
					1,
					{ type: 1, u: { ki: { wVk: 0, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } } },
					koffi.sizeof(INPUT),
				);
			}
		},
	};
}

function createMacInputAdapter(): SystemInputAdapter {
	if (!systemPreferences.isTrustedAccessibilityClient(false)) {
		log.warn("macOS accessibility permission is required for remote input");
		return unsupportedInputAdapter("accessibility_permission_required");
	}
	const koffi = createRequire(import.meta.url)("koffi") as typeof Koffi;
	const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
	const coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
	const _CGPoint = koffi.struct("CGPoint", { x: "double", y: "double" });
	const CGEventCreateMouseEvent = coreGraphics.func("void *CGEventCreateMouseEvent(void *, uint32, CGPoint, uint32)");
	const CGEventCreateKeyboardEvent = coreGraphics.func("void *CGEventCreateKeyboardEvent(void *, uint16, bool)");
	const CGEventCreateScrollWheelEvent = coreGraphics.func(
		"void *CGEventCreateScrollWheelEvent(void *, uint32, uint32, int32, int32)",
	);
	const CGEventPost = coreGraphics.func("void CGEventPost(uint32, void *)");
	const CGMainDisplayID = coreGraphics.func("uint32 CGMainDisplayID()");
	const CGDisplayPixelsWide = coreGraphics.func("size_t CGDisplayPixelsWide(uint32)");
	const CGDisplayPixelsHigh = coreGraphics.func("size_t CGDisplayPixelsHigh(uint32)");
	const CFRelease = coreFoundation.func("void CFRelease(void *)");
	let enabled = true;
	const post = (event: unknown): void => {
		if (!event) return;
		CGEventPost(0, event);
		CFRelease(event);
	};
	return {
		supported: true,
		setEnabled(value) {
			enabled = value;
			log.info("remote input grant changed", { enabled: value, platform: "darwin" });
		},
		apply(message) {
			if (!enabled) return;
			if (message.type === "pointer.move" || message.type === "pointer.button") {
				const display = CGMainDisplayID();
				const point = {
					x: message.x * Math.max(1, Number(CGDisplayPixelsWide(display)) - 1),
					y: message.y * Math.max(1, Number(CGDisplayPixelsHigh(display)) - 1),
				};
				const eventType = message.type === "pointer.move" ? 5 : macMouseEventType(message.button, message.action);
				post(
					CGEventCreateMouseEvent(
						null,
						eventType,
						point,
						message.type === "pointer.button" ? macMouseButton(message.button) : 0,
					),
				);
				return;
			}
			if (message.type === "pointer.scroll") {
				post(CGEventCreateScrollWheelEvent(null, 0, 2, Math.round(-message.deltaY), Math.round(-message.deltaX)));
				return;
			}
			if (message.type === "key") {
				const keyCode = macVirtualKey(message.code);
				if (keyCode !== undefined) post(CGEventCreateKeyboardEvent(null, keyCode, message.action === "down"));
			}
		},
	};
}

function createLinuxX11InputAdapter(): SystemInputAdapter {
	if (!process.env.DISPLAY) return unsupportedInputAdapter("x11_display_unavailable");
	const koffi = createRequire(import.meta.url)("koffi") as typeof Koffi;
	const x11 = koffi.load("libX11.so.6");
	const xtst = koffi.load("libXtst.so.6");
	const XOpenDisplay = x11.func("void *XOpenDisplay(char *)");
	const XFlush = x11.func("int XFlush(void *)");
	const XDefaultScreen = x11.func("int XDefaultScreen(void *)");
	const XDisplayWidth = x11.func("int XDisplayWidth(void *, int)");
	const XDisplayHeight = x11.func("int XDisplayHeight(void *, int)");
	const XStringToKeysym = x11.func("uintptr_t XStringToKeysym(char *)");
	const XKeysymToKeycode = x11.func("uint8_t XKeysymToKeycode(void *, uintptr_t)");
	const XTestFakeMotionEvent = xtst.func("int XTestFakeMotionEvent(void *, int, int, int, ulong)");
	const XTestFakeButtonEvent = xtst.func("int XTestFakeButtonEvent(void *, uint32, bool, ulong)");
	const XTestFakeKeyEvent = xtst.func("int XTestFakeKeyEvent(void *, uint32, bool, ulong)");
	const display = XOpenDisplay(null);
	if (!display) return unsupportedInputAdapter("x11_open_display_failed");
	let enabled = true;
	return {
		supported: true,
		setEnabled(value) {
			enabled = value;
			log.info("remote input grant changed", { enabled: value, platform: "linux-x11" });
			if (!value) XFlush(display);
		},
		apply(message) {
			if (!enabled) return;
			if (message.type === "pointer.move" || message.type === "pointer.button") {
				const screen = XDefaultScreen(display);
				XTestFakeMotionEvent(
					display,
					screen,
					Math.round(message.x * (XDisplayWidth(display, screen) - 1)),
					Math.round(message.y * (XDisplayHeight(display, screen) - 1)),
					0,
				);
				if (message.type === "pointer.button")
					XTestFakeButtonEvent(display, linuxMouseButton(message.button), message.action === "down", 0);
			} else if (message.type === "pointer.scroll") {
				const button = message.deltaY < 0 ? 4 : 5;
				for (
					let count = 0;
					count < Math.max(1, Math.min(12, Math.round(Math.abs(message.deltaY) / 40)));
					count += 1
				) {
					XTestFakeButtonEvent(display, button, true, 0);
					XTestFakeButtonEvent(display, button, false, 0);
				}
			} else if (message.type === "key") {
				const keysym = XStringToKeysym(linuxKeySym(message.code));
				const keyCode = XKeysymToKeycode(display, keysym);
				if (keyCode) XTestFakeKeyEvent(display, keyCode, message.action === "down", 0);
			}
			XFlush(display);
		},
	};
}

function macMouseButton(button: "left" | "middle" | "right"): number {
	return button === "left" ? 0 : button === "right" ? 1 : 2;
}

function macMouseEventType(button: "left" | "middle" | "right", action: "down" | "up"): number {
	if (button === "left") return action === "down" ? 1 : 2;
	if (button === "right") return action === "down" ? 3 : 4;
	return action === "down" ? 25 : 26;
}

function macVirtualKey(code: string): number | undefined {
	const keys: Record<string, number> = {
		KeyA: 0,
		KeyS: 1,
		KeyD: 2,
		KeyF: 3,
		KeyH: 4,
		KeyG: 5,
		KeyZ: 6,
		KeyX: 7,
		KeyC: 8,
		KeyV: 9,
		KeyB: 11,
		KeyQ: 12,
		KeyW: 13,
		KeyE: 14,
		KeyR: 15,
		KeyY: 16,
		KeyT: 17,
		Digit1: 18,
		Digit2: 19,
		Digit3: 20,
		Digit4: 21,
		Digit6: 22,
		Digit5: 23,
		Digit9: 25,
		Digit7: 26,
		Digit8: 28,
		Digit0: 29,
		KeyO: 31,
		KeyU: 32,
		KeyI: 34,
		KeyP: 35,
		Enter: 36,
		KeyL: 37,
		KeyJ: 38,
		KeyK: 40,
		Tab: 48,
		Space: 49,
		Backspace: 51,
		Escape: 53,
		MetaLeft: 55,
		ShiftLeft: 56,
		AltLeft: 58,
		ControlLeft: 59,
		ArrowLeft: 123,
		ArrowRight: 124,
		ArrowDown: 125,
		ArrowUp: 126,
		Delete: 117,
		Home: 115,
		End: 119,
		PageUp: 116,
		PageDown: 121,
	};
	return keys[code];
}

function linuxMouseButton(button: "left" | "middle" | "right"): number {
	return button === "left" ? 1 : button === "middle" ? 2 : 3;
}

function linuxKeySym(code: string): string {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	return (
		(
			{
				Enter: "Return",
				Escape: "Escape",
				Backspace: "BackSpace",
				Tab: "Tab",
				Space: "space",
				ArrowUp: "Up",
				ArrowDown: "Down",
				ArrowLeft: "Left",
				ArrowRight: "Right",
				Delete: "Delete",
				Home: "Home",
				End: "End",
				PageUp: "Page_Up",
				PageDown: "Page_Down",
				ShiftLeft: "Shift_L",
				ControlLeft: "Control_L",
				AltLeft: "Alt_L",
				MetaLeft: "Super_L",
			} as Record<string, string>
		)[code] ?? code
	);
}

function buttonFlag(button: "left" | "middle" | "right", action: "down" | "up"): number {
	const flags = {
		left: [0x0002, 0x0004],
		middle: [0x0020, 0x0040],
		right: [0x0008, 0x0010],
	} as const;
	return flags[button][action === "down" ? 0 : 1];
}

function virtualKey(code: string): { readonly virtualKey: number; readonly extended?: boolean } | undefined {
	if (/^Key[A-Z]$/.test(code)) return { virtualKey: code.charCodeAt(3) };
	if (/^Digit[0-9]$/.test(code)) return { virtualKey: code.charCodeAt(5) };
	const virtualKey = {
		Enter: 0x0d,
		Escape: 0x1b,
		Backspace: 0x08,
		Tab: 0x09,
		Space: 0x20,
		ArrowUp: 0x26,
		ArrowDown: 0x28,
		ArrowLeft: 0x25,
		ArrowRight: 0x27,
		Delete: 0x2e,
		Home: 0x24,
		End: 0x23,
		PageUp: 0x21,
		PageDown: 0x22,
		ShiftLeft: 0xa0,
		ControlLeft: 0xa2,
		AltLeft: 0xa4,
		MetaLeft: 0x5b,
	} as Record<string, number>;
	const value = virtualKey[code];
	return value === undefined
		? undefined
		: { virtualKey: value, extended: /^(Arrow|Delete|Home|End|Page|Meta)/.test(code) };
}
