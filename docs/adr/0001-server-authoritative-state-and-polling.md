# ADR-0001: Server-authoritative state with deadline-driven polling

- Status: Accepted
- Date: 2026-09-22

## Context

Startup Race must keep two to four anonymous browsers synchronized while
preventing a client from selecting dice values, card outcomes, resource changes,
or victory. The academic deployment has a zero-cost constraint and must remain
recoverable after refresh. Turn deadlines must progress even if the active player
disconnects, but a permanently running custom server is outside the chosen stack.

## Decision

PostgreSQL is the authoritative state machine. Security-definer RPC functions
lock the Sala row, authenticate membership and turn ownership, validate an
expected version, perform the complete transition atomically, and record a unique
request ID for replay-safe retries. The browser never writes game tables directly.

The client polls the room-state RPC every two seconds only while its tab is
visible, refreshes immediately after commands and focus, prevents overlapping
requests, ignores state older than the latest observed version, and exponentially
backs off after network failures. Any authenticated member may call the timeout
RPC after a public deadline; the database decides whether the deadline elapsed.

## Consequences

- Every device observes one ordered version stream and can recover by reading it.
- Randomness, deadlines, and authorization remain enforceable without trusting
  JavaScript or browser clocks.
- Polling creates bounded read load but avoids a Realtime dependency during the
  temporary academic deployment.
- An abandoned room advances only when a member is still polling. This is accepted
  because rooms expire after 24 hours and there is no spectator or background-job
  requirement.
- Schema changes require forward migrations and careful function-level tests.
