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

// #RGB を #RRGGBB 相当の成分に展開して {r,g,b} を返す。不正な hex は null。
function parseHexChannels(hex: string): {r: number; g: number; b: number} | null {
  if (!HEX_PATTERN.test(hex)) {
    return null;
  }

  const body = hex.slice(1);
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// hex を rgba() 文字列へ。パレット由来以外の文字列が紛れても CSS として
// 解釈されうる値を通さないよう、HEX_PATTERN を通過した値だけを変換する。
export function hexToRgbaString(hex: string, alpha: number): string | null {
  const channels = parseHexChannels(hex);
  if (!channels) {
    return null;
  }

  return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${alpha})`;
}

// モック（app-ui/Questboard Prototype.dc.html）の pastel(hex, amt) と同じ変換。
// 各成分を白側へ amount ぶん寄せ、不透明度 0.95 のパステル塗りを作る。
// 付箋の「塗りつぶし＋濃い文字色」の背景に使う（issue #192）。
export function pastelizeHex(hex: string, amount: number): string | null {
  const channels = parseHexChannels(hex);
  if (!channels) {
    return null;
  }

  const lift = (value: number) => Math.round(value + (255 - value) * amount);

  return `rgba(${lift(channels.r)}, ${lift(channels.g)}, ${lift(channels.b)}, 0.95)`;
}

// モックの buildObjectStyle が種別ごとに使う塗り・縁の透過率。
const STICKY_PASTEL_AMOUNT = 0.55;
const SOFT_BORDER_ALPHA = 0.55;
const FAINT_FILL_ALPHA = 0.2;
const STRONG_BORDER_ALPHA = 0.65;

// オブジェクト要素に渡す CSS カスタムプロパティ。種別ごとの使い分けは
// globals.css の .board-object-* 側が行う（sticky はパステル塗り、shape は
// 半透明塗り等）。colorId は DB 制約により常に解決される想定であり、
// 解決できない場合は空オブジェクトを返す（CSS 側の既定値に委ねる）。
export function objectColorStyle(
  palettes: ReadonlyArray<BoardColorPaletteLike> | null | undefined,
  colorId: number | null | undefined
): Record<string, string> {
  const hex = resolveObjectColorHex(palettes, colorId);
  if (!hex) {
    return {};
  }

  return {
    '--object-color': hex,
    '--object-fill-soft': pastelizeHex(hex, STICKY_PASTEL_AMOUNT) as string,
    '--object-border-soft': hexToRgbaString(hex, SOFT_BORDER_ALPHA) as string,
    '--object-fill-faint': hexToRgbaString(hex, FAINT_FILL_ALPHA) as string,
    '--object-border-strong': hexToRgbaString(hex, STRONG_BORDER_ALPHA) as string,
  };
}
