export interface BoardColorPaletteLike {
  id: number;
  hex: string;
}

// #RGB / #RRGGBB のみを受け付ける。パレットはサーバー由来だが、
// この値はそのまま style 属性に流し込まれるため、CSS として解釈されうる文字列
// （`red; background: url(...)` のような値）を通さないようにする。
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// colorId に対応するパレット色を返す。見つからない場合・不正な hex の場合は null。
// colorId は DB 制約により常に解決される想定であり、万が一解決できない場合は
// CSS 側でフォールバックされず、背景等が透明（無色）になる。
export function resolveObjectColorHex(
  palettes: ReadonlyArray<BoardColorPaletteLike> | null | undefined,
  colorId: number | null | undefined
): string | null {
  if (!Array.isArray(palettes) || typeof colorId !== 'number' || !Number.isFinite(colorId)) {
    return null;
  }

  const hex = palettes.find((palette) => palette.id === colorId)?.hex;

  if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) {
    return null;
  }

  return hex;
}

// オブジェクト要素に渡す CSS カスタムプロパティ。
// colorId は DB 制約により常に解決される想定であり、解決できない場合は
// 空オブジェクトを返す（CSS カスタムプロパティを設定しない）。
export function objectColorStyle(
  palettes: ReadonlyArray<BoardColorPaletteLike> | null | undefined,
  colorId: number | null | undefined
): Record<string, string> {
  const hex = resolveObjectColorHex(palettes, colorId);

  return hex ? {'--object-color': hex} : {};
}
