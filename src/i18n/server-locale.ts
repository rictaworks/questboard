import {headers} from 'next/headers';

import {LOCALE_HEADER} from './middleware-routing';
import {defaultLocale, locales, type Locale} from './routing';

// リクエストのロケールを解決する。[locale] セグメントの外側（ルート直下の 404 等）
// でも解決できるよう、URL のパラメータではなくミドルウェアが付けたヘッダーを読む。
//
// next-intl の getLocale() を使わないのは、ルートレイアウトから呼ぶと
// getConfig(undefined) の結果がリクエスト単位でメモ化され、後から実行される
// [locale]/layout.tsx の setRequestLocale() が無効化されるため。
// （/ar/... が日本語で描画される回帰の原因）
//
// ヘッダーはクライアントも送れるが、ミドルウェアが
//   - ロケール解決を行うパス: next-intl が必ず上書きする
//   - 素通しするパス        : 明示的に削除する
// のどちらかを保証するため、ここに届く値はミドルウェア由来のものだけになる。
// それでも値域の検査は行い、未知のロケールは既定ロケールとして扱う。
export async function resolveRequestLocale(): Promise<Locale> {
  const requestedLocale = (await headers()).get(LOCALE_HEADER);

  if (requestedLocale !== null && locales.includes(requestedLocale as Locale)) {
    return requestedLocale as Locale;
  }

  return defaultLocale;
}
