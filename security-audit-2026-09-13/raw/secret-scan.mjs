import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'tests', 'scripts'];
const files = ['package.json', 'README.md', 'SECURITY.md', 'tsconfig.json'];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
}

const detectors = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['credential-assignment', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\r\n]{8,}["']/gi],
];
const findings = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [detector, regex] of detectors) {
    for (const match of text.matchAll(regex)) {
      findings.push({
        file: file.replaceAll('\\', '/'),
        line: text.slice(0, match.index).split(/\r?\n/).length,
        detector,
        fingerprint: crypto.createHash('sha256').update(match[0]).digest('hex').slice(0, 12),
      });
    }
  }
}
console.log(JSON.stringify({ scannedFiles: files.length, findings }, null, 2));
