# F6 リアルタイム共同編集・テキストCRDT

`geometry` / `color` / `deleted_at` の決定的LWW（Last-Write-Wins）競合解決に加え、`text_crdt` プロパティによるテキストの共同編集と、`presence`（カーソル位置）のephemeralな共有を実装する。API一覧は [`SPEC/api/rails-backend.md`](api/rails-backend.md)・[`SPEC/api/sync-server.md`](api/sync-server.md)、フローは [`SPEC/diagrams/sequence-op-sync.md`](diagrams/sequence-op-sync.md) を参照。実装は `src/backend/app/controllers/objects_controller.rb`（`TextOT`, `Utf16Text`）、`src/sync-server/internal/ws/handler.go`。

## `text_crdt` のドキュメント表現

永続スナップショット（`objects.text_crdt`）は plain text ではなく、Quill Delta風のinsert-onlyな run 列 `{ "ops": [{ "insert": "...", "attributes": {...} }] }` として保持する。書式（太字・斜体等）を`attributes`として保持することで、再読み込み・再同期後も接続中クライアントと同じ表現を維持する。

## 履歴位置とOperational Transformation

- **`ref_revision`/`revision` はサーバー採番の `object_ops.id`。クライアント生成の `lamport_ts` ではない。** `lamport_ts`はクライアントごとの論理カウンタであり、複数クライアント間の絶対的な順序を表さない。`id`は永続化順に単調増加するため、「クライアントが最後に観測した時点より後に確定した操作」を`id > ref_revision`で正確に検索できる
- `apply_op`は`ref_revision`より後の確定済み`text_crdt`opを`(object_id, property, id)`インデックスで検索し（`MAX_OT_HISTORY_LIMIT`件を超えたら再同期要求）、`TextOT.transform`で自分の差分を順に変換してから、現在の`objects.text_crdt`へ`compose_text_crdt_ops`で合成する
- `ref_revision`はオブジェクト作成時（履歴なし）は省略可能。以後は必須で、省略・不正値（存在しない/別オブジェクトのもの）は`resyncRequired`として拒否する
- `objects.text_crdt_revision`は本文（`text_crdt`）と同一のUPDATE文・同一のロック内で更新するため、読み取り時に本文とrevisionが別時点になることはない

## attributesの合成規則

- `retain`のattributesは「その範囲への書式変更」を表す。省略時は変更なし、値が`nil`のキーは書式の解除（`compact`で除去）
- 同じ属性キーを複数クライアントが競合して変更した場合、最終的にcomposeされた側（コミット順で後）が勝つ。他プロパティのLWWと同じ考え方
- OT変換後もattributesを保持する（`TextOT.transform`のretain/retain分岐、および末尾retainのトリム処理は無条件にattributes付きretainを削除しないよう考慮済み）

## 文字オフセットの単位（UTF-16 code unit）

ブラウザのJavaScript文字列はUTF-16 code unit単位で長さ・オフセットを扱う（絵文字などBMP外文字は2 code unit＝サロゲートペア）。Rubyの`String#length`/`#slice`はUnicodeコードポイント単位のため、そのままではズレる。`Utf16Text`モジュールがこの変換を担い、`retain`/`delete`のオフセットがサロゲートペアの途中を指す場合は`422`で拒否する（黙って文字を複製・欠落させない）。

## 入力値検証・上限

| 項目 | 定数 | 内容 |
|---|---|---|
| 1リクエストあたりのop数 | `MAX_TEXT_CRDT_OPS` | 超過は`422` |
| insert文字列のバイト数 | `MAX_TEXT_CRDT_INSERT_BYTES` | 超過は`422` |
| 本文の合計バイト数 | `MAX_TEXT_CRDT_TEXT_BYTES` | 超過は`422` |
| attributes単体のバイト数・ネスト深さ | `MAX_TEXT_CRDT_ATTRIBUTES_BYTES` / `MAX_TEXT_CRDT_ATTRIBUTES_DEPTH` | 超過は`422` |
| 合成後document全体のバイト数（本文＋全runのattributes） | `MAX_TEXT_CRDT_DOCUMENT_BYTES` | 個々のopは上限内でも、多数のrunに書式を分散させて肥大化させる攻撃を防止 |
| `delete`/`retain` | — | 正の整数のみ許可（0・負数は`422`）。文書長を超える消費も`422` |

## 重複op・再同期の扱い

- Railsは「既に記録済みのop（クライアントIDとLamportTS、text_crdtの場合はref_revisionも一致）」を`duplicate: true`として区別する（`ObjectsController#serialize_op`）
- sync-serverは`duplicate: true`のopを他クライアントへブロードキャスト・Redis中継しない。`text_crdt`は差分適用のため、二重配信は受信側での二重適用（文書破損）につながる。送信元へは確定済みvalue/revision込みのackのみ返し、次の編集に使えるrevisionを回復できるようにする
- 既知の限界：Rails保存成功後・ブロードキャスト実行前にsync-serverが停止した場合、その一回に限り他クライアントへの配信が欠落し得る（durable outboxのような永続的再配信保証は未実装。単一sync-serverインスタンス前提の早期開発段階でのトレードオフ）

## `presence`

カーソル位置などのephemeralな状態。`object_ops`へは永続化せず、`hub.Broadcast`とRedis中継のみで同一board内に共有する。value形式検証・30Hzスロットリング・トークンバケット方式のレート制限（board+ユーザー単位、受信メッセージ全体のバイト数で課金）を行う（詳細は[`SPEC/api/sync-server.md`](api/sync-server.md)）。

## デプロイ上の注意（`text_crdt_revision`カラム）

`db/migrate/20260724150000_add_text_crdt_revision_to_objects.rb`（列追加）と`20260724160000_backfill_text_crdt_revision.rb`（既存`text_crdt`履歴を持つオブジェクトへのバックフィル）は分離しており、後者はDDLを含まないため中断後の再実行が安全。ただし、両migrationの実行中は`text_crdt`編集を受け付ける旧アプリコードを稼働させないこと（新アプリコードのみが`text_crdt_revision`を正しく維持する）。
