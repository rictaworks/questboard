import {getMessages} from 'next-intl/server';

// クライアントへ渡すメッセージを、そのルートが実際に使う名前空間だけに絞る。
//
// ルートレイアウトで NextIntlClientProvider を丸ごと張ると、next-intl は
// カタログ全体を RSC ペイロードに載せる。その結果、メッセージを1つも使わない
// 404（/wp-login.php のような未知の URL を叩くスキャナが引く）や
// OAuth コールバック画面にまで BoardCanvas 名前空間まで含む ja.json 全体が乗り、
// 応答が 1〜2KB から 14KB 超に膨らむ。
//
// 名前空間が見つからない場合は空オブジェクトで代替せず失敗させる。黙って
// 欠けたまま描画すると、画面に出るまで気づけない（CLAUDE.md「フォールバック処理は禁止」）。
export async function clientMessages(namespaces: readonly string[]) {
  const messages = await getMessages();

  return Object.fromEntries(
    namespaces.map((namespace) => {
      const namespaceMessages = messages[namespace];

      if (namespaceMessages === undefined) {
        throw new Error(
          `メッセージ名前空間 ${namespace} が src/messages/ja.json に存在しない。クライアントへ渡す名前空間名を確認すること。`
        );
      }

      return [namespace, namespaceMessages];
    })
  );
}
