import SwiftUI

@main
struct McMaster2DYMOApp: App {
  @StateObject private var server = ServerController()

  var body: some Scene {
    MenuBarExtra {
      MenuView().environmentObject(server)
    } label: {
      Image(systemName: "tag.fill")
    }
    Settings {
      SettingsView().environmentObject(server)
    }
  }
}

struct MenuView: View {
  @EnvironmentObject var server: ServerController

  var body: some View {
    Text(server.state.label)
    Text(server.status.printerText)
    if let j = server.status.lastJob { Text("Last: " + j) }
    Divider()

    Picker("Label size", selection: Binding(
      get: { server.config.string("size") },
      set: { server.set("size", $0) })) {
      ForEach(server.catalog.sizes) { Text($0.name).tag($0.id) }
    }
    Picker("Layout", selection: Binding(
      get: { server.config.string("layout") },
      set: { server.set("layout", $0) })) {
      ForEach(server.catalog.layouts) { Text($0.name).tag($0.id) }
    }
    Toggle("Print the picture", isOn: Binding(
      get: { server.config.bool("showImage") },
      set: { server.set("showImage", $0) }))
    Divider()

    if server.isRunning {
      Button("Stop server") { server.stop() }
      Button("Restart server") { server.restart() }
    } else {
      Button("Start server") { server.start() }
    }
    Button("Open status page") { server.openStatusPage() }
    Button("Open log") { server.openLog() }
    Divider()

    Toggle("Launch at login", isOn: Binding(
      get: { server.launchAtLogin },
      set: { server.launchAtLogin = $0 }))
    if server.launchdAgentInstalled {
      Button("Remove old launchd agent (it fights this app for the port)") { server.removeLaunchdAgent() }
    }
    SettingsLink { Text("Settings…") }
    Divider()
    Button("Quit McMaster2DYMO") { server.quit() }
  }
}
