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

  // quest-engine.ts の import は `import type` のみで、transpile 時に完全に消える。
  // そのため require シムは不要。
  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);

  return moduleShim.exports;
}

const {
  QUEST_DEFINITIONS,
  countActiveQuests,
  createPlaceholderQuestSnapshots,
  isQuestPanelVisible,
  isQuestSkippable,
  questStateLabelKey,
} = await loadModule('src/lib/quest-engine.ts');

const ALL_STATES = [
  'not_started',
  'in_progress',
  'achieved',
  'reward_granted',
  'completed',
  'skipped',
];

function questWithState(id, state) {
  return {
    id,
    title: id,
    conditionEvent: 'camera_panned',
    conditionCount: 1,
    progress: 0,
    state,
    achievedAt: null,
    completedAt: null,
    rewardGrantedAt: null,
    skippedAt: null,
  };
}

test('quest definitions stay aligned with the seeded quest rows', async () => {
  const seeds = await readFile(path.join(root, 'src/backend/db/seeds.rb'), 'utf8');
  const questBlock = seeds.match(/"quests",\s*\[([\s\S]*?)\],\s*unique_by: :index_quests_on_title/);
  assert.ok(questBlock, 'expected to parse quests from db/seeds.rb');

  const seededQuests = [...questBlock[1].matchAll(/title:\s*"([^"]+)",\s*condition_event:\s*"([^"]+)",\s*condition_count:\s*(\d+)/g)].map(
    ([, title, conditionEvent, conditionCount]) => ({title, conditionEvent, conditionCount: Number(conditionCount)})
  );

  assert.equal(QUEST_DEFINITIONS.length, 8);
  assert.deepEqual(
    QUEST_DEFINITIONS.map(({title, conditionEvent, conditionCount}) => ({title, conditionEvent, conditionCount})),
    seededQuests
  );
});

test('createPlaceholderQuestSnapshots returns a render-only baseline with no completed quests', () => {
  const placeholders = createPlaceholderQuestSnapshots();

  assert.equal(placeholders.length, QUEST_DEFINITIONS.length);
  // 祝賀判定にこの配列を渡してはならない理由そのもの: 全て not_started なので、
  // これを基準にすると実応答の完了済みクエストが全て「新規完了」に見えてしまう。
  assert.equal(placeholders.every((quest) => quest.state === 'not_started'), true);
  assert.equal(placeholders.every((quest) => quest.progress === 0), true);
});

test('panel visibility and active count treat completed and skipped as terminal', () => {
  assert.equal(isQuestPanelVisible([questWithState('a', 'completed'), questWithState('b', 'skipped')]), false);
  assert.equal(isQuestPanelVisible([questWithState('a', 'completed'), questWithState('b', 'in_progress')]), true);
  assert.equal(isQuestPanelVisible([]), false);

  assert.equal(countActiveQuests([
    questWithState('a', 'completed'),
    questWithState('b', 'skipped'),
    questWithState('c', 'in_progress'),
    questWithState('d', 'not_started'),
  ]), 2);
});

test('isQuestSkippable allows every non-terminal state and blocks terminal ones', () => {
  assert.equal(isQuestSkippable('not_started'), true);
  assert.equal(isQuestSkippable('in_progress'), true);
  // サーバー(QuestProgressService#skip_quest)は completed/skipped 以外からのスキップを
  // 受理する。ここが食い違うと「サーバーだけスキップ済み」状態が生まれる（PR #61 レビュー）。
  assert.equal(isQuestSkippable('achieved'), true);
  assert.equal(isQuestSkippable('reward_granted'), true);
  assert.equal(isQuestSkippable('completed'), false);
  assert.equal(isQuestSkippable('skipped'), false);
});

test('questStateLabelKey returns a distinct translation key for every state', () => {
  const keys = ALL_STATES.map((state) => questStateLabelKey(state));

  assert.equal(new Set(keys).size, ALL_STATES.length, 'every state needs its own key');
  assert.equal(keys.every((key) => typeof key === 'string' && key.startsWith('questState')), true);
});

test('every quest state label key exists in the ja and en locale files', async () => {
  for (const locale of ['ja', 'en']) {
    const messages = JSON.parse(await readFile(path.join(root, `src/messages/${locale}.json`), 'utf8'));
    for (const state of ALL_STATES) {
      const key = questStateLabelKey(state);
      assert.ok(messages.BoardCanvas[key], `${locale}.json is missing BoardCanvas.${key}`);
    }
    assert.ok(messages.BoardCanvas.questSyncError, `${locale}.json is missing BoardCanvas.questSyncError`);
    assert.ok(messages.BoardCanvas.questActionFailed, `${locale}.json is missing BoardCanvas.questActionFailed`);
  }
});
