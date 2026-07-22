export type InputDevice = 'mouse' | 'touch' | 'pen';
export type InputButton = 'left' | 'middle' | 'right';
export type InputEventType = 'wheel' | 'click' | 'drag' | 'dblclick' | 'contextmenu' | 'keydown';

export type CanvasHitTarget =
  | {kind: 'blank'}
  | {kind: 'object'; objectId?: string; textEditable?: boolean}
  | {kind: 'handle'; objectId?: string}
  | {kind: 'connector'; objectId?: string};

export type CanvasSelectionState = {
  activeTool?: 'select' | 'lasso';
};

export type InputModifiers = {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  spaceKey?: boolean;
};

export type InputIntent =
  | {kind: 'zoom'; mode: 'standard' | 'precise'; axis: 'both' | 'horizontal'; deltaX?: number; deltaY?: number}
  | {kind: 'pan'; source: 'middle-button' | 'right-button' | 'space' | 'touch'; gesture: 'drag' | 'wheel'; deltaX?: number; deltaY?: number}
  | {kind: 'pinchZoom'; source: 'touch'}
  | {kind: 'radialMenu'; source: 'contextmenu' | 'longpress'}
  | {kind: 'resizeRotate'; objectId?: string}
  | {kind: 'connect'; objectId?: string}
  | {kind: 'select'; mode: 'replace' | 'toggle'; objectId?: string}
  | {kind: 'move'; duplicate: boolean; objectId?: string}
  | {kind: 'clearSelection'}
  | {kind: 'marquee'; tool: 'marquee' | 'lasso'}
  | {kind: 'createSticky'}
  | {kind: 'editText'; objectId?: string}
  | {kind: 'draw'}
  | {kind: 'ignore'; reason: string};

export type InputIntentInput = {
  eventType: InputEventType;
  device: InputDevice;
  button?: InputButton;
  touchCount?: number;
  modifiers?: InputModifiers;
  hitTarget?: CanvasHitTarget;
  movementPx?: number;
  pinchDistanceDeltaPx?: number;
  pressDurationMs?: number;
  currentSelection?: CanvasSelectionState;
  palmContactAreaPx?: number;
  deltaX?: number;
  deltaY?: number;
};

export type InputIntentResolverOptions = {
  longPressMs?: number;
  moveThresholdPx?: number;
  pinchThresholdPx?: number;
  palmAreaThresholdPx?: number;
};

export type CanvasEventSnapshot = {
  kind: InputEventType;
  device: InputDevice;
  button?: InputButton;
  touchCount?: number;
  modifiers?: InputModifiers;
  hitTarget?: CanvasHitTarget;
  movementPx?: number;
  pinchDistanceDeltaPx?: number;
  pressDurationMs?: number;
  currentSelection?: CanvasSelectionState;
  palmContactAreaPx?: number;
  deltaX?: number;
  deltaY?: number;
};

const defaultOptions = {
  longPressMs: 500,
  moveThresholdPx: 8,
  pinchThresholdPx: 12,
  palmAreaThresholdPx: 1000,
} satisfies Required<InputIntentResolverOptions>;

export class InputIntentResolver {
  readonly longPressMs: number;
  readonly moveThresholdPx: number;
  readonly pinchThresholdPx: number;
  readonly palmAreaThresholdPx: number;

  constructor(options: InputIntentResolverOptions = {}) {
    this.longPressMs = options.longPressMs ?? defaultOptions.longPressMs;
    this.moveThresholdPx = options.moveThresholdPx ?? defaultOptions.moveThresholdPx;
    this.pinchThresholdPx = options.pinchThresholdPx ?? defaultOptions.pinchThresholdPx;
    this.palmAreaThresholdPx = options.palmAreaThresholdPx ?? defaultOptions.palmAreaThresholdPx;
  }

  resolve(input: InputIntentInput): InputIntent {
    const hitTarget = input.hitTarget ?? {kind: 'blank'};

    if (this.isPalm(input)) {
      return {kind: 'ignore', reason: 'palm'};
    }

    if (input.eventType === 'wheel') {
      return this.resolveWheel(input);
    }

    if (input.device === 'pen') {
      return {kind: 'draw'};
    }

    if (input.eventType === 'contextmenu') {
      return {kind: 'radialMenu', source: 'contextmenu'};
    }

    if (this.isLongPress(input)) {
      return {kind: 'radialMenu', source: 'longpress'};
    }

    if (input.eventType === 'drag' && input.touchCount === 2) {
      if (Math.abs(input.pinchDistanceDeltaPx ?? 0) > this.pinchThresholdPx) {
        return {kind: 'pinchZoom', source: 'touch'};
      }

      return {kind: 'pan', gesture: 'drag', source: 'touch'};
    }

    if (this.isPanGesture(input)) {
      return {
        kind: 'pan',
        gesture: 'drag',
        source: this.panSource(input)
      };
    }

    switch (hitTarget.kind) {
      case 'handle':
        if (input.eventType === 'drag' && input.button === 'left') {
          return {kind: 'resizeRotate', objectId: hitTarget.objectId};
        }
        break;
      case 'connector':
        if (input.eventType === 'drag' && input.button === 'left') {
          return {kind: 'connect', objectId: hitTarget.objectId};
        }
        break;
      case 'object':
        if (input.eventType === 'dblclick' && hitTarget.textEditable) {
          return {kind: 'editText', objectId: hitTarget.objectId};
        }

        if (input.eventType === 'click' && input.button === 'left') {
          return {
            kind: 'select',
            mode: input.modifiers?.shiftKey ? 'toggle' : 'replace',
            objectId: hitTarget.objectId
          };
        }

        if (input.eventType === 'drag' && input.button === 'left') {
          return {
            kind: 'move',
            duplicate: input.modifiers?.ctrlKey === true,
            objectId: hitTarget.objectId
          };
        }
        break;
      case 'blank':
        if (input.eventType === 'click' && input.button === 'left') {
          return {kind: 'clearSelection'};
        }

        if (input.eventType === 'drag' && input.button === 'left' && input.device === 'mouse') {
          return {kind: 'marquee', tool: 'marquee'};
        }

        if (
          input.eventType === 'drag'
          && input.device === 'touch'
          && input.currentSelection?.activeTool === 'lasso'
        ) {
          return {kind: 'marquee', tool: 'lasso'};
        }

        if (input.eventType === 'dblclick' && input.button === 'left') {
          return {kind: 'createSticky'};
        }
        break;
      default:
        break;
    }

    return {kind: 'ignore', reason: 'unhandled'};
  }

  private isLongPress(input: InputIntentInput): boolean {
    const pressDurationMs = input.pressDurationMs ?? 0;
    const movementPx = input.movementPx ?? 0;

    return pressDurationMs >= this.longPressMs
      && movementPx < this.moveThresholdPx
      && (input.button === 'left' || input.button === undefined)
      && input.touchCount !== 2;
  }

  private isPalm(input: InputIntentInput): boolean {
    const palmContactAreaPx = input.palmContactAreaPx ?? 0;
    return palmContactAreaPx > this.palmAreaThresholdPx;
  }

  private isPanGesture(input: InputIntentInput): boolean {
    if (input.eventType !== 'drag') {
      return false;
    }

    return input.button === 'middle'
      || input.button === 'right'
      || (input.button === 'left' && input.modifiers?.spaceKey === true);
  }

  private panSource(input: InputIntentInput): 'middle-button' | 'right-button' | 'space' | 'touch' {
    if (input.touchCount === 2) {
      return 'touch';
    }

    if (input.button === 'middle') {
      return 'middle-button';
    }

    if (input.button === 'right') {
      return 'right-button';
    }

    return 'space';
  }

  private resolveWheel(input: InputIntentInput): InputIntent {
    const deltaX = input.deltaX;
    const deltaY = input.deltaY;

    if (input.modifiers?.ctrlKey) {
      return {kind: 'zoom', mode: 'precise', axis: 'both', deltaX, deltaY};
    }

    if (input.modifiers?.shiftKey) {
      return {kind: 'pan', source: 'space', gesture: 'wheel', deltaX, deltaY};
    }

    return {kind: 'zoom', mode: 'standard', axis: 'both', deltaX, deltaY};
  }
}

export type ControllerState = 'idle' | 'pressing' | 'dragging' | 'radial_menu';

export function resolveCanvasIntent(snapshot: CanvasEventSnapshot, resolver = new InputIntentResolver()): InputIntent {
  return resolver.resolve({
    eventType: snapshot.kind,
    device: snapshot.device,
    button: snapshot.button,
    touchCount: snapshot.touchCount,
    modifiers: snapshot.modifiers,
    hitTarget: snapshot.hitTarget,
    movementPx: snapshot.movementPx,
    pinchDistanceDeltaPx: snapshot.pinchDistanceDeltaPx,
    pressDurationMs: snapshot.pressDurationMs,
    currentSelection: snapshot.currentSelection,
    palmContactAreaPx: snapshot.palmContactAreaPx,
    deltaX: snapshot.deltaX,
    deltaY: snapshot.deltaY
  });
}

export type InputIntentEventContext = {
  pointerId?: number;
  device?: InputDevice;
  button?: InputButton;
  startX?: number;
  startY?: number;
  currentX?: number;
  currentY?: number;
  deltaX?: number;
  deltaY?: number;
  movementPx?: number;
  pressDurationMs?: number;
  pinchDistanceDeltaPx?: number;
  centerX?: number;
  centerY?: number;
};

export type CanvasInputControllerOptions = {
  resolver?: InputIntentResolver;
  onIntent?: (intent: InputIntent, context: InputIntentEventContext) => void;
  getCurrentSelection?: () => CanvasSelectionState;
};

type PointerInfo = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  lastEmitX: number;
  lastEmitY: number;
  startTime: number;
  device: InputDevice;
  button: InputButton;
  hitTarget: CanvasHitTarget;
  palmContactAreaPx?: number;
};

export class CanvasInputController {
  private resolver: InputIntentResolver;
  private onIntent?: (intent: InputIntent, context: InputIntentEventContext) => void;
  private getCurrentSelection?: () => CanvasSelectionState;
  private activePointers = new Map<number, PointerInfo>();
  private currentState: ControllerState = 'idle';
  private longPressTimer?: ReturnType<typeof setTimeout>;
  private element?: EventTarget;
  private isSpacePressed = false;
  private pinchInitialDistance?: number;
  private lastPinchCenterX?: number;
  private lastPinchCenterY?: number;
  private isMultiTouchGesture = false;
  private previousTouchAction?: string;
  private suppressNextContextMenu = false;
  private suppressContextMenuTimer?: ReturnType<typeof setTimeout>;
  private isPinchLatched = false;
  private hasContextMenuFiredInSession = false;
  private freshTouchMoves = new Set<number>();

  constructor(options: CanvasInputControllerOptions = {}) {
    this.resolver = options.resolver ?? new InputIntentResolver();
    this.onIntent = options.onIntent;
    this.getCurrentSelection = options.getCurrentSelection;
  }

  get state(): ControllerState {
    return this.currentState;
  }

  attach(element: EventTarget): void {
    this.detach();
    this.element = element;
    if (typeof (element as HTMLElement).addEventListener === 'function') {
      const el = element as HTMLElement;
      if (typeof el.style === 'object' && el.style !== null) {
        this.previousTouchAction = el.style.touchAction;
        el.style.touchAction = 'none';
      }
      el.addEventListener('pointerdown', this.onPointerDown as EventListener);
      el.addEventListener('pointermove', this.onPointerMove as EventListener);
      el.addEventListener('pointerup', this.onPointerUp as EventListener);
      el.addEventListener('pointercancel', this.onPointerCancel as EventListener);
      el.addEventListener('wheel', this.onWheel as EventListener, { passive: false });
      el.addEventListener('contextmenu', this.onContextMenu as EventListener);
      el.addEventListener('dblclick', this.onDblClick as EventListener);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.onDocumentVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onWindowBlur);
    }
  }

  detach(): void {
    if (this.element && typeof (this.element as HTMLElement).removeEventListener === 'function') {
      const el = this.element as HTMLElement;
      el.removeEventListener('pointerdown', this.onPointerDown as EventListener);
      el.removeEventListener('pointermove', this.onPointerMove as EventListener);
      el.removeEventListener('pointerup', this.onPointerUp as EventListener);
      el.removeEventListener('pointercancel', this.onPointerCancel as EventListener);
      el.removeEventListener('wheel', this.onWheel as EventListener);
      el.removeEventListener('contextmenu', this.onContextMenu as EventListener);
      el.removeEventListener('dblclick', this.onDblClick as EventListener);
      if (typeof el.style === 'object' && el.style !== null && this.previousTouchAction !== undefined) {
        el.style.touchAction = this.previousTouchAction;
      }
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.onDocumentVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onWindowBlur);
    }
    this.resetState();
    this.element = undefined;
    this.previousTouchAction = undefined;
  }

  handlePointerDown(evt: {
    pointerId?: number;
    clientX: number;
    clientY: number;
    pointerType?: string;
    button?: number;
    target?: EventTarget | null;
    width?: number;
    height?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  }): void {
    const pointerId = evt.pointerId ?? 1;
    const device: InputDevice = evt.pointerType === 'touch' ? 'touch' : evt.pointerType === 'pen' ? 'pen' : 'mouse';
    const button: InputButton = evt.button === 1 ? 'middle' : evt.button === 2 ? 'right' : 'left';
    const hitTarget = resolveHitTargetFromElement(evt.target ?? null);

    if (button === 'right') {
      this.hasContextMenuFiredInSession = false;
    }

    if (evt.target && typeof (evt.target as any).setPointerCapture === 'function' && evt.pointerId !== undefined) {
      try {
        (evt.target as any).setPointerCapture(evt.pointerId);
      } catch {
        // ignore capture errors in mock/non-DOM environments
      }
    }

    const width = evt.width ?? 0;
    const height = evt.height ?? 0;
    const palmContactAreaPx = width > 0 && height > 0 ? width * height : undefined;

    if (palmContactAreaPx !== undefined && palmContactAreaPx > this.resolver.palmAreaThresholdPx) {
      this.emitIntent({ kind: 'ignore', reason: 'palm' }, {
        pointerId,
        device,
        button,
        startX: evt.clientX,
        startY: evt.clientY,
        currentX: evt.clientX,
        currentY: evt.clientY
      });
      return;
    }

    const info: PointerInfo = {
      pointerId,
      startX: evt.clientX,
      startY: evt.clientY,
      currentX: evt.clientX,
      currentY: evt.clientY,
      lastEmitX: evt.clientX,
      lastEmitY: evt.clientY,
      startTime: Date.now(),
      device,
      button,
      hitTarget,
      palmContactAreaPx
    };

    this.activePointers.set(pointerId, info);
    this.currentState = 'pressing';

    const touchPointers = this.getTouchPointers();
    if (touchPointers.length > 1) {
      this.isMultiTouchGesture = true;
    }

    this.recomputePinchBaselines();

    this.clearLongPressTimer();
    // Only start long-press timer for left button on mouse or touch
    if (this.activePointers.size === 1 && button === 'left' && (device === 'mouse' || device === 'touch')) {
      this.longPressTimer = setTimeout(() => {
        if (this.currentState === 'pressing') {
          const p = this.activePointers.get(pointerId);
          if (p) {
            const movementPx = Math.hypot(p.currentX - p.startX, p.currentY - p.startY);
            if (movementPx < this.resolver.moveThresholdPx) {
              this.currentState = 'radial_menu';
              this.setSuppressNextContextMenu();
              this.emitIntent({
                kind: 'radialMenu',
                source: 'longpress'
              }, {
                pointerId: p.pointerId,
                device: p.device,
                button: p.button,
                startX: p.startX,
                startY: p.startY,
                currentX: p.currentX,
                currentY: p.currentY,
                movementPx
              });
            }
          }
        }
      }, this.resolver.longPressMs);
    }
  }

  handlePointerMove(evt: {
    pointerId?: number;
    clientX: number;
    clientY: number;
    pointerType?: string;
    width?: number;
    height?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    spaceKey?: boolean;
  }): void {
    const pointerId = evt.pointerId ?? 1;
    const info = this.activePointers.get(pointerId);
    if (!info) return;

    info.currentX = evt.clientX;
    info.currentY = evt.clientY;

    const width = evt.width ?? 0;
    const height = evt.height ?? 0;
    if (width > 0 && height > 0) {
      info.palmContactAreaPx = width * height;
    }

    if (info.palmContactAreaPx !== undefined && info.palmContactAreaPx > this.resolver.palmAreaThresholdPx) {
      this.clearLongPressTimer();
      this.activePointers.delete(pointerId);
      this.recomputePinchBaselines();
      if (this.activePointers.size === 0) {
        this.currentState = 'idle';
      }
      this.emitIntent({ kind: 'ignore', reason: 'palm' }, {
        pointerId,
        device: info.device,
        button: info.button,
        startX: info.startX,
        startY: info.startY,
        currentX: info.currentX,
        currentY: info.currentY
      });
      return;
    }

    if (info.device === 'touch') {
      this.freshTouchMoves.add(pointerId);
    }

    const touchPointers = this.getTouchPointers();

    if (this.isMultiTouchGesture && touchPointers.length < 2) {
      return;
    }

    const movementPx = Math.hypot(info.currentX - info.startX, info.currentY - info.startY);

    if (touchPointers.length > 2) {
      this.emitIntent({ kind: 'ignore', reason: 'unhandled_multitouch' }, {
        device: info.device,
        movementPx
      });
      return;
    }

    let pinchDistanceDeltaPx: number | undefined;
    let resolvedPinchDistanceDeltaPx: number | undefined;
    let centerX: number | undefined;
    let centerY: number | undefined;
    let isDivergentPinch = false;

    if (touchPointers.length === 2 && this.pinchInitialDistance !== undefined) {
      const p1 = touchPointers[0];
      const p2 = touchPointers[1];
      const currentDist = Math.hypot(
        p1.currentX - p2.currentX,
        p1.currentY - p2.currentY
      );
      pinchDistanceDeltaPx = currentDist - this.pinchInitialDistance;
      centerX = (p1.currentX + p2.currentX) / 2;
      centerY = (p1.currentY + p2.currentY) / 2;

      const dx1 = p1.currentX - p1.startX;
      const dy1 = p1.currentY - p1.startY;
      const dx2 = p2.currentX - p2.startX;
      const dy2 = p2.currentY - p2.startY;
      const dotProduct = dx1 * dx2 + dy1 * dy2;
      const dist1 = Math.hypot(dx1, dy1);
      const dist2 = Math.hypot(dx2, dy2);

      const bothTouchPointersFresh = touchPointers.every((p) => this.freshTouchMoves.has(p.pointerId));
      const isOnePointerStationary = dist1 === 0 || dist2 === 0;

      if (bothTouchPointersFresh) {
        resolvedPinchDistanceDeltaPx = pinchDistanceDeltaPx;
        this.freshTouchMoves.clear();
      } else if (this.isPinchLatched) {
        resolvedPinchDistanceDeltaPx = pinchDistanceDeltaPx;
      } else if (isOnePointerStationary && pinchDistanceDeltaPx !== undefined) {
        // A single unsynced pointer's reading can't tell an anchored pinch apart from an async
        // pan frame where the other finger's matching move just hasn't arrived yet. Require a
        // much larger jump than the normal pinch threshold before trusting it either direction.
        if (Math.abs(pinchDistanceDeltaPx) > 2 * this.resolver.pinchThresholdPx) {
          resolvedPinchDistanceDeltaPx = pinchDistanceDeltaPx;
        }
      }

      const atLeastOnePointerMoved = dist1 > 0 || dist2 > 0;

      if (
        atLeastOnePointerMoved &&
        resolvedPinchDistanceDeltaPx !== undefined &&
        Math.abs(resolvedPinchDistanceDeltaPx) > this.resolver.pinchThresholdPx
      ) {
        if (dist1 === 0 || dist2 === 0 || dotProduct <= 0 || Math.abs(resolvedPinchDistanceDeltaPx) > 0.5 * Math.max(dist1, dist2)) {
          isDivergentPinch = true;
        }
      }
    }

    if (isDivergentPinch) {
      this.isPinchLatched = true;
    }

    const isPinchThresholdExceeded =
      resolvedPinchDistanceDeltaPx !== undefined &&
      Math.abs(resolvedPinchDistanceDeltaPx) > this.resolver.pinchThresholdPx;

    if (movementPx >= this.resolver.moveThresholdPx || isPinchThresholdExceeded || this.isPinchLatched) {
      this.clearLongPressTimer();
      if (this.currentState === 'pressing') {
        this.currentState = 'dragging';
      }
    }

    if (this.currentState === 'dragging') {
      const modifiers: InputModifiers = {
        ctrlKey: evt.ctrlKey,
        shiftKey: evt.shiftKey,
        spaceKey: evt.spaceKey ?? this.isSpacePressed
      };

      let emitDeltaX: number;
      let emitDeltaY: number;

      if (touchPointers.length === 2 && centerX !== undefined && centerY !== undefined) {
        if (this.lastPinchCenterX === undefined || this.lastPinchCenterY === undefined) {
          const startCenterX = (touchPointers[0].startX + touchPointers[1].startX) / 2;
          const startCenterY = (touchPointers[0].startY + touchPointers[1].startY) / 2;
          emitDeltaX = centerX - startCenterX;
          emitDeltaY = centerY - startCenterY;
        } else {
          emitDeltaX = centerX - this.lastPinchCenterX;
          emitDeltaY = centerY - this.lastPinchCenterY;
        }
        this.lastPinchCenterX = centerX;
        this.lastPinchCenterY = centerY;
      } else {
        emitDeltaX = info.currentX - info.lastEmitX;
        emitDeltaY = info.currentY - info.lastEmitY;
        info.lastEmitX = info.currentX;
        info.lastEmitY = info.currentY;
      }

      let intent = this.resolver.resolve({
        eventType: 'drag',
        device: info.device,
        button: info.button,
        touchCount: touchPointers.length > 0 ? touchPointers.length : this.activePointers.size,
        modifiers,
        hitTarget: info.hitTarget,
        movementPx,
        pinchDistanceDeltaPx: resolvedPinchDistanceDeltaPx,
        palmContactAreaPx: info.palmContactAreaPx,
        currentSelection: this.getCurrentSelection?.()
      });

      if (this.isPinchLatched && touchPointers.length === 2) {
        intent = { kind: 'pinchZoom', source: 'touch' };
      }

      this.emitIntent(intent, {
        pointerId,
        device: info.device,
        button: info.button,
        startX: info.startX,
        startY: info.startY,
        currentX: info.currentX,
        currentY: info.currentY,
        deltaX: emitDeltaX,
        deltaY: emitDeltaY,
        movementPx,
        pinchDistanceDeltaPx: resolvedPinchDistanceDeltaPx,
        centerX,
        centerY
      });
    }
  }

  handlePointerUp(evt: {
    pointerId?: number;
    pointerType?: string;
    button?: number;
    target?: EventTarget | null;
    width?: number;
    height?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    clientX?: number;
    clientY?: number;
  }): void {
    const pointerId = evt.pointerId ?? 1;
    const info = this.activePointers.get(pointerId);

    if (evt.target && typeof (evt.target as any).releasePointerCapture === 'function' && evt.pointerId !== undefined) {
      try {
        (evt.target as any).releasePointerCapture(evt.pointerId);
      } catch {
        // ignore release errors in mock/non-DOM environments
      }
    }

    this.clearLongPressTimer();

    if (info && !this.isMultiTouchGesture) {
      // pointerup can carry the final position without a preceding pointermove (coalesced
      // events, or callers that skip intermediate moves) — sync it before measuring movement.
      if (evt.clientX !== undefined && evt.clientY !== undefined) {
        info.currentX = evt.clientX;
        info.currentY = evt.clientY;
      }

      const pressDurationMs = Date.now() - info.startTime;
      const movementPx = Math.hypot(info.currentX - info.startX, info.currentY - info.startY);

      if (info.button === 'right' && info.device === 'mouse') {
        if (!this.hasContextMenuFiredInSession) {
          this.setSuppressNextContextMenu();
        }
      }

      if (this.currentState === 'pressing') {
        const modifiers: InputModifiers = {
          ctrlKey: evt.ctrlKey,
          shiftKey: evt.shiftKey,
          spaceKey: this.isSpacePressed
        };

        // A pointerup-only coordinate sync can reveal that the pointer actually travelled past
        // moveThresholdPx even though no pointermove ever fired to transition state to 'dragging'.
        // Resolve that final displacement as a drag instead of letting it fall through to 'click'.
        const hasUnsyncedDragMovement = movementPx >= this.resolver.moveThresholdPx;

        if (info.device === 'mouse' && info.button === 'right' && !hasUnsyncedDragMovement) {
          this.currentState = 'radial_menu';
          this.setSuppressNextContextMenu();
          this.emitIntent({
            kind: 'radialMenu',
            source: 'contextmenu'
          }, {
            pointerId,
            device: info.device,
            button: info.button,
            startX: info.startX,
            startY: info.startY,
            currentX: info.currentX,
            currentY: info.currentY,
            movementPx,
            pressDurationMs
          });
        } else {
          const eventType = hasUnsyncedDragMovement ? 'drag' : 'click';

          const intent = this.resolver.resolve({
            eventType,
            device: info.device,
            button: info.button,
            touchCount: this.activePointers.size,
            modifiers,
            hitTarget: info.hitTarget,
            movementPx,
            pressDurationMs,
            palmContactAreaPx: info.palmContactAreaPx,
            currentSelection: this.getCurrentSelection?.()
          });

          this.emitIntent(intent, {
            pointerId,
            device: info.device,
            button: info.button,
            startX: info.startX,
            startY: info.startY,
            currentX: info.currentX,
            currentY: info.currentY,
            deltaX: hasUnsyncedDragMovement ? info.currentX - info.startX : undefined,
            deltaY: hasUnsyncedDragMovement ? info.currentY - info.startY : undefined,
            movementPx,
            pressDurationMs
          });
        }
      }
    }

    this.activePointers.delete(pointerId);
    this.recomputePinchBaselines();

    const touchPointers = this.getTouchPointers();
    if (touchPointers.length === 0) {
      this.isMultiTouchGesture = false;
    }

    if (this.activePointers.size === 0) {
      this.currentState = 'idle';
    }
  }

  handlePointerCancel(evt: { pointerId?: number; target?: EventTarget | null }): void {
    const pointerId = evt.pointerId ?? 1;
    if (evt.target && typeof (evt.target as any).releasePointerCapture === 'function' && evt.pointerId !== undefined) {
      try {
        (evt.target as any).releasePointerCapture(evt.pointerId);
      } catch {
        // ignore release errors
      }
    }

    this.clearLongPressTimer();
    this.activePointers.delete(pointerId);
    this.recomputePinchBaselines();

    const touchPointers = this.getTouchPointers();
    if (touchPointers.length === 0) {
      this.isMultiTouchGesture = false;
    }

    if (this.activePointers.size === 0) {
      this.currentState = 'idle';
    }
  }

  handleWheel(evt: {
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    deltaX?: number;
    deltaY?: number;
    preventDefault?: () => void;
  }): void {
    evt.preventDefault?.();
    const modifiers: InputModifiers = {
      ctrlKey: evt.ctrlKey,
      shiftKey: evt.shiftKey,
      spaceKey: this.isSpacePressed
    };

    const intent = this.resolver.resolve({
      eventType: 'wheel',
      device: 'mouse',
      modifiers,
      deltaX: evt.deltaX,
      deltaY: evt.deltaY,
      currentSelection: this.getCurrentSelection?.()
    });

    this.emitIntent(intent, {
      device: 'mouse',
      currentX: evt.clientX,
      currentY: evt.clientY,
      deltaX: evt.deltaX,
      deltaY: evt.deltaY
    });
  }

  handleContextMenu(evt: { preventDefault?: () => void; clientX?: number; clientY?: number }): void {
    evt.preventDefault?.();
    this.hasContextMenuFiredInSession = true;

    if (this.suppressNextContextMenu) {
      this.clearSuppressContextMenuTimer();
      return;
    }

    if (this.currentState === 'radial_menu') {
      return;
    }

    const hasActiveRightPointer = Array.from(this.activePointers.values()).some((p) => p.button === 'right');
    if (hasActiveRightPointer) {
      // Defer radialMenu emission to pointerup if released under moveThresholdPx to support right-drag pan
      return;
    }

    this.currentState = 'radial_menu';

    this.emitIntent({
      kind: 'radialMenu',
      source: 'contextmenu'
    }, {
      device: 'mouse',
      button: 'right',
      currentX: evt.clientX,
      currentY: evt.clientY
    });
  }

  handleDblClick(evt: { target?: EventTarget | null; clientX?: number; clientY?: number }): void {
    const hitTarget = resolveHitTargetFromElement(evt.target ?? null);
    const intent = this.resolver.resolve({
      eventType: 'dblclick',
      device: 'mouse',
      button: 'left',
      hitTarget,
      currentSelection: this.getCurrentSelection?.()
    });
    this.emitIntent(intent, {
      device: 'mouse',
      button: 'left',
      currentX: evt.clientX,
      currentY: evt.clientY
    });
  }

  resetToIdle(): void {
    this.resetState();
  }

  reset(): void {
    this.resetState();
  }

  private setSuppressNextContextMenu(timeoutMs = 300): void {
    this.suppressNextContextMenu = true;
    if (this.suppressContextMenuTimer) {
      clearTimeout(this.suppressContextMenuTimer);
    }
    this.suppressContextMenuTimer = setTimeout(() => {
      this.suppressNextContextMenu = false;
      this.suppressContextMenuTimer = undefined;
    }, timeoutMs);
  }

  private clearSuppressContextMenuTimer(): void {
    if (this.suppressContextMenuTimer) {
      clearTimeout(this.suppressContextMenuTimer);
      this.suppressContextMenuTimer = undefined;
    }
    this.suppressNextContextMenu = false;
  }

  private emitIntent(intent: InputIntent, context: InputIntentEventContext = {}): void {
    if (this.onIntent) {
      this.onIntent(intent, context);
    }
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = undefined;
    }
  }

  private getTouchPointers(): PointerInfo[] {
    return Array.from(this.activePointers.values()).filter((p) => p.device === 'touch');
  }

  private recomputePinchBaselines(): void {
    this.freshTouchMoves.clear();
    const touchPointers = this.getTouchPointers();
    if (touchPointers.length === 2) {
      this.pinchInitialDistance = Math.hypot(
        touchPointers[0].currentX - touchPointers[1].currentX,
        touchPointers[0].currentY - touchPointers[1].currentY
      );
      this.lastPinchCenterX = (touchPointers[0].currentX + touchPointers[1].currentX) / 2;
      this.lastPinchCenterY = (touchPointers[0].currentY + touchPointers[1].currentY) / 2;
    } else {
      this.pinchInitialDistance = undefined;
      this.lastPinchCenterX = undefined;
      this.lastPinchCenterY = undefined;
      this.isPinchLatched = false;
    }
  }

  private onPointerDown = (evt: PointerEvent) => this.handlePointerDown(evt);
  private onPointerMove = (evt: PointerEvent) => this.handlePointerMove(evt);
  private onPointerUp = (evt: PointerEvent) => this.handlePointerUp(evt);
  private onPointerCancel = (evt: PointerEvent) => this.handlePointerCancel(evt);
  private onWheel = (evt: WheelEvent) => this.handleWheel(evt);
  private onContextMenu = (evt: MouseEvent) => this.handleContextMenu(evt);
  private onDblClick = (evt: MouseEvent) => this.handleDblClick(evt);
  private onKeyDown = (evt: KeyboardEvent) => {
    if (evt.code === 'Space' || evt.key === ' ') {
      if (!isInteractiveElement(evt.target)) {
        this.isSpacePressed = true;
        const target = evt.target as Node | null;
        const isTargetInsideCanvas = Boolean(
          this.element && target && (
            target === this.element ||
            (typeof (this.element as any).contains === 'function' && (this.element as any).contains(target))
          )
        );
        if (isTargetInsideCanvas) {
          evt.preventDefault?.();
        }
      }
    }
  };
  private onKeyUp = (evt: KeyboardEvent) => {
    if (evt.code === 'Space' || evt.key === ' ') {
      this.isSpacePressed = false;
    }
  };
  private onDocumentVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.resetState();
    }
  };
  private onWindowBlur = () => {
    this.resetState();
  };
  private resetState(): void {
    this.clearLongPressTimer();
    this.clearSuppressContextMenuTimer();
    this.activePointers.clear();
    this.pinchInitialDistance = undefined;
    this.lastPinchCenterX = undefined;
    this.lastPinchCenterY = undefined;
    this.isMultiTouchGesture = false;
    this.isPinchLatched = false;
    this.hasContextMenuFiredInSession = false;
    this.freshTouchMoves.clear();
    this.currentState = 'idle';
    this.isSpacePressed = false;
  }
}

const INTERACTIVE_ANCESTOR_SELECTOR =
  'input, textarea, select, button, a, [contenteditable], [contenteditable="true"], ' +
  '[role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="option"], [role="tab"], [role="textbox"]';

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;

  if (isElementItselfInteractive(el)) {
    return true;
  }

  if (typeof el.closest === 'function') {
    return el.closest(INTERACTIVE_ANCESTOR_SELECTOR) !== null;
  }

  return false;
}

function isElementItselfInteractive(el: HTMLElement): boolean {
  const tagName = el.tagName ? el.tagName.toUpperCase() : '';
  if (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    tagName === 'BUTTON' ||
    tagName === 'A' ||
    Boolean(el.isContentEditable)
  ) {
    return true;
  }
  if (typeof el.getAttribute === 'function') {
    const role = el.getAttribute('role');
    if (role && ['button', 'link', 'checkbox', 'menuitem', 'option', 'tab', 'textbox'].includes(role.toLowerCase())) {
      return true;
    }
  }
  return false;
}

type ClosestLikeElement = {
  closest?: (selector: string) => Element | null;
  dataset?: DOMStringMap;
  getAttribute?: (name: string) => string | null;
};

export function resolveHitTargetFromElement(target: EventTarget | null): CanvasHitTarget {
  const element = toClosestLikeElement(target);
  if (!element) {
    return {kind: 'blank'};
  }

  const handle = element.closest?.('[data-handle="resize"], [data-handle], [data-obj-handle]');
  if (handle) {
    const objectId = readDataAttribute(handle, 'objId') ?? readDataAttribute(element.closest?.('[data-obj-id]'), 'objId');
    return {kind: 'handle', objectId};
  }

  const connector = element.closest?.('[data-connection-point]');
  if (connector) {
    const objectId = readDataAttribute(connector, 'objId') ?? readDataAttribute(element.closest?.('[data-obj-id]'), 'objId');
    return {kind: 'connector', objectId};
  }

  const object = element.closest?.('[data-obj-id]');
  if (!object) {
    return {kind: 'blank'};
  }

  return {
    kind: 'object',
    objectId: readDataAttribute(object, 'objId'),
    textEditable: readBooleanDataAttribute(object, 'textEditable')
  };
}

function toClosestLikeElement(target: EventTarget | null): ClosestLikeElement | null {
  if (!target || typeof target !== 'object' || !('closest' in target)) {
    return null;
  }

  const element = target as ClosestLikeElement;
  return typeof element.closest === 'function' ? element : null;
}

function readDataAttribute(element: ClosestLikeElement | null | undefined, key: 'objId' | 'textEditable'): string | undefined {
  if (!element) return undefined;
  const datasetValue = element.dataset?.[key];
  if (datasetValue !== undefined) {
    return datasetValue;
  }

  const attrName = `data-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
  return element.getAttribute?.(attrName) ?? undefined;
}

function readBooleanDataAttribute(element: ClosestLikeElement, key: 'textEditable'): boolean {
  const value = readDataAttribute(element, key);
  return value === 'true' || value === '';
}

