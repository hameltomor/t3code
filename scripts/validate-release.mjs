#!/usr/bin/env node

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
const DEFAULT_UPDATE_BASE_URL = "https://synkr-server.price-bee.com/xbecode/";

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

function readManifest(filePath) {
  const contents = readFileSync(filePath, "utf8");
  const versionMatch = contents.match(/^version:\s*(.+)$/m);
  const pathMatch = contents.match(/^path:\s*(.+)$/m);
  const urlMatches = [...contents.matchAll(/^\s*-\s*url:\s*(.+)$/gm)];

  return {
    version: versionMatch ? cleanYamlScalar(versionMatch[1]) : null,
    path: pathMatch ? cleanYamlScalar(pathMatch[1]) : null,
    urls: urlMatches.map((match) => cleanYamlScalar(match[1])),
  };
}

function runCommand(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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

    const referencedFiles = new Set(
      [manifest.path, ...manifest.urls].filter((value) => typeof value === "string" && value.length > 0),
    );
    for (const referencedFile of referencedFiles) {
      const referencedPath = join(releaseDir, referencedFile);
      if (!existsSync(referencedPath)) {
        errors.push(`${fileName} references missing local file '${referencedFile}'.`);
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

async function probeUrl(url, description, errors) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
    });
    if (response.status >= 200 && response.status < 400) {
      return;
    }

    errors.push(`${description} returned HTTP ${response.status}: ${url}`);
  } catch (error) {
    errors.push(`${description} request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
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

    const referencedFiles = new Set(
      [tempManifest.path, ...tempManifest.urls].filter(
        (value) => typeof value === "string" && value.length > 0,
      ),
    );
    for (const referencedFile of referencedFiles) {
      const payloadUrl = new URL(referencedFile, updateBaseUrl).toString();
      await probeUrl(payloadUrl, `remote updater payload '${referencedFile}'`, errors);
    }
  }
}

function readManifestFromString(contents) {
  const versionMatch = contents.match(/^version:\s*(.+)$/m);
  const pathMatch = contents.match(/^path:\s*(.+)$/m);
  const urlMatches = [...contents.matchAll(/^\s*-\s*url:\s*(.+)$/gm)];

  return {
    version: versionMatch ? cleanYamlScalar(versionMatch[1]) : null,
    path: pathMatch ? cleanYamlScalar(pathMatch[1]) : null,
    urls: urlMatches.map((match) => cleanYamlScalar(match[1])),
  };
}

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    releaseDir: { type: "string", default: "release" },
    repo: { type: "string", default: DEFAULT_REPO },
    bucket: { type: "string", default: DEFAULT_BUCKET },
    updateBaseUrl: { type: "string", default: DEFAULT_UPDATE_BASE_URL },
    skipGh: { type: "boolean", default: false },
    skipGcs: { type: "boolean", default: false },
    skipRemote: { type: "boolean", default: false },
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

const releaseDir = resolve(values.releaseDir);
const repo = values.repo;
const bucket = values.bucket;
const updateBaseUrl = normalizeBaseUrl(values.updateBaseUrl);
const errors = [];

if (!existsSync(releaseDir)) {
  console.error(`Release directory does not exist: ${releaseDir}`);
  process.exit(1);
}

checkLocalFiles(releaseDir, errors);
checkLocalManifests(releaseDir, version, errors);

if (!values.skipGh) {
  checkGitHubRelease(version, repo, errors);
}

if (!values.skipGcs) {
  checkGcs(bucket, version, errors);
}

if (!values.skipRemote) {
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
console.log(`Validated local artifacts in ${releaseDir}`);
if (!values.skipGh) {
  console.log(`Validated GitHub release assets in ${repo}`);
}
if (!values.skipGcs) {
  console.log(`Validated GCS objects in gs://${bucket}`);
}
if (!values.skipRemote) {
  console.log(`Validated updater URLs under ${updateBaseUrl}`);
}
