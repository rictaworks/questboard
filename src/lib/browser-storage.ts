// ブラウザのストレージへの読み書き。
//
// window.sessionStorage / localStorage は、プロパティに触れた時点で例外を
// 投げることがある。「すべての Cookie をブロック」設定、サードパーティ文脈で
// 埋め込まれた文書、sandbox 属性つきの iframe が該当する。
//
// 生のアクセスを React の effect や描画中に置くと、その SecurityError で
// ツリーが巻き戻り、利用者には白紙が表示される。読めないことは異常ではなく
// その環境の仕様なので、ここで受け止めて「値が無い」として扱う。
//
// 値が無いときの振る舞いは呼び出し側が決める。ここは握り潰す場所ではなく、
// 「読めたか / 読めなかったか」を null で伝える境界にする。
export function readSessionItem(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

// 書けたかどうかを返す。書けないまま「保存した」と信じて先へ進む経路を
// 作らないため、呼び出し側が結果を見られるようにする。
export function writeSessionItem(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeSessionItem(key: string): boolean {
  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// この文書が最上位で開かれているか。
//
// 攻撃ページは iframe で任意の URL を何枚でも開ける。埋め込まれた状態で
// 通報を送ると、被害者の IP から POST /client_errors の毎分10件の枠を
// 使い切らせることができる（攻撃者自身の IP は一切消費しない）。
//
// クロスオリジンの親からは window.top のプロパティに触れられず例外になる。
// それ自体が「埋め込まれている」ことの証拠なので、埋め込み扱いにする。
export function isTopLevelDocument(): boolean {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
}
