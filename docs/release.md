# release

Full manual release guide. Everything runs from a single Linux machine with `gh`, `gcloud`/`gsutil`, Wine, and ImageMagick installed.

## prerequisites

Tools required on the build machine:

```bash
# required
bun --version          # bun runtime (see package.json for version)
node --version         # Node.js 22.13+
gh --version           # GitHub CLI, authenticated to x-b-e/xbe-code
gsutil version         # Google Cloud SDK, authenticated with GCS access

# for cross-platform builds from Linux
wine --version         # Wine (with wine32 for NSIS)
convert --version      # ImageMagick (icon resizing)
png2icns --help        # icnsutils (macOS .icns generation)
```

Install on Debian/Ubuntu:

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine wine32:i386 imagemagick icnsutils
# initialize wine32 prefix (one-time)
rm -rf ~/.wine && WINEARCH=win32 wineboot --init
```

## how it works

- The README uses GitHub's `/releases/latest/download/` URLs which auto-resolve to the most recent non-prerelease release.
- Artifact filenames are version-free (`XBE-Code-{arch}.{ext}`), so the same README links work for every release.
- No README edits needed when releasing a new version.
- Desktop auto-update uses `electron-updater` with a generic provider pointing at `https://synkr-server.price-bee.com/xbecode/`.
- The update server (`synkr-server`) proxies `latest*.yml` manifests and binary downloads from GCS bucket `xbecode-releases`.
- Cross-compilation from Linux works for all platforms (`npmRebuild: false` skips native module recompilation; prebuilt binaries are used).

## artifacts

| platform | filename | build command |
|---|---|---|
| Linux x64 | `XBE-Code-x86_64.AppImage` | `bun dist:desktop:artifact -- --platform linux --target AppImage --arch x64 --build-version $V` |
| macOS arm64 | `XBE-Code-arm64.zip` | `bun dist:desktop:artifact -- --platform mac --target zip --arch arm64 --build-version $V` |
| macOS x64 | `XBE-Code-x64.zip` | `bun dist:desktop:artifact -- --platform mac --target zip --arch x64 --build-version $V` |
| Windows x64 | `XBE-Code-x64.exe` | `bun dist:desktop:artifact -- --platform win --target nsis --arch x64 --build-version $V` |
| Web server | `xbe-server.tgz` | `bun apps/server/scripts/cli.ts pack --output-dir release` |

## full release step by step

### 1. pick a version

```bash
V=0.0.6    # no "v" prefix here — just the number
```

Avoid prerelease suffixes (`-alpha`, `-beta`) — GitHub's `/releases/latest` endpoint skips prereleases and the README download links will 404.

### 2. bump versions in package.json files

```bash
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const V = process.argv[1];
  for (const f of [
    "apps/server/package.json",
    "apps/desktop/package.json",
    "apps/web/package.json",
    "packages/contracts/package.json",
  ]) {
    const pkg = JSON.parse(readFileSync(f, "utf8"));
    pkg.version = V;
    writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
  }
  console.log("All versions set to " + V);
' "$V"

bun install   # refresh lockfile
```

### 3. commit and push

```bash
git add apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json bun.lock
git commit -m "chore(release): prepare v$V"
git push origin main
```

### 4. build all artifacts

```bash
# clean release directory
rm -rf release && mkdir release

# build web + server + desktop (prerequisite for all platform builds)
bun run build:desktop

# build all 4 platforms
bun dist:desktop:artifact -- --platform linux --target AppImage --arch x64 --build-version "$V"
bun dist:desktop:artifact -- --platform mac --target zip --arch arm64 --build-version "$V"
bun dist:desktop:artifact -- --platform mac --target zip --arch x64 --build-version "$V"
bun dist:desktop:artifact -- --platform win --target nsis --arch x64 --build-version "$V"

# build web server tarball
bun apps/server/scripts/cli.ts pack --output-dir release
cp release/xbe-*.tgz release/xbe-server.tgz
```

### 5. fix macOS manifests

The x64 build overwrites `latest-mac.yml`. Rename it and recreate the arm64 manifest:

```bash
# rename x64 manifest
cp release/latest-mac.yml release/latest-mac-x64.yml

# recreate arm64 manifest
SHA=$(openssl dgst -sha512 -binary release/XBE-Code-arm64.zip | openssl base64 -A)
SIZE=$(stat -c %s release/XBE-Code-arm64.zip)
DATE=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

cat > release/latest-mac.yml <<EOF
version: $V
files:
  - url: XBE-Code-arm64.zip
    sha512: $SHA
    size: $SIZE
path: XBE-Code-arm64.zip
sha512: $SHA
releaseDate: '$DATE'
EOF
```

### 6. verify local artifacts

```bash
ls -lh release/
```

Expected files:

```
XBE-Code-arm64.zip              # macOS Apple Silicon
XBE-Code-arm64.zip.blockmap
XBE-Code-x64.zip                # macOS Intel
XBE-Code-x64.zip.blockmap
XBE-Code-x64.exe                # Windows
XBE-Code-x64.exe.blockmap
XBE-Code-x86_64.AppImage        # Linux
latest-linux.yml                 # Linux update manifest
latest-mac.yml                   # macOS arm64 update manifest
latest-mac-x64.yml              # macOS x64 update manifest
latest.yml                       # Windows update manifest
xbe-server.tgz                  # Web server tarball
```

### 7. create GitHub release

```bash
gh release create "v$V" \
  --repo x-b-e/xbe-code \
  --title "XBE Code v$V" \
  --generate-notes \
  --latest \
  release/XBE-Code-arm64.zip \
  release/XBE-Code-arm64.zip.blockmap \
  release/XBE-Code-x64.exe \
  release/XBE-Code-x64.exe.blockmap \
  release/XBE-Code-x64.zip \
  release/XBE-Code-x64.zip.blockmap \
  release/XBE-Code-x86_64.AppImage \
  release/latest-linux.yml \
  release/latest-mac.yml \
  release/latest-mac-x64.yml \
  release/latest.yml \
  release/xbe-server.tgz
```

### 8. upload to GCS (auto-update)

```bash
# upload manifests to bucket root (electron-updater reads these)
gsutil cp release/latest-mac.yml gs://xbecode-releases/latest-mac.yml
gsutil cp release/latest-mac-x64.yml gs://xbecode-releases/latest-mac-x64.yml
gsutil cp release/latest-linux.yml gs://xbecode-releases/latest-linux.yml
gsutil cp release/latest.yml gs://xbecode-releases/latest.yml

# upload binaries to version prefix (electron-updater downloads from here)
gsutil -m cp \
  release/XBE-Code-arm64.zip \
  release/XBE-Code-arm64.zip.blockmap \
  release/XBE-Code-x64.exe \
  release/XBE-Code-x64.exe.blockmap \
  release/XBE-Code-x64.zip \
  release/XBE-Code-x64.zip.blockmap \
  release/XBE-Code-x86_64.AppImage \
  gs://xbecode-releases/$V/
```

### 9. verify everything

```bash
# GitHub release assets
gh release view "v$V" --repo x-b-e/xbe-code --json assets --jq '.assets[].name'

# auto-update manifests
curl -s https://synkr-server.price-bee.com/xbecode/latest.yml | head -2
curl -s https://synkr-server.price-bee.com/xbecode/latest-mac.yml | head -2
curl -s https://synkr-server.price-bee.com/xbecode/latest-linux.yml | head -2

# download redirects
curl -sI 'https://synkr-server.price-bee.com/xbecode/download/mac?arch=arm64' | grep location
curl -sI 'https://synkr-server.price-bee.com/xbecode/download/win' | grep location
curl -sI 'https://synkr-server.price-bee.com/xbecode/download/linux' | grep location

# GCS bucket
gsutil ls gs://xbecode-releases/$V/
```

All manifests should show `version: $V` and all download redirects should point to `https://storage.googleapis.com/xbecode-releases/$V/...`.

## CI release (alternative)

Instead of building locally, you can trigger the GitHub Actions workflow:

```bash
gh workflow run release.yml --repo x-b-e/xbe-code -f version=$V
```

This builds all 4 platforms on native runners (macOS, Linux, Windows), uploads to GCS, and creates the GitHub release automatically. The `finalize` job bumps versions in `package.json` and pushes to main.

Monitor with:

```bash
gh run list --repo x-b-e/xbe-code --workflow=release.yml --limit 1
gh run watch --repo x-b-e/xbe-code    # live tail
```

## replacing a single artifact

Rebuild one platform and re-upload to both GitHub and GCS:

```bash
# rebuild linux
bun run build:desktop
bun dist:desktop:artifact -- --platform linux --target AppImage --arch x64 --build-version "$V"

# re-upload to GitHub
gh release upload "v$V" release/XBE-Code-x86_64.AppImage --repo x-b-e/xbe-code --clobber

# re-upload to GCS
gsutil cp release/XBE-Code-x86_64.AppImage gs://xbecode-releases/$V/
gsutil cp release/latest-linux.yml gs://xbecode-releases/latest-linux.yml
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

## desktop auto-update

- Runtime updater: `electron-updater` in `apps/desktop/src/main.ts`.
- Background checks run on startup delay + interval. No automatic download or install.
- The desktop UI shows a rocket update button when an update is available; click once to download, click again to restart/install.
- Provider: `generic` pointing at `https://synkr-server.price-bee.com/xbecode/`.
- The update server (`synkr-server`) proxies `latest*.yml` manifests and binary downloads from GCS bucket `xbecode-releases`.
- No GitHub token or authentication required — the GCS bucket is publicly readable.
- Override the update URL at build time: set `XBECODE_DESKTOP_UPDATE_URL` env var.

GCS bucket structure:

```
gs://xbecode-releases/
  latest.yml               # Windows manifest (always current)
  latest-mac.yml            # macOS arm64 manifest
  latest-mac-x64.yml        # macOS x64 manifest
  latest-linux.yml          # Linux manifest
  0.0.5/                    # version prefix
    XBE-Code-arm64.zip
    XBE-Code-arm64.zip.blockmap
    XBE-Code-x64.zip
    XBE-Code-x64.zip.blockmap
    XBE-Code-x64.exe
    XBE-Code-x64.exe.blockmap
    XBE-Code-x86_64.AppImage
```

## browser/PWA update notification

- The service worker (`apps/web/public/sw.js`) uses message-based activation — new versions wait until the app sends a `SKIP_WAITING` message.
- `useServiceWorkerUpdate` hook detects a waiting service worker and polls for updates every 4 hours.
- `useAppUpdate` hook unifies browser SW updates and desktop electron-updater into a single `AppUpdateInfo` interface.
- `UpdateBanner` component renders a top-center notification banner when an update is available.
- In Electron, the banner shows desktop update status (available -> downloading -> ready to restart).
- In browsers, the banner prompts the user to refresh and activates the new service worker on click.

## signing (optional)

Signing is auto-detected from environment variables. Builds are unsigned by default. Add `--signed` to the build command to enable.

### apple signing + notarization (macOS)

Set these environment variables (or GitHub Actions secrets for CI):

- `CSC_LINK` — base64-encoded `.p12` certificate + private key
- `CSC_KEY_PASSWORD` — `.p12` export password
- `APPLE_API_KEY` — contents of the `.p8` API key file
- `APPLE_API_KEY_ID` — key ID from App Store Connect
- `APPLE_API_ISSUER` — issuer ID from App Store Connect

Note: macOS signing only works when building on macOS (not from Linux cross-compilation). Use CI for signed macOS builds.

### azure trusted signing (Windows)

Set these environment variables:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

## common mistakes

| mistake | result | fix |
|---|---|---|
| Release created with `--prerelease` | README links 404 | `gh release edit v$V --repo x-b-e/xbe-code --prerelease=false --latest` |
| Forgot `--latest` flag | Older release stays as "latest" | `gh release edit v$V --repo x-b-e/xbe-code --latest` |
| Forgot `bun run build:desktop` | Missing `apps/server/dist/client/index.html` | Run `bun run build:desktop` before artifact builds |
| macOS x64 overwrites `latest-mac.yml` | arm64 users get wrong binary | Rename to `latest-mac-x64.yml` and recreate arm64 manifest (step 5) |
| Uploaded to GCS but forgot manifests | Auto-updater doesn't see new version | Upload `latest*.yml` to bucket root |
| Wine not initialized | Windows build fails with `kernel32.dll` error | `rm -rf ~/.wine && WINEARCH=win32 wineboot --init` |

## troubleshooting

- **Build fails with `sips` not found**: You're on Linux. Ensure ImageMagick (`convert`) and `icnsutils` (`png2icns`) are installed.
- **Build fails with `wine: could not load kernel32.dll`**: Recreate Wine prefix: `rm -rf ~/.wine && WINEARCH=win32 wineboot --init`
- **Build fails with `Missing bundled server client`**: Run `bun run build:desktop` first.
- **`electron-updater` doesn't find updates**: Ensure `latest*.yml` files are uploaded to GCS bucket root and binaries are in `{version}/` prefix.
- **Build fails with signing error**: Retry without `--signed` to confirm unsigned path works, then re-check credentials.
- **Private repo download 404**: Ensure the user is logged into GitHub and has repo access, or set `GH_TOKEN` for CLI use.
