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

The `Classify release notes` workflow uses pinned `actions/labeler` with
filename rules in `.github/labeler.yml`. It applies `omit-from-release-notes`
only when every reported changed filename matches the single support-path
union: `.github/` automation, documentation under `docs/` (`.md`, `.rst`,
`.txt`), `README.md`, Go `*_test.go` files in the root or existing set packages
(including `internal/set`), Travis and lint configuration, `.gitignore`, and
`.editorconfig`. Mixtures of these support files qualify too.

Go production source (including `doc.go`), `go.mod`, `go.sum`, `Makefile`,
`gen_set.sh`, licenses, examples, tools, and unrecognized paths stay visible.
Go source remains included even when its current contents are documentation;
filename rules cannot prove that source edits are comments only. Author,
title, `chore`, and dependency labels do not hide changes.

The workflow runs on opened, synchronized, reopened, edited, and closed PRs.
`sync-labels: true` removes the omission label when the filenames stop matching.
The action handles file retrieval and matching; it uses reported filenames,
including rename destinations. PR code is never checked out or executed by the
labeling workflow.

## Classify previously merged PRs

Before the next release, backfill support-only merged PRs using the workflow on
the default branch:

```sh
gh workflow run label-release-notes.yml --ref master -f pull_request=123
```

Repeat for the relevant PR numbers and wait for each run to succeed before
pushing the release tag. Backfills and event runs share a per-PR concurrency
group. The action manages the canonical label and removes it from mixed or
unrecognized filename changes, including manual uses.
Review any failed classification before releasing. Generated notes exclude PRs
with the label; existing published notes are preserved and are not retroactively
rewritten.

Run the release publication regression suite with:

```sh
node --test .github/tests/release.test.cjs
```
