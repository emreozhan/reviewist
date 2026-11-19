# Reviewist Local

Reviews Java changes in a git repository on this machine. **It never goes to the network**: it works the same on a
machine with no internet connection or with restricted outbound access.

This folder is a standalone application. All you need is **Node.js 20+** and **git**; no `npm install`. You can copy
the folder (`bin/`, `dist/`, `package.json`) anywhere and run it.

> The user interface and command-line messages are in Turkish.

## Start

```bash
node bin/reviewist-local.js
```

The browser opens `http://127.0.0.1:4317`; pick the repository folder with **Gözat…** (Browse), choose the branches
from the drop-downs and press **Analiz et** (Analyze). You can also start a review straight from the command line:

```bash
node bin/reviewist-local.js /path/to/repo --base main --head feature/x
```

```bash
node bin/reviewist-local.js /path/to/repo --worktree
```

All options: `node bin/reviewist-local.js --help`

## What it reviews

| Source | Description |
| --- | --- |
| Git range | Two branches/tags/commits; from the common ancestor of base and head (pull request view) or the direct range |
| Working tree | Uncommitted changes (including untracked files) |
| Patch | A pasted unified diff; if a repository path is given, callers are resolved too |

For remote repositories and GitHub pull requests use the separate application: `reviewist-github` (the `github/`
folder of the repository).

## Network and privacy

- The app contains **no** code that makes outbound requests; the build stops if such code enters the package (bundle
  audit).
- The server process and the parser workers install the egress guard at startup: every TCP connection, DNS lookup and
  UDP send to anything other than `127.0.0.1` is blocked.
- `git` runs with all transports disabled (`protocol.allow=never`, `GIT_NO_LAZY_FETCH=1`): the app never does a
  `fetch`/`clone` under any circumstances, and does not contact the remote for missing objects in partial clones.
- The server listens only on `127.0.0.1`; the content security policy lets the page talk only to its own server.
- The reviewed repository is not written to: hooks and `fsmonitor` are disabled, the index is not rewritten and
  symbolic links are not followed.

If you wish, you can block outbound connections for `node` entirely in the operating system firewall; the app is not
affected.

## Environment variables

| Variable | What it does |
| --- | --- |
| `REVIEWIST_GIT` | Full path of the git executable (if it cannot be found on PATH; Windows and macOS) |

## Limits

- Working tree mode: at most 2000 untracked files, 5 MB per file.
- Patch mode: if a repository path is given, the folder may be in the patched or unpatched state; both are resolved.
  Without a repository path only the lines in the patch are analyzed (no caller information).
- Reviews are kept in memory only (at most 20) and are gone when the server stops. Seen marks, notes and tabs stay in
  the browser's `localStorage`.

## Package contents

`dist/BUILD.json` lists the version and the bundled libraries (with versions); licenses are in
`dist/THIRD-PARTY-LICENSES.txt`. Source code and build: see the README at the repository root.

[MIT](LICENSE)
