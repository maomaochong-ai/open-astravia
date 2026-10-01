// swift-tools-version: 6.2
import PackageDescription

let isolation: [SwiftSetting] = [.defaultIsolation(MainActor.self)]

let package = Package(
	name: "AstraviaKit",
	defaultLocalization: "en",
	platforms: [.iOS(.v26), .macOS(.v26)],
	products: [
		.library(name: "AstraviaKit", targets: ["AstraviaKit"]),
	],
	targets: [
		.target(name: "AstraviaKit", resources: [.process("Resources")], swiftSettings: isolation, linkerSettings: [.linkedLibrary("sqlite3")]),
		.testTarget(name: "AstraviaKitTests", dependencies: ["AstraviaKit"], swiftSettings: isolation),
	]
)
