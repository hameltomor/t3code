import { spawn } from "node:child_process";
import readline from "node:readline";

const IGNORED_LINES = new Set([
  "`transformWithEsbuild` is deprecated and will be removed in the future. Please migrate to `transformWithOxc`.",
]);

const child = spawn(process.execPath, ["./node_modules/astro/astro.js", "build"], {
  cwd: new URL("..", import.meta.url),
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

function pipeFiltered(stream, target) {
  const rl = readline.createInterface({ input: stream });
  rl.on("line", (line) => {
    if (!IGNORED_LINES.has(line.trim())) {
      target.write(`${line}\n`);
    }
  });
}

pipeFiltered(child.stdout, process.stdout);
pipeFiltered(child.stderr, process.stderr);
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
