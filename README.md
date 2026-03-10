<p align="center">
  <a href="https://www.x-b-e.com/">
    <img src="assets/prod/logo.svg" alt="XBE Code" width="96" height="96" />
  </a>
</p>

<h1 align="center">XBE Code</h1>

<p align="center">
A web GUI that puts multiple coding agents under one roof — all the power of the terminal, none of the juggling. Run agents side by side, keep context, ship faster.
</p>

<!-- Download links use /releases/latest/download/ which always resolves   -->
<!-- to the most recent GitHub release. No README edits needed on release. -->
<!-- Just create a release, upload the build artifacts, and you're done.   -->

<h2 align="center">Download Desktop App</h2>

<p align="center">
  <a href="https://github.com/x-b-e/xbe-code/releases/latest">
    <img src="https://img.shields.io/badge/latest_release-%E2%86%93-ff006e?style=flat-square" alt="Latest release" />
  </a>
</p>

<table align="center">
  <tr>
    <th align="center">Platform</th>
    <th align="center">Architecture</th>
    <th align="center">Download</th>
  </tr>
  <tr>
    <td align="center"><strong>macOS</strong></td>
    <td align="center">Apple Silicon (M1/M2/M3/M4)</td>
    <td align="center">
      <a href="https://github.com/x-b-e/xbe-code/releases/latest/download/XBE-Code-arm64.zip">
        <img src="https://img.shields.io/badge/Download-.zip_(arm64)-ff006e?style=for-the-badge&logo=apple&logoColor=white" alt="macOS Apple Silicon" />
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><strong>macOS</strong></td>
    <td align="center">Intel</td>
    <td align="center">
      <a href="https://github.com/x-b-e/xbe-code/releases/latest/download/XBE-Code-x64.zip">
        <img src="https://img.shields.io/badge/Download-.zip_(x64)-ff006e?style=for-the-badge&logo=apple&logoColor=white" alt="macOS Intel" />
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Windows</strong></td>
    <td align="center">x64</td>
    <td align="center">
      <a href="https://github.com/x-b-e/xbe-code/releases/latest/download/XBE-Code-x64.exe">
        <img src="https://img.shields.io/badge/Download-.exe_(x64)-8b5cf6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Linux</strong></td>
    <td align="center">x64</td>
    <td align="center">
      <a href="https://github.com/x-b-e/xbe-code/releases/latest/download/XBE-Code-x86_64.AppImage">
        <img src="https://img.shields.io/badge/Download-.AppImage_(x64)-00d4aa?style=for-the-badge&logo=linux&logoColor=white" alt="Linux" />
      </a>
    </td>
  </tr>
</table>

<p align="center">
  <a href="https://github.com/x-b-e/xbe-code/releases">
    <img src="https://img.shields.io/badge/All_Releases_%E2%86%92-0a0a0a?style=flat-square" alt="All releases" />
  </a>
</p>

<h2 align="center">Run as Web Server (Linux / any OS)</h2>

<p align="center">No repo clone needed. Requires <a href="https://nodejs.org">Node.js</a> 22.13+ and <code>gh</code> CLI with repo access.</p>

```bash
# download and install the latest server release
gh release download --repo x-b-e/xbe-code --pattern 'xbe-server.tgz' --dir /tmp --clobber
npm install -g /tmp/xbe-server.tgz

# start the server (opens browser automatically)
xbe
```

<p align="center">
  <a href="https://github.com/x-b-e/xbe-code/releases/latest/download/xbe-server.tgz">
    <img src="https://img.shields.io/badge/Download-xbe--server.tgz-00d4aa?style=for-the-badge&logo=npm&logoColor=white" alt="Server tarball" />
  </a>
</p>

> **Fork notice:** This project is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by [Ping.gg](https://github.com/pingdotgg). XBE Code is a proprietary internal tool of XBE and is not licensed for external use.

## Features

- **Multi-agent** — Codex, Claude Code, and Gemini in a single interface. Switch models mid-conversation.
- **Multi-repo workspaces** — Work across several repositories at once. Per-repo branch, status, and diff tracking out of the box.
- **Git worktrees** — Spin up isolated branches per task with automatic creation, rollback on failure, and orphan cleanup.
- **GitHub & GitLab** — Create PRs/MRs, view status, and push — all from the UI. Auto-detects your forge from the remote URL.
- **Notification center** — In-app inbox plus Web Push alerts for completed tasks, approval requests, and input prompts.
- **Image attachments** — Paste or upload images directly into the chat. They're persisted and forwarded to the agent.
- **Mobile-ready** — Responsive UI tested down to 320px. Install as a PWA on any phone or tablet — works like a native app.
- **Desktop app** — Native Electron builds for macOS, Windows, and Linux with auto-updates.
- **Thread search** — Fuzzy search across titles, messages, and branch names. Cmd/Ctrl+K to find any conversation instantly.

## How XBE Code compares

| | **XBE Code** | **Cursor** | **Antigravity** | **OpenCode** |
|---|---|---|---|---|
| **Cost** | Free — uses your existing CLI accounts | $20–200/mo (credit-based) | Free preview, ~$20/mo after | $10–20/mo or pay-per-token |
| **Your keys, your tokens** | Native CLIs — tokens go straight to the provider | Proxied through Cursor's infra | Proxied through Google's infra | Proxied through OpenCode's infra |
| **Vendor lock-in** | None — swap agents freely, no proprietary editor | Tied to Cursor's VS Code fork | Tied to Google's IDE | Own model routing layer |
| **Transparency** | Fully open source, runs locally, nothing hidden | Closed-source client | Closed-source platform | Open-source core, closed model relay |
| **Multi-agent** | Codex + Claude Code + Gemini side by side | Single model per request | Gemini-first, limited others | Multiple models, own proxy |
| **Run anywhere** | Browser, PWA, desktop app (macOS/Win/Linux) | Desktop only | Desktop only | Terminal + web |

## XBE Code vs T3 Code (upstream fork)

XBE Code is forked from [T3 Code](https://github.com/pingdotgg/t3code). The table below shows what has been added or changed since the fork.

| Feature | **T3 Code** (upstream) | **XBE Code** (this repo) |
|---|---|---|
| **Agent: Codex** | Codex only | Codex (unchanged) |
| **Agent: Claude Code** | Planned, not implemented | Fully integrated via `claude-agent-sdk` — extended thinking, tool approval, permission modes |
| **Agent: Gemini** | Not present | Full Gemini CLI adapter — tool use, system instructions, project context injection |
| **Forge: GitHub** | PR creation via `gh` CLI | PR creation via `gh` CLI (unchanged) |
| **Forge: GitLab** | Not present | MR creation via `glab` CLI — auto-detected from remote URL |
| **Notifications** | Not present | In-app notification center + Web Push (VAPID) for completed tasks, approvals, and input prompts |
| **Thread search** | Not present | Fuzzy search (Fuse.js) across titles, messages, and branch names — Cmd/Ctrl+K |
| **Multi-repo worktrees** | Single-repo worktrees only | Synchronized worktrees across multiple repos in one workspace — atomic create/rollback, orphan cleanup |
| **PWA / mobile** | Browser access over network, no PWA | Installable PWA with web manifest, responsive down to 320 px, maskable icons |
| **Image attachments** | Paste/drag-drop in composer, Codex-only delivery | Paste/drag-drop with real `inlineData` forwarding to all three providers, persistent attachment storage |
| **Desktop app** | Electron with auto-updates | Electron with auto-updates, rebranded bundle ID and protocol scheme (`xbe://`) |
| **Mobile-responsive UI** | Desktop-focused layout | Two-line mobile header, collapsible sidebar, touch-friendly controls |
| **Workspace entry search** | Basic file listing | Subsequence-based fuzzy matching, LRU cache (15 s TTL), git check-ignore integration |
| **Diff viewer** | Unified/split per-turn diffs | Same core + worker-pool parsing, LRU-cached rendered diffs, theme-aware cache keys |
| **Terminal** | xterm.js, multiple per thread | Same core (unchanged) |
| **Plan mode** | Interactive AI planning with step tracking | Same core (unchanged) |
| **Project scripts** | Configurable commands with icons & shortcuts | Same core + `XBECODE_PROJECT_ROOT` / `XBECODE_WORKTREE_PATH` env vars |
| **Checkpoint/revert** | `refs/t3/checkpoints` | `refs/xbe/checkpoints` (rebranded) |
| **Event sourcing** | Full CQRS/event-sourcing with SQLite | Same architecture (unchanged) |
| **Config & branding** | `@t3tools/*`, `~/.t3/`, `T3CODE_` env prefix | `@xbetools/*`, `~/.xbe/`, `XBECODE_` env prefix |

## How to use

> [!WARNING]
> You need at least one supported agent CLI installed and authorized: [Codex](https://github.com/openai/codex), [Claude Code](https://github.com/anthropics/claude-code), or [Gemini CLI](https://github.com/google-gemini/gemini-cli).

## Runtime setup

XBE Code expects the exact Node version from `.nvmrc`. `pm2`, local scripts, and the server should all run under that same version so globally installed CLIs like `codex` resolve from the same PATH.

One-time machine setup:

```bash
nvm install "$(cat .nvmrc)"
nvm alias default "$(cat .nvmrc)"
nvm use "$(cat .nvmrc)"
```

If `codex` was installed under another Node version, reinstall it after switching to the project version:

```bash
which node
node -v
which codex
codex --version
```

When you restart the app with `pm2`, refresh the environment so it picks up the same NVM-backed PATH:

```bash
pm2 restart ecosystem.config.cjs --update-env
```

## Contributing

PRs welcome, ideas welcome, complaints welcome.
