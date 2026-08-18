import { ImageResponse } from "next/og";

export const socialImageSize = { width: 1200, height: 630 };
export const socialImageAlt = "Vetta Documentation";
export const socialImageContentType = "image/png";

export function createSocialImage(): ImageResponse {
	return new ImageResponse(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				width: "100%",
				height: "100%",
				padding: "72px 80px",
				background: "linear-gradient(160deg, #0b1220 0%, #10222b 55%, #0b7285 140%)",
				color: "#f8fafc",
			}}
		>
			<div
				style={{
					display: "flex",
					fontSize: 28,
					letterSpacing: 6,
					color: "#99f6e4",
				}}
			>
				VETTA
			</div>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<div
					style={{
						display: "flex",
						fontSize: 84,
						fontWeight: 700,
						letterSpacing: -2,
						lineHeight: 1.05,
					}}
				>
					Documentation
				</div>
				<div
					style={{
						display: "flex",
						marginTop: 18,
						fontSize: 28,
						color: "#cbd5e1",
						lineHeight: 1.35,
						maxWidth: 820,
					}}
				>
					Local-first desktop agent docs for workspaces, permissions, plugins, and SDKs.
				</div>
			</div>
			<div
				style={{
					display: "flex",
					fontSize: 22,
					color: "#99f6e4",
					letterSpacing: 1,
				}}
			>
				docs.openvetta.com
			</div>
		</div>,
		socialImageSize,
	);
}
