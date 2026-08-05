import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

if (typeof globalThis.HTMLElement === 'undefined') {
  globalThis.HTMLElement = class HTMLElement extends EventTarget {
    setPointerCapture() {}
    releasePointerCapture() {}
    hasPointerCapture() {
      return false;
    }
  };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = new (class FakeDocument extends EventTarget {
    createElement() {
      return {};
    }
  })();
  globalThis.document.pointerLockElement = null;
  globalThis.document.exitPointerLock = () => {};
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = new (class FakeWindow extends EventTarget {})();
  globalThis.window.document = globalThis.document;
  globalThis.window.navigator = {maxTouchPoints: 0};
  globalThis.window.onpointerdown = null;
  globalThis.window.ontouchstart = null;
  globalThis.window.setTimeout = globalThis.setTimeout.bind(globalThis);
  globalThis.window.clearTimeout = globalThis.clearTimeout.bind(globalThis);
}

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/input-intent-resolver.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

class FakeHitElement extends HTMLElement {
  constructor(attrs = {}) {
    super();
    this.attrs = new Map(Object.entries(attrs));
    this.nextHitTarget = null;
  }

  closest(selector) {
    if (selector === '[data-obj-id]' && this.nextHitTarget) {
      return this.nextHitTarget;
    }

    return selector === '[data-obj-id]' && this.attrs.has('data-obj-id') ? this : null;
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }

  getBoundingClientRect() {
    return {left: 0, top: 0, right: 100, bottom: 100};
  }
}

class FakePointerEvent extends Event {
  constructor(type, props = {}) {
    super(type, {bubbles: true, cancelable: true});
    Object.assign(this, props);
  }
}

class FakeWheelEvent extends Event {
  constructor(type, props = {}) {
    super(type, {bubbles: true, cancelable: true});
    Object.assign(this, props);
  }
}

class FakeKeyboardEvent extends Event {
  constructor(type, props = {}) {
    super(type, {bubbles: true, cancelable: true});
    Object.assign(this, props);
  }
}

const loadedModule = await loadModule();
const {
  CanvasInputController,
  InputIntentResolver,
  resolveCanvasIntent,
  resolveHitTargetFromElement,
} = loadedModule;

test('resolveHitTargetFromElement reads data-obj-id based hit targets', () => {
  const blank = new FakeHitElement();
  const objectEl = new FakeHitElement({'data-obj-id': 'node-1'});
  const handleEl = new FakeHitElement({'data-obj-id': 'node-2', 'data-hit-target': 'handle', 'data-handle-mode': 'rotate'});
  const textEl = new FakeHitElement({'data-obj-id': 'node-3', 'data-hit-target': 'text', 'data-text-editable': 'true'});

  assert.deepEqual(resolveHitTargetFromElement(blank), {kind: 'blank'});
  assert.deepEqual(resolveHitTargetFromElement(objectEl), {kind: 'object', objectId: 'node-1', textEditable: undefined});
  assert.deepEqual(resolveHitTargetFromElement(handleEl), {
    kind: 'handle',
    objectId: 'node-2',
    textEditable: undefined,
    handleMode: 'rotate',
  });
  assert.deepEqual(resolveHitTargetFromElement(textEl), {
    kind: 'text',
    objectId: 'node-3',
    textEditable: true,
  });
});

test('resolveCanvasIntent returns the expected intent for key F1 scenarios', () => {
  const resolver = new InputIntentResolver();
  const selected = {selectedIds: ['node-1']};
  const blank = {kind: 'blank'};
  const object = {kind: 'object', objectId: 'node-1'};
  const handle = {kind: 'handle', objectId: 'node-1', handleMode: 'rotate'};
  const connection = {kind: 'connection-point', objectId: 'node-1'};
  const text = {kind: 'text', objectId: 'node-1', textEditable: true};

  const cases = [
    [{kind: 'wheel', phase: 'wheel', deltaX: 0, deltaY: -120, hitTarget: blank, modifiers: modifiers(), selection: selected}, {kind: 'zoom', source: 'wheel', amount: -120, precision: false}],
    [{kind: 'wheel', phase: 'wheel', deltaX: 0, deltaY: -1, hitTarget: blank, modifiers: modifiers({ctrlKey: true}), selection: selected}, {kind: 'zoom', source: 'wheel', amount: -1, precision: true}],
    [{kind: 'wheel', phase: 'wheel', deltaX: 12, deltaY: -3, hitTarget: blank, modifiers: modifiers({shiftKey: true}), selection: selected}, {kind: 'pan', source: 'wheel', deltaX: -3, deltaY: 12}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 20, movementY: 4, elapsedTimeMs: 20, hitTarget: blank, modifiers: modifiers({spaceKey: true}), selection: selected}, {kind: 'pan', source: 'space', phase: 'change', deltaX: 20, deltaY: 4, velocityX: undefined, velocityY: undefined}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 4, touchCount: 1, movementX: 15, movementY: 0, elapsedTimeMs: 20, hitTarget: blank, modifiers: modifiers(), selection: selected}, {kind: 'pan', source: 'button', phase: 'change', deltaX: 15, deltaY: 0, velocityX: undefined, velocityY: undefined}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 30, movementY: 10, elapsedTimeMs: 40, hitTarget: handle, modifiers: modifiers(), selection: selected}, {kind: 'resize', mode: 'rotate'}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 30, movementY: 10, elapsedTimeMs: 40, hitTarget: connection, modifiers: modifiers(), selection: selected}, {kind: 'connect'}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 30, movementY: 10, elapsedTimeMs: 40, hitTarget: object, modifiers: modifiers({ctrlKey: true}), selection: selected}, {kind: 'move', duplicate: true}],
    [{kind: 'pointer', phase: 'end', device: 'mouse', buttons: 0, touchCount: 1, movementX: 1, movementY: 1, elapsedTimeMs: 60, hitTarget: object, modifiers: modifiers({shiftKey: true}), selection: selected}, {kind: 'select', mode: 'remove'}],
    [{kind: 'pointer', phase: 'end', device: 'mouse', buttons: 0, touchCount: 1, movementX: 1, movementY: 1, elapsedTimeMs: 60, hitTarget: blank, modifiers: modifiers(), selection: {selectedIds: ['node-1']}}, {kind: 'select', mode: 'clear'}],
    [{kind: 'pointer', phase: 'change', device: 'touch', buttons: 1, touchCount: 2, movementX: 18, movementY: 2, elapsedTimeMs: 25, hitTarget: blank, modifiers: modifiers(), selection: selected, activeTool: 'lasso'}, {kind: 'pan', source: 'touch', phase: 'change', deltaX: 18, deltaY: 2, velocityX: undefined, velocityY: undefined}],
    [{kind: 'pointer', phase: 'change', device: 'touch', buttons: 1, touchCount: 2, movementX: 18, movementY: 2, elapsedTimeMs: 25, hitTarget: blank, modifiers: modifiers(), selection: selected, pinchDistanceDeltaPx: 14}, {kind: 'zoom', source: 'pinch', amount: 14, precision: false, centerX: undefined, centerY: undefined}],
    [{kind: 'pointer', phase: 'longpress', device: 'mouse', buttons: 1, touchCount: 1, movementX: 1, movementY: 1, elapsedTimeMs: 500, hitTarget: blank, modifiers: modifiers(), selection: selected}, {kind: 'radial-menu', source: 'longpress'}],
    [{kind: 'pointer', phase: 'dblclick', device: 'mouse', buttons: 1, touchCount: 1, movementX: 0, movementY: 0, elapsedTimeMs: 0, hitTarget: text, modifiers: modifiers(), selection: selected}, {kind: 'edit-text'}],
    [{kind: 'pointer', phase: 'dblclick', device: 'mouse', buttons: 1, touchCount: 1, movementX: 0, movementY: 0, elapsedTimeMs: 0, hitTarget: blank, modifiers: modifiers(), selection: selected}, {kind: 'create-note'}],
    [{kind: 'pointer', phase: 'change', device: 'pen', buttons: 1, touchCount: 1, movementX: 1, movementY: 0, elapsedTimeMs: 12, hitTarget: blank, modifiers: modifiers(), selection: selected, palmContactAreaPx2: 0}, {kind: 'draw'}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 1, movementY: 0, elapsedTimeMs: 12, hitTarget: blank, modifiers: modifiers(), selection: selected, palmContactAreaPx2: 2400}, {kind: 'ignore'}],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(resolver.resolve(input), expected);
    assert.deepEqual(resolveCanvasIntent(input), expected);
  }
});

test('CanvasInputController routes gestures, wheel, keyboard, and cancellation', async () => {
  const intents = [];
  const canvas = new FakeHitElement();
  const controller = new CanvasInputController({
    onIntent(intent) {
      intents.push(intent);
    },
    getSelection() {
      return ['node-1'];
    },
    getActiveTool() {
      return 'lasso';
    },
  });

  await controller.attach(canvas);

  canvas.nextHitTarget = new FakeHitElement({'data-obj-id': 'node-1'});
  canvas.dispatchEvent(new FakeWheelEvent('wheel', {deltaX: 0, deltaY: -120, ctrlKey: true}));
  assert.deepEqual(intents.at(-1), {kind: 'zoom', source: 'wheel', amount: -120, precision: true});

  intents.length = 0;
  canvas.dispatchEvent(new FakePointerEvent('contextmenu', {buttons: 2, button: 2, clientX: 8, clientY: 8, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  assert.deepEqual(intents.at(-1), {kind: 'radial-menu', source: 'contextmenu'});

  intents.length = 0;
  canvas.dispatchEvent(new FakeKeyboardEvent('keydown', {key: ' '}));
  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 1, pointerType: 'mouse', buttons: 1, button: 0, clientX: 0, clientY: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 1, pointerType: 'mouse', buttons: 1, button: 0, clientX: 24, clientY: 4, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  assert.equal(intents.at(-1)?.kind, 'pan');
  assert.equal(intents.at(-1)?.source, 'space');
  assert.equal(intents.at(-1)?.phase, 'change');
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 1, pointerType: 'mouse', buttons: 0, button: 0, clientX: 24, clientY: 4, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  const endIntent = intents.find(i => i.source === 'space' && i.phase === 'end');
  assert.ok(endIntent !== undefined);
  assert.equal(endIntent.kind, 'pan');
  assert.ok(endIntent.velocityX !== undefined);
  assert.ok(endIntent.velocityY !== undefined);
  canvas.dispatchEvent(new FakeKeyboardEvent('keyup', {key: ' '}));

  intents.length = 0;
  canvas.nextHitTarget = new FakeHitElement({'data-obj-id': 'node-1'});
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 2, pointerType: 'mouse', buttons: 1, button: 0, clientX: 0, clientY: 0, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 2, pointerType: 'mouse', buttons: 1, button: 0, clientX: 20, clientY: 5, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false}));
  assert.deepEqual(intents.at(-1), {kind: 'move', duplicate: true});
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 2, pointerType: 'mouse', buttons: 0, button: 0, clientX: 20, clientY: 5, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false}));

  intents.length = 0;
  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 3, pointerType: 'mouse', buttons: 1, button: 0, clientX: 10, clientY: 10, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 3, pointerType: 'mouse', buttons: 0, button: 0, clientX: 10, clientY: 10, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  assert.deepEqual(intents.at(-1), {kind: 'select', mode: 'clear'});

  intents.length = 0;
  canvas.nextHitTarget = new FakeHitElement({'data-obj-id': 'node-2', 'data-hit-target': 'text', 'data-text-editable': 'true'});
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 4, pointerType: 'mouse', buttons: 1, button: 0, clientX: 14, clientY: 14, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 4, pointerType: 'mouse', buttons: 0, button: 0, clientX: 14, clientY: 14, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new Event('dblclick', {bubbles: true, cancelable: true}));
  assert.deepEqual(intents.at(-1), {kind: 'edit-text'});

  controller.detach();
  await wait(10);
  const followUpController = new CanvasInputController({
    onIntent(intent) {
      intents.push(intent);
    },
    getSelection() {
      return ['node-1'];
    },
    getActiveTool() {
      return 'lasso';
    },
  });
  await followUpController.attach(canvas);

  intents.length = 0;
  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 5, pointerType: 'mouse', buttons: 1, button: 0, clientX: 5, clientY: 5, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointercancel', {pointerId: 5, pointerType: 'mouse', buttons: 0, button: 0, clientX: 5, clientY: 5, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  await wait(20);
  assert.deepEqual(intents, []);

  intents.length = 0;
  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 6, pointerType: 'mouse', buttons: 1, button: 0, clientX: 30, clientY: 30, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 7, pointerType: 'mouse', buttons: 1, button: 0, clientX: 40, clientY: 30, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 7, pointerType: 'mouse', buttons: 1, button: 0, clientX: 60, clientY: 30, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  assert.equal(intents.at(-1)?.kind, 'zoom');
  assert.equal(intents.at(-1)?.source, 'pinch');
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 6, pointerType: 'mouse', buttons: 0, button: 0, clientX: 30, clientY: 30, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 7, pointerType: 'mouse', buttons: 0, button: 0, clientX: 60, clientY: 30, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));

  intents.length = 0;
  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 8, pointerType: 'mouse', buttons: 1, button: 0, clientX: 50, clientY: 50, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 8, pointerType: 'mouse', buttons: 0, button: 0, clientX: 50, clientY: 50, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));

  // 2-finger pan & inertia test
  intents.length = 0;
  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 9, pointerType: 'mouse', buttons: 1, button: 0, clientX: 100, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 10, pointerType: 'mouse', buttons: 1, button: 0, clientX: 150, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  
  // Move in small steps (< 8px zoom threshold) to avoid triggering zoom activation
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 9, pointerType: 'mouse', buttons: 1, button: 0, clientX: 104, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 10, pointerType: 'mouse', buttons: 1, button: 0, clientX: 154, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 9, pointerType: 'mouse', buttons: 1, button: 0, clientX: 108, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 10, pointerType: 'mouse', buttons: 1, button: 0, clientX: 158, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));

  const panIntents = intents.filter(i => i.kind === 'pan' && i.source === 'touch');
  assert.ok(panIntents.length > 0);
  assert.ok(panIntents.some(i => i.deltaX !== 0));

  // Verify that the intents are not duplicated (DragGesture does not dispatch dual pan intents for touchCount >= 2)
  const changePanIntents = panIntents.filter(i => i.phase === 'change');
  assert.ok(changePanIntents.length <= 5);

  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 9, pointerType: 'mouse', buttons: 0, button: 0, clientX: 108, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 10, pointerType: 'mouse', buttons: 0, button: 0, clientX: 158, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));

  const endPanIntent = intents.find(i => i.kind === 'pan' && i.source === 'touch' && i.phase === 'end');
  assert.ok(endPanIntent !== undefined);
  assert.ok(endPanIntent.velocityX !== undefined && endPanIntent.velocityX > 0);

  // Drag pan threshold cumulative test (split vs single)
  const intentsSingle = [];
  const controllerSingle = new CanvasInputController({
    onIntent(intent) { intentsSingle.push(intent); }
  });
  await controllerSingle.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 20, pointerType: 'mouse', buttons: 4, button: 1, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 20, pointerType: 'mouse', buttons: 4, clientX: 112, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 20, pointerType: 'mouse', buttons: 0, button: 1, clientX: 112, clientY: 100}));
  controllerSingle.detach();

  const intentsSplit = [];
  const controllerSplit = new CanvasInputController({
    onIntent(intent) { intentsSplit.push(intent); }
  });
  await controllerSplit.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 21, pointerType: 'mouse', buttons: 4, button: 1, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 21, pointerType: 'mouse', buttons: 4, clientX: 104, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 21, pointerType: 'mouse', buttons: 4, clientX: 108, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 21, pointerType: 'mouse', buttons: 4, clientX: 112, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 21, pointerType: 'mouse', buttons: 0, button: 1, clientX: 112, clientY: 100}));
  controllerSplit.detach();

  const totalPanSingle = intentsSingle.filter(i => i.kind === 'pan').reduce((acc, i) => acc + (i.deltaX ?? 0), 0);
  const totalPanSplit = intentsSplit.filter(i => i.kind === 'pan').reduce((acc, i) => acc + (i.deltaX ?? 0), 0);
  assert.equal(totalPanSingle, 12);
  assert.equal(totalPanSplit, 12);

  // Pinch zoom threshold cumulative test (split vs single)
  const intentsZoomSingle = [];
  const controllerZoomSingle = new CanvasInputController({
    onIntent(intent) { intentsZoomSingle.push(intent); }
  });
  await controllerZoomSingle.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 30, pointerType: 'mouse', buttons: 1, button: 0, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 31, pointerType: 'mouse', buttons: 1, button: 0, clientX: 150, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 31, pointerType: 'mouse', buttons: 1, button: 0, clientX: 170, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 30, pointerType: 'mouse', buttons: 0, button: 0, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 31, pointerType: 'mouse', buttons: 0, button: 0, clientX: 170, clientY: 100}));
  controllerZoomSingle.detach();

  const intentsZoomSplit = [];
  const controllerZoomSplit = new CanvasInputController({
    onIntent(intent) { intentsZoomSplit.push(intent); }
  });
  await controllerZoomSplit.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 32, pointerType: 'mouse', buttons: 1, button: 0, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 33, pointerType: 'mouse', buttons: 1, button: 0, clientX: 150, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 33, pointerType: 'mouse', buttons: 1, button: 0, clientX: 154, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 33, pointerType: 'mouse', buttons: 1, button: 0, clientX: 158, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 33, pointerType: 'mouse', buttons: 1, button: 0, clientX: 162, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 33, pointerType: 'mouse', buttons: 1, button: 0, clientX: 166, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 33, pointerType: 'mouse', buttons: 1, button: 0, clientX: 170, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 32, pointerType: 'mouse', buttons: 0, button: 0, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 33, pointerType: 'mouse', buttons: 0, button: 0, clientX: 170, clientY: 100}));
  controllerZoomSplit.detach();

  const totalZoomSingle = intentsZoomSingle.filter(i => i.kind === 'zoom').reduce((acc, i) => acc + (i.amount ?? 0), 0);
  const totalZoomSplit = intentsZoomSplit.filter(i => i.kind === 'zoom').reduce((acc, i) => acc + (i.amount ?? 0), 0);
  assert.equal(totalZoomSingle, 20);
  assert.equal(totalZoomSplit, 20);

  // Pinch zoom round-trip test (expand past threshold, then return to start)
  const intentsRoundTrip = [];
  const controllerRoundTrip = new CanvasInputController({
    onIntent(intent) { intentsRoundTrip.push(intent); }
  });
  await controllerRoundTrip.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 40, pointerType: 'mouse', buttons: 1, button: 0, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 41, pointerType: 'mouse', buttons: 1, button: 0, clientX: 150, clientY: 100}));
  
  // Expand 10px (threshold 8px exceeded, zoom activates: amount = 10)
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 41, pointerType: 'mouse', buttons: 1, button: 0, clientX: 160, clientY: 100}));
  
  // Return to start distance (distance delta drops to 0, should still zoom: amount = -10)
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 41, pointerType: 'mouse', buttons: 1, button: 0, clientX: 150, clientY: 100}));
  
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 40, pointerType: 'mouse', buttons: 0, button: 0, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 41, pointerType: 'mouse', buttons: 0, button: 0, clientX: 150, clientY: 100}));
  controllerRoundTrip.detach();

  const zoomIntents = intentsRoundTrip.filter(i => i.kind === 'zoom');
  const totalZoomRoundTrip = zoomIntents.reduce((acc, i) => acc + (i.amount ?? 0), 0);
  assert.equal(totalZoomRoundTrip, 0);
  assert.ok(zoomIntents.some(i => i.amount === 10));
  assert.ok(zoomIntents.some(i => i.amount === -10));

  // Verify 2-finger pan is independent of pointermove order (no premature zoom activation)
  const intentsOrderA = [];
  const controllerOrderA = new CanvasInputController({
    onIntent(intent) { intentsOrderA.push(intent); }
  });
  await controllerOrderA.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 50, pointerType: 'touch', buttons: 1, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 51, pointerType: 'touch', buttons: 1, clientX: 150, clientY: 100}));

  // Pattern A: Move 50 first, then 51
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 50, pointerType: 'touch', buttons: 1, clientX: 104, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 51, pointerType: 'touch', buttons: 1, clientX: 154, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 50, pointerType: 'touch', buttons: 1, clientX: 108, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 51, pointerType: 'touch', buttons: 1, clientX: 158, clientY: 100}));

  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 50, pointerType: 'touch', buttons: 0, clientX: 108, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 51, pointerType: 'touch', buttons: 0, clientX: 158, clientY: 100}));
  controllerOrderA.detach();

  const intentsOrderB = [];
  const controllerOrderB = new CanvasInputController({
    onIntent(intent) { intentsOrderB.push(intent); }
  });
  await controllerOrderB.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 52, pointerType: 'touch', buttons: 1, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 53, pointerType: 'touch', buttons: 1, clientX: 150, clientY: 100}));

  // Pattern B: Move 53 first, then 52
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 53, pointerType: 'touch', buttons: 1, clientX: 154, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 52, pointerType: 'touch', buttons: 1, clientX: 104, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 53, pointerType: 'touch', buttons: 1, clientX: 158, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 52, pointerType: 'touch', buttons: 1, clientX: 108, clientY: 100}));

  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 52, pointerType: 'touch', buttons: 0, clientX: 108, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 53, pointerType: 'touch', buttons: 0, clientX: 158, clientY: 100}));
  controllerOrderB.detach();

  // Both should only result in pan intents, no zoom intents
  assert.equal(intentsOrderA.filter(i => i.kind === 'zoom').length, 0);
  assert.equal(intentsOrderB.filter(i => i.kind === 'zoom').length, 0);

  const totalPanA = intentsOrderA.filter(i => i.kind === 'pan').reduce((acc, i) => acc + (i.deltaX ?? 0), 0);
  const totalPanB = intentsOrderB.filter(i => i.kind === 'pan').reduce((acc, i) => acc + (i.deltaX ?? 0), 0);
  assert.ok(totalPanA > 0);
  assert.equal(totalPanA, totalPanB);

  // Verify touch release inertia: active for fast flick, zeroed for pause before release
  const intentsPause = [];
  const controllerPause = new CanvasInputController({
    onIntent(intent) { intentsPause.push(intent); }
  });
  await controllerPause.attach(canvas);
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 62, pointerType: 'touch', buttons: 1, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 63, pointerType: 'touch', buttons: 1, clientX: 150, clientY: 100}));
  
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 63, pointerType: 'touch', buttons: 1, clientX: 180, clientY: 100}));

  // Wait 150ms to simulate a static pause
  await new Promise(resolve => setTimeout(resolve, 150));

  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 62, pointerType: 'touch', buttons: 0, clientX: 100, clientY: 100}));
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 63, pointerType: 'touch', buttons: 0, clientX: 180, clientY: 100}));
  controllerPause.detach();

  const endPanPause = intentsPause.find(i => i.kind === 'pan' && i.source === 'touch' && i.phase === 'end');
  assert.ok(endPanPause !== undefined);
  assert.equal(endPanPause.velocityX, 0);
  assert.equal(endPanPause.velocityY, 0);

  followUpController.detach();
});

test('attach during detach cancels initialization and prevents leaking event listeners', async () => {
  const intents = [];
  const canvas = new FakeHitElement();
  const controller = new CanvasInputController({
    onIntent(intent) {
      intents.push(intent);
    },
  });

  const pendingAttach = controller.attach(canvas);
  controller.detach();
  await pendingAttach;

  canvas.dispatchEvent(new FakeWheelEvent('wheel', {deltaX: 0, deltaY: -120, ctrlKey: true}));
  assert.equal(intents.length, 0);
});

test('longpress remains active on subsequent pointer moves and prevents resuming normal drag', async () => {
  const intents = [];
  const canvas = new FakeHitElement();
  const controller = new CanvasInputController({
    onIntent(intent) {
      intents.push(intent);
    },
  });

  await controller.attach(canvas);

  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 10, pointerType: 'mouse', buttons: 1, button: 0, clientX: 50, clientY: 50}));
  await wait(550);

  assert.deepEqual(intents, [{kind: 'radial-menu', source: 'longpress'}]);

  // First move after longpress
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 10, pointerType: 'mouse', buttons: 1, button: 0, clientX: 80, clientY: 50}));
  // Second move after longpress (should not trigger marquee/drag)
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 10, pointerType: 'mouse', buttons: 1, button: 0, clientX: 100, clientY: 50}));
  // Pointer release
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 10, pointerType: 'mouse', buttons: 0, button: 0, clientX: 100, clientY: 50}));

  // No additional intents should be fired after the radial menu
  assert.equal(intents.length, 1);

  controller.detach();
});

test('space key state resets on window blur to avoid stuck pan mode', async () => {
  const intents = [];
  const canvas = new FakeHitElement();
  const controller = new CanvasInputController({
    onIntent(intent) {
      intents.push(intent);
    },
  });

  await controller.attach(canvas);

  canvas.dispatchEvent(new FakeKeyboardEvent('keydown', {key: ' '}));
  window.dispatchEvent(new Event('blur'));

  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 20, pointerType: 'mouse', buttons: 1, button: 0, clientX: 0, clientY: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 20, pointerType: 'mouse', buttons: 1, button: 0, clientX: 24, clientY: 4, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));

  assert.equal(intents.at(-1)?.kind, 'marquee');

  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 20, pointerType: 'mouse', buttons: 0, button: 0, clientX: 24, clientY: 4, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  controller.detach();
});

function modifiers(overrides = {}) {
  return {
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    spaceKey: false,
    ...overrides,
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
