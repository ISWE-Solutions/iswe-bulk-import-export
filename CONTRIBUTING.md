# Contributing to ISWE Bulk Import/Export

Thanks for your interest in improving this project! This document explains how
to propose changes, report problems, and get a pull request merged.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** — open an issue using the *Bug report* template.
- **Suggest a feature** — open an issue using the *Feature request* template.
- **Fix a bug or land a small improvement** — open a pull request. For anything
  non-trivial, please file an issue first so we can agree on scope.
- **Improve documentation** — README, the User Guide, inline JSDoc, or release
  notes. Doc-only PRs are always welcome.
- **Help triage** — reproduce reported bugs, add missing details, propose
  labels.

## Before you start

1. Search [existing issues](https://github.com/ISWE-Solutions/iswe-bulk-import-export/issues)
   and PRs to avoid duplicates.
2. For features or refactors, open a discussion issue first describing the
   problem, proposed behaviour, and any DHIS2 API calls involved.
3. Keep PRs focused — one logical change per PR.

## Development setup

Prerequisites: Node **≥ 18**, Yarn 1.x, access to a DHIS2 **2.40+** instance
(public Play servers work fine for most work).

```sh
git clone https://github.com/ISWE-Solutions/iswe-bulk-import-export.git
cd iswe-bulk-import-export
yarn install
cp .env.example .env        # set DHIS2_BASE_URL etc.
yarn start                  # dev server on http://localhost:3000
```

Build an installable zip:

```sh
yarn build                  # outputs build/bundle/<name>-<version>.zip
```

If the build fails with `react-scripts: command not found`, clear the shell
cache:

```sh
rm -rf .d2/shell build && yarn build
```

## Coding standards

- **Language:** modern JavaScript (ES2022). No TypeScript (yet).
- **UI:** React 18 + `@dhis2/ui` components. Use functional components and
  hooks.
- **DHIS2 APIs:** always use `@dhis2/app-runtime` (`useDataQuery`,
  `useDataMutation`, `useConfig`). Do not embed the base URL or credentials.
- **Lint/format:** run `yarn lint` and `yarn format` before committing.
- **Imports:** keep internal modules tree-shakeable; avoid circular imports
  between `src/lib/*` and `src/components/*`.
- **No secrets:** never commit `.env`, tokens, or instance URLs in fixtures.

## Tests

The project ships an end-to-end test harness that exercises real DHIS2
endpoints.

```sh
DHIS2_BASE=https://play.im.dhis2.org/stable-2-42-4 \
DHIS2_USER=admin DHIS2_PASS=district \
yarn test:e2e
```

Add or update a harness file under `test-harness/` when you change any
behaviour in `src/lib/*`. Every PR that touches import/export logic must keep
the suite green (17/17 files passing at the time of writing).

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body — why, not what>
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`.
Examples:

- `fix(tracker): include program-scoped attributes in export`
- `feat(validator): flag duplicate TEI UIDs`
- `docs(readme): clarify App Hub install steps`

## Pull request checklist

Before requesting review, make sure your PR:

- [ ] Targets `main` and is up to date with the latest `main`.
- [ ] Passes `yarn lint` and `yarn build`.
- [ ] Passes `yarn test:e2e` (or documents which tests are skipped and why).
- [ ] Includes a test for new behaviour where feasible.
- [ ] Updates `README.md` / `docs/USER_GUIDE.md` / `CHANGELOG.md` if user-
      visible behaviour changes.
- [ ] Has a clear title and description (use the PR template).

A maintainer will review, request changes if needed, and merge via
**Squash and merge** to keep history linear.

## Reporting security issues

Do **not** open a public issue for security problems. See
[SECURITY.md](SECURITY.md) for the private disclosure process.

## Licensing

All contributions are licensed under [BSD-3-Clause](LICENSE), the same licence
as the project. By submitting a pull request you certify that you have the
right to contribute the code and that it may be distributed under that licence
(see the [Developer Certificate of Origin](https://developercertificate.org/)).
