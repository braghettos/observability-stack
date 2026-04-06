# Agent Guardrails

## Data Sufficiency Rule

Before producing any root-cause statement or diagnosis, you MUST assess data sufficiency:

1. After querying ClickHouse or K8s API, evaluate whether the returned data is sufficient to draw a conclusion.
2. Emit a line: `DATA_SUFFICIENCY: sufficient` or `DATA_SUFFICIENCY: insufficient`
3. If **insufficient**:
   - Return `ROOT_CAUSE: unknown — insufficient data`
   - List the specific data gaps (e.g., "no logs found for pod X in the last hour", "metrics table returned 0 rows")
   - Do NOT infer root causes from resource names, labels, or descriptions alone
   - Do NOT fabricate plausible-sounding explanations when tool calls returned empty results
4. If **sufficient**: proceed with your diagnosis, citing specific evidence (timestamps, event counts, error messages).

**Example of WRONG behavior:**
- Tool returns `{'result': ''}` (empty)
- Agent says: "The container is intentionally designed to crash as part of testing"
- This is fabrication — the agent inferred from the pod name, not from data.

**Example of CORRECT behavior:**
- Tool returns `{'result': ''}` (empty)
- Agent says: "DATA_SUFFICIENCY: insufficient. The observability agent returned no data for this pod. Possible reasons: pod logs not yet ingested, ClickHouse MCP server may be degraded, or the pod has no recent events. Cannot determine root cause without data."

## Empty Sub-Agent Response Rule

If you delegate to a sub-agent and receive an empty response (`{'result': ''}` or `null`):
- Do NOT treat this as a valid "all clear" signal
- Report: "Sub-agent returned empty response — this may indicate a communication issue, not a clean result"
- Retry once after 30 seconds if possible
- If still empty, escalate with the note "sub-agent response was empty"

## Bare-Pod Preflight (k8s-agent only)

Before executing `delete_pod` or any pod deletion:
1. Check `ownerReferences` on the pod: `kubectl get pod <name> -n <ns> -o jsonpath='{.metadata.ownerReferences}'`
2. If `ownerReferences` is empty (bare pod with no controller):
   - Do NOT delete the pod — it will be recreated by `restartPolicy: Always` with no controller to stop the loop
   - Instead report: `BARE_POD_DETECTED: Pod <name> has no ownerReferences. Deleting it will not fix the restart loop. The pod manifest must be modified or the pod must be deleted with restartPolicy changed.`
   - Escalate to human operator
3. If `ownerReferences` exists (owned by Deployment/ReplicaSet/Job/etc.): proceed with deletion as normal.

## Escalation Timeout

When using `ask_user` to escalate to a human operator:
- If no response is received within 15 minutes, emit: `ESCALATION_TIMEOUT: No human response received after 15 minutes. Closing this investigation as unresolved.`
- Do not wait indefinitely — the thread will hang and consume resources.
- Include a summary of what was tried and what needs human action.
