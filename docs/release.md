# release

How to publish a new release so the README download buttons always point to the latest version. Covers both desktop apps and the web server tarball.

## how it works

- The README uses GitHub's `/releases/latest/download/` URLs which auto-resolve to the most recent non-prerelease release.
- Artifact filenames are version-free (`XBE-Code-{arch}.{ext}`), so the same README links work for every release.
- No README edits needed when releasing a new version.
- Cross-compilation is not supported due to native Node modules (`node-pty`, `msgpackr-extract`). Each platform must be built on its native OS.

## artifacts

| platform | filename | build command | build machine |
|---|---|---|---|
| macOS Apple Silicon | `XBE-Code-arm64.dmg` | `bun dist:desktop:dmg:arm64` | macOS (arm64) |
| macOS Intel | `XBE-Code-x64.dmg` | `bun dist:desktop:dmg:x64` | macOS (x64 or arm64) |
| Windows x64 | `XBE-Code-x64.exe` | `bun dist:desktop:win` | Windows |
| Linux x64 | `XBE-Code-x86_64.AppImage` | `bun dist:desktop:linux` | Linux |
| Web server (all OS) | `xbe-server.tgz` | `bun apps/server/scripts/cli.ts pack --output-dir release` | any |

## step by step

### 1. pick a version

Decide the version tag. Use semver: `v0.1.0`, `v1.0.0`, etc. Avoid prerelease suffixes (`-alpha`, `-beta`) because GitHub's `/releases/latest` endpoint skips prereleases and the README download links will 404.

### 2. build on each platform

Run these on the respective machines. All commands output to `./release/`.

```bash
# linux (on a linux machine)
bun dist:desktop:linux

# macos (on a mac)
bun dist:desktop:dmg:arm64
bun dist:desktop:dmg:x64

# windows (on a windows machine)
bun dist:desktop:win

# web server tarball (on any machine with the repo)
bun apps/server/scripts/cli.ts pack --output-dir release
cp release/xbe-*.tgz release/xbe-server.tgz
```

If the web/server code hasn't changed since the last build, add `--skip-build` to save time:

```bash
bun dist:desktop:linux -- --skip-build
```

### 3. create the github release

From any machine with `gh` CLI authenticated:

```bash
VERSION=v0.1.0

gh release create $VERSION \
  --repo x-b-e/xbe-code \
  --title "$VERSION" \
  --notes "Desktop release $VERSION" \
  --latest
```

### 4. upload artifacts from each build machine

Upload from whichever machine produced the artifact:

```bash
VERSION=v0.1.0

# linux
gh release upload $VERSION release/XBE-Code-x86_64.AppImage --repo x-b-e/xbe-code --clobber

# macos
gh release upload $VERSION release/XBE-Code-arm64.dmg release/XBE-Code-x64.dmg --repo x-b-e/xbe-code --clobber

# windows
gh release upload $VERSION release/XBE-Code-x64.exe --repo x-b-e/xbe-code --clobber

# web server tarball
gh release upload $VERSION release/xbe-server.tgz --repo x-b-e/xbe-code --clobber
```

`--clobber` overwrites if the file already exists (safe to re-upload).

### 5. verify

```bash
gh release view $VERSION --repo x-b-e/xbe-code --json assets --jq '.assets[].name'
```

Expected output:

```
XBE-Code-arm64.dmg
XBE-Code-x64.dmg
XBE-Code-x64.exe
XBE-Code-x86_64.AppImage
xbe-server.tgz
```

The README download buttons now point to this release.

## replacing a single artifact

To rebuild and replace one platform without touching the others:

```bash
VERSION=v0.1.0
bun dist:desktop:linux
gh release upload $VERSION release/XBE-Code-x86_64.AppImage --repo x-b-e/xbe-code --clobber
```

## installing the web server (for team members)

Team members with `gh` CLI access can install and run the web server without cloning the repo:

```bash
# install (or upgrade)
gh release download --repo x-b-e/xbe-code --pattern 'xbe-server.tgz' --dir /tmp --clobber
npm install -g /tmp/xbe-server.tgz

# run
xbe
```

The server starts on `http://localhost:<port>`, auto-opens a browser, and serves the full web UI. Pass `--port 3775` to pin the port, or `--no-browser` for headless use.

Prerequisites: Node.js 22.13+ and at least one authorized agent CLI (Codex, Claude Code, or Gemini CLI).

## signing (optional)

Signing is auto-detected from environment variables. Builds are unsigned by default. Pass `--signed` to enable.

### apple signing + notarization (macos)

Set these environment variables (or GitHub Actions secrets for CI):

- `CSC_LINK` — base64-encoded `.p12` certificate + private key
- `CSC_KEY_PASSWORD` — `.p12` export password
- `APPLE_API_KEY` — contents of the `.p8` API key file
- `APPLE_API_KEY_ID` — key ID from App Store Connect
- `APPLE_API_ISSUER` — issuer ID from App Store Connect

Setup:

1. Create a `Developer ID Application` certificate in Apple Developer portal.
2. Export certificate + private key as `.p12` from Keychain, base64-encode it.
3. Create an API key in App Store Connect (Team key).
4. Build with signing: `bun dist:desktop:dmg:arm64 -- --signed`

### azure trusted signing (windows)

Set these environment variables:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Setup:

1. Create Azure Trusted Signing account and certificate profile.
2. Create an Entra app registration (service principal) with Trusted Signing permissions.
3. Build with signing: `bun dist:desktop:win -- --signed`

## desktop auto-update

- Runtime updater: `electron-updater` in `apps/desktop/src/main.ts`.
- Background checks run on startup delay + interval. No automatic download or install.
- The desktop UI shows a rocket update button when an update is available; click once to download, click again to restart/install.
- Provider: generic (`provider: generic`) pointing at `https://synkr-server.price-bee.com/xbecode/`.
- The update server is a NestJS app (`synkr-server`) that serves `latest*.yml` manifests and binary downloads from GCS bucket `xbecode-releases`.
- No GitHub token or authentication required — the GCS bucket is publicly readable.
- The CI `upload_gcs` job automatically uploads manifests to the bucket root and binaries to `{version}/` on every release.
- Override the update URL at runtime: set `XBECODE_DESKTOP_UPDATE_URL` env var (build-time) or modify `app-update.yml`.
- Required release assets for updater to work: platform installers, `latest*.yml` metadata, `*.blockmap` files.

## browser/PWA update notification

- The service worker (`apps/web/public/sw.js`) uses message-based activation — new versions wait until the app sends a `SKIP_WAITING` message.
- `useServiceWorkerUpdate` hook detects a waiting service worker and polls for updates every 4 hours.
- `useAppUpdate` hook unifies browser SW updates and desktop electron-updater into a single `AppUpdateInfo` interface.
- `UpdateBanner` component renders a top-center notification banner when an update is available.
- In Electron, the banner shows desktop update status (available → downloading → ready to restart).
- In browsers, the banner prompts the user to refresh and activates the new service worker on click.

## npm cli publishing

The CLI package (`apps/server`, npm package `xbe`) can be published separately:

1. Confirm npm org/user owns package `xbe`.
2. Bump version in `apps/server/package.json`.
3. Build: `bun run build:desktop`
4. Publish: `cd apps/server && bun publish --access public`

For GitHub Actions OIDC trusted publishing, configure the npm package settings with provider GitHub Actions, repository `x-b-e/xbe-code`, workflow file `.github/workflows/release.yml`.

## common mistakes

| mistake | result | fix |
|---|---|---|
| Release created with `--prerelease` | README links 404 | `gh release edit $VERSION --repo x-b-e/xbe-code --prerelease=false --latest` |
| Forgot `--latest` flag | Older release stays as "latest" | `gh release edit $VERSION --repo x-b-e/xbe-code --latest` |
| Built on wrong OS | Cross-compilation error | Build each platform on its native OS |
| Version in artifact name | README links break | Keep `artifactName` in build script as `XBE-Code-${arch}.${ext}` |
| macOS build unsigned when expected signed | Missing Apple secrets | Check `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_*` are set |
| Windows build unsigned when expected signed | Missing Azure secrets | Check all `AZURE_*` env vars are set |

## troubleshooting

- Build fails with signing error: retry without `--signed` to confirm unsigned path works, then re-check credentials.
- `electron-updater` doesn't find updates: ensure `latest*.yml` and `*.blockmap` files are in the release assets.
- Private repo download 404: ensure the user is logged into GitHub and has repo access, or set `GH_TOKEN` for CLI use.
