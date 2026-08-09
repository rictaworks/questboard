# フロントエンド API

`src/app/api`（Next.js App Router の Route Handler）。UI のデータ取得はすべて Rails バックエンド（[`rails-backend.md`](rails-backend.md)）と sync-server（[`sync-server.md`](sync-server.md)）が担うため、ここに置くのは Next のプロセス自身についての情報を返す経路だけに限る。以下は現時点で実装済みのエンドポイントのみを記載する。

## ヘルスチェック

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/health` | 稼働中の Next プロセスの死活と、起動時に与えられたインスタンス識別子を返す |

### `GET /api/health`

認証不要。`Cache-Control: no-store` を付けて返す（経路上のキャッシュが古い識別子を返すと、停止済みのインスタンスを稼働中だと判定できてしまうため）。

```json
{
  "instance": "0b9ae2ff-2f0b-4a2b-9f2f-0f4a6d9a1c33",
  "status": "ok"
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `instance` | `string \| null` | 環境変数 `QUESTBOARD_INSTANCE_ID` の値。未設定なら `null` |
| `status` | `string` | 死活。応答できていれば `"ok"` |

`QUESTBOARD_INSTANCE_ID` は起動時に与える任意の文字列で、「いま応答しているのがどのプロセスか」を外から見分けるために使う。本番で設定する運用は前提にしていない（未設定なら `null` を返すだけ）。

用途は `test/not-found-http.test.mjs`。このテストは空きポートを予約してから `next start` を起動するが、予約したソケットを閉じてから子プロセスが bind するまでのあいだに別のプロセスが同じ番号を取る余地が残る。ページの文言では見分けられない（同じ成果物を配信する別インスタンスは同じ文言を返す）ため、起動ごとに生成した UUID を環境変数で渡し、この経路の応答と照合してから検証を始める。

このハンドラは `export const dynamic = 'force-dynamic'` で静的化を止めている。静的化されるとビルド時の環境変数（通常は未設定）を焼き込んだ応答を返し続け、どのインスタンスも同じ答えになって同定として機能しない。
