import {NextResponse} from 'next/server';

// 稼働中のプロセスを外から同定するための経路。
//
// test/not-found-http.test.mjs は空きポートを予約してから `next start` を起動する。
// 予約したソケットを閉じてから子プロセスが bind するまでのあいだ、別のプロセスが
// 同じ番号を取る余地が残るため、「応答が返ってきたこと」だけでは自分が起動した
// サーバーだと確かめられない。ページの文言でも見分けられない（同じ成果物を配信する
// 別インスタンスは同じ文言を返す）。起動ごとに変わる識別子で照合する。
//
// 識別子は返さない。問い合わせ側が知っている値と一致するかどうかだけを答える。
// 反射すると、認証の要らない公開エンドポイントから匿名の呼び出し元が値を読み、
// ポーリングでインスタンスの列挙とデプロイ・再起動タイミングの観測ができてしまう。
//
// 環境変数が未設定なら、一致のしようが無いので常に 404 を返す。本番では設定しない
// 運用なので、その場合この経路は存在しないのと同じ見え方になる。
const INSTANCE_PROBE_PARAM = 'instance';

// 静的化させない。ビルド時に評価されると、起動時の環境変数ではなくビルド時の値
// （通常は未設定）で判定し続ける。
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const expected = process.env.QUESTBOARD_INSTANCE_ID;
  const provided = new URL(request.url).searchParams.get(INSTANCE_PROBE_PARAM);

  if (!expected || provided !== expected) {
    return new NextResponse(null, {status: 404});
  }

  return new NextResponse(null, {
    // 経路上のキャッシュが古い応答を返すと、停止済みのインスタンスを稼働中だと
    // 判定できてしまう。
    headers: {'Cache-Control': 'no-store'},
    status: 204
  });
}
