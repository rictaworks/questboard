// text_crdt ドキュメントのクライアント側ユーティリティ（issue #199）。
//
// 永続化形式は Rails 側 merge_text_crdt_state と同じ「insert のみの run リスト」
// （{ops: [{insert: string, attributes?: object}]}）で、編集の差分は
// retain / delete / insert の op 列として送る（objects_controller#apply_op）。
// オフセットはブラウザの文字列セマンティクス＝ UTF-16 コードユニット単位で数える
// （バックエンドの Utf16Text と一致）。

export type TextCrdtRun = {
  insert: string;
  attributes?: Record<string, unknown> | null;
};

export type TextCrdtState = {
  ops?: TextCrdtRun[];
} | null | undefined;

export type TextCrdtDiffOp = {
  insert?: string;
  delete?: number;
  retain?: number;
  attributes?: Record<string, unknown> | null;
};

// run リストから表示用のプレーンテキストを得る。装飾（attributes）は本文描画では
// 解釈しない（プレーンテキストとして描画する。TM.md T6 の XSS 対策）。
export function textFromCrdt(state: TextCrdtState): string {
  if (!state || !Array.isArray(state.ops)) {
    return '';
  }

  return state.ops
    .map((run) => (typeof run?.insert === 'string' ? run.insert : ''))
    .join('');
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

// before → after の最小差分を retain / delete / insert の op 列にする。
// 共通の前後を取り除くだけの単純な diff だが、境界がサロゲートペアの内側に
// 落ちないよう補正する（バックエンドの valid_boundary? 検証に一致させる）。
export function diffToOps(before: string, after: string): TextCrdtDiffOp[] {
  if (before === after) {
    return [];
  }

  const maxCommon = Math.min(before.length, after.length);

  let prefix = 0;
  while (prefix < maxCommon && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  // 前方一致がサロゲートペアの高位側で止まった場合はペアの手前まで戻す
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }

  let suffix = 0;
  while (
    suffix < maxCommon - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  // 後方一致がサロゲートペアの低位側で止まった場合はペアの後ろまで戻す
  if (suffix > 0 && isHighSurrogate(before.charCodeAt(before.length - suffix - 1))) {
    suffix -= 1;
  }

  const deleteCount = before.length - prefix - suffix;
  const insertText = after.slice(prefix, after.length - suffix);

  const ops: TextCrdtDiffOp[] = [];
  if (prefix > 0) {
    ops.push({retain: prefix});
  }
  if (deleteCount > 0) {
    ops.push({delete: deleteCount});
  }
  if (insertText.length > 0) {
    ops.push({insert: insertText});
  }

  return ops;
}

// 差分 op 列を run リストへ適用する（Rails 側 compose_text_crdt_ops の
// クライアント版）。retain で通過した run の attributes は保持する。
export function composeCrdt(state: TextCrdtState, diff: TextCrdtDiffOp[]): {ops: TextCrdtRun[]} {
  const sourceRuns = (state && Array.isArray(state.ops) ? state.ops : [])
    .filter((run): run is TextCrdtRun => typeof run?.insert === 'string' && run.insert.length > 0)
    .map((run) => ({insert: run.insert, attributes: run.attributes ?? null}));

  const out: TextCrdtRun[] = [];
  let runIndex = 0;
  let runOffset = 0;

  const pushRun = (insert: string, attributes: Record<string, unknown> | null | undefined) => {
    if (insert.length === 0) {
      return;
    }
    const normalized = attributes ?? null;
    const last = out[out.length - 1];
    if (last && (last.attributes ?? null) === normalized && normalized === null) {
      last.insert += insert;
      return;
    }
    out.push(normalized === null ? {insert} : {insert, attributes: normalized});
  };

  // 入力側 run から count コードユニット進める。emit=true なら出力へ写す。
  const consume = (count: number, emit: boolean) => {
    let remaining = count;
    while (remaining > 0 && runIndex < sourceRuns.length) {
      const run = sourceRuns[runIndex];
      const available = run.insert.length - runOffset;
      const take = Math.min(available, remaining);
      if (emit) {
        pushRun(run.insert.slice(runOffset, runOffset + take), run.attributes);
      }
      runOffset += take;
      remaining -= take;
      if (runOffset >= run.insert.length) {
        runIndex += 1;
        runOffset = 0;
      }
    }
  };

  for (const op of diff) {
    if (typeof op.retain === 'number' && op.retain > 0) {
      consume(op.retain, true);
    } else if (typeof op.delete === 'number' && op.delete > 0) {
      consume(op.delete, false);
    } else if (typeof op.insert === 'string' && op.insert.length > 0) {
      pushRun(op.insert, op.attributes ?? null);
    }
  }

  // 差分が触れなかった残りはそのまま引き継ぐ
  consume(Number.MAX_SAFE_INTEGER, true);

  return {ops: out};
}
