// 上部バーの参加者アバター（issue #192）。モック（app-ui/Questboard Prototype.dc.html）
// の「頭文字1字＋色付き円形バッジの重なり」を、WebSocket presence の実データから
// 決定的に導出するためのピュア関数群。

// CSS 側の .board-avatar-color-0 〜 .board-avatar-color-7 と対応する。
export const AVATAR_COLOR_COUNT = 8;

// モックは3名だが、実データは人数上限が無いため表示は5名で打ち切り、
// 超過分は「+N」バッジにまとめる。
export const AVATAR_MAX_VISIBLE = 5;

const FALLBACK_INITIAL = '?';

export interface AvatarParticipant {
  key: string;
  displayName: string;
}

export interface AvatarRosterEntry extends AvatarParticipant {
  initial: string;
  colorIndex: number;
}

export interface AvatarRoster {
  visible: AvatarRosterEntry[];
  overflowCount: number;
}

// 表示名の先頭1文字。サロゲートペア（絵文字・拡張漢字）を分断しないよう
// コードポイント単位で切り出す。空白のみの名前はフォールバック文字。
export function avatarInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed === '') {
    return FALLBACK_INITIAL;
  }

  return [...trimmed][0];
}

// 表示名から色インデックスを決定的に割り当てる（同じ名前は常に同じ色）。
// 暗号強度は不要で、分布の偏りが小さい単純な文字列ハッシュ（djb2）を使う。
export function avatarColorIndex(key: string): number {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % AVATAR_COLOR_COUNT;
}

// 参加者一覧を「表示する分＋超過数」に整形する。並び順は呼び出し側が決める
// （自分を先頭に置く等）。
export function resolveAvatarRoster(participants: readonly AvatarParticipant[]): AvatarRoster {
  const visible = participants.slice(0, AVATAR_MAX_VISIBLE).map((participant) => ({
    ...participant,
    initial: avatarInitial(participant.displayName),
    colorIndex: avatarColorIndex(participant.displayName),
  }));

  return {
    visible,
    overflowCount: Math.max(0, participants.length - AVATAR_MAX_VISIBLE),
  };
}
