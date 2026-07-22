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

test('resolveCameraRange locks camera position to content center when viewport exceeds expanded bounds', () => {
  const smallBounds = {left: 0, top: 0, right: 1000, bottom: 1000};
  const lowZoom = 0.02;
  const controller = new CameraController({
    x: 4000,
    y: 4000,
    zoom: lowZoom,
    velocityX: 0,
    velocityY: 0,
    focus: null,
  });

  const ticked = controller.tick(16, {contentBounds: smallBounds, viewport: {width: 200, height: 200}});
  // Camera should be softened towards center (500), not allowed at x = 4000
  assert.ok(ticked.x < 4000, 'Camera x position should be constrained towards content center');
  assert.ok(ticked.y < 4000, 'Camera y position should be constrained towards content center');
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

  const centerX = 500;
  const centerY = 500;

  return {
    minX: minX > maxX ? centerX : minX,
    maxX: minX > maxX ? centerX : maxX,
    minY: minY > maxY ? centerY : minY,
    maxY: minY > maxY ? centerY : maxY,
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
