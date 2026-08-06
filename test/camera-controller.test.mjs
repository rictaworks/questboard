import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/camera-controller.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });
  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

const loadedModule = await loadModule();
const {
  CameraController,
  DEFAULT_CAMERA_CONTROLLER_OPTIONS,
  animateCameraTo,
  beginFocusTransition,
  fitToContent,
  onCanvasWheel,
  onMinimapClick,
  panCamera,
  startInertia,
  resolveNewObjectGeometry,
  tickCamera,
} = loadedModule;

const viewport = {width: 200, height: 200};
const contentBounds = {left: 0, top: 0, right: 1000, bottom: 1000};
const minimapBounds = {left: 0, top: 0, right: 200, bottom: 200};
const objectBounds = {left: 400, top: 300, right: 600, bottom: 500};

const boundaryStates = {
  inside: {x: 0, y: 0, zoom: 1},
  minEdge: {x: -100, y: -100, zoom: 1},
  maxEdge: {x: 1100, y: 1100, zoom: 1},
  outside: {x: 1300, y: 1300, zoom: 1},
};

test('camera math keeps cursor-fixed zoom, eases focus, and handles empty boards', () => {
  const controller = new CameraController({
    x: 10,
    y: 20,
    zoom: 1,
    velocityX: 0,
    velocityY: 0,
    focus: null,
  });

  const zoomed = onCanvasWheel(controller.getState(), {
    deltaY: -120,
    cursor: {x: 100, y: 100},
    viewport,
  });
  assert.equal(zoomed.x, 10);
  assert.equal(zoomed.y, 20);
  assert.equal(zoomed.focus, null);
  assert.ok(zoomed.zoom > 1);

  const clampedOut = onCanvasWheel(controller.getState(), {
    deltaY: 5000,
    cursor: {x: 100, y: 100},
    viewport,
  });
  assert.equal(clampedOut.zoom, DEFAULT_CAMERA_CONTROLLER_OPTIONS.minZoom);

  const clampedIn = onCanvasWheel(controller.getState(), {
    deltaY: -5000,
    cursor: {x: 100, y: 100},
    viewport,
  });
  assert.equal(clampedIn.zoom, DEFAULT_CAMERA_CONTROLLER_OPTIONS.maxZoom);

  assert.deepEqual(fitToContent(null, viewport), {x: 0, y: 0, zoom: 1});
  assert.deepEqual(fitToContent(contentBounds, viewport), {x: 500, y: 500, zoom: 1 / 7});

  const animated = animateCameraTo(
    {x: 0, y: 0, zoom: 1},
    {x: 100, y: 50, zoom: 2},
    150,
    DEFAULT_CAMERA_CONTROLLER_OPTIONS.focusDurationMs
  );
  assert.deepEqual(animated, {x: 87.5, y: 43.75, zoom: 1.875});

  const focus = beginFocusTransition(controller.getState(), {x: 100, y: 50, zoom: 2});
  assert.equal(focus.focus?.durationMs, 300);
  assert.equal(focus.velocityX, 0);
  assert.equal(focus.velocityY, 0);

  const minimapClick = onMinimapClick(controller.getState(), {
    click: {x: 100, y: 100},
    minimap: minimapBounds,
    contentBounds,
  });
  assert.equal(minimapClick.focus?.to.x, 500);
  assert.equal(minimapClick.focus?.to.y, 500);
});

test('camera matrix covers 48 input/boundary/board combinations', () => {
  const inputKinds = ['pan', 'inertia', 'wheel', 'focus-minimap', 'focus-object', 'fit'];
  const boardStates = ['empty', 'content'];
  const boundaryNames = Object.keys(boundaryStates);

  let cases = 0;

  for (const inputKind of inputKinds) {
    for (const boundaryName of boundaryNames) {
      for (const boardState of boardStates) {
        cases += 1;
        const start = boundaryStates[boundaryName];
        const controller = new CameraController({
          x: start.x,
          y: start.y,
          zoom: start.zoom,
          velocityX: 0,
          velocityY: 0,
          focus: null,
        });

        const expected = runScenario(inputKind, controller.getState(), boardState);
        const result = expected.result;

        assert.ok(Number.isFinite(result.x), `${inputKind}/${boundaryName}/${boardState} x`);
        assert.ok(Number.isFinite(result.y), `${inputKind}/${boundaryName}/${boardState} y`);
        assert.ok(result.zoom >= DEFAULT_CAMERA_CONTROLLER_OPTIONS.minZoom, `${inputKind}/${boundaryName}/${boardState} min zoom`);
        assert.ok(result.zoom <= DEFAULT_CAMERA_CONTROLLER_OPTIONS.maxZoom, `${inputKind}/${boundaryName}/${boardState} max zoom`);

        if (boardState === 'empty') {
          assert.deepEqual(result, expected.raw, `${inputKind}/${boundaryName}/empty raw equivalence`);
          if (inputKind === 'fit') {
            assert.deepEqual(result, {
              x: 0,
              y: 0,
              zoom: 1,
              velocityX: 0,
              velocityY: 0,
              focus: null,
            });
          }
          continue;
        }

        if (inputKind === 'fit') {
          assert.deepEqual(result, {
            x: 500,
            y: 500,
            zoom: 1 / 7,
            velocityX: 0,
            velocityY: 0,
            focus: null,
          });
          continue;
        }

        assert.ok(
          outsideDistance(result, activeRange(result.zoom)) <= outsideDistance(expected.raw, activeRange(expected.raw.zoom)) + 1e-9,
          `${inputKind}/${boundaryName}/${boardState} should not move farther outside`
        );
      }
    }
  }

  assert.equal(cases, 48);
});

function runScenario(inputKind, state, boardState) {
  const controller = new CameraController(state);
  const context = boardState === 'empty' ? {contentBounds: null, viewport} : {contentBounds, viewport};

  switch (inputKind) {
    case 'pan':
      return {
        raw: panCamera(state, 240, 240),
        result: controller.tick(16, contextWithAction(controller, 'pan')),
      };
    case 'inertia':
      controller.startInertia(240, 240);
      return {
        raw: tickWithoutBounds(startInertia(state, 240, 240), 16),
        result: controller.tick(16, context),
      };
    case 'wheel':
      controller.zoomAtCursor({deltaY: -120, cursor: {x: 100, y: 100}, viewport});
      return {
        raw: tickWithoutBounds(
          onCanvasWheel(state, {deltaY: -120, cursor: {x: 100, y: 100}, viewport}),
          0
        ),
        result: controller.tick(0, context),
      };
    case 'focus-minimap':
      controller.focusOnMinimapClick({
        click: {x: 100, y: 100},
        minimap: minimapBounds,
        contentBounds: boardState === 'empty' ? null : contentBounds,
      });
      return {
        raw: tickWithoutBounds(
          boardState === 'empty'
            ? beginFocusTransition(state, {x: 0, y: 0, zoom: 1})
            : beginFocusTransition(state, {x: 500, y: 500, zoom: state.zoom}),
          150
        ),
        result: controller.tick(150, context),
      };
    case 'focus-object':
      controller.focusOnObject(boardState === 'empty' ? null : objectBounds);
      return {
        raw: tickWithoutBounds(
          boardState === 'empty'
            ? beginFocusTransition(state, {x: 0, y: 0, zoom: 1})
            : beginFocusTransition(state, {x: 500, y: 400, zoom: state.zoom}),
          150
        ),
        result: controller.tick(150, context),
      };
    case 'fit':
      return {
        raw: {
          ...fitToContent(boardState === 'empty' ? null : contentBounds, viewport),
          velocityX: 0,
          velocityY: 0,
          focus: null,
        },
        result: controller.fitToContent(boardState === 'empty' ? null : contentBounds, viewport),
      };
    default:
      throw new Error(`Unknown input kind: ${inputKind}`);
  }
}

function contextWithAction(controller, action) {
  if (action !== 'pan') {
    return {contentBounds: null, viewport};
  }

  controller.panBy(240, 240);
  return {contentBounds: null, viewport};
}

function tickWithoutBounds(state, deltaTimeMs) {
  const controller = new CameraController(state);
  return controller.tick(deltaTimeMs, {contentBounds: null, viewport});
}

test('pan to inertia maintains directional continuity across zoom levels', () => {
  const controller = new CameraController({
    x: 0,
    y: 0,
    zoom: 2,
    velocityX: 0,
    velocityY: 0,
    focus: null,
  });

  // Dragging right on screen (+20px) moves camera left in world space (-10px)
  const afterPan = controller.panBy(20, 0);
  assert.equal(afterPan.x, -10);

  // Inertia with positive gesture velocity (+20px/frame) should continue moving camera left in world space
  const afterInertiaStart = controller.startInertia(20, 0);
  assert.equal(afterInertiaStart.velocityX, -10);

  const afterTick = controller.tick(16, {contentBounds: null, viewport});
  assert.ok(afterTick.x < afterPan.x, 'Camera should continue moving in the same direction during inertia');
});

test('wheel zoom, drag pan, and inertia can be driven through controller commands', () => {
  const controller = new CameraController({
    x: 200,
    y: 300,
    zoom: 1,
    velocityX: 0,
    velocityY: 0,
    focus: null,
  });

  const zoomed = controller.zoomAtCursor({
    deltaY: -120,
    cursor: {x: 50, y: 50},
    viewport: {width: 100, height: 100},
  });
  assert.ok(zoomed.zoom > 1);

  const panned = controller.panBy(20, 10);
  assert.equal(panned.x, zoomed.x - 20 / zoomed.zoom);
  assert.equal(panned.y, zoomed.y - 10 / zoomed.zoom);

  const inertial = controller.startInertia(60, 30);
  assert.equal(inertial.velocityX, -60 / panned.zoom);
  assert.equal(inertial.velocityY, -30 / panned.zoom);

  const ticked = tickCamera(inertial, 16, {contentBounds: null, viewport});
  assert.ok(ticked.x !== inertial.x || ticked.y !== inertial.y);
});

test('ビューポートがコンテンツを覆うズームでも、コンテンツが見える範囲は自由にパンできる', () => {
  const smallBounds = {left: 0, top: 0, right: 1000, bottom: 1000};
  const lowZoom = 0.02;
  const stageViewport = {width: 200, height: 200};

  // このズームでは範囲が逆転する（minX=4800 > maxX=-3800）。入れ替えて [-3800, 4800]
  // として扱うため、その内側にいるカメラは引き戻されない。
  const inside = new CameraController({x: 4000, y: 4000, zoom: lowZoom, velocityX: 0, velocityY: 0, focus: null});
  const insideTicked = inside.tick(16, {contentBounds: smallBounds, viewport: stageViewport, interacting: false});
  assert.equal(insideTicked.x, 4000, '範囲内のカメラはコンテンツ中心へ引き戻されない');
  assert.equal(insideTicked.y, 4000, '範囲内のカメラはコンテンツ中心へ引き戻されない');

  // 範囲外まで離れたカメラは従来どおり引き戻される。
  const outside = new CameraController({x: 40000, y: 40000, zoom: lowZoom, velocityX: 0, velocityY: 0, focus: null});
  const outsideTicked = outside.tick(16, {contentBounds: smallBounds, viewport: stageViewport, interacting: false});
  assert.ok(outsideTicked.x < 40000, '範囲外のカメラは引き戻される');
  assert.ok(outsideTicked.y < 40000, '範囲外のカメラは引き戻される');
});

test('resolveNewObjectGeometry centers new objects and offsets overlaps', () => {
  const camera = {x: 100, y: 200, zoom: 2};
  const viewport = {width: 400, height: 300};
  const base = resolveNewObjectGeometry(camera, viewport, []);
  assert.deepEqual(base, {
    x: 20,
    y: 140,
    w: 160,
    h: 120,
    rotation: 0,
  });

  const objects = [
    {geometry: {x: 20, y: 140}},
    {geometry: {x: 36, y: 156}},
  ].map((entry, index) => ({
    id: index + 1,
    boardId: 1,
    objectTypeCode: 'sticky',
    colorId: 1,
    geometry: {...entry.geometry, w: 160, h: 120, rotation: 0},
    locked: false,
  }));

  const offset = resolveNewObjectGeometry(camera, viewport, objects);
  assert.deepEqual(offset, {
    x: 52,
    y: 172,
    w: 160,
    h: 120,
    rotation: 0,
  });
});

test('fitToContent limits zoom to options.fitMaxZoom for small boards/objects', () => {
  const smallBounds = {left: 10, top: 10, right: 20, bottom: 20};
  const largeViewport = {width: 1000, height: 1000};

  // Verify default value (1.0)
  const resultDefault = fitToContent(smallBounds, largeViewport);
  assert.ok(resultDefault.zoom <= 1.0, `Zoom should be at most 1.0 for small content bounds by default (actual: ${resultDefault.zoom})`);

  // Verify custom value (0.5)
  const options = {
    ...DEFAULT_CAMERA_CONTROLLER_OPTIONS,
    fitMaxZoom: 0.5
  };
  const resultCustom = fitToContent(smallBounds, largeViewport, options);
  assert.ok(resultCustom.zoom <= 0.5, `Zoom should be at most 0.5 when fitMaxZoom is configured to 0.5 (actual: ${resultCustom.zoom})`);
});

test('fitToContent respects minZoom even if it exceeds the fitMaxZoom limit', () => {
  const smallBounds = {left: 10, top: 10, right: 20, bottom: 20};
  const largeViewport = {width: 1000, height: 1000};
  const options = {
    ...DEFAULT_CAMERA_CONTROLLER_OPTIONS,
    minZoom: 2.0,
    maxZoom: 4.0,
    fitMaxZoom: 1.0
  };
  const result = fitToContent(smallBounds, largeViewport, options);
  assert.equal(result.zoom, 2.0, `Zoom should be normalized to minZoom (2.0) rather than being inverted by fitMaxZoom limit`);
});

function activeRange(zoom) {
  const width = 1000;
  const height = 1000;
  const marginWidth = width * DEFAULT_CAMERA_CONTROLLER_OPTIONS.boundaryMarginRatio * 2;
  const marginHeight = height * DEFAULT_CAMERA_CONTROLLER_OPTIONS.boundaryMarginRatio * 2;
  const halfViewportWidth = viewport.width / (2 * zoom);
  const halfViewportHeight = viewport.height / (2 * zoom);
  const minX = 0 - (marginWidth / 2) + halfViewportWidth;
  const maxX = 1000 + (marginWidth / 2) - halfViewportWidth;
  const minY = 0 - (marginHeight / 2) + halfViewportHeight;
  const maxY = 1000 + (marginHeight / 2) - halfViewportHeight;

  // ビューポートがコンテンツ＋余白より大きいと min/max が逆転する。実装と同じく
  // 入れ替えて扱う（1点に潰すと fit ズーム以下でパンできなくなるため）。
  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
}

function outsideDistance(state, range) {
  return axisOutsideDistance(state.x, range.minX, range.maxX) + axisOutsideDistance(state.y, range.minY, range.maxY);
}

function axisOutsideDistance(value, min, max) {
  if (value < min) {
    return min - value;
  }

  if (value > max) {
    return value - max;
  }

  return 0;
}

test('concurrent pan and zoom maintains world coordinate under gesture center', () => {
  const controller = new CameraController({
    x: 200,
    y: 300,
    zoom: 1,
    velocityX: 0,
    velocityY: 0,
    focus: null,
  });
  const viewport = {width: 100, height: 100};

  const oldCenter = {x: 50, y: 50};
  const worldX = controller.getState().x + (oldCenter.x - viewport.width / 2) / controller.getState().zoom;
  const worldY = controller.getState().y + (oldCenter.y - viewport.height / 2) / controller.getState().zoom;

  const panDeltaX = 20;
  const panDeltaY = 10;
  const newCenter = {x: oldCenter.x + panDeltaX, y: oldCenter.y + panDeltaY};

  // 1. pan (using older zoom scale)
  const panned = controller.panBy(panDeltaX, panDeltaY);
  
  // 2. zoom (using new panned state at the new center)
  const zoomed = controller.zoomAtCursor({
    deltaY: -120,
    cursor: newCenter,
    viewport,
  });

  const newWorldX = zoomed.x + (newCenter.x - viewport.width / 2) / zoomed.zoom;
  const newWorldY = zoomed.y + (newCenter.y - viewport.height / 2) / zoomed.zoom;

  assert.ok(Math.abs(newWorldX - worldX) < 1e-9);
  assert.ok(Math.abs(newWorldY - worldY) < 1e-9);
});

// --- PR #114 レビュー指摘の回帰テスト -------------------------------------

test('操作中は境界の引き戻しを行わず、ユーザーのパン量がそのまま残る', () => {
  const bounds = {left: 0, top: 0, right: 1000, bottom: 1000};
  const stageViewport = {width: 1200, height: 800};
  const controller = new CameraController({x: 500, y: 500, zoom: 1, velocityX: 0, velocityY: 0, focus: null});

  // 右方向へ 300 ワールド単位ドラッグする（10 フレームに分けて適用）
  for (let index = 0; index < 10; index += 1) {
    controller.panBy(-30, 0);
    controller.tick(16, {contentBounds: bounds, viewport: stageViewport, interacting: true});
  }

  assert.equal(controller.getState().x, 800, 'ドラッグ中は毎フレームの引き戻しで打ち消されない');

  // 指を離すと範囲内へ戻る（このズームでは minX=400 / maxX=600）
  for (let index = 0; index < 120; index += 1) {
    controller.tick(16, {contentBounds: bounds, viewport: stageViewport, interacting: false});
  }

  assert.ok(controller.getState().x <= 600 + 1e-6, '解放後は範囲内へ引き戻される');
  assert.ok(controller.getState().x >= 400 - 1e-6, '引き戻しは範囲の内側で止まる');
});

test('フィットズームでもパンできる（範囲が1点に潰れない）', () => {
  const bounds = {left: 0, top: 0, right: 1000, bottom: 1000};
  const stageViewport = {width: 1200, height: 800};
  const controller = new CameraController({x: 0, y: 0, zoom: 1, velocityX: 0, velocityY: 0, focus: null});

  const fitted = controller.fitToContent(bounds, stageViewport);
  const startX = fitted.x;

  controller.panBy(-120, 0);
  const settled = (() => {
    let state = controller.getState();
    for (let index = 0; index < 120; index += 1) {
      state = controller.tick(16, {contentBounds: bounds, viewport: stageViewport, interacting: false});
    }
    return state;
  })();

  assert.notEqual(settled.x, startX, 'フィットズームでもカメラを動かせる');
});

test('慣性は有限フレームで完全に停止し、velocity が 0 になる', () => {
  const controller = new CameraController({x: 0, y: 0, zoom: 1, velocityX: 0, velocityY: 0, focus: null});
  controller.startInertia(20, 0);

  let frames = 0;
  while (frames < 1000) {
    const state = controller.tick(16, {contentBounds: null, viewport, interacting: false});
    frames += 1;
    if (state.velocityX === 0 && state.velocityY === 0) {
      break;
    }
  }

  assert.ok(frames < 300, `慣性は 300 フレーム以内に停止すること（実際: ${frames}）`);
  assert.equal(controller.getState().velocityX, 0);
  assert.equal(controller.getState().velocityY, 0);

  // 停止後は状態が一切変化しない（再レンダリングを誘発しない）
  const stopped = controller.getState();
  const afterStop = controller.tick(16, {contentBounds: null, viewport, interacting: false});
  assert.equal(afterStop.x, stopped.x);
  assert.equal(afterStop.velocityX, 0);
  assert.equal(afterStop.velocityY, 0);
});

test('zoomByScale は指間距離の倍率で直接ズームし、ホイールの感触定数に依存しない', () => {
  const stageViewport = {width: 200, height: 200};
  const cursor = {x: 100, y: 100};
  const initialState = {x: 0, y: 0, zoom: 1, velocityX: 0, velocityY: 0, focus: null};

  const controller = new CameraController({...initialState});
  const zoomed = controller.zoomByScale({scale: 2, cursor, viewport: stageViewport});
  assert.equal(zoomed.zoom, 2, '倍率 2 のピンチはズームを 2 倍にする');

  // wheelZoomExponent を変えてもピンチの結果は変わらない
  const retuned = new CameraController({...initialState}, {
    ...DEFAULT_CAMERA_CONTROLLER_OPTIONS,
    wheelZoomExponent: DEFAULT_CAMERA_CONTROLLER_OPTIONS.wheelZoomExponent * 10,
  });
  assert.equal(retuned.zoomByScale({scale: 2, cursor, viewport: stageViewport}).zoom, 2);

  // カーソル位置のワールド座標は保たれる
  const worldX = initialState.x + (cursor.x - stageViewport.width / 2) / initialState.zoom;
  const zoomedWorldX = zoomed.x + (cursor.x - stageViewport.width / 2) / zoomed.zoom;
  assert.ok(Math.abs(zoomedWorldX - worldX) < 1e-9);

  // 不正な倍率は握りつぶさず例外にする
  const guarded = new CameraController({...initialState});
  assert.throws(() => guarded.zoomByScale({scale: 0, cursor, viewport: stageViewport}), /positive finite scale/);
  assert.throws(() => guarded.zoomByScale({scale: Number.NaN, cursor, viewport: stageViewport}), /positive finite scale/);
});

test('引き戻しの抑止は次の tick で必ず解除され、操作の取りこぼしで固定化しない', () => {
  const bounds = {left: 0, top: 0, right: 1000, bottom: 1000};
  const stageViewport = {width: 1200, height: 800};
  const controller = new CameraController({x: 500, y: 500, zoom: 1, velocityX: 0, velocityY: 0, focus: null});

  // ジェスチャ終端の通知が無くても（interacting は常に false）、パンした
  // フレームだけ引き戻しを見送り、以降のフレームでは引き戻しが働く。
  controller.panBy(-300, 0);
  const duringDrag = controller.tick(16, {contentBounds: bounds, viewport: stageViewport, interacting: false});
  assert.equal(duringDrag.x, 800, 'パンした直後のフレームは引き戻さない');

  const afterRelease = controller.tick(16, {contentBounds: bounds, viewport: stageViewport, interacting: false});
  assert.ok(afterRelease.x < 800, '操作が止まった次のフレームから引き戻しが働く');
});
