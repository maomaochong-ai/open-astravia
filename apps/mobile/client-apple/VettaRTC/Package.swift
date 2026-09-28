// swift-tools-version: 6.2
import PackageDescription

let isolation: [SwiftSetting] = [.defaultIsolation(MainActor.self)]

// The WebRTC side of the remote desktop and the P2P control channel (ADR-0140). Kept out
// of VettaKit so its tests never download or link the WebRTC binary; only the app uses it.
// Same WebRTC build family and milestone as Android's io.github.webrtc-sdk:android. The
// binary is taken straight from webrtc-sdk/Specs' release: that package's own manifest
// declares visionOS 26 under tools 5.9, which current toolchains refuse to load.
let package = Package(
	name: "VettaRTC",
	platforms: [.iOS(.v26)],
	products: [
		.library(name: "VettaRTC", targets: ["VettaRTC"]),
	],
	dependencies: [
		.package(path: "../VettaKit"),
	],
	targets: [
		.binaryTarget(
			name: "WebRTC",
			url: "https://github.com/webrtc-sdk/Specs/releases/download/144.7559.15/WebRTC.xcframework.zip",
			checksum: "a17a6688e208255b70381926110526593ba626e033cf88c9ed4a7b618f98eb8a"
		),
		.target(
			name: "VettaRTC",
			dependencies: ["VettaKit", "WebRTC"],
			swiftSettings: isolation
		),
	]
)
