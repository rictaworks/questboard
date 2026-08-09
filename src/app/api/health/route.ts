import {NextResponse} from 'next/server';

// 稼働中のプロセスを外から同定するための経路。
//
// test/not-found-http.test.mjs は空きポートを予約してから `next start` を起動する。
// 予約したソケットを閉じてから子プロセスが bind するまでのあいだ、別のプロセスが
// 同じ番号を取る余地が残るため、「応答が返ってきたこと」だけでは自分が起動した
// サーバーだと確かめられない。ページの文言でも見分けられない（同じ成果物を配信する
// 別インスタンスは同じ文言を返す）。起動ごとに変わる識別子をここで返して照合する。
//
// 環境変数が未設定なら null を返す。本番で識別子を配る運用は前提にしていない。
const HEALTH_STATUS_OK = 'ok';

// 静的化させない。ビルド時に評価されると、起動時の環境変数ではなくビルド時の値
// （通常は未設定）を焼き込んだ応答を返し続け、どのインスタンスも同じ答えになる。
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      instance: process.env.QUESTBOARD_INSTANCE_ID ?? null,
      status: HEALTH_STATUS_OK
    },
    {
      headers: {
        // 経路上のキャッシュが古い識別子を返すと、停止済みのインスタンスを
        // 稼働中だと判定できてしまう。
        'Cache-Control': 'no-store'
      }
    }
  );
}
