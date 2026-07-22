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
  globalThis.document = {
    pointerLockElement: null,
    exitPointerLock() {},
  };
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
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 20, movementY: 4, elapsedTimeMs: 20, hitTarget: blank, modifiers: modifiers({spaceKey: true}), selection: selected}, {kind: 'pan', source: 'space', deltaX: 20, deltaY: 4}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 4, touchCount: 1, movementX: 15, movementY: 0, elapsedTimeMs: 20, hitTarget: blank, modifiers: modifiers(), selection: selected}, {kind: 'pan', source: 'button', deltaX: 15, deltaY: 0}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 30, movementY: 10, elapsedTimeMs: 40, hitTarget: handle, modifiers: modifiers(), selection: selected}, {kind: 'resize', mode: 'rotate'}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 30, movementY: 10, elapsedTimeMs: 40, hitTarget: connection, modifiers: modifiers(), selection: selected}, {kind: 'connect'}],
    [{kind: 'pointer', phase: 'change', device: 'mouse', buttons: 1, touchCount: 1, movementX: 30, movementY: 10, elapsedTimeMs: 40, hitTarget: object, modifiers: modifiers({ctrlKey: true}), selection: selected}, {kind: 'move', duplicate: true}],
    [{kind: 'pointer', phase: 'end', device: 'mouse', buttons: 0, touchCount: 1, movementX: 1, movementY: 1, elapsedTimeMs: 60, hitTarget: object, modifiers: modifiers({shiftKey: true}), selection: selected}, {kind: 'select', mode: 'remove'}],
    [{kind: 'pointer', phase: 'end', device: 'mouse', buttons: 0, touchCount: 1, movementX: 1, movementY: 1, elapsedTimeMs: 60, hitTarget: blank, modifiers: modifiers(), selection: {selectedIds: ['node-1']}}, {kind: 'select', mode: 'clear'}],
    [{kind: 'pointer', phase: 'change', device: 'touch', buttons: 1, touchCount: 2, movementX: 18, movementY: 2, elapsedTimeMs: 25, hitTarget: blank, modifiers: modifiers(), selection: selected, activeTool: 'lasso'}, {kind: 'pan', source: 'touch', deltaX: 18, deltaY: 2}],
    [{kind: 'pointer', phase: 'change', device: 'touch', buttons: 1, touchCount: 2, movementX: 18, movementY: 2, elapsedTimeMs: 25, hitTarget: blank, modifiers: modifiers(), selection: selected, pinchDistanceDeltaPx: 14}, {kind: 'zoom', source: 'pinch', amount: 14, precision: false}],
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
  canvas.dispatchEvent(new FakePointerEvent('pointerup', {pointerId: 1, pointerType: 'mouse', buttons: 0, button: 0, clientX: 24, clientY: 4, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakeKeyboardEvent('keyup', {key: ' '}));

  intents.length = 0;
  canvas.nextHitTarget = new FakeHitElement({'data-obj-id': 'node-1'});
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 2, pointerType: 'mouse', buttons: 1, button: 0, clientX: 0, clientY: 0, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false}));
  canvas.dispatchEvent(new FakePointerEvent('pointermove', {pointerId: 2, pointerType: 'mouse', buttons: 1, button: 0, clientX: 20, clientY: 5, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false}));
  assert.deepEqual(intents.at(-1), {kind: 'move', duplicate: true});

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

  intents.length = 0;
  canvas.nextHitTarget = null;
  canvas.dispatchEvent(new FakePointerEvent('pointerdown', {pointerId: 8, pointerType: 'mouse', buttons: 1, button: 0, clientX: 50, clientY: 50, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false}));
  await wait(550);
  assert.deepEqual(intents.at(-1), {kind: 'radial-menu', source: 'longpress'});

  followUpController.detach();
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
