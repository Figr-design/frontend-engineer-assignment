const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const frontend = path.join(root, "frontend");

function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      shutdown(code);
    }
  });
  return child;
}

const backend = launch("node", ["backend/server.js"], root);
const web = launch("npx", ["vite", "--port", "5173", "--strictPort"], frontend);

function shutdown(code = 0) {
  backend.kill();
  web.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
