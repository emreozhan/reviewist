# Reviewist GitHub

Reviews Java changes in remote repositories: a GitHub pull request or two branches of a repository. The repository is
fetched **with git** into a local cache (`git clone` / `git fetch`) and the analysis runs on this machine.

This folder is a standalone application. All you need is **Node.js 20+** and **git**; no `npm install`. You can copy
the folder (`bin/`, `dist/`, `package.json`) anywhere and run it.

> The user interface and command-line messages are in Turkish.

## Start

```bash
node bin/reviewist-github.js
```

The browser opens `http://127.0.0.1:4318`; enter the pull request or repository address and press **Klonla ve analiz
et** (Clone and analyze). You can also start a review straight from the command line:

```bash
node bin/reviewist-github.js https://github.com/owner/repo/pull/12
```

```bash
node bin/reviewist-github.js owner/repo --base main --head feature/x
```

All options: `node bin/reviewist-github.js --help`

### Address formats

| Address | Meaning |
| --- | --- |
| `https://github.com/owner/repo/pull/12` | Pull request (GitHub Enterprise: `https://server/owner/repo/pull/12`) |
| `owner/repo#12` | Pull request on github.com (short form) |
| `https://github.com/owner/repo` · `owner/repo` | Repository — the branch to review (`--head`) is required; the base defaults to the default branch |
| `git@github.com:owner/repo.git` | Repository, over SSH |

Base and head are compared from their common ancestor (merge-base), the same as GitHub's "Files changed" view.

## Authentication

- **Code** is fetched with git; for private repositories git itself must have access (credential helper or SSH key).
  To test: `git ls-remote <address>`. If you prefer SSH, set `REVIEWIST_GIT_PROTOCOL=ssh`. The app never prompts for
  a user name or password (`GIT_TERMINAL_PROMPT=0`); if your SSH key has a passphrase, use `ssh-agent` and accept the
  server's host key beforehand (otherwise ssh may ask in the terminal where the server runs and wait).
- **Pull request info** (title, description, base branch) takes a single GitHub API request. For private repositories
  and for the hourly rate limit, put a token in the `GITHUB_TOKEN` / `GH_TOKEN` environment variable (or
  `--token-env NAME`). The token is not entered in the UI, is not written to disk and is not passed to git. If this
  request fails the review continues with a warning (the PR head commit comes from git; the base branch is assumed to
  be the default branch or is given with `--base`).

## Network and privacy

This application's network traffic consists of two items:

| What | Where | Who |
| --- | --- | --- |
| `git ls-remote` + `git fetch` | The server of the repository you entered | The `git` child process |
| `GET /repos/{owner}/{repo}/pulls/{n}` (pull request addresses only, once) | `api.github.com` (or a GitHub Enterprise server you allowed) | The app |

- The server process and the parser workers install the egress guard at startup: every TCP connection, DNS lookup and
  UDP send to anything other than the GitHub API hosts (`api.github.com` + `REVIEWIST_GITHUB_HOSTS`) is blocked inside
  the process, so the bundled libraries cannot connect anywhere else.
- git is restricted to the `https` and `ssh` transports; `http://` addresses are rejected.
- The token from the environment is sent **only to `github.com`**; allow GitHub Enterprise servers explicitly with
  `REVIEWIST_GITHUB_HOSTS`.
- The server listens only on `127.0.0.1`; the content security policy lets the page talk only to its own server.
- The fetched repository is treated as untrusted: nothing is ever checked out to a working tree (only `.git` objects
  are read), hooks and `fsmonitor` are disabled, and submodules are not fetched.
- This application has **no** local repository or file system endpoints (`/api/git/refs`, `/api/fs/list`); the UI
  cannot browse folders on this machine.

If you write firewall rules: `api.github.com:443` for `node` and your repository server (HTTPS 443 or SSH 22) for
`git` are enough.

## Cache

Each remote repository is kept under `<cache>/repos/<server>/<owner>/<repo>` and later reviews fetch only the missing
objects. The cache folder is chosen from, in order: `--cache-dir` → `REVIEWIST_CACHE_DIR` → the operating system
default:

| System | Default |
| --- | --- |
| macOS | `~/Library/Caches/reviewist-github` |
| Windows | `%LOCALAPPDATA%\reviewist-github\cache` |
| Linux | `$XDG_CACHE_HOME/reviewist-github` (or `~/.cache/reviewist-github`) |

Deleting the cache is safe (delete the folder); the repository is fetched again on the next review. The folder in use
is printed to the console at startup and shown below the form in the UI.

## Environment variables

| Variable | What it does |
| --- | --- |
| `GITHUB_TOKEN`, `GH_TOKEN` | Token used for the pull request info request |
| `REVIEWIST_GITHUB_HOSTS` | Additional servers the token may be sent to and API requests may go to, comma separated (`git.company.com`) |
| `REVIEWIST_GIT_PROTOCOL` | If `ssh`, `owner/repo` and HTTPS addresses are fetched over SSH |
| `REVIEWIST_CACHE_DIR` | Clone cache folder |
| `REVIEWIST_GIT` | Full path of the git executable (if it cannot be found on PATH) |

## Limits

- On very large repositories the first fetch can take a long time (timeout 15 min); later reviews are incremental.
- Without a token the GitHub API allows 60 requests per hour (one request per review).
- The cache is not cleaned up automatically.
- Reviews are kept in memory only (at most 20) and are gone when the server stops. Seen marks, notes, tabs and recent
  addresses stay in the browser's `localStorage`.

For local repositories, uncommitted changes and patches use the separate application: `reviewist-local` (the `local/`
folder of the repository).

## Package contents

`dist/BUILD.json` lists the version and the bundled libraries (with versions); licenses are in
`dist/THIRD-PARTY-LICENSES.txt`. Source code and build: see the README at the repository root.

[MIT](LICENSE)
