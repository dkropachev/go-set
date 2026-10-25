# Releases and release notes

Push a version tag such as `v1.0.2` after following the normal maintainer release
process. The `Create GitHub release` workflow verifies that the remote tag still
points to the triggering commit, resolves annotated tags, and publishes GitHub's
generated notes using `.github/release.yml`. It does not create tags, change Go
versions, or publish packages. It accepts stable `vMAJOR.MINOR.PATCH` tags.

Rerun a failed release job from Actions after resolving the failure. Runs for the
same tag are serialized. A rerun preserves an existing published release and its
curated text. An existing draft or unpublished release fails visibly: maintainers
must deliberately publish it, or remove the draft and rerun to generate filtered
notes. The workflow never treats a draft as publication success.

## Automatic omission

The `Classify release notes` workflow creates and applies
`omit-from-release-notes` only when every changed file is a recognized support
file. `.github/` automation, documentation under `docs/` (`.md`, `.rst`, `.txt`),
`README.md`, Go `*_test.go` files in the root or existing set packages (including
`internal/set`), Travis and lint configuration, `.gitignore`, and `.editorconfig`
qualify. Mixtures of these support files qualify too.

Go production source (including `doc.go`), `go.mod`, `go.sum`, `Makefile`,
`gen_set.sh`, licenses, examples, tools, and unrecognized paths stay visible.
Go source remains included even when its current contents are documentation;
path classification cannot prove that future source edits are comments only.
Both paths of a rename must qualify. Author, title, `chore`, and dependency
labels do not hide changes.

The workflow rechecks opened, synchronized, reopened, edited, and closed PRs,
and removes the omission label when a PR gains production changes. It reads all
file pages and verifies the unique file count, head commit, base commit, and
changed-file count before applying the label. API failures or incomplete or
changing snapshots fail visibly and attempt to remove stale omission labels.
If cleanup itself fails, resolve the API/permissions problem, inspect the label,
and rerun. PR code is never checked out or executed with label write permissions.

## Classify previously merged PRs

Before the next release, backfill support-only merged PRs using the workflow on
the default branch:

```sh
gh workflow run label-release-notes.yml --ref master -f pull_request=123
```

Repeat for the relevant PR numbers and wait for each run to succeed before
pushing the release tag. Backfills and event runs share a per-PR concurrency
group and always fetch current PR metadata. The classifier manages the canonical
label and removes it from mixed or unrecognized changes, including manual uses.
Review any failed classification before releasing. Generated notes exclude PRs
with the label; existing published notes are preserved and are not retroactively
rewritten.

Run the automation regression suite with:

```sh
node --test .github/tests/*.test.cjs
```
