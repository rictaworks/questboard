import type {FullGestureState} from '@use-gesture/vanilla';

const MS_PER_FRAME = 16.6667;
const INERTIA_TIMEOUT_MS = 100;

type UseGestureModule = typeof import('@use-gesture/vanilla');
type DragGestureState = FullGestureState<'drag'>;
type PinchGestureState = FullGestureState<'pinch'>;

export type InputDevice = 'mouse' | 'touch' | 'pen' | 'wheel' | 'keyboard';
export type InputPhase = 'start' | 'change' | 'end' | 'contextmenu' | 'longpress' | 'dblclick' | 'wheel' | 'keydown' | 'keyup';
export type HitTargetKind = 'blank' | 'object' | 'handle' | 'connection-point' | 'text';

export interface HitTarget {
  kind: HitTargetKind;
  objectId?: string;
  textEditable?: boolean;
  handleMode?: 'resize' | 'rotate';
}

export interface InputModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  spaceKey: boolean;
}

export interface SelectionSnapshot {
  selectedIds: readonly string[];
}

export interface PointerInput {
  kind: 'pointer';
  phase: InputPhase;
  device: Exclude<InputDevice, 'wheel' | 'keyboard'>;
  buttons: number;
  touchCount: number;
  movementX: number;
  movementY: number;
  deltaX?: number;
  deltaY?: number;
  velocityX?: number;
  velocityY?: number;
  elapsedTimeMs: number;
  hitTarget: HitTarget;
  modifiers: InputModifiers;
  selection: SelectionSnapshot;
  palmContactAreaPx2?: number;
  activeTool?: 'default' | 'lasso';
  pinchDistanceDeltaPx?: number;
  pinchDeltaPx?: number;
  // 直前の基準距離に対する指間距離の倍率。カメラ側はこれをそのままズーム倍率に使う。
  pinchScale?: number;
  pinchCenterX?: number;
  pinchCenterY?: number;
  pinchZoomApplied?: boolean;
}

export interface WheelInput {
  kind: 'wheel';
  phase: 'wheel';
  deltaX: number;
  deltaY: number;
  hitTarget: HitTarget;
  modifiers: InputModifiers;
  selection: SelectionSnapshot;
}

export interface KeyInput {
  kind: 'key';
  phase: 'keydown' | 'keyup';
  key: string;
  modifiers: InputModifiers;
  selection: SelectionSnapshot;
  hitTarget: HitTarget;
}

export type CanvasInput = PointerInput | WheelInput | KeyInput;

export type CanvasIntent =
  | {
      kind: 'zoom';
      source: 'wheel' | 'pinch';
      amount: number;
      // ピンチのみ。指間距離の倍率をそのまま伝え、ホイール係数への従属を断つ。
      scale?: number;
      precision: boolean;
      centerX?: number;
      centerY?: number;
      phase?: InputPhase;
      panDeltaX?: number;
      panDeltaY?: number;
      velocityX?: number;
      velocityY?: number;
    }
  | {
      kind: 'pan';
      source: 'wheel' | 'space' | 'button' | 'touch';
      phase?: InputPhase;
      deltaX: number;
      deltaY: number;
      velocityX?: number;
      velocityY?: number;
    }
  | {kind: 'radial-menu'; source: 'contextmenu' | 'longpress'}
  | {kind: 'resize'; mode: 'resize' | 'rotate'}
  | {kind: 'connect'}
  | {kind: 'select'; mode: 'replace' | 'add' | 'remove' | 'clear'}
  | {kind: 'move'; duplicate: boolean}
  | {kind: 'marquee'; pointer: 'mouse' | 'touch'}
  | {kind: 'create-note'}
  | {kind: 'edit-text'}
  | {kind: 'draw'}
  | {kind: 'ignore'};

export interface InputIntentResolverOptions {
  clickThresholdPx: number;
  longPressDelayMs: number;
  longPressMovementThresholdPx: number;
  pinchThresholdPx: number;
  palmContactAreaThresholdPx: number;
}

export const DEFAULT_INPUT_INTENT_RESOLVER_OPTIONS: InputIntentResolverOptions = {
  clickThresholdPx: 8,
  longPressDelayMs: 500,
  longPressMovementThresholdPx: 8,
  pinchThresholdPx: 8,
  palmContactAreaThresholdPx: 1600,
};

// PointerEvent.buttons is a bitmask (https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons).
const PRIMARY_BUTTON_BITMASK = 1;
const SECONDARY_BUTTON_BITMASK = 2;
const AUXILIARY_BUTTON_BITMASK = 4;
// PointerEvent.button (not .buttons) uses 0 for the primary button.
const PRIMARY_BUTTON_INDEX = 0;
const MULTI_TOUCH_THRESHOLD = 2;
const MAX_SUPPORTED_TOUCH_COUNT = 2;

// Space が固有の意味を持つ要素。入力欄では文字入力、ボタン/リンクではクリック相当。
const INTERACTIVE_TAG_NAMES = new Set(['input', 'textarea', 'select', 'button', 'a', 'summary', 'option', 'audio', 'video']);
const INTERACTIVE_ARIA_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);

// Space は window で拾うため、その要素本来の Space 操作を奪わないよう除外する。
export function isInteractiveTarget(element: Element | null): boolean {
  if (element == null) {
    return false;
  }

  const tagName = element.tagName?.toLowerCase?.();
  if (tagName !== undefined && INTERACTIVE_TAG_NAMES.has(tagName)) {
    return true;
  }

  if ((element as HTMLElement).isContentEditable === true) {
    return true;
  }

  const role = element.getAttribute?.('role');
  return role != null && INTERACTIVE_ARIA_ROLES.has(role);
}

export function resolveHitTargetFromElement(element: Element | null): HitTarget {
  const hitElement = element?.closest?.('[data-obj-id]') as HTMLElement | null | undefined;

  if (!hitElement) {
    return {kind: 'blank'};
  }

  const objectId = hitElement.getAttribute('data-obj-id') ?? undefined;
  const hitRole = readAttribute(hitElement, 'data-hit-target') ?? readAttribute(hitElement, 'data-obj-role') ?? 'object';
  const textEditable = readBooleanAttribute(hitElement, 'data-text-editable');
  const handleMode = readAttribute(hitElement, 'data-handle-mode') === 'rotate' ? 'rotate' : 'resize';

  if (hitRole === 'handle') {
    return {kind: 'handle', objectId, textEditable, handleMode};
  }

  if (hitRole === 'connection-point') {
    return {kind: 'connection-point', objectId, textEditable};
  }

  if (hitRole === 'text') {
    return {kind: 'text', objectId, textEditable: textEditable ?? true};
  }

  return {kind: 'object', objectId, textEditable};
}

export function resolveCanvasIntent(
  input: CanvasInput,
  options: InputIntentResolverOptions = DEFAULT_INPUT_INTENT_RESOLVER_OPTIONS
): CanvasIntent {
  if (input.kind === 'wheel') {
    return resolveWheelIntent(input);
  }

  if (input.kind === 'key') {
    return {kind: 'ignore'};
  }

  if (isPalmContact(input, options)) {
    return {kind: 'ignore'};
  }

  if (input.phase === 'contextmenu' || input.phase === 'longpress') {
    if (input.phase === 'longpress' && !isLongPressEligible(input, options)) {
      return {kind: 'ignore'};
    }

    return {kind: 'radial-menu', source: input.phase};
  }

  if (input.phase === 'dblclick') {
    if (input.hitTarget.kind === 'text' && input.hitTarget.textEditable !== false) {
      return {kind: 'edit-text'};
    }

    if (input.hitTarget.kind === 'blank') {
      return {kind: 'create-note'};
    }

    return {kind: 'ignore'};
  }

  if (input.device === 'pen') {
    return input.phase === 'change' || input.phase === 'end' ? {kind: 'draw'} : {kind: 'ignore'};
  }

  if (input.touchCount >= MULTI_TOUCH_THRESHOLD) {
    return resolveMultiTouchIntent(input, options);
  }

  if (input.modifiers.spaceKey && input.buttons === PRIMARY_BUTTON_BITMASK) {
    return {
      kind: 'pan',
      source: 'space',
      phase: input.phase,
      deltaX: input.deltaX ?? input.movementX,
      deltaY: input.deltaY ?? input.movementY,
      velocityX: input.velocityX,
      velocityY: input.velocityY,
    };
  }

  if (input.buttons === AUXILIARY_BUTTON_BITMASK || input.buttons === SECONDARY_BUTTON_BITMASK) {
    return {
      kind: 'pan',
      source: 'button',
      phase: input.phase,
      deltaX: input.deltaX ?? input.movementX,
      deltaY: input.deltaY ?? input.movementY,
      velocityX: input.velocityX,
      velocityY: input.velocityY,
    };
  }

  if (input.hitTarget.kind === 'handle' && input.buttons === PRIMARY_BUTTON_BITMASK) {
    return input.phase === 'change' ? {kind: 'resize', mode: input.hitTarget.handleMode ?? 'resize'} : {kind: 'ignore'};
  }

  if (input.hitTarget.kind === 'connection-point' && input.buttons === PRIMARY_BUTTON_BITMASK) {
    return input.phase === 'change' ? {kind: 'connect'} : {kind: 'ignore'};
  }

  if (input.hitTarget.kind === 'object') {
    if (input.phase === 'change') {
      return {kind: 'move', duplicate: input.modifiers.ctrlKey};
    }

    if (input.phase === 'end' && isTapLike(input, options)) {
      return resolveObjectTapIntent(input);
    }
  }

  if (input.hitTarget.kind === 'blank') {
    if (input.phase === 'change' && input.device === 'mouse') {
      return {kind: 'marquee', pointer: 'mouse'};
    }

    if (input.phase === 'change' && input.device === 'touch' && input.activeTool === 'lasso') {
      return {kind: 'marquee', pointer: 'touch'};
    }

    if (input.phase === 'end' && isTapLike(input, options)) {
      return {kind: 'select', mode: 'clear'};
    }
  }

  return {kind: 'ignore'};
}

export class InputIntentResolver {
  constructor(private readonly options: InputIntentResolverOptions = DEFAULT_INPUT_INTENT_RESOLVER_OPTIONS) {}

  resolve(input: CanvasInput): CanvasIntent {
    return resolveCanvasIntent(input, this.options);
  }
}

export interface CanvasInputControllerOptions {
  resolver?: InputIntentResolver;
  onIntent: (intent: CanvasIntent, event: Event) => void;
  // ジェスチャの開始時に呼ばれる（ドラッグ／ピンチいずれも最初のポインタイベント）。
  // 終端 intent は入力状態次第で届かない（Space を先に離す・pointercancel）ため、
  // 「ジェスチャ単位で1回だけ」を成立させる境界はこの開始側に置く必要がある。
  onGestureStart?: () => void;
  // ジェスチャの正常終了。onGestureStart と対で発火する（キャンセル時は onGestureCancel）。
  onGestureEnd?: () => void;
  // ジェスチャが intent を出さずに打ち切られたときに呼ばれる（pointercancel / detach）。
  // 終端 intent を前提にセッション状態を持つ呼び出し側が、それを破棄するための口。
  onGestureCancel?: () => void;
  getSelection?: () => readonly string[];
  getActiveTool?: () => 'default' | 'lasso';
}

export class CanvasInputController {
  private readonly resolver: InputIntentResolver;
  private readonly onIntent: (intent: CanvasIntent, event: Event) => void;
  private readonly onGestureStart: () => void;
  private readonly onGestureEnd: () => void;
  private readonly onGestureCancel: () => void;
  private readonly getSelection: () => readonly string[];
  private readonly getActiveTool: () => 'default' | 'lasso';
  private target: EventTarget | null = null;
  private dragRecognizer: {destroy(): void} | null = null;
  private pinchRecognizer: {destroy(): void} | null = null;
  private pinchPrevVelocityX = 0;
  private pinchPrevVelocityY = 0;
  private pinchPrevMoveTime: number | null = null;
  private readonly wheelListener = (event: Event) => {
    const wheelEvent = event as WheelEvent;
    const intent = this.resolver.resolve({
      kind: 'wheel',
      phase: 'wheel',
      deltaX: wheelEvent.deltaX,
      deltaY: wheelEvent.deltaY,
      hitTarget: resolveHitTargetFromElement(wheelEvent.target as Element | null),
      modifiers: this.readModifiers(wheelEvent),
      selection: this.readSelection(),
    });

    if (intent.kind !== 'ignore') {
      wheelEvent.preventDefault();
      this.onIntent(intent, wheelEvent);
    }
  };
  private readonly contextMenuListener = (event: Event) => {
    const intent = this.resolver.resolve({
      kind: 'pointer',
      phase: 'contextmenu',
      device: 'mouse',
      buttons: 2,
      touchCount: 0,
      movementX: 0,
      movementY: 0,
      elapsedTimeMs: 0,
      hitTarget: resolveHitTargetFromElement(event.target as Element | null),
      modifiers: this.readModifiers(event as MouseEvent),
      selection: this.readSelection(),
    });

    if (intent.kind !== 'ignore') {
      event.preventDefault();
      this.onIntent(intent, event);
    }
  };
  private readonly dblClickListener = (event: Event) => {
    const intent = this.resolver.resolve({
      kind: 'pointer',
      phase: 'dblclick',
      device: 'mouse',
      buttons: 1,
      touchCount: 0,
      movementX: 0,
      movementY: 0,
      elapsedTimeMs: 0,
      hitTarget: resolveHitTargetFromElement(event.target as Element | null),
      modifiers: this.readModifiers(event as MouseEvent),
      selection: this.readSelection(),
    });

    if (intent.kind !== 'ignore') {
      event.preventDefault();
      this.onIntent(intent, event);
    }
  };
  private readonly keyDownListener = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== ' ' || isInteractiveTarget(keyboardEvent.target as Element | null)) {
      return;
    }

    keyboardEvent.preventDefault();
    this.spacePressed = true;
  };
  private readonly keyUpListener = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== ' ') {
      return;
    }

    // 解除はターゲットを問わず行う。押下後にフォーカスが移ってから離された場合に
    // ここで打ち切ると、パンモードが立ったまま残り以降のドラッグが全てパンになる。
    this.spacePressed = false;

    if (!isInteractiveTarget(keyboardEvent.target as Element | null)) {
      keyboardEvent.preventDefault();
    }
  };
  private readonly releaseSpaceListener = () => {
    this.spacePressed = false;
  };
  private readonly handleDragState = (state: DragGestureState) => {
    const event = state.event as PointerEvent;
    if (!event) {
      return;
    }

    if (event.type === 'pointercancel' || state.canceled) {
      this.resetLongPress();
      this.dragButtons = 0;
      this.dragPanApplied = false;
      this.onGestureCancel();
      return;
    }

    if (state.first) {
      this.dragButtons = state.buttons;
      this.dragPanApplied = false;
      this.onGestureStart();
    }

    const pointerInput = this.buildPointerInput(state, event, state.last ? 'end' : state.first ? 'start' : 'change');
    if (state.first) {
      this.resetLongPress();
      this.armLongPress(pointerInput, event);
    }

    // 終端の通知は intent の解決より先に出す。以降の分岐は longpress や
    // マルチタッチで早期 return するため、ここを通さないと取りこぼす。
    if (state.last) {
      this.onGestureEnd();
    }

    if (state.touches > MAX_SUPPORTED_TOUCH_COUNT) {
      this.resetLongPress();
      this.dragButtons = 0;
      return;
    }

    if (this.longPressTriggered) {
      if (state.last) {
        this.resetLongPress();
        this.dragButtons = 0;
        this.dragPanApplied = false;
      }
      return;
    }

    if (state.last) {
      this.clearLongPressTimer();
      this.dragButtons = 0;
      this.dragPanApplied = false;
      if (state.touches >= MULTI_TOUCH_THRESHOLD) {
        return;
      }
      const intent = this.resolver.resolve(pointerInput);
      if (event.button === PRIMARY_BUTTON_INDEX && Math.hypot(pointerInput.movementX, pointerInput.movementY) <= this.resolverOptions.clickThresholdPx) {
        this.emitIntent(intent, event);
      } else {
        if (intent.kind === 'pan' || intent.kind === 'move' || intent.kind === 'resize' || intent.kind === 'marquee' || intent.kind === 'connect') {
          this.emitIntent(intent, event);
        }
      }

      return;
    }

    if (state.touches >= MULTI_TOUCH_THRESHOLD) {
      // 2本指はピンチ側が処理する。ここで解除しないと長押しが発火し、以降の
      // handleDragState が longPressTriggered で素通りして入力が固まる。
      this.clearLongPressTimer();
      return;
    }

    if (Math.hypot(pointerInput.movementX, pointerInput.movementY) > this.resolverOptions.clickThresholdPx) {
      this.clearLongPressTimer();
      const intent = this.resolver.resolve(pointerInput);
      this.emitIntent(intent, event);
      this.dragPanApplied = true;
    }
  };
  private readonly handlePinchState = (state: PinchGestureState) => {
    const event = state.event as PointerEvent;
    if (!event) {
      return;
    }

    if (event.type === 'pointercancel' || state.canceled) {
      this.pinchBaseDistance = null;
      this.prevPinchDistance = null;
      this.pinchPrevOrigin = null;
      this.pinchPrevTime = null;
      this.pinchStartTouchCount = null;
      this.pinchZoomApplied = false;
      this.pinchPrevVelocityX = 0;
      this.pinchPrevVelocityY = 0;
      this.pinchPrevMoveTime = null;
      this.onGestureCancel();
      return;
    }

    if (state.first) {
      // 2本目の指が触れた時点で長押しは成立しない。ドラッグ側は1本目の指しか
      // 追わないため、ここで解除しないと保留中のタイマーが発火してしまう。
      this.clearLongPressTimer();
      this.pinchBaseDistance = state.da[0];
      this.prevPinchDistance = state.da[0];
      this.pinchPrevOrigin = state.origin;
      this.pinchPrevTime = state.elapsedTime;
      this.pinchStartTouchCount = state.touches;
      this.pinchZoomApplied = false;
      this.pinchPrevVelocityX = 0;
      this.pinchPrevVelocityY = 0;
      this.pinchPrevMoveTime = null;
      this.onGestureStart();
    }

    // ピンチの終端は2本目の指が離れた時点。1本目のドラッグが続くことがあるため、
    // 呼び出し側は「開始と終了の対」で数える必要がある（片方だけでは判定できない）。
    if (state.last) {
      this.onGestureEnd();
    }

    const pinchDistance = state.da[0];
    const pinchDistanceDeltaPx = this.pinchBaseDistance == null ? 0 : pinchDistance - this.pinchBaseDistance;
    const currentDistanceDeltaPx = this.prevPinchDistance == null ? 0 : Math.abs(pinchDistance - this.prevPinchDistance);
    
    let pinchDeltaPx = 0;
    let pinchScale = 1;
    const isZoomActive = this.pinchZoomApplied || (Math.abs(pinchDistanceDeltaPx) > this.resolverOptions.pinchThresholdPx);

    if (isZoomActive) {
      // 最初のズームフレームは開始時の距離、以降は前フレームの距離が基準になる。
      const referenceDistance = this.pinchZoomApplied
        ? (this.prevPinchDistance ?? pinchDistance)
        : (this.pinchBaseDistance ?? pinchDistance);
      pinchDeltaPx = pinchDistance - referenceDistance;
      // 2点が完全に重なると距離が 0 になり、倍率 0＝ズームの消失を意味してしまう。
      // ユーザーがそう意図することはあり得ないので、そのフレームは倍率を変えない。
      pinchScale = referenceDistance > 0 && pinchDistance > 0 ? pinchDistance / referenceDistance : 1;
      this.pinchZoomApplied = true;
      // 距離 0 は基準として保存しない。保存すると次に指が離れたフレームでも
      // referenceDistance が 0 のままとなり、その動きまで取りこぼす。
      // 直前の正の距離を保持しておけば、離した瞬間からそのまま追従が再開する。
      this.prevPinchDistance = state.last
        ? null
        : (pinchDistance > 0 ? pinchDistance : this.prevPinchDistance);
    } else {
      pinchDeltaPx = 0;
      if (!this.pinchZoomApplied) {
        this.prevPinchDistance = this.pinchBaseDistance;
      }
    }

    const origin = state.origin;
    const time = state.elapsedTime;
    const pinchDeltaX = this.pinchPrevOrigin == null ? 0 : origin[0] - this.pinchPrevOrigin[0];
    const pinchDeltaY = this.pinchPrevOrigin == null ? 0 : origin[1] - this.pinchPrevOrigin[1];

    // 二本指パン・ズーム時の慣性のために、指の中心（origin）の移動速度を計算する。
    let velocityX = 0;
    let velocityY = 0;

    const deltaTime = this.pinchPrevTime != null ? time - this.pinchPrevTime : 0;
    if (deltaTime > 0 && (pinchDeltaX !== 0 || pinchDeltaY !== 0)) {
      velocityX = (pinchDeltaX / deltaTime) * MS_PER_FRAME;
      velocityY = (pinchDeltaY / deltaTime) * MS_PER_FRAME;

      const centerDelta = Math.hypot(pinchDeltaX, pinchDeltaY);
      const isZooming = isZoomActive && currentDistanceDeltaPx > 0.5 && centerDelta < currentDistanceDeltaPx * 0.75;

      // 方向が反転した（正負が逆になった）場合は、対称ピンチによる一時的な中心の揺れを防ぐため、
      // このフレームの出力速度は 0 に抑える。さらに、ズーム中の場合は対称ピンチのブレとみなして
      // 速度キャッシュも 0 にリセットするが、ズーム中でないパンの反転は実際の切り返しとみなして
      // キャッシュは反転後の速度で更新し、リリース時の慣性に備える。
      if (velocityX * this.pinchPrevVelocityX < 0) {
        this.pinchPrevVelocityX = isZooming ? 0 : velocityX;
        velocityX = 0;
      } else {
        this.pinchPrevVelocityX = velocityX;
      }

      if (velocityY * this.pinchPrevVelocityY < 0) {
        this.pinchPrevVelocityY = isZooming ? 0 : velocityY;
        velocityY = 0;
      } else {
        this.pinchPrevVelocityY = velocityY;
      }

      this.pinchPrevMoveTime = time;
    } else if (deltaTime === 0 && (pinchDeltaX !== 0 || pinchDeltaY !== 0)) {
      // タイムスタンプが進まない環境（テスト時など）用
      velocityX = pinchDeltaX;
      velocityY = pinchDeltaY;

      const centerDelta = Math.hypot(pinchDeltaX, pinchDeltaY);
      const isZooming = isZoomActive && currentDistanceDeltaPx > 0.5 && centerDelta < currentDistanceDeltaPx * 0.75;

      if (velocityX * this.pinchPrevVelocityX < 0) {
        this.pinchPrevVelocityX = isZooming ? 0 : velocityX;
        velocityX = 0;
      } else {
        this.pinchPrevVelocityX = velocityX;
      }

      if (velocityY * this.pinchPrevVelocityY < 0) {
        this.pinchPrevVelocityY = isZooming ? 0 : velocityY;
        velocityY = 0;
      } else {
        this.pinchPrevVelocityY = velocityY;
      }

      this.pinchPrevMoveTime = time;
    } else if (state.last && pinchDeltaX === 0 && pinchDeltaY === 0) {
      const timeSinceLastMove = this.pinchPrevMoveTime != null ? time - this.pinchPrevMoveTime : Infinity;
      if (timeSinceLastMove <= INERTIA_TIMEOUT_MS) {
        velocityX = this.pinchPrevVelocityX;
        velocityY = this.pinchPrevVelocityY;
      } else {
        velocityX = 0;
        velocityY = 0;
      }
    } else {
      // ジェスチャ途中の静止フレーム（変位が 0）
      velocityX = 0;
      velocityY = 0;
      // 経過時間がタイムアウトを超えた場合のみキャッシュを消去し、短い静止フレームではクリアしない
      const timeSinceLastMove = this.pinchPrevMoveTime != null ? time - this.pinchPrevMoveTime : Infinity;
      if (timeSinceLastMove > INERTIA_TIMEOUT_MS) {
        this.pinchPrevVelocityX = 0;
        this.pinchPrevVelocityY = 0;
      }
    }

    const touchCount = this.pinchStartTouchCount ?? state.touches;

    this.pinchPrevOrigin = state.last ? null : origin;
    this.pinchPrevTime = state.last ? null : time;

    const baseInput = {
      kind: 'pointer' as const,
      phase: state.last ? ('end' as const) : ('change' as const),
      device: 'touch' as const,
      buttons: 1,
      touchCount,
      movementX: state.movement[0],
      movementY: state.movement[1],
      deltaX: pinchDeltaX,
      deltaY: pinchDeltaY,
      velocityX,
      velocityY,
      elapsedTimeMs: state.elapsedTime,
      hitTarget: resolveHitTargetFromElement(event.target as Element | null),
      modifiers: this.readModifiers(event),
      selection: this.readSelection(),
      activeTool: this.getActiveTool(),
      pinchDistanceDeltaPx,
      pinchDeltaPx,
      pinchScale,
      pinchCenterX: state.origin[0],
      pinchCenterY: state.origin[1],
    };

    const intent = this.resolver.resolve({
      ...baseInput,
      pinchZoomApplied: this.pinchZoomApplied,
    });

    if (intent.kind !== 'ignore') {
      this.onIntent(intent, event);
    }

    if (state.last) {
      this.pinchBaseDistance = null;
      this.prevPinchDistance = null;
      this.pinchPrevOrigin = null;
      this.pinchPrevTime = null;
      this.pinchStartTouchCount = null;
      this.pinchZoomApplied = false;
      this.pinchPrevVelocityX = 0;
      this.pinchPrevVelocityY = 0;
      this.pinchPrevMoveTime = null;
    }
  };
  private readonly resolverOptions = DEFAULT_INPUT_INTENT_RESOLVER_OPTIONS;
  private attachSession = 0;
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private longPressArmed: PointerInput | null = null;
  private longPressTriggered = false;
  private pinchBaseDistance: number | null = null;
  private prevPinchDistance: number | null = null;
  private pinchPrevOrigin: [number, number] | null = null;
  private pinchPrevTime: number | null = null;
  private pinchStartTouchCount: number | null = null;
  private pinchZoomApplied = false;
  private dragPanApplied = false;
  private spacePressed = false;
  private dragButtons = 0;

  constructor(options: CanvasInputControllerOptions = {onIntent: () => {}}) {
    this.resolver = options.resolver ?? new InputIntentResolver();
    this.onIntent = options.onIntent;
    this.onGestureStart = options.onGestureStart ?? (() => {});
    this.onGestureEnd = options.onGestureEnd ?? (() => {});
    this.onGestureCancel = options.onGestureCancel ?? (() => {});
    this.getSelection = options.getSelection ?? (() => []);
    this.getActiveTool = options.getActiveTool ?? (() => 'default');
  }

  async attach(target: EventTarget): Promise<void> {
    this.detach();
    const sessionId = ++this.attachSession;

    const {DragGesture, PinchGesture} = await loadGestureModule();
    if (this.attachSession !== sessionId) {
      return;
    }

    this.target = target;
    this.dragRecognizer = new DragGesture(target, this.handleDragState, {pointer: {buttons: -1, capture: true, keys: false}});
    this.pinchRecognizer = new PinchGesture(target, this.handlePinchState, {});

    target.addEventListener('wheel', this.wheelListener, {passive: false});
    target.addEventListener('contextmenu', this.contextMenuListener);
    target.addEventListener('dblclick', this.dblClickListener);

    if (typeof window !== 'undefined') {
      // キーは window で拾う。キャンバスは tabIndex を持たずフォーカスを得られないため、
      // 要素に束縛すると Space が一度も届かず、Space+ドラッグのパンが成立しない。
      window.addEventListener('keydown', this.keyDownListener);
      window.addEventListener('keyup', this.keyUpListener);
      window.addEventListener('blur', this.releaseSpaceListener);
      document.addEventListener('visibilitychange', this.releaseSpaceListener);
    }
  }

  detach(): void {
    this.attachSession++;
    this.dragRecognizer?.destroy();
    this.pinchRecognizer?.destroy();
    this.dragRecognizer = null;
    this.pinchRecognizer = null;

    if (this.target) {
      this.target.removeEventListener('wheel', this.wheelListener);
      this.target.removeEventListener('contextmenu', this.contextMenuListener);
      this.target.removeEventListener('dblclick', this.dblClickListener);
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyDownListener);
      window.removeEventListener('keyup', this.keyUpListener);
      window.removeEventListener('blur', this.releaseSpaceListener);
      document.removeEventListener('visibilitychange', this.releaseSpaceListener);
    }

    this.target = null;
    this.resetLongPress();
    this.pinchBaseDistance = null;
    this.prevPinchDistance = null;
    this.pinchPrevOrigin = null;
    this.pinchPrevTime = null;
    this.pinchStartTouchCount = null;
    this.pinchZoomApplied = false;
    this.pinchPrevVelocityX = 0;
    this.pinchPrevVelocityY = 0;
    this.pinchPrevMoveTime = null;
    this.dragPanApplied = false;
    this.dragButtons = 0;
    this.spacePressed = false;
    // 進行中のジェスチャは終端 intent を出さずに失われるため、キャンセルとして通知する。
    this.onGestureCancel();
  }

  private emitIntent(intent: CanvasIntent, event: Event): void {
    if (intent.kind !== 'ignore') {
      this.onIntent(intent, event);
    }
  }

  private buildPointerInput(state: DragGestureState, event: PointerEvent, phase: InputPhase): PointerInput {
    const dirX = state.direction?.[0] ?? 0;
    const dirY = state.direction?.[1] ?? 0;
    const vx = state.velocity?.[0] ?? 0;
    const vy = state.velocity?.[1] ?? 0;

    const isFirstPanFrame = !this.dragPanApplied && Math.hypot(state.movement[0], state.movement[1]) > this.resolverOptions.clickThresholdPx;
    const deltaX = isFirstPanFrame ? state.movement[0] : state.delta[0];
    const deltaY = isFirstPanFrame ? state.movement[1] : state.delta[1];

    return {
      kind: 'pointer',
      phase,
      device: (event.pointerType === 'pen' ? 'pen' : event.pointerType === 'touch' ? 'touch' : 'mouse') as PointerInput['device'],
      // pointerup では event.buttons が 0 になるため、ドラッグとして成立した
      // ジェスチャに限り開始時のボタンを引き継ぐ。移動を伴わない単なる右/中クリックで
      // 引き継ぐと、押していないボタンでのパンとして解決されてしまう。
      // 判定には「一度でも閾値を超えたか」(dragPanApplied) を使う。解放位置だけを
      // 見ると、往復して開始点付近へ戻したドラッグで終端と慣性が失われる。
      buttons: phase === 'end' && (this.dragPanApplied || this.hasMovedBeyondClickThreshold(state))
        ? this.dragButtons
        : (event.buttons ?? state.buttons),
      touchCount: state.touches,
      movementX: state.movement[0],
      movementY: state.movement[1],
      deltaX,
      deltaY,
      velocityX: vx * dirX * MS_PER_FRAME,
      velocityY: vy * dirY * MS_PER_FRAME,
      elapsedTimeMs: state.elapsedTime,
      hitTarget: resolveHitTargetFromElement(event.target as Element | null),
      modifiers: this.readModifiers(event),
      selection: this.readSelection(),
      palmContactAreaPx2: readContactAreaPx2(event),
      activeTool: this.getActiveTool(),
    };
  }

  private hasMovedBeyondClickThreshold(state: DragGestureState): boolean {
    return Math.hypot(state.movement[0], state.movement[1]) > this.resolverOptions.clickThresholdPx;
  }

  private armLongPress(pointerInput: PointerInput, event: PointerEvent): void {
    if (!isLongPressArmable(pointerInput)) {
      return;
    }

    this.longPressArmed = pointerInput;
    this.longPressTimeout = setTimeout(() => {
      if (!this.longPressArmed) {
        return;
      }

      const intent = this.resolver.resolve({
        ...this.longPressArmed,
        phase: 'longpress',
        elapsedTimeMs: this.resolverOptions.longPressDelayMs,
      });
      this.longPressTriggered = true;
      this.clearLongPressTimer();
      this.emitIntent(intent, event);
    }, this.resolverOptions.longPressDelayMs);
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
    }
    this.longPressTimeout = null;
    this.longPressArmed = null;
  }

  private resetLongPress(): void {
    this.clearLongPressTimer();
    this.longPressTriggered = false;
  }

  private readModifiers(event: {shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; key?: string}): InputModifiers {
    return {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      spaceKey: this.spacePressed || event.key === ' ',
    };
  }

  private readSelection(): SelectionSnapshot {
    return {selectedIds: this.getSelection()};
  }
}

function resolveWheelIntent(input: WheelInput): CanvasIntent {
  if (input.modifiers.ctrlKey) {
    return {kind: 'zoom', source: 'wheel', amount: input.deltaY, precision: true};
  }

  if (input.modifiers.shiftKey) {
    // shift+ホイールは横スクロールを意味する。ブラウザは多くの場合ノッチを deltaX へ
    // 付け替えて報告するが、付け替えない実装もある。トラックパッドは両軸に値を乗せて
    // 報告するため、絶対値の大きい方＝ユーザーが意図した主軸を横パンへ回す。
    const horizontalDelta = Math.abs(input.deltaX) >= Math.abs(input.deltaY) ? input.deltaX : input.deltaY;
    return {
      kind: 'pan',
      source: 'wheel',
      deltaX: horizontalDelta,
      deltaY: 0,
    };
  }

  return {kind: 'zoom', source: 'wheel', amount: input.deltaY, precision: false};
}

function resolveMultiTouchIntent(input: PointerInput, options: InputIntentResolverOptions): CanvasIntent {
  const isZooming = input.pinchZoomApplied || (input.pinchDistanceDeltaPx != null && Math.abs(input.pinchDistanceDeltaPx) > options.pinchThresholdPx);
  if (isZooming) {
    return {
      kind: 'zoom',
      source: 'pinch',
      amount: input.pinchDeltaPx ?? input.pinchDistanceDeltaPx ?? 0,
      scale: input.pinchScale,
      precision: false,
      centerX: input.pinchCenterX,
      centerY: input.pinchCenterY,
      phase: input.phase,
      panDeltaX: input.deltaX ?? input.movementX,
      panDeltaY: input.deltaY ?? input.movementY,
      velocityX: input.velocityX,
      velocityY: input.velocityY,
    };
  }

  return {
    kind: 'pan',
    source: 'touch',
    phase: input.phase,
    deltaX: input.deltaX ?? input.movementX,
    deltaY: input.deltaY ?? input.movementY,
    velocityX: input.velocityX,
    velocityY: input.velocityY,
  };
}

function resolveObjectTapIntent(input: PointerInput): CanvasIntent {
  const selected = input.selection.selectedIds.includes(input.hitTarget.objectId ?? '');

  if (input.modifiers.shiftKey) {
    return {kind: 'select', mode: selected ? 'remove' : 'add'};
  }

  return {kind: 'select', mode: 'replace'};
}

function isTapLike(input: PointerInput, options: InputIntentResolverOptions): boolean {
  return Math.hypot(input.movementX, input.movementY) <= options.clickThresholdPx;
}

function isPalmContact(input: PointerInput, options: InputIntentResolverOptions): boolean {
  return input.palmContactAreaPx2 != null && input.palmContactAreaPx2 >= options.palmContactAreaThresholdPx;
}

function isLongPressEligible(input: PointerInput, options: InputIntentResolverOptions): boolean {
  return isLongPressArmable(input) && Math.hypot(input.movementX, input.movementY) <= options.longPressMovementThresholdPx;
}

function isLongPressArmable(input: PointerInput): boolean {
  return input.device !== 'pen' && input.buttons === PRIMARY_BUTTON_BITMASK;
}

function readAttribute(element: HTMLElement, name: string): string | null {
  return element.getAttribute(name);
}

function readBooleanAttribute(element: HTMLElement, name: string): boolean | undefined {
  const value = readAttribute(element, name);
  if (value == null) {
    return undefined;
  }

  return value === '' || value === 'true' || value === '1';
}

function readContactAreaPx2(event: PointerEvent): number | undefined {
  const width = Number((event as PointerEvent & {width?: number}).width ?? 0);
  const height = Number((event as PointerEvent & {height?: number}).height ?? 0);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  return width * height;
}

let gestureModulePromise: Promise<UseGestureModule> | null = null;

async function loadGestureModule(): Promise<UseGestureModule> {
  gestureModulePromise ??= import('@use-gesture/vanilla');
  return gestureModulePromise;
}
