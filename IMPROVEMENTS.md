# Improvements made during the Global AI Builder's Challenge window

Everything here was committed after the tag `pre-global` (`4d3b2db`, set 2026-11-20, before the challenge opened on Sat Nov 21 12:00am PST). `git log pre-global..HEAD` lists every commit. Each line gives the commit, the date and the number that moved, measured as described in `eval/results.md`. Numbers are reported as measured, including the ones that got worse.

| # | Improvement | Commit(s) | Date | Before → after |
|---|---|---|---|---|
| I1 | **Meaning gate.** Every kept sentence is judged against its own quote by a separate model call; a sentence that adds a claim gets one rewrite and is removed if it still says more than its quote. | `ecaecf0` | 2026-11-22 | _pending the final eval run_ |
