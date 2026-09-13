import fs from 'node:fs';

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const packages = Object.entries(lock.packages ?? {}).filter(([path]) => path);
const records = packages.map(([path, value]) => ({
  path,
  name: value.name ?? path.replace(/^node_modules\//, ''),
  version: value.version ?? null,
  resolved: value.resolved ?? null,
  hasIntegrity: typeof value.integrity === 'string' && value.integrity.length > 0,
  hasInstallScript: value.hasInstallScript === true,
  dev: value.dev === true,
  optional: value.optional === true,
}));
const nonRegistry = records.filter((r) => r.resolved && !/^https:\/\/registry\.npmjs\.org\//.test(r.resolved));
const missingIntegrity = records.filter((r) => r.resolved && !r.hasIntegrity);
const installScripts = records.filter((r) => r.hasInstallScript);
const summary = {
  lockfileVersion: lock.lockfileVersion,
  packageCount: records.length,
  nonRegistry,
  missingIntegrity,
  installScripts,
  rootDependencies: lock.packages?.['']?.dependencies ?? {},
  rootDevDependencies: lock.packages?.['']?.devDependencies ?? {},
};
console.log(JSON.stringify(summary, null, 2));
