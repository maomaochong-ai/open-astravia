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
				padding: "68px 76px",
				background: "#17201f",
				color: "#f3efe4",
			}}
		>
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: 6,
					background: "#dd6b55",
				}}
			/>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 16,
						fontSize: 22,
						letterSpacing: 7,
						color: "#dd6b55",
					}}
				>
					VETTA
				</div>
				<div
					style={{
						display: "flex",
						width: 18,
						height: 18,
						borderRadius: 999,
						background: "#dd6b55",
					}}
				/>
			</div>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<div
					style={{
						display: "flex",
						fontSize: 84,
						fontWeight: 600,
						letterSpacing: -2,
						lineHeight: 1.05,
					}}
				>
					Documentation
				</div>
				<div
					style={{
						display: "flex",
						marginTop: 22,
						fontSize: 28,
						color: "#c8c2b4",
						lineHeight: 1.4,
						maxWidth: 780,
					}}
				>
					本地工作区里的 Agent 文档：任务、权限、批量、插件与 SDK。
				</div>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-end",
					fontSize: 22,
					color: "#9aa39a",
					letterSpacing: 1,
				}}
			>
				<div style={{ display: "flex" }}>docs.openvetta.com</div>
				<div style={{ display: "flex", color: "#dd6b55", letterSpacing: 3 }}>LOCAL FIRST</div>
			</div>
		</div>,
		socialImageSize,
	);
}
