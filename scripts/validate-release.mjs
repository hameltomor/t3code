#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const EXPECTED_RELEASE_FILES = [
  "XBE-Code-arm64.zip",
  "XBE-Code-arm64.zip.blockmap",
  "XBE-Code-x64.zip",
  "XBE-Code-x64.zip.blockmap",
  "XBE-Code-x64.exe",
  "XBE-Code-x64.exe.blockmap",
  "XBE-Code-x86_64.AppImage",
  "latest-mac.yml",
  "latest-mac-x64.yml",
  "latest-linux.yml",
  "latest.yml",
  "xbe-server.tgz",
];

const EXPECTED_ROOT_GCS_FILES = [
  "latest-mac.yml",
  "latest-mac-x64.yml",
  "latest-linux.yml",
  "latest.yml",
  "XBE-Code-arm64.zip",
  "XBE-Code-arm64.zip.blockmap",
  "XBE-Code-x64.zip",
  "XBE-Code-x64.zip.blockmap",
  "XBE-Code-x64.exe",
  "XBE-Code-x64.exe.blockmap",
  "XBE-Code-x86_64.AppImage",
];

const EXPECTED_VERSIONED_GCS_FILES = [
  "XBE-Code-arm64.zip",
  "XBE-Code-arm64.zip.blockmap",
  "XBE-Code-x64.zip",
  "XBE-Code-x64.zip.blockmap",
  "XBE-Code-x64.exe",
  "XBE-Code-x64.exe.blockmap",
  "XBE-Code-x86_64.AppImage",
];

const EXPECTED_GITHUB_ASSETS = [...EXPECTED_RELEASE_FILES];

const MANIFEST_FILES = ["latest-mac.yml", "latest-mac-x64.yml", "latest-linux.yml", "latest.yml"];

const DEFAULT_REPO = "x-b-e/xbe-code";
const DEFAULT_BUCKET = "xbecode-releases";
const DEFAULT_UPDATE_BASE_URL = "https://storage.googleapis.com/xbecode-releases/";

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/validate-release.mjs --version 0.0.10",
      "",
      "Options:",
      "  --release-dir <dir>      Local release directory (default: release)",
      `  --repo <owner/name>      GitHub repo (default: ${DEFAULT_REPO})`,
      `  --bucket <name>          GCS bucket (default: ${DEFAULT_BUCKET})`,
      `  --update-base-url <url>  Updater base URL (default: ${DEFAULT_UPDATE_BASE_URL})`,
      "  --skip-local             Skip local release directory validation",
      "  --skip-gh                Skip GitHub release validation",
      "  --skip-gcs               Skip GCS validation",
      "  --skip-remote            Skip updater URL validation",
    ].join("\n"),
  );
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function cleanYamlScalar(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function cleanYamlInteger(value) {
  const normalized = cleanYamlScalar(value);
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  return Number.parseInt(normalized, 10);
}

function readManifestFromString(contents) {
  const versionMatch = contents.match(/^version:\s*(.+)$/m);
  const pathMatch = contents.match(/^path:\s*(.+)$/m);
  const sha512Match = contents.match(/^sha512:\s*(.+)$/m);
  const fileEntries = [...contents.matchAll(/^\s*-\s*url:\s*(.+)\n\s+sha512:\s*(.+)\n\s+size:\s*(.+)$/gm)].map(
    (match) => ({
      url: cleanYamlScalar(match[1]),
      sha512: cleanYamlScalar(match[2]),
      size: cleanYamlInteger(match[3]),
    }),
  );

  return {
    version: versionMatch ? cleanYamlScalar(versionMatch[1]) : null,
    path: pathMatch ? cleanYamlScalar(pathMatch[1]) : null,
    sha512: sha512Match ? cleanYamlScalar(sha512Match[1]) : null,
    files: fileEntries,
  };
}

function readManifest(filePath) {
  return readManifestFromString(readFileSync(filePath, "utf8"));
}

function runCommand(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function hashBytes(input) {
  return createHash("sha512").update(input).digest("base64");
}

function hashLocalFile(filePath) {
  const contents = readFileSync(filePath);
  return {
    sha512: hashBytes(contents),
    size: contents.byteLength,
  };
}

async function hashRemoteFile(url, description, errors) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      errors.push(`${description} returned HTTP ${response.status}: ${url}`);
      return null;
    }
    if (!response.body) {
      errors.push(`${description} returned an empty response body: ${url}`);
      return null;
    }

    const hash = createHash("sha512");
    let size = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      hash.update(buffer);
    }

    return {
      sha512: hash.digest("base64"),
      size,
    };
  } catch (error) {
    errors.push(`${description} request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function getManifestReferencedFiles(manifest) {
  return new Set(
    [manifest.path, ...manifest.files.map((entry) => entry.url)].filter(
      (value) => typeof value === "string" && value.length > 0,
    ),
  );
}

function validateManifestFileEntry(manifestName, entry, actual, errors) {
  if (entry.size === null) {
    errors.push(`${manifestName} entry '${entry.url}' has an invalid size value.`);
  } else if (actual.size !== entry.size) {
    errors.push(
      `${manifestName} entry '${entry.url}' has size ${entry.size}, but the payload is ${actual.size} bytes.`,
    );
  }

  if (actual.sha512 !== entry.sha512) {
    errors.push(
      `${manifestName} entry '${entry.url}' has sha512 '${entry.sha512}', but the payload hashes to '${actual.sha512}'.`,
    );
  }
}

function checkLocalFiles(releaseDir, errors) {
  for (const fileName of EXPECTED_RELEASE_FILES) {
    const filePath = join(releaseDir, fileName);
    if (!existsSync(filePath)) {
      errors.push(`Missing local release artifact: ${filePath}`);
    }
  }
}

function checkLocalManifests(releaseDir, version, errors) {
  for (const fileName of MANIFEST_FILES) {
    const manifestPath = join(releaseDir, fileName);
    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = readManifest(manifestPath);
    if (manifest.version !== version) {
      errors.push(
        `${fileName} has version '${manifest.version ?? "missing"}', expected '${version}'.`,
      );
    }

    const referencedFiles = getManifestReferencedFiles(manifest);
    for (const referencedFile of referencedFiles) {
      const referencedPath = join(releaseDir, referencedFile);
      if (!existsSync(referencedPath)) {
        errors.push(`${fileName} references missing local file '${referencedFile}'.`);
      }
    }

    const payloadHashes = new Map();
    for (const entry of manifest.files) {
      const referencedPath = join(releaseDir, entry.url);
      if (!existsSync(referencedPath)) {
        continue;
      }

      const actual =
        payloadHashes.get(entry.url) ??
        (() => {
          const value = hashLocalFile(referencedPath);
          payloadHashes.set(entry.url, value);
          return value;
        })();
      validateManifestFileEntry(fileName, entry, actual, errors);
    }

    if (manifest.path && manifest.sha512) {
      const referencedPath = join(releaseDir, manifest.path);
      if (existsSync(referencedPath)) {
        const actual =
          payloadHashes.get(manifest.path) ??
          (() => {
            const value = hashLocalFile(referencedPath);
            payloadHashes.set(manifest.path, value);
            return value;
          })();
        if (actual.sha512 !== manifest.sha512) {
          errors.push(
            `${fileName} top-level path '${manifest.path}' has sha512 '${manifest.sha512}', but the payload hashes to '${actual.sha512}'.`,
          );
        }
      }
    }
  }
}

function checkGitHubRelease(version, repo, errors) {
  try {
    const output = runCommand("gh", [
      "release",
      "view",
      `v${version}`,
      "--repo",
      repo,
      "--json",
      "assets",
    ]);
    const parsed = JSON.parse(output);
    const assetNames = new Set(
      Array.isArray(parsed.assets)
        ? parsed.assets
            .map((asset) => (asset && typeof asset.name === "string" ? asset.name : null))
            .filter((value) => value !== null)
        : [],
    );

    for (const fileName of EXPECTED_GITHUB_ASSETS) {
      if (!assetNames.has(fileName)) {
        errors.push(`GitHub release v${version} is missing asset '${fileName}'.`);
      }
    }
  } catch (error) {
    errors.push(`GitHub release validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseGcsStat(output) {
  const sizeMatch = output.match(/^Content-Length:\s*(\d+)$/m);
  const md5Match = output.match(/^Hash \(md5\):\s*(.+)$/m);
  const crc32cMatch = output.match(/^Hash \(crc32c\):\s*(.+)$/m);

  return {
    size: sizeMatch ? Number.parseInt(sizeMatch[1], 10) : null,
    md5: md5Match ? md5Match[1].trim() : null,
    crc32c: crc32cMatch ? crc32cMatch[1].trim() : null,
  };
}

function statGcsObject(objectUrl) {
  return parseGcsStat(runCommand("gsutil", ["stat", objectUrl]));
}

function checkGcsObject(objectUrl, description, errors) {
  try {
    runCommand("gsutil", ["ls", objectUrl]);
  } catch (error) {
    errors.push(
      `Missing GCS object for ${description}: ${objectUrl} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function checkGcs(bucket, version, errors) {
  for (const fileName of EXPECTED_ROOT_GCS_FILES) {
    checkGcsObject(`gs://${bucket}/${fileName}`, `bucket root file '${fileName}'`, errors);
  }

  for (const fileName of EXPECTED_VERSIONED_GCS_FILES) {
    checkGcsObject(`gs://${bucket}/${version}/${fileName}`, `versioned file '${fileName}'`, errors);
  }

  for (const fileName of EXPECTED_VERSIONED_GCS_FILES) {
    const rootObjectUrl = `gs://${bucket}/${fileName}`;
    const versionedObjectUrl = `gs://${bucket}/${version}/${fileName}`;

    try {
      const rootMetadata = statGcsObject(rootObjectUrl);
      const versionedMetadata = statGcsObject(versionedObjectUrl);
      if (rootMetadata.size !== null && versionedMetadata.size !== null && rootMetadata.size !== versionedMetadata.size) {
        errors.push(
          `GCS root file '${fileName}' has size ${rootMetadata.size}, but versioned file '${version}/${fileName}' has size ${versionedMetadata.size}.`,
        );
      }

      const comparableHash = rootMetadata.md5 && versionedMetadata.md5
        ? "md5"
        : rootMetadata.crc32c && versionedMetadata.crc32c
          ? "crc32c"
          : null;
      if (comparableHash && rootMetadata[comparableHash] !== versionedMetadata[comparableHash]) {
        errors.push(
          `GCS root file '${fileName}' does not match versioned file '${version}/${fileName}' (${comparableHash} differs).`,
        );
      }
    } catch (error) {
      errors.push(
        `GCS metadata validation failed for '${fileName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function fetchText(url, description, errors) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      errors.push(`${description} returned HTTP ${response.status}: ${url}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    errors.push(`${description} request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function checkRemote(updateBaseUrl, version, errors) {
  for (const fileName of MANIFEST_FILES) {
    const manifestUrl = new URL(fileName, updateBaseUrl).toString();
    const contents = await fetchText(manifestUrl, `remote manifest '${fileName}'`, errors);
    if (!contents) {
      continue;
    }

    const tempManifest = readManifestFromString(contents);
    if (tempManifest.version !== version) {
      errors.push(
        `Remote manifest '${fileName}' has version '${tempManifest.version ?? "missing"}', expected '${version}'.`,
      );
    }

    const payloadHashes = new Map();
    for (const entry of tempManifest.files) {
      const payloadUrl = new URL(entry.url, updateBaseUrl).toString();
      const actual =
        payloadHashes.get(entry.url) ??
        (await hashRemoteFile(payloadUrl, `remote updater payload '${entry.url}'`, errors));
      if (!actual) {
        continue;
      }
      payloadHashes.set(entry.url, actual);
      validateManifestFileEntry(`Remote manifest '${fileName}'`, entry, actual, errors);
    }

    if (tempManifest.path && tempManifest.sha512) {
      const payloadUrl = new URL(tempManifest.path, updateBaseUrl).toString();
      const actual =
        payloadHashes.get(tempManifest.path) ??
        (await hashRemoteFile(
          payloadUrl,
          `remote updater payload '${tempManifest.path}'`,
          errors,
        ));
      if (!actual) {
        continue;
      }
      payloadHashes.set(tempManifest.path, actual);
      if (actual.sha512 !== tempManifest.sha512) {
        errors.push(
          `Remote manifest '${fileName}' top-level path '${tempManifest.path}' has sha512 '${tempManifest.sha512}', but the payload hashes to '${actual.sha512}'.`,
        );
      }
    }
  }
}

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    "release-dir": { type: "string", default: "release" },
    repo: { type: "string", default: DEFAULT_REPO },
    bucket: { type: "string", default: DEFAULT_BUCKET },
    "update-base-url": { type: "string", default: DEFAULT_UPDATE_BASE_URL },
    "skip-local": { type: "boolean", default: false },
    "skip-gh": { type: "boolean", default: false },
    "skip-gcs": { type: "boolean", default: false },
    "skip-remote": { type: "boolean", default: false },
  },
});

if (!values.version) {
  usage();
  process.exit(1);
}

const version = values.version.trim().replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid version '${values.version}'.`);
  usage();
  process.exit(1);
}

const releaseDir = resolve(values["release-dir"]);
const repo = values.repo;
const bucket = values.bucket;
const updateBaseUrl = normalizeBaseUrl(values["update-base-url"]);
const errors = [];

if (!values["skip-local"] && !existsSync(releaseDir)) {
  console.error(`Release directory does not exist: ${releaseDir}`);
  process.exit(1);
}

if (!values["skip-local"]) {
  checkLocalFiles(releaseDir, errors);
  checkLocalManifests(releaseDir, version, errors);
}

if (!values["skip-gh"]) {
  checkGitHubRelease(version, repo, errors);
}

if (!values["skip-gcs"]) {
  checkGcs(bucket, version, errors);
}

if (!values["skip-remote"]) {
  await checkRemote(updateBaseUrl, version, errors);
}

if (errors.length > 0) {
  console.error(`Release validation failed with ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Release validation passed for v${version}.`);
if (!values["skip-local"]) {
  console.log(`Validated local artifacts in ${releaseDir}`);
}
if (!values["skip-gh"]) {
  console.log(`Validated GitHub release assets in ${repo}`);
}
if (!values["skip-gcs"]) {
  console.log(`Validated GCS objects in gs://${bucket}`);
}
if (!values["skip-remote"]) {
  console.log(`Validated updater URLs under ${updateBaseUrl}`);
}
