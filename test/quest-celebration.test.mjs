import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  // quest-celebration.ts の import は `import type` のみで transpile 時に消えるため
  // require シムは不要。
  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);

  return moduleShim.exports;
}

const {
  QUEST_CELEBRATION_OVERLAY_MS,
  collectCompletedQuestIds,
  detectNewlyCompletedQuests,
} = await loadModule('src/lib/quest-celebration.ts');

function quest(id, state) {
  return {
    id,
    title: id,
    conditionEvent: 'camera_panned',
    conditionCount: 1,
    progress: 1,
    state,
    achievedAt: null,
    completedAt: null,
    rewardGrantedAt: null,
    skippedAt: null,
  };
}

test('the first observed response never celebrates, even when quests are already completed', () => {
  // PR #61 レビューの退行ガード。ページを開いた時点で完了済みだったクエストを
  // 「いま完了した」と誤認して祝ってしまう不具合が繰り返し発生していた。
  const alreadyCompleted = [quest('a', 'completed'), quest('b', 'completed')];

  assert.deepEqual(detectNewlyCompletedQuests(null, alreadyCompleted), []);
  assert.deepEqual(detectNewlyCompletedQuests(null, []), []);
});

test('a quest completing after the baseline is celebrated exactly once', () => {
  const baseline = collectCompletedQuestIds([quest('a', 'in_progress')]);
  assert.deepEqual(baseline, []);

  const firstObservation = detectNewlyCompletedQuests(baseline, [quest('a', 'completed')]);
  assert.deepEqual(firstObservation, ['a']);

  // 20秒ポーリングやWS通知で同じ完了状態を何度受け取っても、二度は祝わない。
  const seen = collectCompletedQuestIds([quest('a', 'completed')]);
  assert.deepEqual(detectNewlyCompletedQuests(seen, [quest('a', 'completed')]), []);
  assert.deepEqual(detectNewlyCompletedQuests(seen, [quest('a', 'completed')]), []);
});

test('only the newly completed quest is celebrated when others were already complete', () => {
  const seen = collectCompletedQuestIds([quest('a', 'completed')]);

  const newly = detectNewlyCompletedQuests(seen, [quest('a', 'completed'), quest('b', 'completed')]);

  assert.deepEqual(newly, ['b']);
});

test('non-completed states never trigger a celebration', () => {
  const seen = [];

  for (const state of ['not_started', 'in_progress', 'achieved', 'reward_granted', 'skipped']) {
    assert.deepEqual(
      detectNewlyCompletedQuests(seen, [quest('a', state)]),
      [],
      `${state} must not celebrate`
    );
  }
});

test('a skipped quest that is later completed still celebrates once', () => {
  const seen = collectCompletedQuestIds([quest('a', 'skipped')]);
  assert.deepEqual(seen, []);

  assert.deepEqual(detectNewlyCompletedQuests(seen, [quest('a', 'completed')]), ['a']);
});

test('the overlay duration matches the CSS keyframes it drives', async () => {
  // インラインの animationDuration が CSS のキーフレーム長より短いと、
  // アニメーションが終わる前にオーバーレイが消えて内容を読めない（PR #61 レビュー）。
  assert.equal(QUEST_CELEBRATION_OVERLAY_MS, 2000);

  const css = await readFile(path.join(root, 'src/app/globals.css'), 'utf8');
  const overlayAnimations = [...css.matchAll(/animation:\s*fadeInOut(?:Simple)?\s+(\d+)ms/g)]
    .map(([, duration]) => Number(duration));

  assert.ok(overlayAnimations.length > 0, 'expected the celebration overlay keyframes in globals.css');
  for (const duration of overlayAnimations) {
    assert.equal(
      duration,
      QUEST_CELEBRATION_OVERLAY_MS,
      'globals.css overlay animation must match QUEST_CELEBRATION_OVERLAY_MS'
    );
  }
});
