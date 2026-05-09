# Crew

A desktop dashboard for orchestrating multiple Claude Code CLI agents in parallel. Spawn agents in different working directories, watch them all at once in a tiled grid, glance at their states from a radar overview, and broadcast a single prompt to a selected swarm.

Built with Tauri 2 + React + TypeScript. Native PTYs (ConPTY on Windows, openpty elsewhere) drive real `claude` processes. Terminals render through xterm.js with the WebGL addon so a wall of agents stays smooth.

## Views

- **Grid** — tiled terminals you can focus, maximize, or close.
- **Radar** — at-a-glance status of every agent (running / awaiting input / idle).
- **Swarm** — composer that broadcasts the same prompt to the agents you select.

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ T` | New agent |
| `Ctrl/⌘ W` | Close focused agent |
| `Ctrl/⌘ M` | Maximize / restore focused agent |
| `Ctrl/⌘ 1–9` | Focus agent by index |
| `Ctrl/⌘ ]` / `[` | Focus next / previous agent |
| `Ctrl/⌘ \` | Cycle view (Grid → Radar → Swarm) |
| `Ctrl/⌘ Enter` | Broadcast (Swarm composer) |

## Prerequisites

- **Node.js 20+** and **npm**
- **Rust** (stable toolchain via [rustup](https://rustup.rs/))
- Platform toolchain Tauri needs:
  - **Windows** — Microsoft C++ Build Tools + WebView2 (already on Win11)
  - **macOS** — Xcode Command Line Tools
  - **Linux** — `webkit2gtk-4.1`, `libssl-dev`, `build-essential` (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))
- The [`claude`](https://docs.claude.com/en/docs/claude-code) CLI on your `PATH` (Crew spawns whatever `command` you point a pane at, but the default templates assume `claude`).

## Run from source (dev)

```bash
git clone https://github.com/m-flex/crew.git
cd crew
npm install
npm run tauri dev
```

The first `tauri dev` will compile the Rust side and is slow. Subsequent runs are quick.

## Install permanently — build a release binary

`npm run dev` is only for hot-reload development. To get a real installable app you launch like any other program:

```bash
npm run tauri build
```

That produces a release bundle under `src-tauri/target/release/bundle/`:

| Platform | What you get |
| --- | --- |
| Windows | `bundle/msi/Crew_<version>_x64_en-US.msi` and `bundle/nsis/Crew_<version>_x64-setup.exe` |
| macOS | `bundle/macos/Crew.app` and `bundle/dmg/Crew_<version>_aarch64.dmg` (or `x64`) |
| Linux | `bundle/deb/*.deb`, `bundle/rpm/*.rpm`, `bundle/appimage/*.AppImage` |

Install it once, then launch Crew from the Start Menu / Launchpad / your app launcher. No more `npm run dev`, no Node or Rust required at runtime.

You can also run the unbundled binary directly:

- Windows — `src-tauri\target\release\crew.exe`
- macOS / Linux — `src-tauri/target/release/crew`

Pin that exe to your taskbar / dock if you don't want to install.

### Updating an installed build

Pull the latest source and rebuild:

```bash
git pull
npm install
npm run tauri build
```

Then re-run the installer (it upgrades in place).

## Project layout

```
src/                React UI (views, terminal panes, store)
src-tauri/          Rust backend
  src/pty.rs        PTY manager — spawn / write / resize / kill agents
  src/lib.rs        Tauri command handlers + plugin wiring
  tauri.conf.json   App identifier, window, bundler config
```

## License

MIT
