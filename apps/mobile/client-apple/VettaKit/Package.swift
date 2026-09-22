// swift-tools-version: 6.2
import PackageDescription

let isolation: [SwiftSetting] = [.defaultIsolation(MainActor.self)]

let package = Package(
	name: "VettaKit",
	defaultLocalization: "zh-Hans",
	platforms: [.iOS(.v26), .macOS(.v26)],
	products: [
		.library(name: "VettaKit", targets: ["VettaKit"]),
	],
	targets: [
		.target(name: "VettaKit", swiftSettings: isolation, linkerSettings: [.linkedLibrary("sqlite3")]),
		.testTarget(name: "VettaKitTests", dependencies: ["VettaKit"], swiftSettings: isolation),
	]
)
