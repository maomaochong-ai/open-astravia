import { createRequire } from "node:module";
import type { RemoteScreenCursor } from "@vetta/remote-control";
import { screen } from "electron";
import type * as Koffi from "koffi";

/**
 * The pointer macOS shows right now (arrow, I-beam, hand…), for a phone that draws the
 * pointer itself (ADR-0140). Read through the Objective-C runtime: `NSCursor
 * currentSystemCursor` is the system-wide pointer, whichever app set it.
 */
const objc = (() => {
	let loaded: ReturnType<typeof load> | undefined;
	return () => {
		loaded ??= load();
		return loaded;
	};
})();

function load() {
	const koffi = createRequire(import.meta.url)("koffi") as typeof Koffi;
	koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit");
	const runtime = koffi.load("/usr/lib/libobjc.A.dylib");
	const getClass = runtime.func("void *objc_getClass(const char *)");
	const selector = runtime.func("void *sel_registerName(const char *)");
	const Pair = koffi.struct("VettaCursorPair", { x: "double", y: "double" });
	return {
		koffi,
		getClass,
		selector,
		send: runtime.func("objc_msgSend", "void *", ["void *", "void *"]),
		sendObject: runtime.func("objc_msgSend", "void *", ["void *", "void *", "void *"]),
		sendRepresentation: runtime.func("objc_msgSend", "void *", ["void *", "void *", "uint64", "void *"]),
		sendPair: runtime.func("objc_msgSend", Pair, ["void *", "void *"]),
		sendLength: runtime.func("objc_msgSend", "uint64", ["void *", "void *"]),
		poolPush: runtime.func("void *objc_autoreleasePoolPush()"),
		poolPop: runtime.func("void objc_autoreleasePoolPop(void *)"),
	};
}

/** `NSBitmapImageFileTypePNG`. */
const PNG = 4;

let lastTiff: Buffer | undefined;
let lastCursor: Omit<RemoteScreenCursor, "screenWidth"> | undefined;

/** Undefined while macOS shows no pointer or cannot say; call on the main thread. */
export function readMacCursor(): RemoteScreenCursor | undefined {
	if (process.platform !== "darwin") return undefined;
	const runtime = objc();
	const { send, selector, getClass, koffi } = runtime;
	const pool = runtime.poolPush();
	try {
		const cursor = send(getClass("NSCursor"), selector("currentSystemCursor"));
		if (!cursor) return undefined;
		const image = send(cursor, selector("image"));
		if (!image) return undefined;
		const tiff = send(image, selector("TIFFRepresentation"));
		if (!tiff) return undefined;
		const tiffBytes = Buffer.from(
			koffi.decode(
				send(tiff, selector("bytes")),
				koffi.array("uint8", Number(runtime.sendLength(tiff, selector("length")))),
			) as Uint8Array,
		);
		// The same pointer as last time: skip turning it into a PNG again.
		if (!lastCursor || !lastTiff?.equals(tiffBytes)) {
			const size = runtime.sendPair(image, selector("size")) as { x: number; y: number };
			const hotspot = runtime.sendPair(cursor, selector("hotSpot")) as { x: number; y: number };
			const bitmap = runtime.sendObject(getClass("NSBitmapImageRep"), selector("imageRepWithData:"), tiff);
			if (!bitmap) return undefined;
			const properties = send(getClass("NSDictionary"), selector("dictionary"));
			const png = runtime.sendRepresentation(
				bitmap,
				selector("representationUsingType:properties:"),
				PNG,
				properties,
			);
			if (!png) return undefined;
			const length = Number(runtime.sendLength(png, selector("length")));
			const bytes = koffi.decode(send(png, selector("bytes")), koffi.array("uint8", length)) as Uint8Array;
			lastTiff = tiffBytes;
			lastCursor = {
				image: Buffer.from(bytes).toString("base64"),
				width: size.x,
				height: size.y,
				hotspotX: hotspot.x,
				hotspotY: hotspot.y,
			};
		}
		return { ...lastCursor, screenWidth: screen.getPrimaryDisplay().size.width };
	} catch {
		return undefined;
	} finally {
		runtime.poolPop(pool);
	}
}
