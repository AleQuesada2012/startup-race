# Startup Race MVP — Implementation Plan

## Summary

Build the multiplayer board game defined in the [shared design conversation](https://chatgpt.com/share/6ab20268-1f40-83e8-aad5-ab234ab431fd).

Success means 2–4 people can join a private room from separate devices, finish a coherent match, recover after refreshing the same browser, and receive either a consolidation victory or final progress ranking.

- Deadline: September 25, 2026 at 7:00 a.m. Costa Rica time.
- Code freeze: September 24 at 8:00 p.m.
- Public personal GitHub repository: `startup-race`.
- Software-only scope; academic documents and pitch are excluded.
- Spanish player experience; English engineering documentation.
- Zero-cost, temporary academic deployment.

## Game Contract

### Match lifecycle

- Rooms use six-character, unambiguous uppercase codes and expire after 24 hours.
- A lobby accepts 2–4 players. Names are 1–24 characters and unique per room, case-insensitively.
- Entrepreneurship types may repeat. The server randomizes turn order.
- Only the host starts the game; joining closes afterward. Host migration is not implemented.
- Anonymous Supabase identity restores a seat only in the same browser.

### Board and resources

- Position `0`: IDEA/Salida.
- Positions `1–7`: VALIDACIÓN.
- Positions `8–14`: PROTOTIPO.
- Positions `15–21`: LANZAMIENTO.
- Positions `22–29`: CRECIMIENTO.
- Position `30`: EMPRESA; overshooting stops at 30 and arrival triggers no card.
- Event categories appear at fixed positions:
  - Decisión: `1, 5, 9, 13, 17, 21, 25, 29`
  - Innovación: `2, 7, 10, 15, 19, 22, 27`
  - Oportunidad: `3, 6, 11, 14, 18, 23, 26`
  - Crisis: `4, 8, 12, 16, 20, 24, 28`

Base resources are capital `$5,000`, reputation `1`, and innovation `1`.

- Tecnológico: `+1` innovation.
- Social: `+1` reputation.
- Tradicional: `+$2,000` capital.
- Resources never fall below zero, and crises never eliminate players.

### Turns and completion

- A normal turn is roll → move → reveal fixed card → choose option → resolve server-side outcome → check victory → advance.
- Roll deadline: 30 seconds; expiration skips the turn.
- Choice deadline: 60 seconds; expiration applies the card’s designated free default option.
- Every card has 2–3 options, exactly one free default, visible costs, visible probability percentages, and an educational explanation.
- A player at Empresa without the thresholds chooses:
  - Financing: `+$2,000` capital.
  - Product improvement: `-$1,000` capital, `+1` innovation.
  - Brand-building: `-$1,000` capital, `+1` reputation.
- The first player at Empresa with capital ≥ `$10,000`, reputation ≥ `5`, and innovation ≥ `5` wins immediately.
- After the final action of round 12, check victory first; otherwise finish with “no consolidation.”
- Final ranking uses `min(capital/10000,1) + min(reputation/5,1) + min(innovation/5,1)`, then position. Exact ties share rank.

### Content and presentation

- Author 24 Spanish cards: six per category.
- Map them statically to the board; repeat two Decisión cards and one card from each other category.
- Inversionista, Patente, Competencia, and Feria empresarial are themes/tags, not additional categories.
- Use a playful, responsive visual system with semantic HTML, accessible contrast, keyboard operation, reduced-motion support, and projector/phone layouts.
- Add opt-in Web Audio cues for rolling, resolving a decision, and winning, with persistent mute.
- Exclude matchmaking, accounts, spectators, late joining, cross-device recovery, editors/admin UI, leaderboards, AI, PWA/native apps, host migration, and continuing-revenue investment mechanics.

## Repository and Architecture

### Repository foundation

1. Initialize Git on `main`, authenticate `gh`, and create the public personal `startup-race` repository with an MIT license.
2. Add the approved agent-skills setup: `AGENTS.md`, the issue-tracker and triage-label configuration, and the single-context domain-doc rules.
3. Add `CONTEXT.md` with the canonical terms Sala, Partida, Jugador, Tipo de emprendimiento, Turno, Ronda, Tarjeta, Opción, Resultado, Empresa, and Consolidación.
4. Record one ADR for server-authoritative Supabase/PostgreSQL game state and deadline-driven polling.
5. Add a README, environment example, contribution commands, and deployment/recovery instructions.

### Application stack

Use Node 22, pnpm 11, React, TypeScript, and Vite’s `react-ts` scaffold. Use plain responsive CSS, Supabase JS, Zod, Vitest, Testing Library, and Playwright.

Deploy the static SPA to Vercel with preview deployments for pull requests and production from `main`. Use `/?room=ABC123` instead of path routing.

Use Supabase anonymous Auth, PostgreSQL, RLS, database functions, and local Docker-backed migrations.

### Data and public interfaces

Persist:

- `rooms`: code, host, status, phase, current player, round, version, pending interaction, deadline, result, expiry.
- `players`: room, anonymous identity, name, type, order, position, and resources.
- `cards`, `card_options`, `card_outcomes`, and `board_spaces`: normalized authored content and weighted consequences.
- `management_actions`: the three fixed Empresa actions.
- `actions`: request ID, actor, command, result, resulting version, and timestamp.

Canonical states:

- Room: `waiting | playing | finished | expired`
- Turn phase: `waiting_for_roll | waiting_for_choice`
- Pending kind: `card | management`
- Entrepreneurship type: `technology | social | traditional`
- Card category: `decision | opportunity | crisis | innovation`

Expose these RPCs:

- `create_room(name, entrepreneurship_type, request_id)`
- `join_room(code, name, entrepreneurship_type, request_id)`
- `start_game(room_id, expected_version, request_id)`
- `get_room_state(code)`
- `roll_dice(room_id, expected_version, request_id)`
- `choose_option(room_id, option_id, expected_version, request_id)`
- `resolve_timeout(room_id, expected_version, request_id)`

Every mutation locks the room row, verifies membership/turn/phase/version, executes atomically, and records its request ID. Duplicate requests return the recorded result; stale versions return a structured error. Dice, card outcomes, resource changes, deadlines, ranking, and victory are calculated by PostgreSQL, never accepted from the browser.

RLS permits members to read their room and denies direct game-state writes. Privileged functions explicitly validate `auth.uid()`, schema-qualify objects, set a safe `search_path`, and are executable only by authenticated users.

The client polls every two seconds only while the game tab is visible, refreshes immediately after actions or focus, prevents overlapping requests, ignores older versions, and backs off after network errors.

### Provider setup

On Day 1, create or activate Supabase, Vercel, and Cloudflare accounts. Configure Turnstile for anonymous sign-in.

Only these public values enter the frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TURNSTILE_SITE_KEY`

Never expose Supabase secret/service-role keys. If any provider setup would incur a charge, stop and request approval.

## Delivery and Tracking

Create a GitHub milestone named `MVP — 2026-09-25 07:00 CST`. Use short issue branches, small pull requests, squash merges, and required CI. Keep `main` deployable; Vercel production follows `main`.

Timeline:

- September 22: repository, accounts, local/cloud environments, CI, schema, and deployed shell.
- September 23: complete lobby, authoritative game loop, 24 cards, and two-browser vertical slice.
- September 24 morning: finish responsive UI, resilience, automated tests, and three balance playtests.
- September 24 by 6:00 p.m.: complete the published four-device match.
- September 24 at 8:00 p.m.: freeze features, merge green pull requests, and tag `v0.1.0`.
- Final buffer: deployment/configuration recovery only.

## Verification and Acceptance

Automated checks on every pull request:

- Formatting, linting, type checking, unit tests, and production build.
- Content validation: exactly 24 cards, six per category, valid board coverage, 2–3 options per card, one free default, and outcome weights totaling 100%.
- Database tests for RLS isolation, direct-write denial, room capacity races, duplicate names, host-only start, stale versions, double submissions, out-of-turn actions, insufficient capital, resource clamping, deadlines, expiry, round cap, ranking, and victory.
- Playwright multi-context flow covering four joins, start, roll, choice, refresh during a decision, retry, timeout, Empresa management, and final lockout.

Manual release gates:

- Three complete balance playtests targeting a typical 15–20 minute duration.
- Every type must have a reachable consolidation path; tune card effects only if testing exposes impossibility or clear dominance.
- One complete production match on four real devices.
- Confirm exact probability display, Spanish copy, mobile/projector layouts, mute persistence, keyboard operation, reconnect messaging, and coherent final results.
- After the demonstration period, purge transient room/player/action data and disable anonymous sign-ins if the deployment is no longer needed.

## Assumptions

- The authenticated personal GitHub account can host `startup-race`.
- Four test devices are available.
- Transient game data is disposable.
- Provider account creation completes on September 22.
