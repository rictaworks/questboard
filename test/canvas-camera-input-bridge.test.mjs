import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/canvas-camera-input-bridge.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });
  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

const {
  consumeGestureZoom,
  createGesturePanTracker,
  createGestureZoomTracker,
  createThrottledTrackState,
  flushThrottledTrack,
  noteGestureZoom,
  resetGesturePan,
  resetGestureZoom,
  resolveGesturePanSource,
  resolveReleaseInertiaVelocity,
  trackWithLeadingThrottle,
  WHEEL_ANALYTICS_THROTTLE_MS,
} = await loadModule();

function touchPan(deltaX, deltaY, phase = 'change') {
  return {kind: 'pan', source: 'touch', phase, deltaX, deltaY};
}

function spacePan(deltaX, deltaY, phase = 'change') {
  return {kind: 'pan', source: 'space', phase, deltaX, deltaY};
}

function pinchZoom(panDeltaX, panDeltaY, phase = 'change') {
  return {kind: 'zoom', source: 'pinch', amount: 12, precision: false, phase, panDeltaX, panDeltaY};
}

function createTracker() {
  const tracked = [];
  return {
    tracked,
    tracker: {
      track(event) {
        tracked.push(event);
      },
    },
  };
}

function createTrackerRef() {
  const {tracked, tracker} = createTracker();
  return {tracked, ref: {current: tracker}};
}

test('release inertia starts for space, button and touch pan but never for wheel', () => {
  const velocity = {velocityX: 12, velocityY: -4};

  for (const source of ['space', 'button', 'touch']) {
    const resolved = resolveReleaseInertiaVelocity({
      kind: 'pan',
      source,
      phase: 'end',
      deltaX: 0,
      deltaY: 0,
      ...velocity,
    });
    assert.deepEqual(resolved, velocity, `${source} のリリースでは慣性が開始する`);
  }

  // ホイールにはリリースという概念がないため慣性を開始しない
  assert.equal(
    resolveReleaseInertiaVelocity({kind: 'pan', source: 'wheel', deltaX: 3, deltaY: 4, ...velocity}),
    null
  );
  assert.equal(
    resolveReleaseInertiaVelocity({kind: 'pan', source: 'wheel', phase: 'end', deltaX: 3, deltaY: 4, ...velocity}),
    null
  );
});

test('release inertia is skipped for non-end phases, missing velocity and unrelated intents', () => {
  assert.equal(
    resolveReleaseInertiaVelocity({kind: 'pan', source: 'touch', phase: 'change', deltaX: 1, deltaY: 1, velocityX: 5, velocityY: 5}),
    null
  );
  assert.equal(
    resolveReleaseInertiaVelocity({kind: 'pan', source: 'touch', phase: 'end', deltaX: 1, deltaY: 1}),
    null
  );
  assert.equal(
    resolveReleaseInertiaVelocity({kind: 'pan', source: 'touch', phase: 'end', deltaX: 1, deltaY: 1, velocityX: 5}),
    null
  );
  assert.equal(resolveReleaseInertiaVelocity({kind: 'select', mode: 'clear'}), null);
  assert.equal(resolveReleaseInertiaVelocity({kind: 'ignore'}), null);
});

test('pinch release inertia is resolved from the zoom intent', () => {
  assert.deepEqual(
    resolveReleaseInertiaVelocity({
      kind: 'zoom',
      source: 'pinch',
      amount: 4,
      precision: false,
      phase: 'end',
      velocityX: 8,
      velocityY: 2,
    }),
    {velocityX: 8, velocityY: 2}
  );
});

test('a pan is recorded on the first moving change instead of waiting for a terminal intent', () => {
  const tracker = createGesturePanTracker();

  // Space+左ドラッグ中に Space を先に離すと、終端で resolver は pan intent を返さない。
  // 終端待ちで記録すると camera_panned が永久に送られないため、最初の移動で確定する。
  assert.equal(resolveGesturePanSource(tracker, spacePan(0, 0)), null, '移動が無ければ記録しないこと');
  assert.equal(resolveGesturePanSource(tracker, spacePan(12, 0)), 'space');
  assert.equal(resolveGesturePanSource(tracker, spacePan(9, 3)), null, '同一ジェスチャで二重に記録しないこと');
  assert.equal(resolveGesturePanSource(tracker, spacePan(4, 4, 'end')), null);
});

test('a pointercancel during a pan keeps the already recorded event and frees the next gesture', () => {
  const tracker = createGesturePanTracker();

  assert.equal(resolveGesturePanSource(tracker, {kind: 'pan', source: 'button', phase: 'change', deltaX: 5, deltaY: 0}), 'button');

  // pointercancel では終端 intent が届かないが、記録は既に済んでいる
  resetGesturePan(tracker);

  // 次のジェスチャは独立して1回記録できる
  assert.equal(resolveGesturePanSource(tracker, {kind: 'pan', source: 'button', phase: 'change', deltaX: 5, deltaY: 0}), 'button');
});

test('a new gesture records again once the tracker is reset at gesture start', () => {
  const tracker = createGesturePanTracker();

  assert.equal(resolveGesturePanSource(tracker, touchPan(6, 2)), 'touch');
  assert.equal(resolveGesturePanSource(tracker, touchPan(6, 2)), null);

  resetGesturePan(tracker);
  assert.equal(resolveGesturePanSource(tracker, touchPan(6, 2)), 'touch', '次のジェスチャでは再び記録できること');
});

test('a two-finger gesture without any movement is never recorded as a pan', () => {
  const tracker = createGesturePanTracker();

  // 指間距離がズーム閾値を超えず、中心も動かないまま離した2本指タップ
  assert.equal(resolveGesturePanSource(tracker, touchPan(0, 0)), null);
  assert.equal(resolveGesturePanSource(tracker, touchPan(0, 0, 'end')), null);
  assert.equal(tracker.recorded, false, 'ゼロ差分のタップで「ボードをパンする」クエストが達成されないこと');
});

test('a pan that starts before zoom activation is recorded once for the whole gesture', () => {
  const tracker = createGesturePanTracker();

  // 1. 2本指で中心を移動（この時点ではまだ pan intent）
  assert.equal(resolveGesturePanSource(tracker, touchPan(6, 2)), 'touch');

  // 2. 指間距離が閾値を超えて zoom intent へ移行。以降 pan の end は届かない
  assert.equal(resolveGesturePanSource(tracker, pinchZoom(3, 1)), null, 'ズーム移行後に二重記録しないこと');
  assert.equal(resolveGesturePanSource(tracker, pinchZoom(0, 0, 'end')), null);
});

test('a pinch that only moves its center after zoom activation is recorded as a pinch pan', () => {
  const tracker = createGesturePanTracker();

  assert.equal(resolveGesturePanSource(tracker, pinchZoom(0, 0)), null);
  assert.equal(resolveGesturePanSource(tracker, pinchZoom(0, 4, 'end')), 'pinch');
});

test('the pinch zoom tracker keeps the latest applied zoom so a cancel can still report it', () => {
  const state = createGestureZoomTracker();
  const {tracked, ref} = createTrackerRef();

  // pointercancel では終端 intent が届かないため、適用済みの倍率を都度控えておく
  noteGestureZoom(state, ref, pinchZoom(0, 0), 1.4);
  noteGestureZoom(state, ref, pinchZoom(0, 0), 1.9);

  const record = consumeGestureZoom(state);
  assert.equal(record?.zoom, 1.9, 'キャンセル時は最後に適用した倍率を送ること');
  assert.equal(record?.tracker, ref.current, '発生時の tracker を掴んでおくこと');
  assert.equal(tracked.length, 0, '控えた時点ではまだ送信しないこと');
  assert.equal(consumeGestureZoom(state), null, '同一ジェスチャで二重に送らないこと');
});

test('a pinch zoom pending at unmount still reaches the tracker that produced it', () => {
  const state = createGestureZoomTracker();
  const {tracked, ref} = createTrackerRef();
  const originatingTracker = ref.current;

  noteGestureZoom(state, ref, pinchZoom(0, 0), 2.2);

  // アンマウントでは analytics tracker を破棄する effect が先に走り ref は null になる。
  // その後で入力側の detach → onGestureCancel が呼ばれる。
  ref.current = null;

  const record = consumeGestureZoom(state);
  assert.equal(record?.zoom, 2.2);
  assert.equal(record?.tracker, originatingTracker, 'ref が null でも発生時の tracker へ送れること');

  record?.tracker?.track({eventId: 'camera_zoomed', attributes: {source: 'pinch', zoom: record.zoom}});
  assert.equal(tracked.length, 1, 'アンマウント時に camera_zoomed を取りこぼさないこと');
});

test('a pinch zoom is attributed to the tracker that was current when it was applied', () => {
  const state = createGestureZoomTracker();
  const previousUser = createTracker();
  const nextUser = createTracker();
  const ref = {current: previousUser.tracker};

  noteGestureZoom(state, ref, pinchZoom(0, 0), 1.3);

  // ジェスチャ中に userGoogleSub / boardId が変わって tracker が差し替わる。
  // ズームは1ジェスチャ1件なので、最後に適用した時点の帰属だけが残る。
  ref.current = nextUser.tracker;
  noteGestureZoom(state, ref, pinchZoom(0, 0), 1.8);

  const record = consumeGestureZoom(state);
  assert.equal(record?.zoom, 1.8);
  assert.equal(record?.tracker, nextUser.tracker);
});

test('the pinch zoom tracker reports nothing for a gesture that never zoomed', () => {
  const state = createGestureZoomTracker();
  const {ref} = createTrackerRef();

  assert.equal(consumeGestureZoom(state), null);

  // ズームへ移行しなかった2本指パンは zoom intent を出さないため控えるものが無い
  noteGestureZoom(state, ref, touchPan(8, 2), 1.0);
  assert.equal(consumeGestureZoom(state), null, 'ズームしていないジェスチャで camera_zoomed を送らないこと');
});

test('the pinch zoom tracker ignores wheel zooms, which use the throttled path', () => {
  const state = createGestureZoomTracker();
  const {ref} = createTrackerRef();

  noteGestureZoom(state, ref, {kind: 'zoom', source: 'wheel', amount: -120, precision: false}, 2.5);
  assert.equal(consumeGestureZoom(state), null);
});

test('a reset at gesture start drops a zoom left over from a previous gesture', () => {
  const state = createGestureZoomTracker();
  const {ref} = createTrackerRef();

  noteGestureZoom(state, ref, pinchZoom(0, 0), 1.6);
  resetGestureZoom(state);

  assert.equal(consumeGestureZoom(state), null, '前のジェスチャの倍率を持ち越さないこと');
  assert.equal(state.pendingTracker, null, '掴んだ tracker も解放すること');
});

test('a zoom of exactly 1 is still reported instead of being treated as absent', () => {
  const state = createGestureZoomTracker();
  const {ref} = createTrackerRef();

  // 倍率1.0 は「等倍へ戻した」という有効な結果であり、未ズームとは区別する
  noteGestureZoom(state, ref, pinchZoom(0, 0), 1);
  assert.equal(consumeGestureZoom(state)?.zoom, 1);
});

test('a pinch zoom applied while the tracker is already disposed is dropped silently', () => {
  const state = createGestureZoomTracker();

  assert.doesNotThrow(() => {
    noteGestureZoom(state, {current: null}, pinchZoom(0, 0), 1.7);
    const record = consumeGestureZoom(state);
    record?.tracker?.track({eventId: 'camera_zoomed', attributes: {source: 'pinch', zoom: record.zoom}});
  });
});

test('the gesture pan tracker ignores wheel and non-camera intents', () => {
  const tracker = createGesturePanTracker();

  // ホイールはジェスチャ境界を持たず、スロットル経路で別に記録する
  assert.equal(resolveGesturePanSource(tracker, {kind: 'pan', source: 'wheel', deltaX: 30, deltaY: 30}), null);
  assert.equal(resolveGesturePanSource(tracker, {kind: 'zoom', source: 'wheel', amount: -120, precision: false}), null);
  assert.equal(resolveGesturePanSource(tracker, {kind: 'select', mode: 'clear'}), null);
  assert.equal(resolveGesturePanSource(tracker, {kind: 'ignore'}), null);
  assert.equal(tracker.recorded, false);
});

test('leading throttle records the first event immediately and coalesces the rest', async () => {
  const {tracked, ref} = createTrackerRef();
  const state = createThrottledTrackState();

  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.1}, 30);
  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.2}, 30);
  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.3}, 30);

  // 先頭の1件は即座に記録される
  assert.equal(tracked.length, 1);
  assert.deepEqual(tracked[0], {eventId: 'camera_zoomed', attributes: {source: 'wheel', zoom: 1.1}});

  await new Promise((resolve) => setTimeout(resolve, 60));

  // 間引かれた分は最後の値だけが末尾で記録される
  assert.equal(tracked.length, 2);
  assert.deepEqual(tracked[1], {eventId: 'camera_zoomed', attributes: {source: 'wheel', zoom: 1.3}});
  assert.equal(state.timer, null);
  assert.equal(state.pendingAttributes, null);
  assert.equal(state.pendingTracker, null);
});

test('flush sends the pending event before the timer is discarded', () => {
  const {tracked, ref} = createTrackerRef();
  const state = createThrottledTrackState();

  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel'}, 10_000);
  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel'}, 10_000);
  assert.equal(tracked.length, 1);

  flushThrottledTrack(state, 'camera_panned');

  // viewport 変更やアンマウントで cleanup が走っても保留分が失われない
  assert.equal(tracked.length, 2);
  assert.deepEqual(tracked[1], {eventId: 'camera_panned', attributes: {source: 'wheel'}});
  assert.equal(state.timer, null);
  assert.equal(state.pendingAttributes, null);
  assert.equal(state.pendingTracker, null);
});

test('flush reaches the originating tracker even after the ref was cleared', () => {
  const {tracked, ref} = createTrackerRef();
  const state = createThrottledTrackState();

  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.5}, 10_000);
  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.9}, 10_000);

  // アンマウントでは tracker 破棄の effect が先に走り ref は null になる
  ref.current = null;
  flushThrottledTrack(state, 'camera_zoomed');

  assert.equal(tracked.length, 2);
  assert.deepEqual(tracked[1], {eventId: 'camera_zoomed', attributes: {source: 'wheel', zoom: 1.9}});
});

test('flush without a pending event does not emit a duplicate', () => {
  const {tracked, ref} = createTrackerRef();
  const state = createThrottledTrackState();

  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 2}, 10_000);
  assert.equal(tracked.length, 1);

  flushThrottledTrack(state, 'camera_zoomed');
  assert.equal(tracked.length, 1);

  // 保留もタイマーも無い状態で再度 flush しても副作用がない
  flushThrottledTrack(state, 'camera_zoomed');
  assert.equal(tracked.length, 1);
});

test('pending events are attributed to the user who produced them, not the next one', async () => {
  const previousUser = createTracker();
  const nextUser = createTracker();
  const ref = {current: previousUser.tracker};
  const state = createThrottledTrackState();

  // 300ms 以内に複数回発生させ、末尾を保留させる
  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel'}, 40);
  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel'}, 40);

  // タイマー満了前に userGoogleSub が変わり、tracker が差し替わる
  ref.current = nextUser.tracker;
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(previousUser.tracked.length, 2, '保留分は発生時のユーザーへ記録されること');
  assert.equal(nextUser.tracked.length, 0, '切替後ユーザーへ誤帰属しないこと');
});

test('pending events survive a user switch that happens before cleanup flushes', () => {
  const previousUser = createTracker();
  const nextUser = createTracker();
  const ref = {current: previousUser.tracker};
  const state = createThrottledTrackState();

  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 3}, 10_000);
  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 4}, 10_000);

  ref.current = nextUser.tracker;
  flushThrottledTrack(state, 'camera_zoomed');

  assert.equal(previousUser.tracked.length, 2);
  assert.equal(nextUser.tracked.length, 0);
});

test('a tracker switch flushes the pending event instead of overwriting it', () => {
  const previousUser = createTracker();
  const nextUser = createTracker();
  const ref = {current: previousUser.tracker};
  const state = createThrottledTrackState();

  // 1. 旧 tracker でスロットル期間を開始し、末尾を保留させる
  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.1}, 10_000);
  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.2}, 10_000);
  assert.equal(previousUser.tracked.length, 1);

  // 2. タイマー満了前に userGoogleSub / boardId が変わり tracker が差し替わる
  ref.current = nextUser.tracker;

  // 3. 切替後に同種の操作が起きても、旧 tracker の保留分を上書きしない
  trackWithLeadingThrottle(state, ref, 'camera_zoomed', {source: 'wheel', zoom: 1.3}, 10_000);

  assert.equal(previousUser.tracked.length, 2, '切替時に旧ユーザーの保留分が送出されること');
  assert.deepEqual(previousUser.tracked[1], {
    eventId: 'camera_zoomed',
    attributes: {source: 'wheel', zoom: 1.2},
  });
  assert.equal(nextUser.tracked.length, 1, '切替後は新しいスロットル期間の先頭として記録されること');
  assert.deepEqual(nextUser.tracked[0], {
    eventId: 'camera_zoomed',
    attributes: {source: 'wheel', zoom: 1.3},
  });
  assert.equal(state.pendingAttributes, null);
  assert.equal(state.pendingTracker, null);

  flushThrottledTrack(state, 'camera_zoomed');

  // 切替直後の1件は先頭として送出済みなので、保留の二重送信は起きない
  assert.equal(previousUser.tracked.length, 2);
  assert.equal(nextUser.tracked.length, 1);
});

test('a tracker switch keeps throttling events that belong to the same tracker', () => {
  const nextUser = createTracker();
  const previousUser = createTracker();
  const ref = {current: previousUser.tracker};
  const state = createThrottledTrackState();

  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel', step: 1}, 10_000);
  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel', step: 2}, 10_000);

  ref.current = nextUser.tracker;
  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel', step: 3}, 10_000);
  // 切替後の連続操作は、新しいスロットル期間の中で通常どおり間引かれる
  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel', step: 4}, 10_000);
  trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel', step: 5}, 10_000);

  assert.equal(nextUser.tracked.length, 1);
  flushThrottledTrack(state, 'camera_panned');

  assert.equal(nextUser.tracked.length, 2);
  assert.deepEqual(nextUser.tracked[1], {
    eventId: 'camera_panned',
    attributes: {source: 'wheel', step: 5},
  });
  assert.equal(previousUser.tracked.length, 2, '旧ユーザーへは切替時の1件だけが追加されること');
});

test('throttled tracking tolerates a disposed tracker', () => {
  const state = createThrottledTrackState();
  const ref = {current: null};

  // アンマウント順序によっては tracker が先に破棄される。例外を出さずに黙って捨てる。
  assert.doesNotThrow(() => {
    trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel'}, 10_000);
    trackWithLeadingThrottle(state, ref, 'camera_panned', {source: 'wheel'}, 10_000);
    flushThrottledTrack(state, 'camera_panned');
  });
});

test('camera input constants are exported instead of inlined as magic numbers', () => {
  assert.equal(typeof WHEEL_ANALYTICS_THROTTLE_MS, 'number');
  assert.ok(WHEEL_ANALYTICS_THROTTLE_MS > 0);
});

test('board canvas panel does not inline the extracted camera input literals', async () => {
  const panelSource = await readFile(path.join(root, 'src/components/board-canvas-panel.tsx'), 'utf8');

  assert.ok(
    !panelSource.includes('PINCH_ZOOM_COEFFICIENT'),
    'ピンチのズームはホイール係数を経由せず、倍率で直接指定すること'
  );
  assert.ok(
    panelSource.includes('zoomByScale'),
    'ピンチのズームは倍率を受け取る専用の入口を使うこと'
  );
  assert.ok(
    panelSource.includes('WHEEL_ANALYTICS_THROTTLE_MS'),
    'スロットル間隔は定数経由で参照すること'
  );
  assert.ok(
    panelSource.includes('trackWithLeadingThrottle'),
    'ホイールの KPI 送信はブリッジ層のスロットルを経由すること'
  );
  assert.ok(
    panelSource.includes('flushThrottledTrack'),
    'cleanup で保留分を送出すること'
  );
  assert.ok(
    panelSource.includes('resolveReleaseInertiaVelocity'),
    'リリース慣性の判定はブリッジ層に集約すること'
  );
  assert.ok(
    panelSource.includes('resolveGesturePanSource'),
    'パンの記録可否はブリッジ層のトラッカーで判定すること'
  );
  assert.ok(
    panelSource.includes('onGestureStart') && panelSource.includes('onGestureCancel'),
    'ジェスチャの開始とキャンセルの両方でセッション状態を破棄すること'
  );

  assert.ok(
    panelSource.includes('noteGestureZoom') && panelSource.includes('consumeGestureZoom'),
    'ピンチのズーム倍率はブリッジ層のトラッカー経由で送信すること'
  );

  // 終端 intent 限定の送信に戻ると、Space の先離しや pointercancel で
  // camera_panned / camera_zoomed が失われる（#114 レビュー指摘）。
  assert.ok(
    !/phase === 'end'[\s\S]{0,200}camera_panned/.test(panelSource),
    'camera_panned を終端 intent 限定で送信しないこと'
  );
  assert.ok(
    !/phase === 'end'[\s\S]{0,200}camera_zoomed/.test(panelSource),
    'camera_zoomed を終端 intent 限定で送信しないこと'
  );

  // 入力源による慣性の出し分けはブリッジ層の責務。パネル側で source を直接
  // 判定すると #46 受け入れ基準2（4種のパンを区別しない）から再び逸脱する。
  const inertiaCalls = panelSource.match(/startInertia\([^)]*\)/g) ?? [];
  assert.ok(inertiaCalls.length > 0, 'パネルは慣性を開始すること');
  for (const call of inertiaCalls) {
    assert.equal(
      call,
      'startInertia(inertia.velocityX, inertia.velocityY)',
      '慣性の速度は resolveReleaseInertiaVelocity の戻り値から渡すこと'
    );
  }
});
