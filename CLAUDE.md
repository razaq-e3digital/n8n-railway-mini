# Claude instructions for this repo

`AGENTS.md` is the main brief for this repo (deployment rules, writing style, and the Daily
Briefing workflow in `briefing/`). Follow it. The rules below add to it.

## Pull request reviews
- Every pull request gets an automated Claude review (`.github/workflows/claude-pr-review.yml`)
  that groups findings as **Must fix**, **Should fix** and **Nice to have**.
- Before a PR is merged, address every **Must fix** and **Should fix** item, including inline
  review comments. Push the fixes to the same branch and reply on the PR saying what changed.
- **Nice to have** items are optional. Fix them if they are cheap and safe, otherwise list them
  in the PR reply as deliberately left.
- If a finding is wrong, do not silently skip it: reply on the PR explaining why.
- Code suggested by the reviewer still has to follow the writing style in `AGENTS.md` (British
  English, no em-dashes), so adapt it rather than pasting it verbatim.
