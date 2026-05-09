# Crew

A desktop dashboard for orchestrating multiple Claude Code CLI agents in parallel. Spawn agents in different working directories, watch them all at once in a tiled grid, glance at their states from a radar overview, and broadcast a single prompt to a selected swarm.

Built with Tauri 2 + React + TypeScript. Native PTYs (ConPTY on Windows, openpty elsewhere) drive real `claude` processes. Terminals render through xterm.js with the WebGL addon so a wall of agents stays smooth.

## Views

- **Grid** — tiled terminals you can focus, maximize, or close.
- **Radar** — at-a-glance status card per agent. Each card shows one of: spawning, thinking, idle, awaiting input, exited, error, plus the time since the last activity. Click a card to jump back to that agent in Grid view. The Radar pill in the topbar carries a badge with the count of agents currently awaiting input.

## Roles

Saved system-prompt + broadcast-prefix bundles you can attach to a pane to specialise it. A role's system prompt is appended to `claude` at spawn (via `--append-system-prompt`); its broadcast prefix is prepended to every message sent to that pane through the broadcast palette. Open the **Roles** modal in the topbar to manage them. Crew ships starter roles (Reviewer, Tester, Refactorer, Documenter) on first run.

Click the role chip in any pane header to assign or change a pane's role. Editing a role's system prompt only takes effect the next time the agent spawns (it's baked into the running process); the broadcast prefix updates immediately for the next message.

## Broadcast palette

Press **Ctrl/⌘ Enter** to open a palette that sends the same message to multiple panes at once. Pick which panes receive it, optionally override the role framing for that one message, then Ctrl/⌘ Enter again to fire. Useful for control-plane messages (`/clear`, `/compact`, "stop, requirements changed"), polling status across N agents, or fan-out tasks where each pane wears a different role.

## Git integration

Each pane's header shows a branch badge (current branch + dirty count) when the agent's working directory is inside a git repo. Click the badge to slide out a per-pane git panel with three tabs:

- **Status** — staged / unstaged / untracked files. Stage, unstage, discard, click any path to view its diff. Bottom of the tab is a commit composer with an Amend toggle.
- **Branches** — list local + remote branches, checkout existing or create-and-checkout new ones, delete branches.
- **Log** — last 50 commits on HEAD with author and relative time.

When you spawn a new agent on a folder that is inside a git repository, Crew offers a branch picker:

- **Use current branch** — spawns in the chosen folder as-is. Fast path for single-agent work; if two agents land here they will fight over `HEAD`.
- **Existing branch** — creates a worktree under `<repo>/.crew-worktrees/<branch>/` and spawns the agent there. The branch must not already be checked out elsewhere.
- **New branch** — creates the branch from a base of your choosing, then a worktree on it.

Auto-created worktrees are removed when the agent's pane closes (Crew prompts before discarding uncommitted changes). A journal at your app data dir tracks active worktrees so a crashed app can prune the orphans on next launch. Templates remember each pane's branch — loading a template recreates the worktrees.

## Templates

Save the current set of panes (commands, working directories, role assignments, branches) as a named template, then load it later to recreate the layout in one click. You can mark one template as the default so it auto-loads on app start. Open the **Templates** modal in the topbar to save, load, rename, or delete templates.

## Idle notifications

Toggle the bell icon in the topbar to opt in to OS notifications when an agent transitions to idle (the prompt is back, ready for input). Crew asks for system notification permission the first time you enable it. The toggle is per-install and remembered across launches.

## Terminal niceties

- **Copy / paste** — `Ctrl/⌘ C` copies the current selection (or sends an interrupt if there's no selection, matching terminal convention). `Ctrl/⌘ V` pastes from the clipboard.
- **Ctrl/⌘ Click links** — URLs in agent output become clickable; modifier-click opens them in your default browser.

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ T` | New agent |
| `Ctrl/⌘ W` | Close focused agent |
| `Ctrl/⌘ M` | Maximize / restore focused agent |
| `Ctrl/⌘ 1–9` | Focus agent by index |
| `Ctrl/⌘ ]` / `[` | Focus next / previous agent |
| `Ctrl/⌘ \` | Cycle view (Grid ↔ Radar) |
| `Ctrl/⌘ Enter` | Open broadcast palette (and send from inside it) |
| `Ctrl/⌘ C` | Copy selection in terminal (interrupt if no selection) |
| `Ctrl/⌘ V` | Paste in terminal |
| `Ctrl/⌘ Click` | Open URL under cursor in browser |

## Prerequisites

- **Node.js 20+** and **npm**
- **Rust** (stable toolchain via [rustup](https://rustup.rs/))
- Platform toolchain Tauri needs:
  - **Windows** — Microsoft C++ Build Tools + WebView2 (already on Win11)
  - **macOS** — Xcode Command Line Tools
  - **Linux** — `webkit2gtk-4.1`, `libssl-dev`, `build-essential` (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))
- The [`claude`](https://docs.claude.com/en/docs/claude-code) CLI on your `PATH` (Crew spawns whatever `command` you point a pane at, but the default for a new agent is `claude`).

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
  src/git.rs        libgit2-backed status / branches / log / diff / worktrees
  src/lib.rs        Tauri command handlers + plugin wiring
  tauri.conf.json   App identifier, window, bundler config
```

## License

MIT
