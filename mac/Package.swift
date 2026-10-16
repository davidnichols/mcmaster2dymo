// swift-tools-version:5.9
// Menu bar app for the shop print server. Build with mac/build.sh (or
// `npm run app`), which wraps the binary in dist/McMaster2DYMO.app.
import PackageDescription

let package = Package(
  name: "McMaster2DYMO",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "McMaster2DYMO", path: "Sources/McMaster2DYMO")
  ]
)
