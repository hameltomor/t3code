# XBE Code

XBE Code is a minimal web GUI for coding agents. Currently Codex-first, with Claude Code support coming soon.

> **Fork notice:** This project is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by [Ping.gg](https://github.com/pingdotgg). The original project is licensed under its respective license. XBE Code is an independent rebranding and continuation with extended functionality.

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for XBE Code to work.

```bash
npx xbe
```

You can also just install the desktop app. It's cooler.

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
