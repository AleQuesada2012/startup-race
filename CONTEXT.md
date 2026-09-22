# Startup Race domain context

Startup Race has one bounded context: a temporary multiplayer entrepreneurship
game. Code and tests use the English identifiers below, while the player-facing
experience uses the canonical Spanish terms.

| Canonical term         | Code identifier        | Meaning                                                                  |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Sala                   | `Room`                 | Private, expiring place where Jugadores gather for one Partida.          |
| Partida                | `Match`                | A Sala after the host starts it, through Consolidación or final ranking. |
| Jugador                | `Player`               | One anonymous identity occupying one seat in a Sala.                     |
| Tipo de emprendimiento | `EntrepreneurshipType` | Tecnología, Social, or Tradicional; grants the starting bonus.           |
| Turno                  | `Turn`                 | One Jugador rolling and resolving a Tarjeta or Empresa action.           |
| Ronda                  | `Round`                | One pass in which every Jugador receives one Turno.                      |
| Tarjeta                | `Card`                 | A fixed board event from one of the four categories.                     |
| Opción                 | `CardOption`           | A visible choice with a cost and weighted possible Resultados.           |
| Resultado              | `Outcome`              | The server-selected consequence of an Opción.                            |
| Empresa                | `CompanySpace`         | Board position 30, where unconsolidated players take management actions. |
| Consolidación          | `Consolidation`        | Immediate victory at Empresa with all three resource thresholds met.     |

## Invariants

- PostgreSQL owns all state transitions and random decisions.
- A Jugador belongs to one Sala and is identified by `auth.uid()`.
- A Turno has exactly one current Jugador and one public phase.
- Client commands are idempotent by request ID and optimistic by room version.
- Resources never become negative.
- A finished or expired Sala accepts no further game commands.

Avoid using “session” for Sala or Partida; Supabase Auth already has an identity
session. Avoid using “event” for Tarjeta; an event also means a technical record.
