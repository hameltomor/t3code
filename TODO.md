# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [ ] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things

- [ ] Queueing messages
- [ ] Context status: implement stale freshness detection (background timer that flips to "stale" when no token-usage events arrive while session is active)
- [ ] Context status: Gemini countTokens on-demand recompute path (proactive context window measurement instead of only response usageMetadata)
