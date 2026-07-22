export type FeedbackIntensityCode = 'full' | 'subtle' | 'off';

export type FeedbackEventKind =
  | 'object_created'
  | 'object_created_frame'
  | 'object_deleted'
  | 'object_duplicated'
  | 'object_recolored'
  | 'object_locked'
  | 'object_unlocked'
  | 'comment_created'
  | 'board_shared'
  | 'radial_opened'
  | 'camera_panned'
  | 'camera_zoomed';

export type FeedbackTrigger = FeedbackEventKind | 'quest_completed';

export type FeedbackMotionMode = 'motion' | 'color-only';

export interface FeedbackEffectMaster {
  code: string;
  durationMs: number;
  easing: string;
}

export interface FeedbackDecision {
  trigger: FeedbackTrigger;
  /** The canonical event kind this trigger routes through for effect selection; see FEEDBACK_EVENT_ALIAS for triggers (e.g. quest_completed) that borrow another event's effect. */
  eventKind: FeedbackEventKind;
  effectCode: string;
  intensity: FeedbackIntensityCode;
  resolvedIntensity: FeedbackIntensityCode;
  reducedMotion: boolean;
  durationMs: number;
  easing: string;
  motionMode: FeedbackMotionMode;
  modal: false;
  blocksInput: false;
  soundEnabled: false;
}

export const FEEDBACK_INTENSITY_MASTERS: readonly FeedbackIntensityCode[] = ['full', 'subtle', 'off'];

export const FEEDBACK_EFFECT_MASTERS: readonly FeedbackEffectMaster[] = [
  {code: 'creation_pop', durationMs: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)'},
  {code: 'frame_materialize', durationMs: 220, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)'},
  {code: 'deletion_dissolve', durationMs: 240, easing: 'ease-out'},
  {code: 'duplicate_burst', durationMs: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'},
  {code: 'recolor_pulse', durationMs: 140, easing: 'ease-in-out'},
  {code: 'lock_shimmer', durationMs: 260, easing: 'linear'},
  {code: 'unlock_shimmer', durationMs: 260, easing: 'linear'},
  {code: 'comment_ping', durationMs: 200, easing: 'cubic-bezier(0.2, 0.7, 0.1, 1)'},
  {code: 'share_pulse', durationMs: 220, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)'},
  {code: 'radial_bloom', durationMs: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'},
  {code: 'camera_swish', durationMs: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)'},
  {code: 'zoom_wave', durationMs: 240, easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)'},
] as const;

export const FEEDBACK_EVENT_KINDS: readonly FeedbackEventKind[] = [
  'object_created',
  'object_created_frame',
  'object_deleted',
  'object_duplicated',
  'object_recolored',
  'object_locked',
  'object_unlocked',
  'comment_created',
  'board_shared',
  'radial_opened',
  'camera_panned',
  'camera_zoomed',
] as const;

const FEEDBACK_EVENT_EFFECT_CODES: Record<FeedbackEventKind, string> = {
  object_created: 'creation_pop',
  object_created_frame: 'frame_materialize',
  object_deleted: 'deletion_dissolve',
  object_duplicated: 'duplicate_burst',
  object_recolored: 'recolor_pulse',
  object_locked: 'lock_shimmer',
  object_unlocked: 'unlock_shimmer',
  comment_created: 'comment_ping',
  board_shared: 'share_pulse',
  radial_opened: 'radial_bloom',
  camera_panned: 'camera_swish',
  camera_zoomed: 'zoom_wave',
};

// effect_masters (db/seeds.rb) has no dedicated celebration effect, and event_defs has no
// "quest_completed" row, so quest completion is routed onto the radial-menu bloom effect
// instead of a 13th canonical event kind. If a dedicated celebration effect is ever added
// to the seeded master data, update this alias (and event_defs) to point at it instead.
const FEEDBACK_EVENT_ALIAS: Record<'quest_completed', FeedbackEventKind> = {
  quest_completed: 'radial_opened',
};

const FEEDBACK_EFFECT_LOOKUP = new Map(FEEDBACK_EFFECT_MASTERS.map((effect) => [effect.code, effect]));

export function detectPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function normalizeFeedbackTrigger(trigger: FeedbackTrigger): FeedbackEventKind {
  if (trigger === 'quest_completed') {
    return FEEDBACK_EVENT_ALIAS.quest_completed;
  }

  return trigger;
}

export function resolveFeedbackEffect(trigger: FeedbackTrigger): FeedbackEffectMaster {
  const eventKind = normalizeFeedbackTrigger(trigger);
  const effectCode = FEEDBACK_EVENT_EFFECT_CODES[eventKind];
  const effect = FEEDBACK_EFFECT_LOOKUP.get(effectCode);

  if (effect == null) {
    throw new Error(`Unknown feedback effect for trigger: ${trigger}`);
  }

  return effect;
}

export function decideFeedback(
  trigger: FeedbackTrigger,
  intensity: FeedbackIntensityCode,
  reducedMotion = detectPrefersReducedMotion()
): FeedbackDecision {
  const eventKind = normalizeFeedbackTrigger(trigger);
  const effect = resolveFeedbackEffect(trigger);
  const resolvedIntensity: FeedbackIntensityCode = reducedMotion ? 'off' : intensity;
  const durationMs = resolvedIntensity === 'full'
    ? effect.durationMs
    : resolvedIntensity === 'subtle'
      ? Math.min(Math.round(effect.durationMs * 0.75), 400)
      : Math.min(120, effect.durationMs);

  return {
    trigger,
    eventKind,
    effectCode: effect.code,
    intensity,
    resolvedIntensity,
    reducedMotion,
    durationMs,
    easing: effect.easing,
    motionMode: resolvedIntensity === 'off' ? 'color-only' : 'motion',
    modal: false,
    blocksInput: false,
    soundEnabled: false,
  };
}

export class FeedbackDirector {
  readonly reducedMotion: boolean;

  constructor(reducedMotion = detectPrefersReducedMotion()) {
    this.reducedMotion = reducedMotion;
  }

  decide(trigger: FeedbackTrigger, intensity: FeedbackIntensityCode): FeedbackDecision {
    return decideFeedback(trigger, intensity, this.reducedMotion);
  }
}
