# Reviewist

A code review tool that **runs on your own machine** and makes large, Java-heavy changes (especially AI-generated
ones) easier to review.

A line-by-line diff does not answer "where does this change go?". Reviewist takes the change, resolves the Java code
at **symbol level** (type, method, field) and shows in the browser:

- **Semantic diff** — a status for every member: added, removed, body changed, signature changed, renamed, moved to
  another class, or formatting only. Details are concrete: "parameter added: String idempotencyKey",
  "@Transactional added", "complexity 3 → 7".
- **Propagation** — subclasses overriding the changed method, interface implementations, callers (inside and
  **outside the diff**) and callees.
- **Reading plan** — contracts first (interfaces, abstract classes, domain model), then implementations in dependency
  order; each file's test right after it; formatting-only files last.
- **Risk** — public API changes, members that were removed but are still called, template method changes, meaningful
  annotations, equals/hashCode, empty catch blocks, concurrency… Every reason is shown with its score.
- **Architecture and test checks** — hexagonal architecture violations; does the changed class have a test, and was
  it updated.
- **Follow the flow** — click a call in the code and the target opens in a window in front; a window opened from
  inside it cascades on top. Targets can also open in IDE-style tabs. There is also an impact map, change groups,
  seen marks, notes and Markdown export.

> The user interface and command-line messages are in Turkish.

## Two independent applications

The repository contains two applications that can be deployed independently. Each lives in its own folder with a
**ready-to-run package** (`dist/`) that needs no installation; you can copy the folder on its own and run it. All you
need is **Node.js 20+** and **git**; no `npm install`.

| | [Reviewist Local](local/README.md) (`local/`) | [Reviewist GitHub](github/README.md) (`github/`) |
| --- | --- | --- |
| What it reviews | A git repository on this machine: between two branches/commits, the uncommitted working tree, a pasted patch | A remote repository: a GitHub pull request or two branches of a repository |
| How it gets the code | Reads the repository in place | Fetches it into a local cache with `git clone` / `git fetch` |
| Network | **None.** The app contains no outbound request code; an in-process egress guard is active and `git` runs with networking disabled | `git` connects to the remote; the app itself makes a **single** GitHub API request for the PR title and base branch |
| Start | `node local/bin/reviewist-local.js` | `node github/bin/reviewist-github.js` |
| Default address | `http://127.0.0.1:4317` | `http://127.0.0.1:4318` |

```bash
git clone <repo-url> reviewist
```

```bash
cd reviewist
```

Optional self-check that verifies both packages work on this machine (~10 s, no network):

```bash
node scripts/smoke.mjs
```

To review a local repository:

```bash
node local/bin/reviewist-local.js
```

To review a remote repository or pull request:

```bash
node github/bin/reviewist-github.js
```

To deploy only one of them, copy just that folder (`local/` or `github/`); it does not need the other folder, the
`shared/` sources or `node_modules`.

### macOS notes

- If git is missing: `xcode-select --install` (or Homebrew `brew install git`).
- When the app is started from an icon/launcher, PATH may be restricted; Reviewist also looks for git in well-known
  install locations. If needed, set the path explicitly:
  `REVIEWIST_GIT=/opt/homebrew/bin/git node local/bin/reviewist-local.js`
- For repositories under Documents / Desktop / Downloads, macOS may ask to grant the terminal app folder access.
- Use `⌘+click` instead of `Ctrl+click` on links in the code.

## Security and privacy

Keeping your code on your machine is central to the design and is protected by three independent layers:

1. **Build time — bundle audit.** `npm run build` compares every library that goes into a package, and the
   network/process capabilities inside it, against an allowlist
   ([scripts/lib/bundleAudit.mjs](scripts/lib/bundleAudit.mjs)). The build stops and no package is written if it finds
   a library that is not on the list, a capability that newly appeared in a library (for example a `fetch` introduced
   by an update), any outbound request code in the local app, or a forbidden browser API in the UI (WebSocket,
   `sendBeacon`, `eval`…). The bundled libraries and their versions are listed in `dist/BUILD.json`.
2. **Run time — egress guard.** The server process and the parser workers patch Node's network layer at startup
   ([shared/src/runtime/egressGuard.ts](shared/src/runtime/egressGuard.ts)): every TCP connection, DNS lookup and UDP
   send to anything other than `127.0.0.1` is blocked. The allowlist is empty in the local app; the GitHub app allows
   only the GitHub API hosts (`api.github.com` + `REVIEWIST_GITHUB_HOSTS`). The local app additionally runs `git`
   with all transports disabled (`protocol.allow=never`).
3. **Browser — content security policy.** Every response carries `Content-Security-Policy: default-src 'none';
   connect-src 'self'; script-src 'self'; …`: the page can only talk to its own local server, cannot load external
   scripts, images or fonts, cannot run inline scripts and cannot be embedded in another page.

In addition:

- The server listens only on `127.0.0.1` and rejects requests from other sites and other machines (Host, Origin and
  `Sec-Fetch-Site` checks). There is no authentication against other user accounts on the same machine; do not leave
  the server running on a shared machine.
- All UI assets (including fonts) are served by the local server; there is no CDN, analytics or telemetry. No AI
  service is called; the analysis is rule based.
- The reviewed repository may be untrusted: git runs with hooks and `fsmonitor` disabled, symbolic links are not
  followed, and `git` is always invoked by its full path (a fake `git.exe` placed in the repository is never run).
- There are **no npm dependencies at run time**; the packages run no install scripts.

> These layers guard against accidental leaks and leaks introduced by a dependency update. They do not guarantee to
> stop deliberately hidden malicious code running inside the process; the strongest measure is restricting outbound
> connections for `node` in the operating system firewall (they can be blocked entirely for the local app).

## Usage tips

| Action | Result |
| --- | --- |
| **Click** a call in the code / a propagation row | The target opens in a peek window in front (windows can nest) |
| **Shift+click** | The target opens in a tab |
| **⌘/Ctrl+click** or middle click | Opens a tab in the background |
| `j` / `k` | Next / previous file in the reading plan |
| `n` · `v` | Next unseen · mark as seen |
| `/` · `g` · `f` | Search · impact map · focus mode |
| `Esc` | Close the top window / menu |
| `?` | All shortcuts |

The dividers between panels can be dragged; seen marks, notes and open tabs are stored in the browser. Reviews are
kept in memory only (at most 20) and are gone when the server stops.

## Known limitations

- Deep analysis is **Java only**; Kotlin and other files are shown as a plain diff.
- Caller and overload resolution is heuristic, not compiler based; exact matches are marked separately from "likely"
  ones. Test and hexagonal architecture detection relies on path/package names.
- The repository index covers at most 5000 `.java` files; very large impact graphs are capped at the 600 riskiest
  nodes.
- App-specific limits: [local/README.md](local/README.md), [github/README.md](github/README.md).

## Development

Development dependencies are only needed to change the source code (requires access to the npm registry):

```bash
npm install
```

### Repository structure

```
shared/            source shared by both apps (does not run on its own; bundled into each app at build time)
  src/core/        analysis engine: tree-sitter Java, semantic diff, repository index, risk, reading plan
  src/sources/     local sources: git range, working tree, patch
  src/server/      Hono server (/api), security headers, shared launcher (runServer)
  src/runtime/     egress guard
  src/shared/      shared data model and API types (types.ts)
  web/             React UI (built per app: __EDITION__)
  vendor/          tree-sitter-java (wasm)
local/             Reviewist Local
  src/             command line (contains no network code)
  bin/ dist/       ready-to-run package (committed)
github/            Reviewist GitHub
  src/             command line + remote source (git clone/fetch, PR info, cache)
  bin/ dist/       ready-to-run package (committed)
scripts/           build, bundle audit, self-check, fixture
```

```
ReviewRequest → source (local: shared/src/sources · remote: github/src) → ChangeSet
ChangeSet     → shared/src/core   → ReviewModel
ReviewModel   → shared/src/server → shared/web
```

Architecture and API summary (in Turkish): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · accuracy measurements on
real repositories (historical record, in Turkish): [docs/QA-tur1.md](docs/QA-tur1.md)

### Commands

| Command | What it does |
| --- | --- |
| `npm start` · `npm run start:github` | Runs the ready-made package: local app (`start`, same as `start:local`) · GitHub app |
| `npm run dev:local` + `npm run dev:web` | Local app: server (4317) and Vite UI (5173); `?mock=1` gives sample data without a server |
| `npm run dev:github` + `npm run dev:web:github` | GitHub app: server (4318) and Vite UI (5173) |
| `npm test` | All tests (Vitest). Needs git ≥ 2.32 on PATH; generates the fixture repository if it is missing |
| `npm run typecheck` | Type check for server and UI |
| `npm run build` | Rebuilds both packages (`local/dist`, `github/dist`); `build:local` / `build:github` build one |
| `npm run smoke` | Verifies the packages run standalone (without `node_modules`) and are up to date with the source |
| `npm run fixture` | Creates the `fixtures/sample-repo` sample Java repository (expected results: `fixtures/EXPECTED.md`) |
| `npm run test:perf` | Performance measurements (with time thresholds, run on their own) |

> **Important:** `local/dist` and `github/dist` are committed. When `shared/`, `local/src`, `github/src` or the
> dependencies change, run `npm run build` and commit both `dist/` folders as well; `npm run smoke` catches a stale
> package.

### External packages

All of the following are bundled into the packages at build time; nothing is installed at run time and none of them
goes to the network.

| Package | Used for |
| --- | --- |
| `hono`, `@hono/node-server` | Local HTTP server |
| `web-tree-sitter` + `shared/vendor/tree-sitter-java` (wasm) | Parsing Java source into a syntax tree |
| `diff` | Line diff and patch application |
| `zod` | Validating API requests |
| `react`, `@tanstack/react-query`, `zustand`, `@xyflow/react`, `@dagrejs/dagre`, `highlight.js`, `@fontsource/*` | UI |

Adding a new library or updating one requires deliberately updating the allowlist in the bundle audit. Licenses of the
bundled software: [local/dist/THIRD-PARTY-LICENSES.txt](local/dist/THIRD-PARTY-LICENSES.txt),
[github/dist/THIRD-PARTY-LICENSES.txt](github/dist/THIRD-PARTY-LICENSES.txt)

## License

[MIT](LICENSE)
