// Copyright ScyllaDB, Inc. SPDX-License-Identifier: Apache-2.0
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join, resolve} = require('node:path');
const {test} = require('node:test');

const root = resolve(__dirname, '../..');
const classifier = readFileSync(join(root, '.github/workflows/label-release-notes.yml'), 'utf8');
const script = classifier.split('          script: |\n')[1]
  .split('\n').map(line => line.replace(/^            /, '')).join('\n');
const runScript = new (Object.getPrototypeOf(async function () {}).constructor)(
  'github', 'context', 'process', 'core', script
);

async function classify(paths, options = {}) {
  const files = paths.map(path => typeof path === 'string' ? {filename: path, status: 'modified'} : path);
  const calls = [];
  let reads = 0;
  const github = {
    rest: {
      pulls: {
        get: async () => {
          if ((options.beforeFailure && reads === 0) || (options.afterFailure && reads > 0)) {
            throw new Error('PR metadata unavailable');
          }
          return {data: {
          changed_files: options.count ?? files.length,
          head: {sha: options.changing && reads ? 'new' : 'head'},
          base: {sha: options.changingBase && reads ? 'new-base' : 'base'},
          ...(options.changingCount && reads ? {changed_files: files.length + 1} : {}),
          snapshot: reads++
        }};
        },
        listFiles: Symbol('listFiles')
      },
      issues: {
        removeLabel: async () => {
          calls.push('remove');
          if (options.noLabel) throw {status: 404};
          if (options.cleanupFailure) throw new Error('Cleanup unavailable');
        },
        getLabel: async () => {
          calls.push('get');
          if (options.missingLabel && (!options.labelRace || !calls.includes('create'))) throw {status: 404};
        },
        createLabel: async () => {
          calls.push('create');
          if (options.labelRace) throw {status: 422};
          if (options.createFailure) throw new Error('Create unavailable');
        },
        addLabels: async () => {
          calls.push('add');
          if (options.addFailure) throw new Error('Add unavailable');
        }
      }
    },
    paginate: async (method, params) => {
      assert.equal(method, github.rest.pulls.listFiles);
      assert.equal(params.per_page, 100);
      if (options.apiFailure) throw new Error('API unavailable');
      // Simulate the complete flattened result supplied by Octokit's paginator.
      const pages = [];
      for (let start = 0; start < files.length; start += params.per_page) {
        pages.push(files.slice(start, start + params.per_page));
      }
      if (files.length > 100) assert.ok(pages.length > 1);
      return pages.flat();
    }
  };
  let error;
  try {
    await runScript(github, {repo: {owner: 'scylladb', repo: 'go-set'}},
      {env: {PR_NUMBER: options.number ?? '123'}}, {error: message => calls.push('cleanup-error')});
  } catch (caught) { error = caught; }
  return {calls, error};
}

test('support-only changes create and apply shared label', async () => {
  const {calls, error} = await classify(['README.md', 'docs/guide.md',
    'strset/helper_test.go', 'internal/set/set_test.go', 'u16set/set_bench_test.go',
    'root_test.go', '.github/workflows/ci.yml', '.travis.yml', '.golangci.yml', '.gitignore'],
    {missingLabel: true});
  assert.ifError(error);
  assert.deepEqual(calls, ['get', 'create', 'add']);
});

for (const path of ['set.go', 'doc.go', 'internal/set/set.go', 'strset/strset.go',
  'go.mod', 'go.sum', 'LICENSE', 'Makefile', 'gen_set.sh',
  'build/tool.go', 'tools/generator.go', 'examples/main.go', 'unknown.md',
  'unknown/helper_test.go', 'docs/config.yml']) {
  test(`production or unknown path removes stale label: ${path}`, async () => {
    const {calls, error} = await classify(['README.md', path]);
    assert.ifError(error);
    assert.deepEqual(calls, ['remove']);
  });
}

test('renames must stay within support paths', async () => {
  for (const [filename, previous_filename, expected] of [
    ['docs/new.md', 'docs/old.md', ['get', 'add']],
    ['strset/new_test.go', 'strset/old.go', ['remove']],
    ['strset/new.go', 'strset/old_test.go', ['remove']],
    ['docs/new.md', undefined, ['remove']]
  ]) {
    const {calls, error} = await classify([{filename, previous_filename, status: 'renamed'}]);
    assert.ifError(error);
    assert.deepEqual(calls, expected);
  }
});

test('pagination retains all 101 support files', async () => {
  const {calls, error} = await classify(Array.from({length: 101}, (_, n) => `strset/test_${n}_test.go`));
  assert.ifError(error);
  assert.deepEqual(calls, ['get', 'add']);
});

test('truncated, empty, duplicate, changing and failed listings remove label and fail', async () => {
  for (const [paths, options] of [
    [['docs/a.md'], {count: 3001}], [[], {}],
    [[{filename: 'README.md', status: 'unknown'}], {}],
    [['docs/a.md', 'docs/a.md'], {}],
    [['docs/a.md'], {changing: true}], [['docs/a.md'], {changingBase: true}],
    [['docs/a.md'], {changingCount: true}], [['docs/a.md'], {apiFailure: true}],
    [['README.md'], {beforeFailure: true}], [['README.md'], {afterFailure: true}]
  ]) {
    const {calls, error} = await classify(paths, options);
    assert.ok(error);
    assert.deepEqual(calls, ['remove']);
  }
});

test('production PR without existing omission label succeeds', async () => {
  const {calls, error} = await classify(['go.mod'], {noLabel: true});
  assert.ifError(error);
  assert.deepEqual(calls, ['remove']);
});

test('workflow_dispatch validates PR number before API access', async () => {
  const {calls, error} = await classify(['README.md'], {number: '1; echo unsafe'});
  assert.ok(error);
  assert.deepEqual(calls, []);
});

test('release config excludes only the canonical label and classifier serializes current snapshots', () => {
  const config = readFileSync(join(root, '.github/release.yml'), 'utf8');
  assert.match(config, /exclude:\n    labels:\n      - "omit-from-release-notes"\n/);
  assert.doesNotMatch(config, /authors:|"cicd"/);
  assert.match(classifier, /types: \[opened, synchronize, reopened, edited, closed\]/);
  assert.match(classifier, /group: release-notes-/);
  assert.match(classifier, /cancel-in-progress: false/);
  assert.match(classifier, /workflow_dispatch:/);
  assert.doesNotMatch(classifier, /actions\/checkout|pull_request\.head/);
});

test('label-creation races recover and write failures clean up', async () => {
  const race = await classify(['README.md'], {missingLabel: true, labelRace: true});
  assert.ifError(race.error);
  assert.deepEqual(race.calls, ['get', 'create', 'get', 'add']);
  for (const options of [{missingLabel: true, createFailure: true}, {addFailure: true}]) {
    const result = await classify(['README.md'], options);
    assert.ok(result.error);
    assert.equal(result.calls.at(-1), 'remove');
  }
});

test('cleanup failure is visible and preserves original snapshot failure', async () => {
  const {calls, error} = await classify(['README.md'], {apiFailure: true, cleanupFailure: true});
  assert.match(error.message, /API unavailable/);
  assert.deepEqual(calls, ['remove', 'cleanup-error']);
});
