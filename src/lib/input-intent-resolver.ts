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
  | {kind: 'zoom'; mode: 'standard' | 'precise'; axis: 'both' | 'horizontal'}
  | {kind: 'pan'; source: 'middle-button' | 'right-button' | 'space' | 'touch'; gesture: 'drag' | 'wheel'}
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
    if (input.modifiers?.ctrlKey) {
      return {kind: 'zoom', mode: 'precise', axis: 'both'};
    }

    if (input.modifiers?.shiftKey) {
      return {kind: 'pan', source: 'space', gesture: 'wheel'};
    }

    return {kind: 'zoom', mode: 'standard', axis: 'both'};
  }
}

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
    palmContactAreaPx: snapshot.palmContactAreaPx
  });
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

  const handle = element.closest?.('[data-obj-handle]');
  if (handle) {
    return {kind: 'handle', objectId: readDataAttribute(handle, 'objId')};
  }

  const connector = element.closest?.('[data-connection-point]');
  if (connector) {
    return {kind: 'connector', objectId: readDataAttribute(connector, 'objId')};
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

function readDataAttribute(element: ClosestLikeElement, key: 'objId' | 'textEditable'): string | undefined {
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
