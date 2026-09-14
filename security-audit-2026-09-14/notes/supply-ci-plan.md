# Supply-chain, secrets, and CI/CD audit plan

Target revision: `91d08f0f91198178cd7b9a8b25474f8d03170c8d`, including the current working tree.

1. Inventory package manifests, exact lockfile resolutions, lifecycle scripts, CI workflows, containers, infrastructure, and publication configuration.
2. Run the Trail of Bits deterministic supply-chain collector when its required runtime is available; preserve raw JSON and rendered Markdown.
3. Run `npm audit` against resolved lockfile versions and record JSON output without installing or changing packages.
4. Inspect all dependency lifecycle scripts and determine whether `npm ci --ignore-scripts` is viable.
5. Inspect the current tree and reachable Git history for credential patterns without recording secret values.
6. Review GitHub Actions according to the agentic-actions-auditor workflow when workflows exist; otherwise record the absence and the resulting coverage limit.
7. Separate confirmed vulnerable resolved dependencies, reachable application impact, and maintenance or hardening risks.

No private source will be uploaded, no production files will be modified, and no live services will be tested.
