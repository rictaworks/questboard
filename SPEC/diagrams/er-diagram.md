# ER図（実装済みスキーマ）

`src/backend/db/schema.rb`（version 2026_07_20_230735）からのリバースエンジニアリング。

```mermaid
erDiagram
    BOARDS ||--o{ BOARD_MEMBERS : has
    USERS ||--o{ BOARD_MEMBERS : joins
    ROLES ||--o{ BOARD_MEMBERS : grants
    BOARDS ||--o{ OBJECTS : contains
    OBJECT_TYPES ||--o{ OBJECTS : typed_as
    COLOR_PALETTES ||--o{ OBJECTS : colored_as
    OBJECTS ||--o{ OBJECTS : parent_frame
    OBJECTS ||--o| FRAME_LOCKS : locked_by
    USERS ||--o{ FRAME_LOCKS : holds
    OBJECTS ||--o{ COMMENTS : has
    USERS ||--o{ COMMENTS : writes
    BOARDS ||--o{ OBJECT_OPS : records
    OBJECTS ||--o{ OBJECT_OPS : has
    USERS ||--o{ OBJECT_OPS : authored
    BOARDS ||--o{ KPI_EVENTS : emits
    USERS ||--o{ KPI_EVENTS : triggers
    EVENT_DEFS ||--o{ KPI_EVENTS : classifies
    EFFECT_MASTERS ||--o{ EVENT_DEFS : plays
    USERS ||--o{ USER_QUESTS : progresses
    QUESTS ||--o{ USER_QUESTS : tracked_by
    USERS ||--o| USER_SETTINGS : configures
    INTENSITY_MASTERS ||--o{ USER_SETTINGS : level

    BOARDS {
        bigint id PK
        string title
        string share_token UK
        datetime created_at
    }
    USERS {
        bigint id PK
        string google_sub UK
        string display_name
        datetime created_at
    }
    ROLES {
        bigint id PK
        string code UK
    }
    BOARD_MEMBERS {
        bigint id PK
        bigint board_id FK
        bigint user_id FK
        integer role_id FK
    }
    OBJECT_TYPES {
        bigint id PK
        string code UK
    }
    COLOR_PALETTES {
        bigint id PK
        string hex UK
    }
    OBJECTS {
        bigint id PK
        bigint board_id FK
        integer object_type_id FK
        integer color_id FK
        jsonb geometry
        jsonb text_crdt
        bigint parent_frame_id FK
        datetime deleted_at "tombstone、30日後にpurge対象"
    }
    FRAME_LOCKS {
        bigint id PK
        bigint object_id FK "UK"
        bigint locked_by FK
        datetime locked_at
    }
    COMMENTS {
        bigint id PK
        bigint object_id FK
        bigint user_id FK
        text body
        datetime created_at
    }
    OBJECT_OPS {
        bigint id PK
        bigint board_id FK
        bigint object_id FK
        bigint user_id FK
        string property "geometry / color / deleted_at"
        jsonb value
        bigint lamport_ts
        string client_id
    }
    KPI_EVENTS {
        bigint id PK
        integer event_def_id FK
        bigint user_id FK
        bigint board_id FK
        jsonb props "PII禁止"
        datetime occurred_at
    }
    EVENT_DEFS {
        bigint id PK
        string code UK
        integer effect_id FK
    }
    EFFECT_MASTERS {
        bigint id PK
        string code UK
        integer duration_ms
    }
    QUESTS {
        bigint id PK
        string title UK
        string condition_event
        integer condition_count
    }
    USER_QUESTS {
        bigint id PK
        bigint user_id FK
        integer quest_id FK
        string state
        integer progress
    }
    USER_SETTINGS {
        bigint user_id PK, FK
        integer intensity_id FK
        boolean sound_enabled
    }
    INTENSITY_MASTERS {
        bigint id PK
        string code UK
    }
    RADIAL_MENU_ITEMS {
        bigint id PK
        string code UK
        string label
        integer sort_order UK
    }
```

`RADIAL_MENU_ITEMS` は他テーブルとの外部キー関係を持たない独立したマスタテーブル（UI用ラジアルメニュー項目）。


`object_ops` の `(object_id, client_id, lamport_ts)` 一意インデックスが、同一opの再送を冪等にする仕組みの核。詳細は [`SPEC/api/rails-backend.md`](../api/rails-backend.md) の「オブジェクト」節を参照。
