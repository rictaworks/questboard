type UseGestureModule = typeof import('@use-gesture/vanilla');

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
  elapsedTimeMs: number;
  hitTarget: HitTarget;
  modifiers: InputModifiers;
  selection: SelectionSnapshot;
  palmContactAreaPx2?: number;
  activeTool?: 'default' | 'lasso';
  pinchDistanceDeltaPx?: number;
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
  | {kind: 'zoom'; source: 'wheel' | 'pinch'; amount: number; precision: boolean}
  | {kind: 'pan'; source: 'wheel' | 'space' | 'button' | 'touch'; deltaX: number; deltaY: number}
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

  if (input.touchCount >= 2) {
    return resolveMultiTouchIntent(input, options);
  }

  if (input.modifiers.spaceKey && input.buttons === 1) {
    return {kind: 'pan', source: 'space', deltaX: input.movementX, deltaY: input.movementY};
  }

  if (input.buttons === 4 || input.buttons === 2) {
    return {kind: 'pan', source: 'button', deltaX: input.movementX, deltaY: input.movementY};
  }

  if (input.hitTarget.kind === 'handle' && input.buttons === 1) {
    return input.phase === 'change' ? {kind: 'resize', mode: input.hitTarget.handleMode ?? 'resize'} : {kind: 'ignore'};
  }

  if (input.hitTarget.kind === 'connection-point' && input.buttons === 1) {
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
  getSelection?: () => readonly string[];
  getActiveTool?: () => 'default' | 'lasso';
}

export class CanvasInputController {
  private readonly resolver: InputIntentResolver;
  private readonly onIntent: (intent: CanvasIntent, event: Event) => void;
  private readonly getSelection: () => readonly string[];
  private readonly getActiveTool: () => 'default' | 'lasso';
  private target: EventTarget | null = null;
  private dragRecognizer: {destroy(): void} | null = null;
  private pinchRecognizer: {destroy(): void} | null = null;
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
    if (keyboardEvent.key !== ' ') {
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

    keyboardEvent.preventDefault();
    this.spacePressed = false;
  };
  private readonly handleDragState = (state: any) => {
    const event = state.event as PointerEvent | undefined;
    if (!event) {
      return;
    }

    if (event.type === 'pointercancel' || state.canceled) {
      this.resetLongPress();
      return;
    }

    const pointerInput = this.buildPointerInput(state, event, state.last ? 'end' : state.first ? 'start' : 'change');
    if (state.first) {
      this.resetLongPress();
      this.armLongPress(pointerInput, event);
    }

    if (state.touches > 2) {
      this.resetLongPress();
      return;
    }

    if (this.longPressTriggered) {
      if (state.last) {
        this.resetLongPress();
      }
      return;
    }

    if (state.last) {
      this.clearLongPressTimer();
      if (event.button === 0 && Math.hypot(pointerInput.movementX, pointerInput.movementY) <= this.resolverOptions.clickThresholdPx) {
        const intent = this.resolver.resolve(pointerInput);
        this.emitIntent(intent, event);
      }

      return;
    }

    if (Math.hypot(pointerInput.movementX, pointerInput.movementY) > this.resolverOptions.clickThresholdPx) {
      this.clearLongPressTimer();
      const intent = this.resolver.resolve(pointerInput);
      this.emitIntent(intent, event);
    }
  };
  private readonly handlePinchState = (state: any) => {
    const event = state.event as PointerEvent | undefined;
    if (!event) {
      return;
    }

    if (event.type === 'pointercancel' || state.canceled) {
      this.pinchBaseDistance = null;
      return;
    }

    if (state.first) {
      this.pinchBaseDistance = state.da?.[0] ?? null;
    }

    const pinchDistance = state.da?.[0];
    const pinchDistanceDeltaPx = this.pinchBaseDistance == null || pinchDistance == null ? 0 : pinchDistance - this.pinchBaseDistance;
    const intent = this.resolver.resolve({
      kind: 'pointer',
      phase: state.last ? 'end' : 'change',
      device: 'touch',
      buttons: 1,
      touchCount: state.touches ?? 2,
      movementX: state.movement?.[0] ?? 0,
      movementY: state.movement?.[1] ?? 0,
      elapsedTimeMs: state.elapsedTime ?? 0,
      hitTarget: resolveHitTargetFromElement(event.target as Element | null),
      modifiers: this.readModifiers(event as MouseEvent),
      selection: this.readSelection(),
      activeTool: this.getActiveTool(),
      pinchDistanceDeltaPx,
    });

    if (intent.kind !== 'ignore') {
      this.onIntent(intent, event);
    }

    if (state.last) {
      this.pinchBaseDistance = null;
    }
  };
  private readonly resolverOptions = DEFAULT_INPUT_INTENT_RESOLVER_OPTIONS;
  private attachSession = 0;
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private longPressArmed: PointerInput | null = null;
  private longPressTriggered = false;
  private pinchBaseDistance: number | null = null;
  private spacePressed = false;

  constructor(options: CanvasInputControllerOptions = {onIntent: () => {}}) {
    this.resolver = options.resolver ?? new InputIntentResolver();
    this.onIntent = options.onIntent;
    this.getSelection = options.getSelection ?? (() => []);
    this.getActiveTool = options.getActiveTool ?? (() => 'default');
  }

  async attach(target: EventTarget): Promise<void> {
    this.detach();
    const sessionId = ++this.attachSession;
    this.ensureGestureEnvironment();

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
    target.addEventListener('keydown', this.keyDownListener);
    target.addEventListener('keyup', this.keyUpListener);
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
      this.target.removeEventListener('keydown', this.keyDownListener);
      this.target.removeEventListener('keyup', this.keyUpListener);
    }

    this.target = null;
    this.resetLongPress();
    this.pinchBaseDistance = null;
    this.spacePressed = false;
  }

  private emitIntent(intent: CanvasIntent, event: Event): void {
    if (intent.kind !== 'ignore') {
      this.onIntent(intent, event);
    }
  }

  private buildPointerInput(state: any, event: PointerEvent, phase: InputPhase): PointerInput {
    return {
      kind: 'pointer',
      phase,
      device: (event.pointerType === 'pen' ? 'pen' : event.pointerType === 'touch' ? 'touch' : 'mouse') as PointerInput['device'],
      buttons: event.buttons ?? state.buttons ?? 0,
      touchCount: state.touches ?? 0,
      movementX: state.movement?.[0] ?? 0,
      movementY: state.movement?.[1] ?? 0,
      elapsedTimeMs: state.elapsedTime ?? 0,
      hitTarget: resolveHitTargetFromElement(event.target as Element | null),
      modifiers: this.readModifiers(event),
      selection: this.readSelection(),
      palmContactAreaPx2: readContactAreaPx2(event),
      activeTool: this.getActiveTool(),
      pinchDistanceDeltaPx: state.da ? state.da[0] : undefined,
    };
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

  private ensureGestureEnvironment(): void {
    const root = globalThis as typeof globalThis & {
      window?: any;
      document?: any;
      HTMLElement?: typeof HTMLElement;
    };

    if (typeof root.window === 'undefined') {
      const fakeDocument = {
        createElement() {
          return {};
        },
        pointerLockElement: null,
        exitPointerLock() {},
      };

      root.window = {
        document: fakeDocument,
        navigator: {maxTouchPoints: 0},
        onpointerdown: null,
        ontouchstart: null,
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      };
    }

    if (typeof root.document === 'undefined') {
      root.document = root.window.document;
    }

    if (typeof root.HTMLElement === 'undefined') {
      root.HTMLElement = class GestureHTMLElement extends EventTarget {
        setPointerCapture() {}
        releasePointerCapture() {}
        hasPointerCapture() {
          return false;
        }
      } as unknown as typeof HTMLElement;
    }
  }
}

function resolveWheelIntent(input: WheelInput): CanvasIntent {
  if (input.modifiers.ctrlKey) {
    return {kind: 'zoom', source: 'wheel', amount: input.deltaY, precision: true};
  }

  if (input.modifiers.shiftKey) {
    return {kind: 'pan', source: 'wheel', deltaX: input.deltaY, deltaY: input.deltaX};
  }

  return {kind: 'zoom', source: 'wheel', amount: input.deltaY, precision: false};
}

function resolveMultiTouchIntent(input: PointerInput, options: InputIntentResolverOptions): CanvasIntent {
  if (input.pinchDistanceDeltaPx != null && Math.abs(input.pinchDistanceDeltaPx) > options.pinchThresholdPx) {
    return {kind: 'zoom', source: 'pinch', amount: input.pinchDistanceDeltaPx, precision: false};
  }

  return {kind: 'pan', source: 'touch', deltaX: input.movementX, deltaY: input.movementY};
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
  return input.device !== 'pen' && input.buttons === 1;
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
