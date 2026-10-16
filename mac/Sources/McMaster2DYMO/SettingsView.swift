import SwiftUI

/// Everything in ~/.mcmaster2dymo.json that isn't in the menu. Edits a draft;
/// Save writes the file and restarts the server.
struct SettingsView: View {
  @EnvironmentObject var server: ServerController
  @State private var draft = ServerConfig.load()
  @State private var nodePath = ""
  @State private var saved = false

  var body: some View {
    Form {
      Section("Labels") {
        Picker("Printer", selection: bind("printer")) {
          Text("First connected LabelWriter 550").tag("")
          ForEach(server.status.printers, id: \.self) { Text($0).tag($0) }
          let cur = draft.string("printer")
          if !cur.isEmpty && !server.status.printers.contains(cur) { Text(cur + " (not seen)").tag(cur) }
        }
        Stepper("Default copies: \(draft.int("copies"))", value: bindInt("copies"), in: 1...99)
        Toggle("Print part number + QR even if McMaster can't be read", isOn: bindBool("printWithoutDetails"))
      }
      Section("Server") {
        TextField("Port", value: bindInt("port"), format: .number)
        Picker("Listen on", selection: bind("bind")) {
          Text("Whole network (iPhone can reach it)").tag("0.0.0.0")
          Text("This Mac only").tag("127.0.0.1")
        }
        TextField("Token (optional shared secret)", text: bind("token"))
        TextField("Chrome path (blank = auto-detect)", text: bind("chromePath"))
        Stepper("Close headless Chrome after \(draft.int("chromeIdleMs") / 60_000) min idle",
                value: Binding(get: { draft.int("chromeIdleMs") / 60_000 }, set: { draft.values["chromeIdleMs"] = $0 * 60_000 }), in: 1...120)
      }
      Section("App") {
        TextField("Node binary", text: $nodePath)
        LabeledContent("Repo", value: server.repo.path)
        LabeledContent("Settings file", value: ServerConfig.path.path)
        HStack {
          Button("Open settings file") { server.openConfigFile() }
          Button("Open log") { server.openLog() }
        }
      }
      HStack {
        Spacer()
        if saved { Text("Saved, server restarting").foregroundStyle(.secondary) }
        Button("Revert") { draft = ServerConfig.load(); nodePath = server.nodePath; saved = false }
        Button("Save & restart") {
          server.config = draft
          if nodePath != server.nodePath { server.nodePath = nodePath; server.reloadCatalog() }
          server.saveAndRestart()
          saved = true
        }.keyboardShortcut(.defaultAction)
      }
    }
    .formStyle(.grouped)
    .frame(width: 520)
    .onAppear {
      draft = ServerConfig.load()
      nodePath = server.nodePath
      saved = false
      NSApp.activate(ignoringOtherApps: true)
    }
  }

  private func bind(_ k: String) -> Binding<String> {
    Binding(get: { draft.string(k) }, set: { draft.values[k] = $0 })
  }
  private func bindInt(_ k: String) -> Binding<Int> {
    Binding(get: { draft.int(k) }, set: { draft.values[k] = $0 })
  }
  private func bindBool(_ k: String) -> Binding<Bool> {
    Binding(get: { draft.bool(k) }, set: { draft.values[k] = $0 })
  }
}
