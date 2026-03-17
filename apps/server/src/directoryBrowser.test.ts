import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, assert, describe, expect, it } from "vitest";

import { getAllowedRoots, isUnderAllowedRoot, listDirectory } from "./directoryBrowser";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(dir: string, relativePath: string, contents = ""): void {
  const absolutePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
}

describe("listDirectory", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists files and directories sorted correctly", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-");
    writeFile(dir, "b-file.txt");
    writeFile(dir, "a-file.txt");
    fs.mkdirSync(path.join(dir, "z-dir"));
    fs.mkdirSync(path.join(dir, "a-dir"));

    const result = await listDirectory({ path: dir });

    // Directories first, alphabetical; then files, alphabetical
    const names = result.entries.map((e) => e.name);
    assert.deepStrictEqual(names, ["a-dir", "z-dir", "a-file.txt", "b-file.txt"]);
  });

  it("returns correct entry metadata", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-meta-");
    writeFile(dir, "hello.txt", "hello world");
    fs.mkdirSync(path.join(dir, "sub"));

    const result = await listDirectory({ path: dir });

    const fileEntry = result.entries.find((e) => e.name === "hello.txt");
    assert.ok(fileEntry);
    assert.strictEqual(fileEntry.kind, "file");
    assert.strictEqual(fileEntry.size, 11);
    assert.ok(fileEntry.modifiedAt);

    const dirEntry = result.entries.find((e) => e.name === "sub");
    assert.ok(dirEntry);
    assert.strictEqual(dirEntry.kind, "directory");
  });

  it("hides hidden files by default", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-hidden-");
    writeFile(dir, ".hidden");
    writeFile(dir, "visible.txt");

    const result = await listDirectory({ path: dir });
    const names = result.entries.map((e) => e.name);

    assert.notInclude(names, ".hidden");
    assert.include(names, "visible.txt");
  });

  it("shows hidden files when showHidden is true", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-showhidden-");
    writeFile(dir, ".hidden");
    writeFile(dir, "visible.txt");

    const result = await listDirectory({ path: dir, showHidden: true });
    const names = result.entries.map((e) => e.name);

    assert.include(names, ".hidden");
    assert.include(names, "visible.txt");
  });

  it("always skips node_modules and .git", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-skip-");
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.mkdirSync(path.join(dir, ".git"));
    writeFile(dir, "src/index.ts");

    const result = await listDirectory({ path: dir, showHidden: true });
    const names = result.entries.map((e) => e.name);

    assert.notInclude(names, "node_modules");
    assert.notInclude(names, ".git");
    assert.include(names, "src");
  });

  it("returns parentPath for non-root directories", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-parent-");
    const subDir = path.join(dir, "child");
    fs.mkdirSync(subDir);

    const result = await listDirectory({ path: subDir });

    assert.strictEqual(result.currentPath, subDir);
    assert.strictEqual(result.parentPath, dir);
  });

  it("returns null parentPath for filesystem root", async () => {
    // On POSIX, "/" is root. On Windows, "C:\" is root.
    const rootPath = process.platform === "win32" ? "C:\\" : "/";
    const result = await listDirectory({ path: rootPath });

    assert.strictEqual(result.parentPath, null);
  });

  it("throws on non-existent directory", async () => {
    const nonExistent = path.join(os.tmpdir(), "xbecode-dirbrowser-nonexistent-" + Date.now());
    await expect(listDirectory({ path: nonExistent })).rejects.toBeDefined();
  });

  it("resolves currentPath to absolute", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-resolve-");
    const result = await listDirectory({ path: dir });

    assert.ok(path.isAbsolute(result.currentPath));
    assert.strictEqual(result.currentPath, path.resolve(dir));
  });

  it("handles empty directories", async () => {
    const dir = makeTempDir("xbecode-dirbrowser-empty-");
    const result = await listDirectory({ path: dir });

    assert.deepStrictEqual(result.entries, []);
    assert.strictEqual(result.currentPath, dir);
  });
});

describe("isUnderAllowedRoot", () => {
  it("accepts a path equal to an allowed root", () => {
    assert.isTrue(isUnderAllowedRoot("/home/user", ["/home/user"]));
  });

  it("accepts a path nested under an allowed root", () => {
    assert.isTrue(isUnderAllowedRoot("/home/user/projects/foo", ["/home/user"]));
  });

  it("rejects a path outside all allowed roots", () => {
    assert.isFalse(isUnderAllowedRoot("/etc/secrets", ["/home/user"]));
  });

  it("rejects a path that is a prefix but not a parent (no separator)", () => {
    // /home/userX should NOT match allowed root /home/user
    assert.isFalse(isUnderAllowedRoot("/home/userX", ["/home/user"]));
  });

  it("accepts paths under filesystem root /", () => {
    assert.isTrue(isUnderAllowedRoot("/tmp", ["/"]));
    assert.isTrue(isUnderAllowedRoot("/home/user/file", ["/"]));
  });

  it("handles multiple allowed roots", () => {
    const roots = ["/home/user", "/mnt/data"];
    assert.isTrue(isUnderAllowedRoot("/mnt/data/repo", roots));
    assert.isTrue(isUnderAllowedRoot("/home/user/work", roots));
    assert.isFalse(isUnderAllowedRoot("/var/log", roots));
  });

  it("handles Windows-style drive roots", () => {
    // path.resolve() is platform-specific so this only works on Windows
    if (process.platform !== "win32") return;
    assert.isTrue(isUnderAllowedRoot("C:\\Users\\me", ["C:\\"]));
    assert.isTrue(isUnderAllowedRoot("C:\\Users\\me", ["C:\\Users\\me"]));
  });
});

describe("getAllowedRoots", () => {
  it("includes the home directory", async () => {
    const roots = await getAllowedRoots();
    const home = path.resolve(os.homedir());
    assert.include(roots, home);
  });

  it("includes filesystem root on POSIX", async () => {
    if (process.platform === "win32") return; // skip on Windows
    const roots = await getAllowedRoots();
    assert.include(roots, "/");
  });
});
