# kagent Overrides

Post-deploy patches for kagent agents. These fixes are re-applied after any
kagent reconcile that would overwrite the following changes.

## Why these overrides are needed

### 1. Tool name correction

The base prompts in `krateo-prompts-eng` ConfigMap reference a
`krateo-code-remediation-agent` that **does not exist in the cluster**. The
actual agent is named `krateo-code-analysis-agent`. When the SRE or Autopilot
agents tried to invoke the non-existent tool, they failed with:

    Tool 'krateo_system__NS__krateo_code_remediation_agent' not found.

**Fix:** rename `code-remediation` → `code-analysis` in both the `autopilot`
and `sre_agent` prompts.

### 2. Streaming sub-agents return empty results

When sub-agents have `stream: true` AND are invoked via A2A tool calls, the
caller (e.g. Autopilot) receives an **empty** `{'result': ''}` response
immediately, while the sub-agent keeps running asynchronously. The caller
interprets the empty result as "done" and responds:

    "I have delegated the investigation. I will provide an update soon."

...but never does, because the sub-agent's actual response never comes back.

**Fix:** set `stream: false` on all sub-agents. This makes A2A calls
synchronous, returning the full response to the caller. The top-level
`krateo-autopilot` keeps `stream: true` for its user-facing streaming UX in
Slack.

### 3. Closed-loop verification step

The `sre_agent` prompt now includes an explicit VERIFY step — after any
remediation action, the SRE agent must delegate back to the observability
agent to confirm the fix worked before declaring resolution. The
`observability_agent` prompt gained a VERIFICATION MODE section explaining
how to run the verification query.

## Files

| File | Description |
|------|-------------|
| `apply-overrides.sh` | Script that applies all overrides |
| `prompts/autopilot.md` | Updated Autopilot system prompt |
| `prompts/sre_agent.md` | Updated SRE agent system prompt (with VERIFY step) |
| `prompts/observability_agent.md` | Updated Observability agent prompt (with VERIFICATION MODE) |

## Usage

After any kagent redeploy:

```bash
./kagent-overrides/apply-overrides.sh
```

## Verify

```bash
# Should show all sub-agents at stream=false, only autopilot at stream=true
kubectl get agent -n krateo-system \
  -o custom-columns=NAME:.metadata.name,STREAM:.spec.declarative.stream
```
