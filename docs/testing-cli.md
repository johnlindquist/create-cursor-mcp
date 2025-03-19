# Testing the CLI locally

You can test the CLI locally (from the root folder) using this command that changes to the tmp directory and runs the cli.ts in its parent folder. The tmp/ folder is gitignored, so we can create test projects there.

With Node.js:
```bash
cd tmp && node ../cli.ts
```

With TypeScript loaders (like tsx):
```bash
cd tmp && tsx ../cli.ts
```

With Bun:
```bash
cd tmp && bun ../cli.ts
```

## Testing with options:

```bash
cd tmp && node ../cli.ts --name my-server
```

```bash
cd tmp && node ../cli.ts --clone https://github.com/user/repo
``` 