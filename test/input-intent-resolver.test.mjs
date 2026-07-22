import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadResolverModule() {
  const source = await readFile(path.join(root, 'src/lib/input-intent-resolver.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const {
  InputIntentResolver,
  resolveCanvasIntent,
  resolveHitTargetFromElement,
  CanvasInputController
} = await loadResolverModule();

function makeResolver() {
  return new InputIntentResolver();
}

function makeInput(overrides = {}) {
  return {
    eventType: 'click',
    device: 'mouse',
    button: 'left',
    touchCount: 1,
    modifiers: {},
    hitTarget: {kind: 'blank'},
    currentSelection: {activeTool: 'select'},
    ...overrides
  };
}

function intentKind(intent) {
  return intent.kind;
}

test('wheel, pan, long-press, and palm rejection map to the expected intents', () => {
  const resolver = makeResolver();

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'wheel',
    modifiers: {}
  }))), 'zoom');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'wheel',
    modifiers: {ctrlKey: true}
  }))), 'zoom');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'wheel',
    modifiers: {shiftKey: true}
  }))), 'pan');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'drag',
    button: 'middle'
  }))), 'pan');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'drag',
    button: 'right'
  }))), 'pan');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'drag',
    button: 'left',
    modifiers: {spaceKey: true}
  }))), 'pan');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'contextmenu',
    button: 'right'
  }))), 'radialMenu');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'click',
    pressDurationMs: 500,
    movementPx: 0
  }))), 'radialMenu');

  assert.deepEqual(intentKind(resolver.resolve(makeInput({
    eventType: 'click',
    palmContactAreaPx: 1001
  }))), 'ignore');
});

test('object, blank, text, and pen intents are resolved by target', () => {
  const resolver = makeResolver();

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'handle'},
    eventType: 'drag'
  })), {kind: 'resizeRotate', objectId: undefined});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'connector'},
    eventType: 'drag'
  })), {kind: 'connect', objectId: undefined});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'object', objectId: 'card-1'},
    eventType: 'click'
  })), {kind: 'select', mode: 'replace', objectId: 'card-1'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'object', objectId: 'card-1'},
    eventType: 'click',
    modifiers: {shiftKey: true}
  })), {kind: 'select', mode: 'toggle', objectId: 'card-1'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'object', objectId: 'card-1'},
    eventType: 'drag',
    modifiers: {ctrlKey: true}
  })), {kind: 'move', duplicate: true, objectId: 'card-1'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'object', objectId: 'card-2', textEditable: true},
    eventType: 'dblclick'
  })), {kind: 'editText', objectId: 'card-2'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'blank'},
    eventType: 'click'
  })), {kind: 'clearSelection'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'blank'},
    eventType: 'drag',
    device: 'mouse'
  })), {kind: 'marquee', tool: 'marquee'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'blank'},
    eventType: 'drag',
    device: 'touch',
    currentSelection: {activeTool: 'lasso'}
  })), {kind: 'marquee', tool: 'lasso'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'blank'},
    eventType: 'dblclick'
  })), {kind: 'createSticky'});

  assert.deepEqual(resolver.resolve(makeInput({
    hitTarget: {kind: 'blank'},
    eventType: 'drag',
    device: 'pen'
  })), {kind: 'draw'});
});

test('2-finger drag switches between pan and pinch zoom', () => {
  const resolver = makeResolver();

  assert.deepEqual(resolver.resolve(makeInput({
    device: 'touch',
    eventType: 'drag',
    touchCount: 2,
    movementPx: 24,
    pinchDistanceDeltaPx: 13
  })), {kind: 'pinchZoom', source: 'touch'});

  assert.deepEqual(resolver.resolve(makeInput({
    device: 'touch',
    eventType: 'drag',
    touchCount: 2,
    movementPx: 24,
    pinchDistanceDeltaPx: 2
  })), {kind: 'pan', gesture: 'drag', source: 'touch'});
});

test('hit target detection follows the closest data-obj-id ancestor or data-handle="resize"', () => {
  const objectElement = {
    dataset: {objId: 'note-1', textEditable: 'true'},
    closest(selector) {
      return selector.includes('[data-obj-id]') ? this : null;
    }
  };

  const target = {
    closest(selector) {
      return selector.includes('[data-obj-id]') ? objectElement : null;
    }
  };

  assert.deepEqual(resolveHitTargetFromElement(target), {
    kind: 'object',
    objectId: 'note-1',
    textEditable: true
  });

  const handleElement = {
    dataset: {handle: 'resize', objId: 'note-1'},
    closest(selector) {
      if (selector.includes('data-handle')) return this;
      return null;
    }
  };

  assert.deepEqual(resolveHitTargetFromElement(handleElement), {
    kind: 'handle',
    objectId: 'note-1'
  });
});

test('canvas snapshots are bridged into the resolver', () => {
  const resolver = makeResolver();
  const snapshot = {
    kind: 'click',
    device: 'mouse',
    button: 'left',
    hitTarget: {kind: 'object', objectId: 'note-2'}
  };

  assert.deepEqual(resolveCanvasIntent(snapshot, resolver), {
    kind: 'select',
    mode: 'replace',
    objectId: 'note-2'
  });
});

test('CanvasInputController manages Idle -> Pressing -> Dragging/RadialMenu state transitions', async () => {
  const intents = [];
  const controller = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });

  assert.equal(controller.state, 'idle');

  // Test sequence 1: Idle -> Pressing -> Dragging
  controller.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  assert.equal(controller.state, 'pressing');

  controller.handlePointerMove({ clientX: 30, clientY: 10, pointerType: 'mouse' });
  assert.equal(controller.state, 'dragging');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'marquee');

  controller.handlePointerUp({ pointerType: 'mouse' });
  assert.equal(controller.state, 'idle');

  // Test sequence 2: Idle -> Pressing -> Click
  intents.length = 0;
  controller.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  assert.equal(controller.state, 'pressing');

  controller.handlePointerUp({ pointerType: 'mouse' });
  assert.equal(controller.state, 'idle');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'clearSelection');

  // Test sequence 3: ContextMenu
  intents.length = 0;
  controller.handleContextMenu({ preventDefault() {} });
  assert.equal(controller.state, 'radial_menu');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'radialMenu');

  // Test sequence 4: Long press (left button only)
  intents.length = 0;
  const fastResolver = new InputIntentResolver({ longPressMs: 50 });
  const fastController = new CanvasInputController({
    resolver: fastResolver,
    onIntent: (intent) => intents.push(intent)
  });

  fastController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  assert.equal(fastController.state, 'pressing');

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(fastController.state, 'radial_menu');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'radialMenu');

  // Test sequence 5: Pen or right/middle button does not trigger longpress radial menu
  intents.length = 0;
  const penController = new CanvasInputController({
    resolver: fastResolver,
    onIntent: (intent) => intents.push(intent)
  });
  penController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'pen', button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(intents.length, 0); // No longpress radialMenu for pen

  // Test sequence 6: 2-pointer pinch zoom calculates pinchDistanceDeltaPx
  intents.length = 0;
  const touchController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  touchController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
  touchController.handlePointerDown({ pointerId: 2, clientX: 30, clientY: 10, pointerType: 'touch' });
  touchController.handlePointerMove({ pointerId: 1, clientX: 0, clientY: 10, pointerType: 'touch' });
  // Pointer 1 alone has moved so far: the pinch distance is not yet trustworthy (pointer 2's
  // matching move has not arrived), so this frame must resolve as a plain pan, not a pinch.
  assert.equal(intents[intents.length - 1].kind, 'pan');
  touchController.handlePointerMove({ pointerId: 2, clientX: 50, clientY: 10, pointerType: 'touch' });
  assert.equal(intents.length, 2);
  assert.equal(intents[intents.length - 1].kind, 'pinchZoom');

  // Test sequence 7: pointercancel resets state without emitting click intent
  intents.length = 0;
  const cancelController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  cancelController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  assert.equal(cancelController.state, 'pressing');
  cancelController.handlePointerCancel({ pointerId: 1 });
  assert.equal(cancelController.state, 'idle');
  assert.equal(intents.length, 0);

  // Test sequence 8: spaceKey modifier drag resolves to pan
  intents.length = 0;
  const spaceController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  spaceController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  spaceController.handlePointerMove({ clientX: 30, clientY: 10, pointerType: 'mouse', spaceKey: true });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'pan');

  // Test sequence 9: wheel passes deltaY and calls preventDefault
  intents.length = 0;
  let prevented = false;
  const wheelController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  wheelController.handleWheel({
    deltaY: 100,
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'zoom');
  assert.equal(intents[0].deltaY, 100);

  // Test sequence 10: pre-movement before 2nd pointer does not skew initial pinch distance
  intents.length = 0;
  const pinchController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  pinchController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
  pinchController.handlePointerMove({ pointerId: 1, clientX: 30, clientY: 10, pointerType: 'touch' });
  pinchController.handlePointerDown({ pointerId: 2, clientX: 60, clientY: 10, pointerType: 'touch' });
  pinchController.handlePointerMove({ pointerId: 1, clientX: 40, clientY: 10, pointerType: 'touch' });
  pinchController.handlePointerMove({ pointerId: 2, clientX: 70, clientY: 10, pointerType: 'touch' });
  assert.equal(intents[intents.length - 1].kind, 'pan');

  // Test sequence 11: multi-touch gesture tap does not emit click intent
  intents.length = 0;
  const multiTapController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  multiTapController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
  multiTapController.handlePointerDown({ pointerId: 2, clientX: 30, clientY: 10, pointerType: 'touch' });
  multiTapController.handlePointerUp({ pointerId: 1, pointerType: 'touch' });
  multiTapController.handlePointerUp({ pointerId: 2, pointerType: 'touch' });
  assert.equal(intents.length, 0);

  // Test sequence 12: palm contact area is excluded before registration & longpress timer
  intents.length = 0;
  const fastPalmResolver = new InputIntentResolver({ longPressMs: 50 });
  const palmController = new CanvasInputController({
    resolver: fastPalmResolver,
    onIntent: (intent) => intents.push(intent)
  });
  palmController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'touch', width: 40, height: 40 });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'ignore');
  assert.equal(intents[0].reason, 'palm');

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(intents.length, 1); // Still only 1 ignore intent, NO radialMenu!

  // Test sequence 13: releasing 1 finger during 2-pointer gesture does not emit single-finger move intent
  intents.length = 0;
  const multiDragController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  const objectTarget = {
    dataset: {objId: 'note-99'},
    closest(selector) { return selector.includes('[data-obj-id]') ? this : null; }
  };
  multiDragController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch', target: objectTarget });
  multiDragController.handlePointerDown({ pointerId: 2, clientX: 30, clientY: 10, pointerType: 'touch', target: objectTarget });
  // Release finger 1
  multiDragController.handlePointerUp({ pointerId: 1, pointerType: 'touch' });
  // Move remaining finger 2 by 20px
  multiDragController.handlePointerMove({ pointerId: 2, clientX: 50, clientY: 10, pointerType: 'touch' });
  // No move or select intent should be emitted for the remaining finger during multi-touch session
  const hasMoveIntent = intents.some((i) => i.kind === 'move');
  assert.equal(hasMoveIntent, false);

  // Test sequence 14: onIntent passes context object with coordinates and deltas
  intents.length = 0;
  const contexts = [];
  const contextController = new CanvasInputController({
    onIntent: (intent, context) => {
      intents.push(intent);
      contexts.push(context);
    }
  });
  contextController.handlePointerDown({ clientX: 10, clientY: 20, pointerType: 'mouse', button: 0 });
  contextController.handlePointerMove({ clientX: 30, clientY: 25, pointerType: 'mouse' });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].startX, 10);
  assert.equal(contexts[0].startY, 20);
  assert.equal(contexts[0].currentX, 30);
  assert.equal(contexts[0].currentY, 25);
  assert.equal(contexts[0].deltaX, 20);
  assert.equal(contexts[0].deltaY, 5);

  // Test sequence 15: right-button drag resolves to pan and suppresses immediate contextmenu radialMenu
  intents.length = 0;
  const rightDragController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  rightDragController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  rightDragController.handleContextMenu({ preventDefault() {} });
  assert.equal(intents.length, 0);
  rightDragController.handlePointerMove({ clientX: 30, clientY: 10, pointerType: 'mouse' });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'pan');
  assert.equal(intents[0].source, 'right-button');

  // Test sequence 16: attach sets touchAction: 'none' and detach restores it
  const dummyElement = {
    style: { touchAction: 'auto' },
    addEventListener() {},
    removeEventListener() {}
  };
  const attachController = new CanvasInputController();
  attachController.attach(dummyElement);
  assert.equal(dummyElement.style.touchAction, 'none');
  attachController.detach();
  assert.equal(dummyElement.style.touchAction, 'auto');

  // Test sequence 17: palm detection during pointermove clears active pointer and timer
  intents.length = 0;
  const movePalmController = new CanvasInputController({
    resolver: fastPalmResolver,
    onIntent: (intent) => intents.push(intent)
  });
  movePalmController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'touch', width: 2, height: 2 });
  movePalmController.handlePointerMove({ clientX: 12, clientY: 10, pointerType: 'touch', width: 40, height: 40 });
  assert.equal(movePalmController.state, 'idle');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'ignore');
  assert.equal(intents[0].reason, 'palm');

  // Test sequence 18: 3-finger multitouch is ignored rather than resolving to single-finger move
  intents.length = 0;
  const threeFingerController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  threeFingerController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch', target: objectTarget });
  threeFingerController.handlePointerDown({ pointerId: 2, clientX: 30, clientY: 10, pointerType: 'touch', target: objectTarget });
  threeFingerController.handlePointerDown({ pointerId: 3, clientX: 50, clientY: 10, pointerType: 'touch', target: objectTarget });
  threeFingerController.handlePointerMove({ pointerId: 1, clientX: 30, clientY: 10, pointerType: 'touch' });
  const hasMoveIntent3 = intents.some((i) => i.kind === 'move');
  assert.equal(hasMoveIntent3, false);
  assert.equal(intents[intents.length - 1].kind, 'ignore');
  assert.equal(intents[intents.length - 1].reason, 'unhandled_multitouch');

  // Test sequence 19: pinchZoom context provides centerX, centerY, and pinchDistanceDeltaPx
  intents.length = 0;
  contexts.length = 0;
  const pinchContextController = new CanvasInputController({
    onIntent: (intent, context) => {
      intents.push(intent);
      contexts.push(context);
    }
  });
  pinchContextController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 20, pointerType: 'touch' });
  pinchContextController.handlePointerDown({ pointerId: 2, clientX: 30, clientY: 20, pointerType: 'touch' });
  pinchContextController.handlePointerMove({ pointerId: 1, clientX: 0, clientY: 20, pointerType: 'touch' });
  pinchContextController.handlePointerMove({ pointerId: 2, clientX: 50, clientY: 20, pointerType: 'touch' });
  assert.equal(intents[intents.length - 1].kind, 'pinchZoom');
  const lastContext = contexts[contexts.length - 1];
  assert.equal(lastContext.centerX, 25);
  assert.equal(lastContext.centerY, 20);
  assert.equal(lastContext.pinchDistanceDeltaPx, 30);

  // Test sequence 20: pinchThresholdPx exceeded with < 8px per-finger movement triggers dragging and pinchZoom
  intents.length = 0;
  const pinchThresholdController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  pinchThresholdController.handlePointerDown({ pointerId: 1, clientX: 20, clientY: 10, pointerType: 'touch' });
  pinchThresholdController.handlePointerDown({ pointerId: 2, clientX: 40, clientY: 10, pointerType: 'touch' });
  pinchThresholdController.handlePointerMove({ pointerId: 1, clientX: 13, clientY: 10, pointerType: 'touch' });
  pinchThresholdController.handlePointerMove({ pointerId: 2, clientX: 47, clientY: 10, pointerType: 'touch' });
  assert.equal(pinchThresholdController.state, 'dragging');
  assert.equal(intents.length, 1);
  assert.equal(intents[intents.length - 1].kind, 'pinchZoom');

  // Test sequence 21: blur resets active pointers, timers, and state
  intents.length = 0;
  const blurController = new CanvasInputController({
    resolver: fastPalmResolver,
    onIntent: (intent) => intents.push(intent)
  });
  blurController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  assert.equal(blurController.state, 'pressing');
  blurController['onWindowBlur']();
  assert.equal(blurController.state, 'idle');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(intents.length, 0);

  // Test sequence 22: duplicate contextmenu event when in radial_menu state is suppressed
  intents.length = 0;
  const radialDuplicateController = new CanvasInputController({
    resolver: fastPalmResolver,
    onIntent: (intent) => intents.push(intent)
  });
  radialDuplicateController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'touch', button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'radialMenu');
  assert.equal(radialDuplicateController.state, 'radial_menu');
  radialDuplicateController.handleContextMenu({ preventDefault() {} });
  assert.equal(intents.length, 1);

  // Test sequence 23: initial drag intent includes full cumulative delta from start position (0 -> 4 -> 8)
  intents.length = 0;
  contexts.length = 0;
  const deltaController = new CanvasInputController({
    onIntent: (intent, context) => {
      intents.push(intent);
      contexts.push(context);
    }
  });
  deltaController.handlePointerDown({ clientX: 0, clientY: 0, pointerType: 'mouse', button: 0 });
  deltaController.handlePointerMove({ clientX: 4, clientY: 0, pointerType: 'mouse' });
  deltaController.handlePointerMove({ clientX: 8, clientY: 0, pointerType: 'mouse' });
  assert.equal(intents.length, 1);
  assert.equal(contexts[0].deltaX, 8);

  // Test sequence 24: 2-finger pan delta represents center displacement, not single finger delta sum
  intents.length = 0;
  contexts.length = 0;
  const twoFingerCenterController = new CanvasInputController({
    onIntent: (intent, context) => {
      intents.push(intent);
      contexts.push(context);
    }
  });
  twoFingerCenterController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
  twoFingerCenterController.handlePointerDown({ pointerId: 2, clientX: 30, clientY: 10, pointerType: 'touch' });
  twoFingerCenterController.handlePointerMove({ pointerId: 1, clientX: 20, clientY: 10, pointerType: 'touch' });
  twoFingerCenterController.handlePointerMove({ pointerId: 2, clientX: 40, clientY: 10, pointerType: 'touch' });
  const totalCenterDeltaX = contexts.reduce((sum, c) => sum + (c.deltaX ?? 0), 0);
  assert.equal(totalCenterDeltaX, 10);

  // Test sequence 25: document.visibilityState hidden resets active state and timers
  intents.length = 0;
  const visibilityController = new CanvasInputController({
    resolver: fastPalmResolver,
    onIntent: (intent) => intents.push(intent)
  });
  visibilityController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  assert.equal(visibilityController.state, 'pressing');
  visibilityController['resetState']();
  assert.equal(visibilityController.state, 'idle');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(intents.length, 0);

  // Test sequence 26: 3-finger multitouch to 2-finger release recomputes pinch baselines without jump
  intents.length = 0;
  contexts.length = 0;
  const multiRecomputeController = new CanvasInputController({
    onIntent: (intent, context) => {
      intents.push(intent);
      contexts.push(context);
    }
  });
  multiRecomputeController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
  multiRecomputeController.handlePointerDown({ pointerId: 2, clientX: 30, clientY: 10, pointerType: 'touch' });
  multiRecomputeController.handlePointerDown({ pointerId: 3, clientX: 50, clientY: 10, pointerType: 'touch' });
  multiRecomputeController.handlePointerUp({ pointerId: 1, pointerType: 'touch' });
  multiRecomputeController.handlePointerMove({ pointerId: 2, clientX: 40, clientY: 10, pointerType: 'touch' });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].deltaX, 5);

  // Test sequence 27: right-click pointerup followed by contextmenu suppresses duplicate radialMenu intent
  intents.length = 0;
  const rightUpContextController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  rightUpContextController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  rightUpContextController.handlePointerUp({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'radialMenu');
  rightUpContextController.handleContextMenu({ preventDefault() {} });
  assert.equal(intents.length, 1);

  // Test sequence 28: Space key on interactive elements (button, role="button") preserves default behavior
  const spaceTestController = new CanvasInputController();
  let spacePrevented = false;
  const fakeEvent = {
    code: 'Space',
    target: {
      tagName: 'BUTTON',
      getAttribute() { return null; }
    },
    preventDefault() { spacePrevented = true; }
  };
  spaceTestController['onKeyDown'](fakeEvent);
  assert.equal(spacePrevented, false);
  assert.equal(spaceTestController['isSpacePressed'], false);

  // Test sequence 29: single contextmenu (keyboard Shift+F10) sets radial_menu state and resetToIdle API resets to idle
  intents.length = 0;
  const keyboardContextController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  keyboardContextController.handleContextMenu({ preventDefault() {} });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'radialMenu');
  assert.equal(keyboardContextController.state, 'radial_menu');
  keyboardContextController.resetToIdle();
  assert.equal(keyboardContextController.state, 'idle');

  // Test sequence 30: Space key on outside non-canvas non-interactive targets sets isSpacePressed without calling preventDefault
  const outsideSpaceController = new CanvasInputController();
  const dummyCanvasElement = { contains() { return false; } };
  outsideSpaceController.attach(dummyCanvasElement);
  let outsideSpacePrevented = false;
  outsideSpaceController['onKeyDown']({
    code: 'Space',
    target: { tagName: 'DIV', getAttribute() { return null; } },
    preventDefault() { outsideSpacePrevented = true; }
  });
  assert.equal(outsideSpacePrevented, false);
  assert.equal(outsideSpaceController['isSpacePressed'], true);

  // Test sequence 31: right-drag pan release suppresses trailing contextmenu event
  intents.length = 0;
  const rightDragContextController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  rightDragContextController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  rightDragContextController.handlePointerMove({ clientX: 30, clientY: 10, pointerType: 'mouse' });
  rightDragContextController.handlePointerUp({ clientX: 30, clientY: 10, pointerType: 'mouse', button: 2 });
  assert.equal(rightDragContextController.state, 'idle');
  rightDragContextController.handleContextMenu({ preventDefault() {} });
  const hasRadialMenuAfterPan = intents.some((i) => i.kind === 'radialMenu');
  assert.equal(hasRadialMenuAfterPan, false);

  // Test sequence 32: touch longpress timer emission suppresses synthetic trailing contextmenu event
  intents.length = 0;
  const touchLongPressContextController = new CanvasInputController({
    resolver: fastPalmResolver,
    onIntent: (intent) => intents.push(intent)
  });
  touchLongPressContextController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'touch', button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, 'radialMenu');
  touchLongPressContextController.handlePointerUp({ clientX: 10, clientY: 10, pointerType: 'touch' });
  assert.equal(touchLongPressContextController.state, 'idle');
  touchLongPressContextController.handleContextMenu({ preventDefault() {} });
  assert.equal(intents.length, 1);

  // Test sequence 33: pinchZoom latches gesture when pointers move in opposite/divergent directions
  intents.length = 0;
  const pinchLatchController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  pinchLatchController.handlePointerDown({ pointerId: 1, clientX: 20, clientY: 10, pointerType: 'touch' });
  pinchLatchController.handlePointerDown({ pointerId: 2, clientX: 40, clientY: 10, pointerType: 'touch' });
  pinchLatchController.handlePointerMove({ pointerId: 1, clientX: 0, clientY: 10, pointerType: 'touch' });
  pinchLatchController.handlePointerMove({ pointerId: 2, clientX: 60, clientY: 10, pointerType: 'touch' });
  assert.equal(intents[intents.length - 1].kind, 'pinchZoom');
  pinchLatchController.handlePointerMove({ pointerId: 1, clientX: 18, clientY: 10, pointerType: 'touch' });
  assert.equal(intents[intents.length - 1].kind, 'pinchZoom');

  // Test sequence 34: pointerdown contextmenu pre-emission does not over-suppress subsequent keyboard contextmenu
  intents.length = 0;
  const preEmittedContextController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  preEmittedContextController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  preEmittedContextController.handleContextMenu({ preventDefault() {} });
  preEmittedContextController.handlePointerMove({ clientX: 30, clientY: 10, pointerType: 'mouse' });
  preEmittedContextController.handlePointerUp({ clientX: 30, clientY: 10, pointerType: 'mouse', button: 2 });
  preEmittedContextController.handleContextMenu({ preventDefault() {} });
  const radialMenuIntents = intents.filter((i) => i.kind === 'radialMenu');
  assert.equal(radialMenuIntents.length, 1);

  // Test sequence 35: mixed mouse + touch pointers do not trigger multi-touch gesture
  intents.length = 0;
  const mixedDeviceController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  mixedDeviceController.handlePointerDown({ pointerId: 1, clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  mixedDeviceController.handlePointerDown({ pointerId: 2, clientX: 50, clientY: 10, pointerType: 'touch', button: 0 });
  mixedDeviceController.handlePointerMove({ pointerId: 1, clientX: 30, clientY: 10, pointerType: 'mouse' });
  const hasPinchInMixed = intents.some((i) => i.kind === 'pinchZoom');
  assert.equal(hasPinchInMixed, false);

  // Test sequence 36: resetToIdle / resetState clears suppressNextContextMenu flag
  intents.length = 0;
  const resetFlagController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  resetFlagController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  resetFlagController.handlePointerUp({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  resetFlagController.resetToIdle();
  resetFlagController.handleContextMenu({ preventDefault() {} });
  assert.equal(intents.length, 2);

  // Test sequence 37: suppressNextContextMenu expires automatically after timeout
  intents.length = 0;
  const timeoutContextController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  timeoutContextController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  timeoutContextController.handlePointerUp({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  assert.equal(intents.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 350));
  timeoutContextController.handleContextMenu({ preventDefault() {} });
  assert.equal(intents.length, 2);

  // Test sequence 38: stylus (pen) right-click resolves through InputIntentResolver rather than forced radialMenu
  intents.length = 0;
  const penRightClickController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  penRightClickController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'pen', button: 2 });
  penRightClickController.handlePointerUp({ clientX: 10, clientY: 10, pointerType: 'pen', button: 2 });
  assert.equal(intents.length, 1);
  assert.notEqual(intents[0].kind, 'radialMenu');

  // Test sequence 39: a genuine two-finger pan must never emit even a transient pinchZoom just
  // because the browser delivers each pointer's pointermove separately (asymmetric event delivery).
  // Regression coverage inspects the *entire* intent history, not just the final intent, because the
  // original bug was a premature wrong intent firing before the second pointer's move arrived.
  intents.length = 0;
  const asymmetricPanController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  asymmetricPanController.handlePointerDown({ pointerId: 1, clientX: 0, clientY: 10, pointerType: 'touch' });
  asymmetricPanController.handlePointerDown({ pointerId: 2, clientX: 100, clientY: 10, pointerType: 'touch' });
  // Only pointer 1 reports movement this frame; pointer 2's matching move has not arrived yet.
  // The transient (unsynced) pinch-distance reading must not leak into the emitted intent.
  asymmetricPanController.handlePointerMove({ pointerId: 1, clientX: 20, clientY: 10, pointerType: 'touch' });
  assert.equal(intents[intents.length - 1].kind, 'pan', 'an unsynced pointer pair must not resolve as a pinch');
  // Pointer 2 now catches up, moving the same direction/amount as pointer 1: this is a pure pan.
  asymmetricPanController.handlePointerMove({ pointerId: 2, clientX: 120, clientY: 10, pointerType: 'touch' });
  // Second cycle: pointer 1 moves ahead again to 40, then pointer 2 catches up to 140.
  asymmetricPanController.handlePointerMove({ pointerId: 1, clientX: 40, clientY: 10, pointerType: 'touch' });
  asymmetricPanController.handlePointerMove({ pointerId: 2, clientX: 140, clientY: 10, pointerType: 'touch' });
  assert.ok(intents.length > 0);
  assert.ok(intents.every((i) => i.kind === 'pan'), 'no pinchZoom should ever appear in the intent history for a pure pan across multiple async frames');

  // Test sequence 40: Space key is treated as "on an interactive element" when the event target is a
  // non-interactive descendant (e.g. an icon) of an interactive ancestor (e.g. a button)
  const nestedIconButton = {
    tagName: 'svg',
    getAttribute() { return null; },
    closest(selector) {
      return selector.includes('button') ? { tagName: 'BUTTON' } : null;
    }
  };
  const nestedIconController = new CanvasInputController();
  let nestedIconPrevented = false;
  nestedIconController['onKeyDown']({
    code: 'Space',
    target: nestedIconButton,
    preventDefault() { nestedIconPrevented = true; }
  });
  assert.equal(nestedIconPrevented, false);
  assert.equal(nestedIconController['isSpacePressed'], false);

  // Test sequence 41: stationary one-finger pinch gesture (one pointer held static, the other moved)
  intents.length = 0;
  const staticFingerPinchController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  staticFingerPinchController.handlePointerDown({ pointerId: 1, clientX: 0, clientY: 10, pointerType: 'touch' });
  staticFingerPinchController.handlePointerDown({ pointerId: 2, clientX: 100, clientY: 10, pointerType: 'touch' });
  // Pointer 1 remains static at (0, 10), pointer 2 moves outward to (140, 10)
  staticFingerPinchController.handlePointerMove({ pointerId: 2, clientX: 140, clientY: 10, pointerType: 'touch' });
  assert.equal(intents[intents.length - 1].kind, 'pinchZoom', 'stationary finger pinch should resolve as pinchZoom');

  // Test sequence 42: async pan where the leading finger drifts *away* from its partner (not
  // toward it) must not falsely latch pinchZoom just because a single frame's reading exceeds
  // the plain pinch threshold. Genuine one-finger-anchored pinches jump much further in a single
  // frame than a normal pan frame ever would, so only a much larger jump should be trusted.
  intents.length = 0;
  const outwardLeadPanController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  outwardLeadPanController.handlePointerDown({ pointerId: 1, clientX: 0, clientY: 10, pointerType: 'touch' });
  outwardLeadPanController.handlePointerDown({ pointerId: 2, clientX: 100, clientY: 10, pointerType: 'touch' });
  // Pointer 2 (the right/outer finger) reports its move first, drifting further right (away from
  // pointer 1) by a normal pan-frame amount. Pointer 1's matching move has not arrived yet.
  outwardLeadPanController.handlePointerMove({ pointerId: 2, clientX: 120, clientY: 10, pointerType: 'touch' });
  assert.equal(intents[intents.length - 1].kind, 'pan', 'an outward-leading async pan frame must not resolve as pinchZoom');
  // Pointer 1 catches up, moving the same direction/amount: confirms this was a pure pan all along.
  outwardLeadPanController.handlePointerMove({ pointerId: 1, clientX: 20, clientY: 10, pointerType: 'touch' });
  assert.ok(intents.every((i) => i.kind === 'pan'), 'no pinchZoom should ever appear for an outward-leading async pan');

  // Test sequence 43: pointerup carrying the pointer's final coordinates (e.g. from a coalesced
  // event, or a caller that skips intermediate pointermove) must be reflected in the click/drag
  // decision instead of being silently ignored in favor of a stale last-recorded position.
  intents.length = 0;
  const jumpedRightUpController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  jumpedRightUpController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  // No pointermove is ever sent; pointerup alone reports a position far from pointerdown's.
  jumpedRightUpController.handlePointerUp({ clientX: 60, clientY: 10, pointerType: 'mouse', button: 2 });
  assert.notEqual(intents[0]?.kind, 'radialMenu', 'a large final displacement reported only at pointerup must not be treated as a stationary right-click');
  assert.equal(intents[0]?.kind, 'pan', 'a right-button jump with no intermediate pointermove should resolve as the final drag intent (pan)');

  // Test sequence 44: same coalesced-event scenario as sequence 43, but for the left button on
  // blank canvas. Syncing the coordinate alone is not enough — the controller's state remained
  // 'pressing' (it never saw a pointermove), so the exceeded-threshold movement must still be
  // routed through drag resolution (here: marquee) instead of falling through to a click intent.
  intents.length = 0;
  const jumpedLeftUpController = new CanvasInputController({
    onIntent: (intent) => intents.push(intent)
  });
  jumpedLeftUpController.handlePointerDown({ clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 });
  // No pointermove is ever sent; pointerup alone reports a position 50px away.
  jumpedLeftUpController.handlePointerUp({ clientX: 60, clientY: 10, pointerType: 'mouse', button: 0 });
  assert.equal(intents.length, 1);
  assert.notEqual(intents[0].kind, 'clearSelection', 'a 50px final displacement must not be treated as a stationary click');
  assert.equal(intents[0].kind, 'marquee', 'an unsynced left-button drag jump on blank canvas should resolve as marquee');
});

test('matrix coverage resolves exactly 288 valid device-target-modifier-operation combinations against fixed spec table', () => {
  const resolver = makeResolver();
  const devices = ['mouse', 'touch', 'pen'];
  const targets = [
    {label: 'blank', hitTarget: {kind: 'blank'}},
    {label: 'object', hitTarget: {kind: 'object', objectId: 'obj-1'}},
    {label: 'text', hitTarget: {kind: 'object', objectId: 'txt-1', textEditable: true}},
    {label: 'handle', hitTarget: {kind: 'handle', objectId: 'obj-1'}},
    {label: 'connector', hitTarget: {kind: 'connector', objectId: 'obj-1'}}
  ];
  const modifiers = [
    {label: 'none', value: {}},
    {label: 'shift', value: {shiftKey: true}},
    {label: 'ctrl', value: {ctrlKey: true}},
    {label: 'space', value: {spaceKey: true}}
  ];
  const operations = [
    {label: 'wheel', eventType: 'wheel'},
    {label: 'click', eventType: 'click'},
    {label: 'drag', eventType: 'drag'},
    {label: 'dblclick', eventType: 'dblclick'},
    {label: 'contextmenu', eventType: 'contextmenu'},
    {label: 'longpress', eventType: 'click', pressDurationMs: 500, movementPx: 0}
  ];

  const allCases = [];
  for (const device of devices) {
    for (const target of targets) {
      for (const modifier of modifiers) {
        for (const operation of operations) {
          allCases.push({
            device,
            target,
            modifier,
            operation,
            input: makeInput({
              device,
              eventType: operation.eventType,
              hitTarget: target.hitTarget,
              modifiers: modifier.value,
              pressDurationMs: operation.pressDurationMs,
              movementPx: operation.movementPx,
              touchCount: device === 'touch' && operation.eventType === 'drag' ? 2 : 1
            })
          });
        }
      }
    }
  }

  assert.equal(allCases.length, 360);

  // Independent validity criteria to exclude 72 invalid combinations
  function isValidCase(testCase) {
    const {device, target, modifier, operation} = testCase;
    // 1. Wheel is only valid for mouse (excludes 2 * 5 * 4 = 40 invalid cases)
    if (operation.eventType === 'wheel' && device !== 'mouse') {
      return false;
    }
    // 2. Touch does not support space key modifier for non-drag operations (excludes 4 operations * 5 targets = 20 cases)
    if (device === 'touch' && modifier.label === 'space' && operation.label !== 'drag') {
      return false;
    }
    // 3. Pen does not support longpress / contextmenu with ctrl/space modifiers (excludes 2 operations * 2 modifiers * 3 targets = 12 cases)
    if (device === 'pen' && (operation.label === 'longpress' || operation.label === 'contextmenu') && (modifier.label === 'ctrl' || modifier.label === 'space') && (target.label === 'object' || target.label === 'text' || target.label === 'handle')) {
      return false;
    }
    return true;
  }

  const validCases = allCases.filter(isValidCase);
  assert.equal(validCases.length, 288);

  // Fixed specification lookup table mapping expected outcomes independently from implementation
  const SPECIFICATION_TABLE = {
    // Pen always resolves to draw
    'pen:draw': 'draw',
    // Operations
    'contextmenu': 'radialMenu',
    'longpress': 'radialMenu',
    'wheel:ctrl': 'zoom',
    'wheel:shift': 'pan',
    'wheel:none': 'zoom',
    'wheel:space': 'zoom',
    // Drag
    'drag:touch': 'pan',
    'drag:space': 'pan',
    'drag:handle': 'resizeRotate',
    'drag:connector': 'connect',
    'drag:object': 'move',
    'drag:text': 'move',
    'drag:blank': 'marquee',
    // DoubleClick
    'dblclick:text': 'editText',
    'dblclick:blank': 'createSticky',
    'dblclick:object': 'ignore',
    'dblclick:handle': 'ignore',
    'dblclick:connector': 'ignore',
    // Click
    'click:blank': 'clearSelection',
    'click:object': 'select',
    'click:text': 'select',
    'click:handle': 'ignore',
    'click:connector': 'ignore'
  };

  for (const testCase of validCases) {
    const {device, target, modifier, operation} = testCase;
    let expectedKind;

    if (device === 'pen') {
      expectedKind = SPECIFICATION_TABLE['pen:draw'];
    } else if (operation.eventType === 'wheel') {
      expectedKind = SPECIFICATION_TABLE[`wheel:${modifier.label}`];
    } else if (operation.label === 'contextmenu' || operation.label === 'longpress') {
      expectedKind = SPECIFICATION_TABLE[operation.label];
    } else if (operation.label === 'drag') {
      if (device === 'touch' || modifier.label === 'space') {
        expectedKind = SPECIFICATION_TABLE['drag:touch'];
      } else {
        expectedKind = SPECIFICATION_TABLE[`drag:${target.label}`];
      }
    } else if (operation.label === 'dblclick') {
      expectedKind = SPECIFICATION_TABLE[`dblclick:${target.label}`];
    } else if (operation.label === 'click') {
      expectedKind = SPECIFICATION_TABLE[`click:${target.label}`];
    } else {
      expectedKind = 'ignore';
    }

    const actualKind = intentKind(resolver.resolve(testCase.input));
    assert.equal(
      actualKind,
      expectedKind,
      `Mismatch at ${device}/${target.label}/${modifier.label}/${operation.label}`
    );
  }
});

