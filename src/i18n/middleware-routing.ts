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
// apple-app-site-association は拡張子を持たない固定名の実ファイルなので個別に挙げる。
export const PASS_THROUGH_PREFIXES = [
  '/api',
  '/_next',
  '/_vercel',
  '/.well-known',
  '/apple-app-site-association'
] as const;

// 最終セグメントに拡張子を持つパスは実ファイル要求とみなす。public/ に置いた
// ファイル（所有権確認用の HTML、apple-app-site-association 等）をロケール URL へ
// リダイレクトすると、検証側はファイルではなく 404 を受け取ることになる。
const FILE_EXTENSION_PATTERN = /\/[^/]+\.[^./]+$/;

export function hasLocalePrefix(pathname: string): boolean {
  const firstSegment = pathname.split('/')[1] ?? '';

  return locales.includes(firstSegment as Locale);
}

// ロケール解決（リダイレクトとロケールヘッダーの付与）を行うかどうかを返す。
//
// ロケール接頭辞が付いているパスは、拡張子があっても必ずロケール解決の対象に
// する。付いていないパスだけを実ファイル要求として素通しする。こうしないと
// /ar/data.json のようなパスでロケールが失われ、既定ロケールへ退行する。
export function shouldSkipLocaleRouting(pathname: string): boolean {
  if (hasLocalePrefix(pathname)) {
    return false;
  }

  if (PASS_THROUGH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }

  return FILE_EXTENSION_PATTERN.test(pathname);
}
