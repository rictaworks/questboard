# Development Principles

These principles formalize the implementation guidance used by the agent workflow.

## Core principles

- YAGNI: do not add capabilities that are not needed for the current scope
- KISS: prefer the simplest correct implementation
- DRY: keep shared logic in one place
- SOLID: design for small, composable responsibilities
- Secure by default: validate input, escape output, and enforce permissions server-side

## Implementation rules

- Put business rules in functions or classes, not in ad hoc inline logic
- Keep state transitions explicit and testable
- Prefer deterministic behavior for concurrency and conflict resolution
- Separate UI concerns from domain and persistence concerns
- Use configuration or data files for hardcoded strings when the design already supports it

## Quality rules

- Write the smallest change that fully resolves the issue
- Preserve existing behavior unless the change is explicitly intended
- Make failure modes explicit instead of relying on silent fallback
- Keep code readable enough for debugging and security review

## Collaboration rules

- Respect the current design document and existing agent instructions
- Avoid introducing new patterns unless they clearly reduce complexity
- When multiple options exist, choose the one that is easiest to reason about and verify

