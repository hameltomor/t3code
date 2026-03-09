# XBE Code

A web GUI that puts multiple coding agents under one roof — all the power of the terminal, none of the juggling. Run agents side by side, keep context, ship faster.

> **Fork notice:** This project is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by [Ping.gg](https://github.com/pingdotgg). The original project is licensed under its respective license. XBE Code is an independent rebranding and continuation with extended functionality.

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

## Why XBE Code over OpenCode?

| | **XBE Code** | **OpenCode** |
|---|---|---|
| **Cost** | Free. Uses your existing CLI accounts — no extra subscription. | $10–20/mo plans or pay-per-token through their proxy. |
| **Your keys, your tokens** | Runs native CLIs (codex, claude, gemini) directly. Tokens go straight to the provider — no middleman. | Routes requests through OpenCode's own infrastructure. |
| **Transparency** | Fully open source. Read every line, verify nothing leaves your machine, extend anything. | Open-source core, but model access flows through their services. |
| **Security** | Code runs locally, calls go to the providers you already trust. Nothing to audit beyond what's in this repo. | Additional trust surface — your code context passes through a third-party relay. |

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

## Some notes

We are very very early in this project. Expect bugs.
