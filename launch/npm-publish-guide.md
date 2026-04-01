# npm Publish Guide — claude-code-xray

The package name `claude-code-xray` is confirmed available on npm (checked 2026-03-31).

## Prerequisites

- Node.js >= 18
- npm account (https://www.npmjs.com/signup)

## First-time publish

### 1. Login

```bash
npm login
```

Follow the prompts (username, password, OTP if 2FA enabled).

### 2. Build

```bash
npx tsc
```

Verify the CLI entry point exists and has a shebang:

```bash
head -1 dist/scan/cli.js
# Expected: #!/usr/bin/env node
```

### 3. Dry run (optional)

See exactly what npm will pack:

```bash
npm pack --dry-run
```

Review the file list. Only `dist/`, `README.md`, `LICENSE`, and `package.json` should be included.

### 4. Publish

```bash
npm publish --access public
```

### 5. Verify

```bash
# Check the registry listing
npm view claude-code-xray

# Test global install
npx claude-code-xray

# Or install globally
npm i -g claude-code-xray
claude-code-xray
```

## Publishing updates

### 1. Bump version

```bash
# Patch (0.1.0 -> 0.1.1) — bug fixes
npm version patch

# Minor (0.1.0 -> 0.2.0) — new features, backward compatible
npm version minor

# Major (0.1.0 -> 1.0.0) — breaking changes
npm version major
```

This auto-updates `package.json` and creates a git tag.

### 2. Build + publish

```bash
npx tsc
npm publish
```

### 3. Verify

```bash
npx claude-code-xray@latest
```

## Troubleshooting

| Problem                  | Fix                                                         |
| ------------------------ | ----------------------------------------------------------- |
| `E403 Forbidden`         | Run `npm login` again, check OTP                            |
| `E402 Payment Required`  | Add `--access public` (scoped packages default to private)  |
| `ENEEDAUTH`              | `npm login` first                                           |
| Missing files in package | Check `.npmignore` and `files` in `package.json`            |
| shebang not working      | Ensure `dist/scan/cli.js` starts with `#!/usr/bin/env node` |
