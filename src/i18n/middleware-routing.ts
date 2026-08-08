import {locales, type Locale} from './routing';

// next-intl のミドルウェアがリクエストヘッダーに載せるロケール。サーバー
// コンポーネント側はこの値だけを見る。next-intl の内部実装に依存する名前なので、
// 参照箇所をこの定数に集約する。
export const LOCALE_HEADER = 'x-next-intl-locale';

// ロケール解決を行わず素通ししたリクエストの、元のパス。ロケールとして無効な
// 1セグメントのパス（/robots.txt 等）が [locale] セグメントに一致してしまうため、
// app router 側で元のパスを復元して 404 へ寄せるのに使う。
export const PATHNAME_HEADER = 'x-questboard-pathname';

// ロケール解決を行わず、リクエストをそのまま通すパスの接頭辞。
// - /api        : ルートハンドラ。ロケール接頭辞を付けてはいけない
// - /_next      : ビルド成果物
// - /_vercel    : Vercel の計測エンドポイント
// - /.well-known: 証明書更新（HTTP-01 チャレンジ）やアプリの関連付けファイル。
//                 リダイレクトすると CA や OS が実ファイルに到達できなくなる
export const PASS_THROUGH_PREFIXES = ['/api', '/_next', '/_vercel', '/.well-known'] as const;

// ロケール接頭辞を付けずに外部へ渡りうる入口。ロケール検出に任せず、既定ロケールへ送る。
// - /b : ボードの共有リンク。受け取り側には NEXT_LOCALE クッキーが無いため、検出は
//        Accept-Language に落ちる。翻訳が未完了のロケール（fr / zh / ru / es / ar）に
//        着地すると、見出しもボタンも "[TODO] translate" のまま表示される。
//        既定ロケールなら少なくとも全文が翻訳済みで読める。
//
// /auth/google/callback はここに入れない。Google に登録した redirect_uri は
// ロケール接頭辞を持たないが、戻ってくる利用者は直前に付いた NEXT_LOCALE クッキーを
// 持っているため、検出結果は本人が選んだロケールになる。既定ロケールへ固定すると
// ログインのたびに日本語サイトへ飛ばされる。
export const DEFAULT_LOCALE_ENTRY_PREFIXES = ['/b'] as const;

// 既定ロケールへ寄せる入口かどうかを返す。
export function requiresDefaultLocale(pathname: string): boolean {
  if (hasLocalePrefix(pathname)) {
    return false;
  }

  return DEFAULT_LOCALE_ENTRY_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`));
}

// public/ のサブディレクトリに置いた実ファイル（/fonts/inter.woff2 等）を見分ける。
// ルート直下のファイルは拡張子の有無に関わらず isRootFileRequest() が拾うので、
// このパターンは多階層のパスだけを対象にすればよい。
const FILE_EXTENSION_PATTERN = /\/[^/]+\.[^./]+$/;

export function hasLocalePrefix(pathname: string): boolean {
  const firstSegment = pathname.split('/')[1] ?? '';

  return locales.includes(firstSegment as Locale);
}

// ルート直下の1セグメントのパスかどうか。'/' は含めない。
//
// アプリのルートで root 直下に居るのは '/' だけで、それ以外の1セグメントのパスは
// public/ の実ファイル要求か、どこにも一致しない 404 のどちらかしかない。
// そのため拡張子を条件にせず、1セグメントであること自体を実ファイル要求の
// 判定に使う。拡張子で絞ると、ドメイン所有権確認ファイルや CDN の
// ヘルスチェックパスのような拡張子を持たない実ファイルが配信されなくなる。
function isRootFileRequest(pathname: string): boolean {
  if (pathname === '/') {
    return false;
  }

  const segments = pathname.split('/').filter((segment) => segment !== '');

  return segments.length === 1;
}

// ロケール解決（リダイレクトとロケールヘッダーの付与）を行うかどうかを返す。
//
// ロケール接頭辞が付いているパスは、拡張子があっても必ずロケール解決の対象に
// する。付いていないパスだけを実ファイル要求として素通しする。こうしないと
// /ar/data.json のようなパスでロケールが失われ、既定ロケールへ退行する。
//
// 素通ししたパスに実ファイルが無かった場合、そのリクエストは app router に届き、
// [locale] セグメントとして扱われて 404 に寄せられる（src/app/[locale]/layout.tsx）。
// つまり素通しは「配信を試みる」であって「404 を諦める」ではない。
export function shouldSkipLocaleRouting(pathname: string): boolean {
  if (hasLocalePrefix(pathname)) {
    return false;
  }

  if (PASS_THROUGH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }

  if (isRootFileRequest(pathname)) {
    return true;
  }

  return FILE_EXTENSION_PATTERN.test(pathname);
}

// パスがロケール解決に渡せる形かどうか。
//
// next-intl のミドルウェアは decodeURI() が失敗すると、リクエストヘッダーに一切
// 触れないまま NextResponse.next() を返して Next に 400 を任せる。その経路では
// クライアントが送った LOCALE_HEADER が上書きされずサーバーコンポーネントへ届く
// ため、表示言語をリクエストヘッダーで操作できてしまう。
// 判定をこちらで先に行い、壊れたパスは next-intl に渡さない。
export function isDecodablePathname(pathname: string): boolean {
  try {
    decodeURI(pathname);

    return true;
  } catch {
    // decodeURI が投げるのは URIError だけで、不正なパーセントエスケープを
    // 「ロケール解決に渡せない」と分類するためだけに捕捉する。
    return false;
  }
}
