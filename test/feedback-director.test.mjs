import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function walkFiles(dir) {
  const entries = await readdir(path.join(root, dir), {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(relativePath));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/feedback-director.ts'), 'utf8');
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
  FeedbackDirector,
  FEEDBACK_EFFECT_MASTERS,
  FEEDBACK_EVENT_KINDS,
  FEEDBACK_INTENSITY_MASTERS,
  decideFeedback,
  detectPrefersReducedMotion,
  normalizeFeedbackTrigger,
  resolveFeedbackEffect,
} = loadedModule;

test('detectPrefersReducedMotion respects window.matchMedia', () => {
  const originalWindow = globalThis.window;

  globalThis.window = {
    matchMedia(query) {
      return {matches: query === '(prefers-reduced-motion: reduce)'};
    },
  };

  assert.equal(detectPrefersReducedMotion(), true);

  globalThis.window = {
    matchMedia() {
      return {matches: false};
    },
  };

  assert.equal(detectPrefersReducedMotion(), false);
  globalThis.window = originalWindow;
});

test('FeedbackDirector covers the 12 × 3 × 2 matrix and keeps feedback non-blocking', () => {
  const director = new FeedbackDirector(false);
  let cases = 0;

  for (const trigger of FEEDBACK_EVENT_KINDS) {
    for (const intensity of FEEDBACK_INTENSITY_MASTERS) {
      for (const reducedMotion of [false, true]) {
        cases += 1;
        const decision = decideFeedback(trigger, intensity, reducedMotion);
        assert.equal(decision.trigger, trigger);
        assert.equal(normalizeFeedbackTrigger(trigger), trigger);
        assert.equal(decision.eventKind, trigger);
        assert.equal(decision.effectCode, resolveFeedbackEffect(trigger).code);
        assert.equal(decision.modal, false);
        assert.equal(decision.blocksInput, false);
        assert.equal(decision.soundEnabled, false);
        assert.ok(decision.durationMs <= 400);

        if (reducedMotion) {
          assert.equal(decision.resolvedIntensity, 'off');
          assert.equal(decision.motionMode, 'color-only');
          assert.equal(decision.durationMs, 120);
        } else {
          assert.equal(decision.resolvedIntensity, intensity);
          assert.equal(decision.motionMode, intensity === 'off' ? 'color-only' : 'motion');
        }
      }
    }
  }

  assert.equal(cases, 72);
  assert.equal(director.decide('camera_zoomed', 'full').effectCode, 'zoom_wave');
});

test('quest completion routes through the director alias instead of a separate animation path', () => {
  const decision = decideFeedback('quest_completed', 'full', false);
  assert.equal(decision.trigger, 'quest_completed');
  assert.equal(decision.eventKind, 'radial_opened');
  assert.equal(decision.effectCode, 'radial_bloom');
});

test('feedback source avoids direct burst/dissolve trigger strings outside the director', async () => {
  const sourceFiles = (await walkFiles('src')).filter((file) => /\.[cm]?[jt]sx?$/.test(file));
  const contents = await Promise.all(sourceFiles.map((file) => readFile(path.join(root, file), 'utf8')));
  const joined = contents.join('\n');

  assert.equal(/spawnBurst\s*\(|\bqb(Pop|Dissolve|Burst)\b/.test(joined), false);
});
