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
  resolveHitTargetFromElement
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

test('hit target detection follows the closest data-obj-id ancestor', () => {
  const objectElement = {
    dataset: {objId: 'note-1', textEditable: 'true'},
    closest(selector) {
      return selector === '[data-obj-id]' ? this : null;
    }
  };

  const target = {
    closest(selector) {
      return selector === '[data-obj-id]' ? objectElement : null;
    }
  };

  assert.deepEqual(resolveHitTargetFromElement(target), {
    kind: 'object',
    objectId: 'note-1',
    textEditable: true
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

test('matrix coverage resolves all 360 device-target-modifier-operation combinations', () => {
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

  const cases = [];

  for (const device of devices) {
    for (const target of targets) {
      for (const modifier of modifiers) {
        for (const operation of operations) {
          cases.push({
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

  assert.equal(cases.length, 360);

  for (const testCase of cases) {
    const expected = expectedKind(testCase);
    const actual = intentKind(resolver.resolve(testCase.input));
    assert.equal(
      actual,
      expected,
      `${testCase.device}/${testCase.target.label}/${testCase.modifier.label}/${testCase.operation.label}`
    );
  }
});

function expectedKind(testCase) {
  const {device, target, modifier, operation} = testCase;

  if (operation.eventType === 'wheel') {
    return modifier.value.ctrlKey ? 'zoom' : modifier.value.shiftKey ? 'pan' : 'zoom';
  }

  if (device === 'pen') {
    return 'draw';
  }

  if (operation.label === 'contextmenu') {
    return 'radialMenu';
  }

  if (operation.label === 'longpress') {
    return 'radialMenu';
  }

  if (operation.label === 'drag') {
    if (device === 'touch') {
      return 'pan';
    }

    if (modifier.value.spaceKey) {
      return 'pan';
    }

    if (target.label === 'handle') {
      return 'resizeRotate';
    }

    if (target.label === 'connector') {
      return 'connect';
    }

    if (target.label === 'object' || target.label === 'text') {
      return 'move';
    }

    if (target.label === 'blank') {
      return 'marquee';
    }
  }

  if (operation.label === 'dblclick') {
    if (target.label === 'text') {
      return 'editText';
    }

    if (target.label === 'blank') {
      return 'createSticky';
    }

    return 'ignore';
  }

  if (operation.label === 'click') {
    if (target.label === 'blank') {
      return 'clearSelection';
    }

    if (target.label === 'object' || target.label === 'text') {
      return 'select';
    }

    return 'ignore';
  }

  return 'ignore';
}
