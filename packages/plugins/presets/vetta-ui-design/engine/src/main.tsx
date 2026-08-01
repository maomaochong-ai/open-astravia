import "./styles.css";
import { type ComponentType, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installBridge, notifyFrameRendered } from "./bridge";

interface FrameModule {
	default?: ComponentType;
	frame?: { width?: number; height?: number; title?: string };
}

// Eager so the whole app builds to a single chunk (export snapshot inlines it).
const modules = import.meta.glob<FrameModule>("@design/frames/*.tsx", { eager: true });

const frames = new Map<string, FrameModule>();
for (const [path, mod] of Object.entries(modules)) {
	const id = path.split("/").pop()?.replace(/\.tsx$/, "");
	if (id) frames.set(id, mod);
}

function currentFrameId(): string | null {
	const match = window.location.hash.match(/#\/frame\/([^/?]+)/);
	if (match) return decodeURIComponent(match[1]);
	return null;
}

// Packaged-snapshot previews load via srcdoc (no URL), so the frame id can also
// arrive by postMessage ("vetd:show-frame") instead of the hash.
let requestedId: string | null = currentFrameId();

function FrameMissing({ id }: { id: string | null }) {
	return (
		<div
			style={{
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontFamily: "system-ui, sans-serif",
				color: "#9ca3af",
				fontSize: 13,
			}}
		>
			{id ? `Frame not found: ${id}` : "No frame selected"}
		</div>
	);
}

const container = document.getElementById("root");
if (!container) throw new Error("engine root missing");
const root = createRoot(container);

function render(): void {
	const mod = requestedId ? frames.get(requestedId) : undefined;
	const Component = mod?.default;
	root.render(<StrictMode>{Component ? <Component /> : <FrameMissing id={requestedId} />}</StrictMode>);
	notifyFrameRendered(requestedId, [...frames.keys()]);
}

window.addEventListener("hashchange", () => {
	requestedId = currentFrameId();
	render();
});

installBridge({
	getFrameId: () => requestedId,
	showFrame: (id) => {
		requestedId = id;
		render();
	},
});

render();
