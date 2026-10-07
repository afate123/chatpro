# Contributing

Use Node.js 22+; no npm dependencies or API keys are required.

1. Edit source in `src/`, not generated files in `dist/`.
2. Add meaningful tests for accounting, migration, identity, quota, or scheduling changes.
3. Run `npm test`, `npm run build`, `npm run build:verify`, `npm run check`.
4. Include generated user/meta files when the source changes. `package.json` is the only version source.
5. Run the offline preview after building; do not include real tokens or histories in fixtures, screenshots, issues, or commits.

Explain actual versus mock verification. An offline test is not proof of a working live private API. Preserve account isolation, existing storage keys, limits/cooldowns and AGPL attribution. Document plan preset provenance and period assumptions. Pro $200 eligibility cannot be inferred from a current subscription start alone.
