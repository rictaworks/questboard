import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/quest-engine.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  const realRequire = createRequire(import.meta.url);
  const require = (specifier) => {
    if (specifier === '@/lib/feedback-director') {
      return {
        FeedbackDirector: class FeedbackDirector {
          decide(trigger, intensity) {
            return {
              trigger,
              eventKind: 'radial_opened',
              effectCode: 'radial_bloom',
              intensity,
              resolvedIntensity: intensity,
              reducedMotion: false,
              durationMs: 180,
              easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
              motionMode: intensity === 'off' ? 'color-only' : 'motion',
              modal: false,
              blocksInput: false,
              soundEnabled: false,
            };
          }
        }
      };
    }

    return realRequire(specifier);
  };
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);

  return moduleShim.exports;
}

function createRecordingDirector() {
  const calls = [];

  return {
    calls,
    decide(trigger, intensity) {
      const decision = {
        trigger,
        eventKind: 'radial_opened',
        effectCode: 'radial_bloom',
        intensity,
        resolvedIntensity: intensity,
        reducedMotion: false,
        durationMs: 180,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        motionMode: intensity === 'off' ? 'color-only' : 'motion',
        modal: false,
        blocksInput: false,
        soundEnabled: false,
      };
      calls.push(decision);
      return decision;
    },
  };
}

const {QuestEngine, QUEST_DEFINITIONS} = await loadModule();

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

test('quest engine covers the 44 valid onboarding transitions', () => {
  const cases = [];

  for (const definition of QUEST_DEFINITIONS) {
    cases.push({
      label: `${definition.title}: first event advances the state machine`,
      run() {
        const director = createRecordingDirector();
        const engine = new QuestEngine([definition], {feedbackDirector: director});
        const result = engine.trackEvent({eventId: definition.conditionEvent, attributes: {source: 'test'}});

        const snapshot = engine.getSnapshot().quests[0];
        assert.equal(result.startedQuestIds.includes(definition.id), true);
        assert.equal(snapshot.state, definition.conditionCount === 1 ? 'achieved' : 'in_progress');
        assert.equal(snapshot.progress, 1);
        assert.equal(director.calls.length, 0);
      }
    });

    cases.push({
      label: `${definition.title}: repeated events reach achieved`,
      run() {
        const director = createRecordingDirector();
        const engine = new QuestEngine([definition], {feedbackDirector: director});
        const repetitions = Array.from({length: definition.conditionCount}, () => ({
          eventId: definition.conditionEvent,
          attributes: {source: 'test'}
        }));

        repetitions.forEach((event) => engine.trackEvent(event));

        const snapshot = engine.getSnapshot().quests[0];
        assert.equal(snapshot.state, 'achieved');
        assert.equal(snapshot.progress, definition.conditionCount);
      }
    });

    cases.push({
      label: `${definition.title}: grantReward routes through F4`,
      run() {
        const director = createRecordingDirector();
        const engine = new QuestEngine([definition], {feedbackDirector: director});

        for (let index = 0; index < definition.conditionCount; index += 1) {
          engine.trackEvent({eventId: definition.conditionEvent, attributes: {source: 'test'}});
        }

        const decision = engine.grantReward(definition.id, 'subtle');
        const snapshot = engine.getSnapshot().quests[0];

        assert.equal(director.calls.length, 1);
        assert.equal(decision?.trigger, 'quest_completed');
        assert.equal(decision?.effectCode, 'radial_bloom');
        assert.equal(snapshot.state, 'reward_granted');
      }
    });

    cases.push({
      label: `${definition.title}: reward_granted completes cleanly`,
      run() {
        const director = createRecordingDirector();
        const engine = new QuestEngine([definition], {feedbackDirector: director});

        for (let index = 0; index < definition.conditionCount; index += 1) {
          engine.trackEvent({eventId: definition.conditionEvent, attributes: {source: 'test'}});
        }

        engine.grantReward(definition.id);
        assert.equal(engine.completeQuest(definition.id), true);
        assert.equal(engine.getSnapshot().quests[0].state, 'completed');
      }
    });

    cases.push({
      label: `${definition.title}: skip freezes progress until reopen`,
      run() {
        const director = createRecordingDirector();
        const engine = new QuestEngine([definition], {feedbackDirector: director});
        engine.trackEvent({eventId: definition.conditionEvent, attributes: {source: 'test'}});
        engine.skipQuest(definition.id);
        const skippedProgress = engine.getSnapshot().quests[0].progress;
        engine.trackEvent({eventId: definition.conditionEvent, attributes: {source: 'test'}});
        assert.equal(engine.getSnapshot().quests[0].progress, skippedProgress);
        assert.equal(engine.reopenQuest(definition.id), true);
        assert.equal(engine.getSnapshot().quests[0].state, 'in_progress');
      }
    });
  }

  cases.push({
    label: 'panel hides when every quest is terminal',
    run() {
      const director = createRecordingDirector();
      const engine = new QuestEngine(QUEST_DEFINITIONS, {feedbackDirector: director});

      QUEST_DEFINITIONS.forEach((definition) => {
        engine.skipQuest(definition.id);
      });

      assert.equal(engine.isPanelVisible(), false);
      assert.equal(engine.getSnapshot().panelVisible, false);
    }
  });

  cases.push({
    label: 'auto-advance completes a quest and keeps the celebration alias',
    run() {
      const director = createRecordingDirector();
      const engine = new QuestEngine([QUEST_DEFINITIONS[1]], {feedbackDirector: director});
      const result = engine.trackEvent(
        {eventId: QUEST_DEFINITIONS[1].conditionEvent, attributes: {source: 'test'}},
        {autoAdvanceReward: true}
      );

      assert.equal(result.rewardDecisions.length, 1);
      assert.equal(engine.getSnapshot().quests[0].state, 'completed');
      assert.equal(engine.getSnapshot().lastCelebration?.trigger, 'quest_completed');
    }
  });

  cases.push({
    label: 'listeners are notified whenever quest state changes',
    run() {
      const director = createRecordingDirector();
      const engine = new QuestEngine([QUEST_DEFINITIONS[0]], {feedbackDirector: director});
      let notifications = 0;

      const unsubscribe = engine.subscribe(() => {
        notifications += 1;
      });

      engine.trackEvent({eventId: QUEST_DEFINITIONS[0].conditionEvent, attributes: {source: 'test'}});
      engine.skipQuest(QUEST_DEFINITIONS[0].id);
      unsubscribe();

      assert.equal(notifications >= 2, true);
    }
  });

  cases.push({
    label: 'reopening a skipped quest preserves its progress counter',
    run() {
      const director = createRecordingDirector();
      const definition = QUEST_DEFINITIONS[0];
      const engine = new QuestEngine([definition], {feedbackDirector: director});

      engine.trackEvent({eventId: definition.conditionEvent, attributes: {source: 'test'}});
      engine.skipQuest(definition.id);
      engine.reopenQuest(definition.id);

      assert.equal(engine.getSnapshot().quests[0].progress, 1);
      assert.equal(engine.getSnapshot().quests[0].state, 'in_progress');
    }
  });

  assert.equal(cases.length, 44);
  for (const testCase of cases) {
    testCase.run();
  }
});
