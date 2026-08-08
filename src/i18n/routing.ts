// 対応言語は日本語のみ。多言語対応は行わない（CLAUDE.md「言語方針」参照）。
//
// next-intl は残しているが、これは翻訳のためではなく、CLAUDE.md が要求する
// 「文字列リテラルは設定ファイルに分離すること」を満たすメッセージカタログ
// および ICU の補間・複数形のためである。ロケールを URL 接頭辞に持たせないので、
// この値はメッセージファイルの選択と <html lang> にのみ使う。
export const defaultLocale = 'ja';

export type Locale = typeof defaultLocale;
