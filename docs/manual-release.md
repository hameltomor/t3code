# manual release

How to publish a new desktop release so the README download buttons always point to the latest version.

## how it works

- The README uses GitHub's `/releases/latest/download/` URLs which auto-resolve to the most recent non-prerelease release.
- Artifact filenames are version-free (`XBE-Code-{arch}.{ext}`), so the same README links work for every release.
- No README edits needed when releasing a new version.

## artifacts

| platform | filename | build command | build machine |
|---|---|---|---|
| macOS Apple Silicon | `XBE-Code-arm64.dmg` | `bun dist:desktop:dmg:arm64` | macOS (arm64) |
| macOS Intel | `XBE-Code-x64.dmg` | `bun dist:desktop:dmg:x64` | macOS (x64 or arm64) |
| Windows x64 | `XBE-Code-x64.exe` | `bun dist:desktop:win` | Windows |
| Linux x64 | `XBE-Code-x86_64.AppImage` | `bun dist:desktop:linux` | Linux |

Cross-compilation is not supported due to native Node modules (`node-pty`, `msgpackr-extract`). Each platform must be built on its native OS.

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
```

If the web/server code hasn't changed since the last build, add `--skip-build` to save time:

```bash
bun dist:desktop:linux -- --skip-build
```

### 3. create the github release and upload

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
```

The README download buttons now point to this release.

## replacing a single artifact

To rebuild and replace one platform without touching the others:

```bash
VERSION=v0.1.0
bun dist:desktop:linux
gh release upload $VERSION release/XBE-Code-x86_64.AppImage --repo x-b-e/xbe-code --clobber
```

## common mistakes

| mistake | result | fix |
|---|---|---|
| Release created with `--prerelease` | README links 404 (GitHub skips prereleases for `/latest`) | `gh release edit $VERSION --repo x-b-e/xbe-code --prerelease=false --latest` |
| Forgot `--latest` flag | Another older release stays as "latest" | `gh release edit $VERSION --repo x-b-e/xbe-code --latest` |
| Built on wrong OS | Build fails with cross-compilation error | Build each platform on its native OS |
| Version in artifact name | README links break (they expect fixed names) | Keep `artifactName` in build script as `XBE-Code-${arch}.${ext}` |
