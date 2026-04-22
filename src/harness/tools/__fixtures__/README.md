# Tool test fixtures

Files in this directory exist to exercise the Alpha baseline tools
(`read.ts`, `grep.ts`, `glob.ts`, `ls.ts`) against realistic input
shapes without requiring a cloned benchmark repo. Each file has a
specific job — changes that break these assumptions will break the
tool tests.

## Layout

```
__fixtures__/
├── README.md                 # this file
├── simple.txt                # plain ASCII, Read happy path
├── code.ts                   # TS-like source for Grep content search
├── large.txt                 # >5 KB, exercises truncation
├── with spaces.txt           # filename with spaces
├── unicode-文件.md            # unicode in filename
└── nested/
    ├── other.md              # Glob sort-by-mtime diversity
    └── deep/
        └── file.md           # recursion depth for LS/Glob
```

## What each fixture proves

- **simple.txt** — 3 lines, trailing newline. Read without
  offset/limit should return all 3 lines with `cat -n` line prefixes.
- **code.ts** — contains distinctive strings like `export function
  benchmarkFoo` and `import { something } from ...` so Grep patterns
  have real matches and non-matches to distinguish.
- **large.txt** — long enough that Read's default preview cap clips
  it. Tests the truncation marker is appended.
- **with spaces.txt** and **unicode-文件.md** — filename edge cases.
  Glob and LS must return them correctly; Read must open them.
- **nested/** — two-level nesting for Glob `**/*.md` and LS recursion
  behavior. `nested/other.md` vs `nested/deep/file.md` let us verify
  sort order and depth traversal.

## Path-safety testing

No fixture file on disk tests path-escape directly. Path-safety tests
use synthetic inputs like `../../etc/passwd` against the fixtures
root as `repoDir` and expect `resolveInside` to throw. Do not add
fixtures that reach outside this directory — path safety is tested
purely via inputs, not planted targets.
