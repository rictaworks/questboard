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
  // 慣性を打ち切る速度（ワールド単位/フレーム）。摩擦は指数減衰で 0 に到達しないため、
  // この閾値を下回ったら 0 に落として tick の差分検出を確実に止める。
  inertiaStopVelocity: number;
  minZoom: number;
  maxZoom: number;
  focusDurationMs: number;
  boundaryMarginRatio: number;
  boundaryElasticity: number;
  wheelZoomExponent: number;
  precisionWheelZoomExponent: number;
  frameDurationMs: number;
  fitMaxZoom: number;
}

export const DEFAULT_CAMERA_CONTROLLER_OPTIONS: CameraControllerOptions = {
  inertiaFrictionPerFrame: 0.92,
  inertiaStopVelocity: 0.01,
  minZoom: 0.02,
  maxZoom: 4,
  focusDurationMs: 300,
  boundaryMarginRatio: 0.2,
  boundaryElasticity: 0.35,
  wheelZoomExponent: 0.0015,
  precisionWheelZoomExponent: 0.003,
  frameDurationMs: 1000 / 60,
  fitMaxZoom: 1.0,
};

export interface CanvasWheelCameraInput {
  deltaY: number;
  cursor: CameraPoint;
  viewport: CameraViewport;
  precision?: boolean;
}

// ピンチは指間距離の倍率をそのまま渡す。ホイールの deltaY へ変換すると
// wheelZoomExponent（ホイールの感触用の定数）にピンチ感度が従属してしまう。
export interface CanvasPinchCameraInput {
  scale: number;
  origin?: CameraPoint;
  cursor?: CameraPoint;
  viewport: CameraViewport;
}

export interface MinimapClickInput {
  click: CameraPoint;
  minimap: CameraBounds;
  contentBounds: CameraBounds | null;
}

export interface CameraControllerCommandContext {
  viewport: CameraViewport;
  contentBounds: CameraBounds | null;
  // ポインタ操作中は true。境界の引き戻しは毎フレーム複利で効くため、操作中に
  // 適用するとドラッグに逆らって実質ハードクランプになる。引き戻しは解放後に行う。
  interacting: boolean;
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

export function onCanvasPinch(
  state: CameraState,
  input: CanvasPinchCameraInput,
  options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS
): CameraState {
  if (!Number.isFinite(input.scale) || input.scale <= 0) {
    throw new Error(`onCanvasPinch requires a positive finite scale, received ${input.scale}`);
  }

  const nextZoom = clamp(state.zoom * input.scale, options.minZoom, options.maxZoom);
  const origin = input.origin ?? input.cursor;
  if (origin == null) {
    throw new Error('onCanvasPinch requires an origin or cursor');
  }

  const next = zoomAtPoint(state, nextZoom, origin, input.viewport, options);
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
  const maxLimit = Math.max(options.minZoom, Math.min(options.maxZoom, options.fitMaxZoom));
  const zoom = clamp(
    Math.min(viewport.width / (contentWidth + marginWidth), viewport.height / (contentHeight + marginHeight)),
    options.minZoom,
    maxLimit
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
  const friction = Math.pow(options.inertiaFrictionPerFrame, frameFactor);
  let next = {
    ...state,
    x: state.x + state.velocityX * frameFactor,
    y: state.y + state.velocityY * frameFactor,
    velocityX: stopBelowThreshold(state.velocityX * friction, options.inertiaStopVelocity),
    velocityY: stopBelowThreshold(state.velocityY * friction, options.inertiaStopVelocity),
  };

  // 操作中の引き戻しはドラッグと綱引きになるため、指を離してから範囲へ戻す。
  if (context.contentBounds != null && !context.interacting) {
    next = applyElasticBoundary(next, context.contentBounds, context.viewport, frameFactor, options);
  }

  return normalizeCameraState(next, options);
}

export class CameraController {
  private state: CameraState;
  // 直前の tick 以降にユーザー操作でカメラを動かしたか。操作中に境界の引き戻しを
  // 適用するとドラッグと綱引きになるため、その1フレームは引き戻しを見送る。
  // ジェスチャ境界をまたいで持ち回るフラグと違い、終端 intent を取りこぼしても
  // 次の tick で必ず倒れるため「引き戻しが二度と効かない」状態にならない。
  private commandedSinceTick = false;

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
    this.commandedSinceTick = true;
    this.state = panCamera(this.state, deltaX, deltaY, this.options);
    return this.state;
  }

  startInertia(velocityX: number, velocityY: number): CameraState {
    this.state = startInertia(this.state, velocityX, velocityY, this.options);
    return this.state;
  }

  zoomAtCursor(input: CanvasWheelCameraInput): CameraState {
    this.commandedSinceTick = true;
    this.state = onCanvasWheel(this.state, input, this.options);
    return this.state;
  }

  zoomByScale(input: CanvasPinchCameraInput): CameraState {
    this.commandedSinceTick = true;
    this.state = onCanvasPinch(this.state, input, this.options);
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
    const interacting = context.interacting || this.commandedSinceTick;
    this.commandedSinceTick = false;
    this.state = tickCamera(this.state, deltaTimeMs, {...context, interacting}, this.options);
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
  frameFactor: number,
  options: CameraControllerOptions
): CameraState {
  const range = resolveCameraRange(bounds, viewport, state.zoom, options.boundaryMarginRatio);
  // 1フレーム分で boundaryElasticity 倍だけ超過分を残す。フレーム時間が伸びても
  // 引き戻し量が変わらないよう、経過フレーム数で指数化する。
  const retain = Math.pow(options.boundaryElasticity, frameFactor);

  return {
    ...state,
    x: softenToRange(state.x, range.minX, range.maxX, retain),
    y: softenToRange(state.y, range.minY, range.maxY, retain),
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

  // ビューポートがコンテンツ＋余白より大きいと min/max が逆転する。1点に潰すと
  // fit ズーム以下でパンが一切できなくなるため、逆転時は入れ替えて範囲として扱う。
  // 入れ替え後の範囲は「コンテンツが画面内に残る」カメラ位置の集合と一致する。
  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
}

function softenToRange(value: number, min: number, max: number, retain: number): number {
  if (value < min) {
    return min + (value - min) * retain;
  }

  if (value > max) {
    return max + (value - max) * retain;
  }

  return value;
}

function stopBelowThreshold(velocity: number, threshold: number): number {
  return Math.abs(velocity) < threshold ? 0 : velocity;
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

export const DEFAULT_OBJECT_SIZE = { w: 160, h: 120 };

export interface GeometryPositionLike {
  geometry: {
    x: number;
    y: number;
  };
}

export function resolveNewObjectGeometry(
  camera: CameraState,
  viewport: { width: number; height: number },
  objects: GeometryPositionLike[]
) {
  const centerX = camera.x;
  const centerY = camera.y;
  const baseGeometry = {
    x: Math.max(Math.round(centerX - DEFAULT_OBJECT_SIZE.w / 2), 0),
    y: Math.max(Math.round(centerY - DEFAULT_OBJECT_SIZE.h / 2), 0),
    w: DEFAULT_OBJECT_SIZE.w,
    h: DEFAULT_OBJECT_SIZE.h,
    rotation: 0,
  };

  const occupied = new Set(objects.map((object) => `${object.geometry.x}:${object.geometry.y}`));
  const offsetStep = 16;

  for (let index = 0; index < objects.length + 1; index += 1) {
    const nextGeometry = {
      ...baseGeometry,
      x: baseGeometry.x + index * offsetStep,
      y: baseGeometry.y + index * offsetStep,
    };

    if (!occupied.has(`${nextGeometry.x}:${nextGeometry.y}`)) {
      return nextGeometry;
    }
  }

  return baseGeometry;
}
