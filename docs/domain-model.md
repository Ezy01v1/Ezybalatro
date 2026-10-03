# Modelo de dominio (borrador Fase 0)

Convenciones: PK `uuid` (v7 generado en la app), `created_at`/`updated_at` `timestamptz` en todas las tablas, FKs con índice, fichas en `bigint`.

## ERD

```mermaid
erDiagram
  profiles ||--|| wallets : "tiene"
  profiles ||--o{ chip_ledger : "movimientos"
  profiles ||--o{ seats : "se sienta"
  profiles ||--o{ runs : "juega"
  profiles ||--o{ challenge_scores : "puntúa"
  tables ||--o{ seats : "6 max"
  tables ||--o{ hands : "reparte"
  hands ||--o{ hand_actions : "registra"
  seats ||--o{ hand_actions : "actúa"
  daily_challenges ||--o{ challenge_scores : "ranking"
  daily_challenges ||--o{ runs : "semilla del día"
  hands ||--o{ chip_ledger : "ref opcional"

  profiles {
    uuid id PK "= auth.users.id (Supabase)"
    text nickname "UNIQUE, 3-20"
    text avatar_id "set predefinido"
    bool is_guest
    timestamptz deleted_at "null salvo anonimización"
  }
  wallets {
    uuid user_id PK,FK
    bigint balance "CHECK >= 0"
    timestamptz last_daily_refill_at
  }
  chip_ledger {
    uuid id PK
    uuid user_id FK
    bigint delta "!= 0"
    bigint balance_after "CHECK >= 0"
    text reason "initial|daily_refill|buy_in|cash_out|reward|adjustment"
    uuid table_id FK "null si no aplica"
    text idempotency_key "UNIQUE (user_id, key)"
  }
  tables {
    uuid id PK
    text status "open|running|closed"
    int max_seats "CHECK 2..6"
    bigint small_blind
    bigint big_blind
    bigint min_buy_in
    bigint max_buy_in
  }
  seats {
    uuid id PK
    uuid table_id FK
    int seat_index "UNIQUE (table_id, seat_index)"
    uuid user_id FK "null = vacío; bot = flag"
    bool is_bot
    text status "empty|seated|sitting_out|leaving"
    bigint stack "CHECK >= 0"
  }
  hands {
    uuid id PK
    uuid table_id FK
    bigint hand_number "UNIQUE (table_id, hand_number)"
    text status "waiting..settled|voided"
    int button_seat
    jsonb board "cartas comunitarias"
    jsonb pots "principal + laterales y ganadores"
    timestamptz settled_at
  }
  hand_actions {
    uuid id PK
    uuid hand_id FK
    int seq "UNIQUE (hand_id, seq)"
    int seat_index
    text street "preflop|flop|turn|river"
    text type "post_blind|fold|check|call|bet|raise|all_in|timeout"
    bigint amount
  }
  runs {
    uuid id PK
    uuid user_id FK
    uuid daily_challenge_id FK "null = run libre"
    text seed
    text status "in_progress|won|lost|abandoned"
    int ante_reached
    float8 best_hand_score
    jsonb summary "comodines finales, etc."
    timestamptz ended_at
  }
  daily_challenges {
    uuid id PK
    date day "UNIQUE (UTC)"
    text seed
    jsonb modifiers
  }
  challenge_scores {
    uuid id PK
    uuid challenge_id FK
    uuid user_id FK "UNIQUE (challenge_id, user_id)"
    uuid run_id FK
    float8 score
    int ante_reached
  }
```

Notas:
- La run del roguelike **en curso** vive en el teléfono (expo-sqlite). `runs` en el servidor guarda solo el resultado al terminar (para el desafío diario e historial), cuando hay red. Validar puntajes del desafío diario reproduciendo semilla + acciones en el servidor es posible gracias al engine determinista; decidir en la fase del desafío si se envía el log de acciones.
- Las cartas privadas de `hand_actions`/`hands` solo se persisten tras liquidar (`jsonb` de hole cards en `hands`, visible solo para historial propio o tras showdown).
- `hands.status` incluye `voided` para manos anuladas por reinicio (ADR 0004). No figuraba en CLAUDE.md: propuesta.

## Estados

### Run (cliente; se sube al terminar)
```mermaid
stateDiagram-v2
  [*] --> in_progress: jugador inicia run (semilla)
  in_progress --> won: engine — supera la ciega jefe del nivel 8
  in_progress --> lost: engine — se acaban las manos sin alcanzar el objetivo
  in_progress --> abandoned: jugador — abandona / inicia otra run
  won --> [*]
  lost --> [*]
  abandoned --> [*]
```

### Table (servidor)
```mermaid
stateDiagram-v2
  [*] --> open: sistema / matchmaking crea la mesa
  open --> running: servidor — hay ≥ 2 asientos seated con stack ≥ big blind
  running --> open: servidor — al terminar una mano quedan < 2 jugadores activos
  open --> closed: servidor — sin humanos durante X min
  running --> closed: admin/deploy — solo entre manos (drenado)
  closed --> [*]
```

### Seat (servidor)
```mermaid
stateDiagram-v2
  [*] --> empty
  empty --> seated: jugador — se sienta con buy-in (transacción wallet→stack)
  seated --> sitting_out: jugador pide pausa · servidor — desconexión vencida / stack 0
  sitting_out --> seated: jugador — vuelve (y tiene stack ≥ big blind, o hace rebuy)
  seated --> leaving: jugador — se levanta (si está en mano, sale al terminarla)
  sitting_out --> leaving: jugador se levanta · servidor — sitting out > X min
  leaving --> empty: servidor — cash-out (transacción stack→wallet) al terminar la mano
```

### Hand (engine; el servidor la avanza)
```mermaid
stateDiagram-v2
  [*] --> waiting: servidor — crea mano, botón, ciegas
  waiting --> preflop: engine — ciegas puestas, cartas repartidas (RNG servidor)
  preflop --> flop: engine — ronda de apuestas cerrada
  flop --> turn: engine — ronda cerrada
  turn --> river: engine — ronda cerrada
  river --> showdown: engine — ronda cerrada con ≥ 2 vivos
  preflop --> settled: engine — todos menos uno foldean
  flop --> settled: engine — todos menos uno foldean
  turn --> settled: engine — todos menos uno foldean
  river --> settled: engine — todos menos uno foldean
  showdown --> settled: engine — reparte botes (ficha impar al 1º a la izq. del botón)
  preflop --> voided: servidor — reinicio a mitad de mano
  flop --> voided: servidor
  turn --> voided: servidor
  river --> voided: servidor
  settled --> [*]: servidor persiste en una transacción
  voided --> [*]
```
Con all-in de todos los vivos, el engine reparte las calles restantes sin rondas de apuestas (sigue pasando por flop/turn/river).
