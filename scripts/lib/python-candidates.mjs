import fs from 'node:fs';

export function isWindows() {
  return process.platform === 'win32';
}

export function getCandidates() {
  const out = [];
  if (process.env.PYTHON && process.env.PYTHON.trim()) {
    out.push({ cmd: process.env.PYTHON.trim(), args: [] });
  }

  if (isWindows()) {
    const miniconda = 'C:\\ProgramData\\miniconda3\\python.exe';
    if (fs.existsSync(miniconda)) {
      out.push({ cmd: miniconda, args: [] });
    }

    out.push({ cmd: 'py', args: ['-3'] });
    out.push({ cmd: 'python', args: [] });
  } else {
    out.push({ cmd: 'python3', args: [] });
    out.push({ cmd: 'python', args: [] });
  }

  return out;
}
