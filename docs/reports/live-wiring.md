# Live wiring evidence

Generated 2026-10-08T13:41:34.539Z by `node scripts/live-wiring.mjs`. Every line below is the output of a real request made at that moment; nothing is asserted from documentation.

## Verdict

**Not connected.** The handshake against `https://agent.bitget.com/mcp` did not complete, so no live number in this project has ever been served by that endpoint. The failure is recorded below rather than papered over.

| step | result |
| --- | --- |
| DNS `agent.bitget.com` | resolved 2606:4700::6812:891, 2606:4700::6812:991, 104.18.9.145, 104.18.8.145 (101 ms) |
| MCP `initialize` | **failed after 3422 ms** - ECONNRESET fetch failed |
| control egress | https://api.github.com/zen answered HTTP 200 in 1821 ms at the same moment - general egress worked, so the failure above is specific to the MCP host (or to how it treats this network), not to this machine being offline |
| market intents resolved | 0/20 (endpoint unreachable) |
| bitget-signal skills resolved | 0/5 (endpoint unreachable) |

## What this means for the submission

The integration is built and test-covered (discovery, fuzzy intent resolution, transparent degradation, per-intent provenance), but it has **not** been exercised against the live endpoint from this machine. That is a statement about the network this run had, not about the wiring. Re-run `node scripts/live-wiring.mjs --record` from a network that can reach the endpoint and commit the result; this file is regenerated, never hand-edited.

## Reproduce

```bash
node scripts/live-wiring.mjs --record   # probe, record real responses, rewrite this file
node scripts/live-wiring.mjs --check    # assert this file and the recorded pack agree
PRISM_FIXTURE_DIR=data/fixtures/mcp-live node server.mjs   # run the desk on the recorded data
```
