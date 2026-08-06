import type {AnalyticsTrackerEvent, KpiEventDefinitionCode} from './analytics-tracker';
import type {CanvasIntent} from './input-intent-resolver';

// ピンチの指間距離差分(px)をホイールの deltaY 相当へ変換する係数。
// zoomAtCursor は deltaY を前提とするため、符号反転とスケール合わせをここで行う。
export const PINCH_ZOOM_COEFFICIENT = 3;

// ホイールは1操作で毎フレーム intent が発火するため、KPI 送信は間引く。
export const WHEEL_ANALYTICS_THROTTLE_MS = 300;

export type AnalyticsTrackerLike = {
  track(event: AnalyticsTrackerEvent): void;
};

// AnalyticsTracker 本体ではなく ref 形状で受ける。生成/破棄する effect とは
// ライフサイクルが異なるため、送信時点の最新インスタンスを都度読む必要がある。
export type AnalyticsTrackerRef = {
  current: AnalyticsTrackerLike | null;
};

export type ThrottledTrackState = {
  timer: ReturnType<typeof setTimeout> | null;
  pendingAttributes: Record<string, unknown> | null;
  // 保留を作った時点の tracker。AnalyticsTracker は userGoogleSub / boardId ごとに
  // 作り直されるため、満了時に ref を読み直すと切替後ユーザーへ誤帰属する。
  // インスタンスを掴んでおけば、そのイベントは常に発生時のユーザーへ記録される。
  pendingTracker: AnalyticsTrackerLike | null;
};

export function createThrottledTrackState(): ThrottledTrackState {
  return {timer: null, pendingAttributes: null, pendingTracker: null};
}

// leading-edge + trailing のスロットル。
// 先頭の1件を即座に送るのは、末尾のみの送信だと以下の取りこぼしが避けられないため:
// AnalyticsTracker を破棄する effect はキャンバス入力の effect より前に宣言されており、
// アンマウント時には React が宣言順に cleanup を呼ぶ結果、入力側の cleanup が走る
// 時点で trackerRef.current は既に null になっている。
export function trackWithLeadingThrottle(
  state: ThrottledTrackState,
  trackerRef: AnalyticsTrackerRef,
  eventId: KpiEventDefinitionCode,
  attributes: Record<string, unknown>,
  intervalMs: number
): void {
  const tracker = trackerRef.current;

  // tracker が切り替わった時点でスロットル期間を区切り直す。保留を上書きすると
  // 切替前ユーザー／ボードの操作記録が失われるため、先に旧 tracker へ送出する。
  // flush はタイマーも破棄するので、以降は新 tracker の先頭イベントとして扱われる。
  if (state.pendingTracker !== null && state.pendingTracker !== tracker) {
    flushThrottledTrack(state, eventId);
  }

  if (state.timer !== null) {
    state.pendingAttributes = attributes;
    state.pendingTracker = tracker;
    return;
  }

  tracker?.track({eventId, attributes});
  state.timer = setTimeout(() => {
    state.timer = null;
    const pending = state.pendingAttributes;
    const pendingTracker = state.pendingTracker;
    state.pendingAttributes = null;
    state.pendingTracker = null;
    if (pending !== null) {
      pendingTracker?.track({eventId, attributes: pending});
    }
  }, intervalMs);
}

// タイマーを破棄する前に保留分を送出する。送信先は保留を作った時点の tracker で、
// ref は参照しない。アンマウント時に ref が既に null でも、また保留中にユーザーが
// 切り替わっていても、そのイベントは発生時のユーザーへ記録される。
export function flushThrottledTrack(state: ThrottledTrackState, eventId: KpiEventDefinitionCode): void {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  const pending = state.pendingAttributes;
  const pendingTracker = state.pendingTracker;
  state.pendingAttributes = null;
  state.pendingTracker = null;
  if (pending !== null) {
    pendingTracker?.track({eventId, attributes: pending});
  }
}

// camera_panned の source 属性。ホイールはジェスチャ境界を持たないため含めない。
export type GesturePanSource = 'space' | 'button' | 'touch' | 'pinch';

// camera_panned をジェスチャ単位で1回だけ記録するための状態。
//
// 終端 intent を待って記録することはできない:
//   - Space+左ドラッグで Space を先に離すと、終端では resolver が pan 以外へ解決する
//   - pointercancel では終端 intent 自体が発生しない
//   - 2本指はズーム移行後に pan の end が届かない
// いずれもパン操作は成立しているため、実移動を伴う最初の intent で確定させる。
// 逆に移動ゼロの2本指タップでは1件も記録されず、KPI の水増しも起きない。
export type GesturePanTracker = {
  recorded: boolean;
};

export function createGesturePanTracker(): GesturePanTracker {
  return {recorded: false};
}

// ジェスチャ境界（onGestureStart / onGestureCancel）で印を倒す。
export function resetGesturePan(tracker: GesturePanTracker): void {
  tracker.recorded = false;
}

// 実移動を伴う最初の非ホイール pan/zoom intent なら送信すべき source を返し、
// 以降は同一ジェスチャ中 null を返す。記録しない場合は状態を変更しない。
export function resolveGesturePanSource(tracker: GesturePanTracker, intent: CanvasIntent): GesturePanSource | null {
  if (tracker.recorded) {
    return null;
  }

  const source = resolveMovingPanSource(intent);
  if (source === null) {
    return null;
  }

  tracker.recorded = true;
  return source;
}

function resolveMovingPanSource(intent: CanvasIntent): GesturePanSource | null {
  if (intent.kind === 'pan' && intent.source !== 'wheel') {
    return intent.deltaX !== 0 || intent.deltaY !== 0 ? intent.source : null;
  }

  // ズーム移行後もピンチ中心の移動はパンとして扱う（#46 受け入れ基準2）。
  if (intent.kind === 'zoom' && intent.source === 'pinch') {
    const {panDeltaX, panDeltaY} = intent;
    const moved = (panDeltaX !== undefined && panDeltaX !== 0) || (panDeltaY !== undefined && panDeltaY !== 0);
    return moved ? 'pinch' : null;
  }

  return null;
}

// camera_zoomed（ピンチ）をジェスチャ単位で1回だけ記録するための状態。
//
// パンと違い「最初の変更で確定」はできない。KPI の zoom 属性は操作結果の倍率で
// あり、途中の値を送ると意味が変わるためである。そこで適用済みの最新倍率を
// 保持し、終端 intent が届けばそこで、届かなければキャンセル通知で送出する。
export type GestureZoomTracker = {
  appliedZoom: number | null;
  // 控えた時点の tracker。送出はキャンセル通知まで遅れることがあり、その間に
  // ref が null になる（アンマウントでは破棄する effect が先に走る）ため、
  // ThrottledTrackState と同じくインスタンスを掴んでおく必要がある。
  pendingTracker: AnalyticsTrackerLike | null;
};

export type GestureZoomRecord = {
  zoom: number;
  tracker: AnalyticsTrackerLike | null;
};

export function createGestureZoomTracker(): GestureZoomTracker {
  return {appliedZoom: null, pendingTracker: null};
}

// ジェスチャ境界（onGestureStart）で捨てる。前のジェスチャの倍率を持ち越さない。
export function resetGestureZoom(state: GestureZoomTracker): void {
  state.appliedZoom = null;
  state.pendingTracker = null;
}

// ピンチのズームを適用したら、その結果の倍率と送信先を控える。
// ズームへ移行しなかった2本指パンは zoom intent を出さないため、何も控えられない。
//
// ジェスチャ中に tracker が差し替わっても旧 tracker へ送出しない点が
// trackWithLeadingThrottle と異なる。あちらは間引かれた各イベントが独立した
// 記録なのに対し、ズームは1ジェスチャ1件で、控えは同じ1件の更新だからである。
export function noteGestureZoom(
  state: GestureZoomTracker,
  trackerRef: AnalyticsTrackerRef,
  intent: CanvasIntent,
  zoom: number
): void {
  if (intent.kind !== 'zoom' || intent.source !== 'pinch') {
    return;
  }

  state.appliedZoom = zoom;
  state.pendingTracker = trackerRef.current;
}

// 送出すべき倍率と送信先を返して控えを倒す。控えが無ければ null（送信しない）。
// 倍率1.0 は「等倍へ戻した」という有効な結果なので、未ズームとは区別する。
export function consumeGestureZoom(state: GestureZoomTracker): GestureZoomRecord | null {
  const {appliedZoom, pendingTracker} = state;
  state.appliedZoom = null;
  state.pendingTracker = null;

  if (appliedZoom === null) {
    return null;
  }

  return {zoom: appliedZoom, tracker: pendingTracker};
}

export type ReleaseInertiaVelocity = {
  velocityX: number;
  velocityY: number;
};

// リリース時に開始すべき慣性の速度を返す。開始しない場合は null。
// #46 受け入れ基準2 は中ボタン/右ボタン/Space+左/2本指をいずれも「パン」と定義し、
// #11 の「パンは摩擦係数0.92/frame の慣性」に入力源の限定はない。したがって
// リリースという概念を持たない wheel だけを除外し、他は source を問わず慣性を開始する。
export function resolveReleaseInertiaVelocity(intent: CanvasIntent): ReleaseInertiaVelocity | null {
  if (intent.kind !== 'pan' && intent.kind !== 'zoom') {
    return null;
  }

  if (intent.source === 'wheel' || intent.phase !== 'end') {
    return null;
  }

  const {velocityX, velocityY} = intent;
  if (velocityX === undefined || velocityY === undefined) {
    return null;
  }

  return {velocityX, velocityY};
}
