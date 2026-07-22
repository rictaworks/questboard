export interface CameraPoint {
  x: number;
  y: number;
}

export interface CameraViewport {
  width: number;
  height: number;
}

export interface CameraBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  velocityX: number;
  velocityY: number;
  focus: CameraFocusAnimation | null;
}

export interface CameraFocusAnimation {
  from: CameraPose;
  to: CameraPose;
  elapsedMs: number;
  durationMs: number;
}

export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraControllerOptions {
  inertiaFrictionPerFrame: number;
  minZoom: number;
  maxZoom: number;
  focusDurationMs: number;
  boundaryMarginRatio: number;
  boundaryElasticity: number;
  wheelZoomExponent: number;
  precisionWheelZoomExponent: number;
  frameDurationMs: number;
}

export const DEFAULT_CAMERA_CONTROLLER_OPTIONS: CameraControllerOptions = {
  inertiaFrictionPerFrame: 0.92,
  minZoom: 0.02,
  maxZoom: 4,
  focusDurationMs: 300,
  boundaryMarginRatio: 0.2,
  boundaryElasticity: 0.35,
  wheelZoomExponent: 0.0015,
  precisionWheelZoomExponent: 0.003,
  frameDurationMs: 1000 / 60,
};

export interface CanvasWheelCameraInput {
  deltaY: number;
  cursor: CameraPoint;
  viewport: CameraViewport;
  precision?: boolean;
}

export interface MinimapClickInput {
  click: CameraPoint;
  minimap: CameraBounds;
  contentBounds: CameraBounds | null;
}

export interface CameraControllerCommandContext {
  viewport: CameraViewport;
  contentBounds: CameraBounds | null;
}

export function createCameraState(overrides: Partial<CameraState> = {}): CameraState {
  return {
    x: 0,
    y: 0,
    zoom: 1,
    velocityX: 0,
    velocityY: 0,
    focus: null,
    ...overrides,
  };
}

export function startInertia(
  state: CameraState,
  velocityX: number,
  velocityY: number,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  return normalizeCameraState(
    {
      ...state,
      velocityX: -velocityX / state.zoom,
      velocityY: -velocityY / state.zoom,
      focus: null,
    },
    options
  );
}

export function panCamera(
  state: CameraState,
  deltaX: number,
  deltaY: number,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  return normalizeCameraState(
    {
      ...state,
      x: state.x - deltaX / state.zoom,
      y: state.y - deltaY / state.zoom,
      velocityX: 0,
      velocityY: 0,
      focus: null,
    },
    options
  );
}

export function onCanvasWheel(
  state: CameraState,
  input: CanvasWheelCameraInput,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  const exponent = input.precision ? options.precisionWheelZoomExponent : options.wheelZoomExponent;
  const nextZoom = clamp(state.zoom * Math.exp(-input.deltaY * exponent), options.minZoom, options.maxZoom);
  const next = zoomAtPoint(state, nextZoom, input.cursor, input.viewport, options);
  return normalizeCameraState(next, options);
}

export function beginFocusTransition(
  state: CameraState,
  target: CameraPose,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  return normalizeCameraState(
    {
      ...state,
      velocityX: 0,
      velocityY: 0,
      focus: {
        from: {x: state.x, y: state.y, zoom: state.zoom},
        to: {
          x: target.x,
          y: target.y,
          zoom: clamp(target.zoom, options.minZoom, options.maxZoom),
        },
        elapsedMs: 0,
        durationMs: options.focusDurationMs,
      },
    },
    options
  );
}

export function focusOnObject(
  state: CameraState,
  objectBounds: CameraBounds | null,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  if (objectBounds == null) {
    return beginFocusTransition(state, {x: 0, y: 0, zoom: 1}, options);
  }

  return beginFocusTransition(state, centerCameraOnBounds(objectBounds, state.zoom), options);
}

export function onMinimapClick(
  state: CameraState,
  input: MinimapClickInput,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  if (input.contentBounds == null) {
    return beginFocusTransition(state, {x: 0, y: 0, zoom: 1}, options);
  }

  const target = minimapClickToWorldPoint(input.click, input.minimap, input.contentBounds);
  return beginFocusTransition(state, {x: target.x, y: target.y, zoom: state.zoom}, options);
}

export function fitToContent(
  contentBounds: CameraBounds | null,
  viewport: CameraViewport,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraPose {
  if (contentBounds == null) {
    return {x: 0, y: 0, zoom: 1};
  }

  const contentWidth = Math.max(contentBounds.right - contentBounds.left, 1);
  const contentHeight = Math.max(contentBounds.bottom - contentBounds.top, 1);
  const marginWidth = contentWidth * options.boundaryMarginRatio * 2;
  const marginHeight = contentHeight * options.boundaryMarginRatio * 2;
  const zoom = clamp(
    Math.min(viewport.width / (contentWidth + marginWidth), viewport.height / (contentHeight + marginHeight)),
    options.minZoom,
    options.maxZoom
  );

  return centerCameraOnBounds(contentBounds, zoom);
}

export function animateCameraTo(
  from: CameraPose,
  to: CameraPose,
  elapsedMs: number,
  durationMs = DEFAULT_CAMERA_CONTROLLER_OPTIONS.focusDurationMs
): CameraPose {
  const progress = clamp(elapsedMs / durationMs, 0, 1);
  const eased = easeOutCubic(progress);

  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    zoom: lerp(from.zoom, to.zoom, eased),
  };
}

export function tickCamera(
  state: CameraState,
  deltaTimeMs: number,
  context: CameraControllerCommandContext,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  if (state.focus != null) {
    const nextFocusElapsed = state.focus.elapsedMs + deltaTimeMs;
    const pose = animateCameraTo(state.focus.from, state.focus.to, nextFocusElapsed, state.focus.durationMs);
    const focusComplete = nextFocusElapsed >= state.focus.durationMs;
    return normalizeCameraState(
      {
        ...state,
        ...pose,
        velocityX: 0,
        velocityY: 0,
        focus: focusComplete
          ? null
          : {
              ...state.focus,
              elapsedMs: nextFocusElapsed,
            },
      },
      options
    );
  }

  const frameFactor = deltaTimeMs <= 0 ? 0 : deltaTimeMs / options.frameDurationMs;
  let next = {
    ...state,
    x: state.x + state.velocityX * frameFactor,
    y: state.y + state.velocityY * frameFactor,
    velocityX: state.velocityX * Math.pow(options.inertiaFrictionPerFrame, frameFactor),
    velocityY: state.velocityY * Math.pow(options.inertiaFrictionPerFrame, frameFactor),
  };

  if (context.contentBounds != null) {
    next = applyElasticBoundary(next, context.contentBounds, context.viewport, options);
  }

  return normalizeCameraState(next, options);
}

export class CameraController {
  private state: CameraState;

  constructor(
    initialState: CameraState = createCameraState(),
    private readonly options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
  ) {
    this.state = normalizeCameraState(initialState, this.options);
  }

  getState(): CameraState {
    return this.state;
  }

  setState(state: CameraState): CameraState {
    this.state = normalizeCameraState(state, this.options);
    return this.state;
  }

  panBy(deltaX: number, deltaY: number): CameraState {
    this.state = panCamera(this.state, deltaX, deltaY, this.options);
    return this.state;
  }

  startInertia(velocityX: number, velocityY: number): CameraState {
    this.state = startInertia(this.state, velocityX, velocityY, this.options);
    return this.state;
  }

  zoomAtCursor(input: CanvasWheelCameraInput): CameraState {
    this.state = onCanvasWheel(this.state, input, this.options);
    return this.state;
  }

  fitToContent(contentBounds: CameraBounds | null, viewport: CameraViewport): CameraState {
    const pose = fitToContent(contentBounds, viewport, this.options);
    this.state = normalizeCameraState(
      {
        ...this.state,
        ...pose,
        velocityX: 0,
        velocityY: 0,
        focus: null,
      },
      this.options
    );
    return this.state;
  }

  focusOnObject(objectBounds: CameraBounds | null): CameraState {
    this.state = focusOnObject(this.state, objectBounds, this.options);
    return this.state;
  }

  focusOnMinimapClick(input: MinimapClickInput): CameraState {
    this.state = onMinimapClick(this.state, input, this.options);
    return this.state;
  }

  tick(deltaTimeMs: number, context: CameraControllerCommandContext): CameraState {
    this.state = tickCamera(this.state, deltaTimeMs, context, this.options);
    return this.state;
  }
}

function zoomAtPoint(
  state: CameraState,
  nextZoom: number,
  cursor: CameraPoint,
  viewport: CameraViewport,
  options: CameraControllerOptions
): CameraState {
  const worldX = state.x + (cursor.x - viewport.width / 2) / state.zoom;
  const worldY = state.y + (cursor.y - viewport.height / 2) / state.zoom;

  return {
    ...state,
    x: worldX - (cursor.x - viewport.width / 2) / nextZoom,
    y: worldY - (cursor.y - viewport.height / 2) / nextZoom,
    zoom: nextZoom,
    velocityX: 0,
    velocityY: 0,
    focus: null,
  };
}

function centerCameraOnBounds(bounds: CameraBounds, zoom: number): CameraPose {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    zoom,
  };
}

function minimapClickToWorldPoint(
  click: CameraPoint,
  minimap: CameraBounds,
  contentBounds: CameraBounds
): CameraPoint {
  const contentWidth = Math.max(contentBounds.right - contentBounds.left, 1);
  const contentHeight = Math.max(contentBounds.bottom - contentBounds.top, 1);
  const minimapWidth = Math.max(minimap.right - minimap.left, 1);
  const minimapHeight = Math.max(minimap.bottom - minimap.top, 1);
  const ratioX = clamp((click.x - minimap.left) / minimapWidth, 0, 1);
  const ratioY = clamp((click.y - minimap.top) / minimapHeight, 0, 1);

  return {
    x: contentBounds.left + ratioX * contentWidth,
    y: contentBounds.top + ratioY * contentHeight,
  };
}

function applyElasticBoundary(
  state: CameraState,
  bounds: CameraBounds,
  viewport: CameraViewport,
  options: CameraControllerOptions
): CameraState {
  const range = resolveCameraRange(bounds, viewport, state.zoom, options.boundaryMarginRatio);

  return {
    ...state,
    x: softenToRange(state.x, range.minX, range.maxX, options.boundaryElasticity),
    y: softenToRange(state.y, range.minY, range.maxY, options.boundaryElasticity),
  };
}

function resolveCameraRange(
  bounds: CameraBounds,
  viewport: CameraViewport,
  zoom: number,
  marginRatio: number
): {minX: number; maxX: number; minY: number; maxY: number} {
  const width = Math.max(bounds.right - bounds.left, 1);
  const height = Math.max(bounds.bottom - bounds.top, 1);
  const expandedWidth = width * (1 + marginRatio * 2);
  const expandedHeight = height * (1 + marginRatio * 2);
  const halfViewportWidth = viewport.width / (2 * zoom);
  const halfViewportHeight = viewport.height / (2 * zoom);
  const minX = bounds.left - (expandedWidth - width) / 2 + halfViewportWidth;
  const maxX = bounds.right + (expandedWidth - width) / 2 - halfViewportWidth;
  const minY = bounds.top - (expandedHeight - height) / 2 + halfViewportHeight;
  const maxY = bounds.bottom + (expandedHeight - height) / 2 - halfViewportHeight;

  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;

  return {
    minX: minX > maxX ? centerX : minX,
    maxX: minX > maxX ? centerX : maxX,
    minY: minY > maxY ? centerY : minY,
    maxY: minY > maxY ? centerY : maxY,
  };
}

function softenToRange(value: number, min: number, max: number, elasticity: number): number {
  if (value < min) {
    return min + (value - min) * elasticity;
  }

  if (value > max) {
    return max + (value - max) * elasticity;
  }

  return value;
}

function normalizeCameraState(state: CameraState, options: CameraControllerOptions): CameraState {
  return {
    ...state,
    zoom: clamp(state.zoom, options.minZoom, options.maxZoom),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function easeOutCubic(value: number): number {
  const inverted = 1 - value;
  return 1 - inverted * inverted * inverted;
}
