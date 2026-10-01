const { spawn } = require('node:child_process');

const processes = [
  spawn(process.execPath, ['backend/server.js'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '--prefix', 'frontend'], { stdio: 'inherit', shell: true }),
];

let stopping = false;
const stop = code => {
  if (stopping) return;
  stopping = true;
  processes.forEach(child => {
    if (!child.killed) child.kill();
  });
  process.exitCode = code;
};

processes.forEach(child => {
  child.on('exit', code => {
    if (!stopping && code !== 0) stop(code || 1);
  });
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
