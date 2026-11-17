# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kylus/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kylus/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads a sealed DefiLlama snapshot, finds the protocols that record no token, and ranks them by an implied launch value: TVL times what the snapshot's own live-token protocols of the same category trade at, adjusted for seven-day growth, how long the protocol has run with no token, and how many chains it spans. Every row carries a seven-step farm plan with a cost and a time for each step, and a static dashboard (no framework, no network) shows the board, a detail view for each protocol, the model and its comparables.

Standard library only, deterministic, no clock and no randomness. The implied value is this entry's own estimate; it says nothing about whether or when a protocol issues a token.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=mp1vhw1y&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
