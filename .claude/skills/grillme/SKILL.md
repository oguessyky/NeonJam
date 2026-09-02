---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a
shared understanding. Walk down each branch of the design tree resolving
dependencies between decisions one by one.

For each question:
- Use the `AskUserQuestion` tool to present the question as a multiple-choice picker (this is the MCP-style question UI).
- Provide 2-4 concrete options. Mark your recommendation as the **first** option with `(Recommended)` suffix in the label.
- Each option's `description` should be one short line on the tradeoff — not a full paragraph.
- Use a 1-3 word `header` chip (e.g. "Trigger point", "Format", "Scope").
- Only ask **one question per turn** — wait for the answer before the next.
- The picker's auto-injected "Other" option lets the user type a custom answer; honour combined answers (e.g. "1+4") by synthesizing the hybrid in the next turn.

Before each question, briefly state in plain text:
- The flow or decision being grilled
- Why it matters (click frequency, ambiguity in the spec, downstream dependency)
- The recommended answer with one short reason

Then call `AskUserQuestion`.

If a question can be answered by exploring the codebase, explore the codebase
instead of asking.

After each answer, **append the resolved decision to the plan file** so context
survives compaction. The plan file is the persistent record — not the chat.

Stop grilling when the user signals "wrap up" or when all major flows that
affect the project's primary user journeys have been resolved.
