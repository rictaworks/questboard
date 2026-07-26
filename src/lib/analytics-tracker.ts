export const KPI_EVENT_DEFINITIONS = [
  'object_created_sticky',
  'object_created_shape',
  'object_created_text',
  'object_created_image',
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

export type KpiEventDefinitionCode = (typeof KPI_EVENT_DEFINITIONS)[number];
export type AnalyticsConnectionState = 'connected' | 'reconnecting' | 'offline';

export interface AnalyticsTrackerEvent {
  eventId: KpiEventDefinitionCode;
  attributes?: Record<string, unknown>;
  timestamp?: string | number | Date;
}

export interface AnalyticsTrackerOptions {
  endpointUrl: string;
  boardId: number;
  userId: string;
  batchSize?: number;
  flushIntervalMs?: number;
  offlineBufferLimit?: number;
  storageKey?: string;
  storage?: StorageLike | null;
  fetchImpl?: typeof fetch;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  logger?: Pick<Console, 'error' | 'warn'>;
}

type StoredAnalyticsEvent = {
  boardId: number;
  attributes: Record<string, unknown>;
  eventId: KpiEventDefinitionCode;
  timestamp: string;
  userId: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_OFFLINE_BUFFER_LIMIT = 500;
const PII_KEY_PATTERNS = [
  /(?:^|[_.-])(name|fullName|firstName|lastName)(?:$|[_.-])/i,
  /(?:^|[_.-])(email|emailAddress)(?:$|[_.-])/i,
  /(?:^|[_.-])(address|street|postalCode|zipCode|city|state|country)(?:$|[_.-])/i,
  /(?:^|[_.-])(phone|phoneNumber|tel|telephone|mobile)(?:$|[_.-])/i,
  /(?:^|[_.-])(dob|birth|birthday|dateOfBirth)(?:$|[_.-])/i,
] as const;
const EMAIL_VALUE_PATTERN = /(^|[\s<])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}($|[\s>.,;:!?])/;
const PHONE_VALUE_PATTERN = /^\+?[0-9()\-\s]{7,}$/;
const DOB_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsTracker {
  private readonly endpointUrl: string;
  private readonly boardId: number;
  private readonly userId: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly offlineBufferLimit: number;
  private readonly storageKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private readonly logger: Pick<Console, 'error' | 'warn'>;
  private readonly storage: StorageLike | null;
  private pendingQueue: StoredAnalyticsEvent[] = [];
  private connectionState: AnalyticsConnectionState = 'connected';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(options: AnalyticsTrackerOptions) {
    this.endpointUrl = options.endpointUrl;
    this.boardId = options.boardId;
    this.userId = options.userId;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.offlineBufferLimit = options.offlineBufferLimit ?? DEFAULT_OFFLINE_BUFFER_LIMIT;
    this.storageKey = options.storageKey ?? `questboard.analytics.${options.userId}.${options.boardId}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
    this.logger = options.logger ?? console;
    this.storage = options.storage ?? readBrowserStorage();
  }

  setConnectionState(state: AnalyticsConnectionState): void {
    this.connectionState = state;

    if (state === 'offline') {
      this.persistOfflineBuffer([...this.readOfflineBuffer(), ...this.pendingQueue]);
      this.pendingQueue = [];
      this.clearScheduledFlush();
      return;
    }

    if (this.hasPendingWork()) {
      this.scheduleFlush();
    }
  }

  track(event: AnalyticsTrackerEvent): void {
    const trackedEvent = this.normalizeEvent(event);

    if (this.connectionState === 'offline') {
      this.persistOfflineBuffer([...this.readOfflineBuffer(), trackedEvent]);
      return;
    }

    this.pendingQueue.push(trackedEvent);

    if (this.pendingQueue.length >= this.batchSize) {
      void this.flush();
      return;
    }

    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }

    if (this.connectionState === 'offline') {
      this.persistOfflineBuffer([...this.readOfflineBuffer(), ...this.pendingQueue]);
      this.pendingQueue = [];
      this.clearScheduledFlush();
      return;
    }

    this.flushing = true;
    this.clearScheduledFlush();

    try {
      this.pendingQueue = [...this.readOfflineBuffer(), ...this.pendingQueue];
      this.persistOfflineBuffer([]);

      while (this.pendingQueue.length > 0) {
        const batch = this.pendingQueue.slice(0, this.batchSize);
        const nextQueue = this.pendingQueue.slice(batch.length);
        const result = await this.sendBatch(batch);

        if (result.kind === 'retry-later') {
          this.persistOfflineBuffer([...result.buffered, ...nextQueue]);
          this.pendingQueue = [];
          return;
        }

        if (result.kind === 'discard') {
          this.pendingQueue = nextQueue;
          continue;
        }

        this.pendingQueue = nextQueue;
      }
    } catch (error) {
      this.logger.warn('[AnalyticsTracker] flush failed', error);
    } finally {
      this.flushing = false;
      if (this.hasPendingWork()) {
        this.scheduleFlush();
      }
    }
  }

  dispose(): void {
    this.clearScheduledFlush();
    if (this.connectionState === 'offline' || this.pendingQueue.length > 0) {
      this.persistOfflineBuffer([...this.readOfflineBuffer(), ...this.pendingQueue]);
      this.pendingQueue = [];
    }
  }

  private hasPendingWork(): boolean {
    return this.pendingQueue.length > 0 || this.readOfflineBuffer().length > 0;
  }

  private scheduleFlush(): void {
    if (this.flushTimer != null || this.connectionState === 'offline' || this.pendingQueue.length === 0) {
      return;
    }

    this.flushTimer = this.setTimeoutImpl(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private clearScheduledFlush(): void {
    if (this.flushTimer == null) {
      return;
    }

    this.clearTimeoutImpl(this.flushTimer);
    this.flushTimer = null;
  }

  private normalizeEvent(event: AnalyticsTrackerEvent): StoredAnalyticsEvent {
    if (!KPI_EVENT_DEFINITIONS.includes(event.eventId)) {
      throw new Error(`Unsupported KPI event: ${event.eventId}`);
    }

    if (!Number.isFinite(this.boardId)) {
      throw new Error('boardId is required');
    }

    if (!this.userId) {
      throw new Error('userId is required');
    }

    const timestamp = this.normalizeTimestamp(event.timestamp ?? Date.now());
    const attributes = this.normalizeAttributes(event.attributes ?? {});

    return {
      boardId: this.boardId,
      attributes,
      eventId: event.eventId,
      timestamp,
      userId: this.userId,
    };
  }

  private normalizeTimestamp(timestamp: string | number | Date): string {
    const value = timestamp instanceof Date ? timestamp : new Date(timestamp);

    if (Number.isNaN(value.getTime())) {
      throw new Error('timestamp is invalid');
    }

    return value.toISOString();
  }

  private normalizeAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
    this.ensureNoPii(attributes);
    return structuredCloneSafe(attributes);
  }

  private ensureNoPii(value: unknown, path: string[] = []): void {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => this.ensureNoPii(entry, [...path, String(index)]));
      return;
    }

    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        this.ensureNoPiiInString(value, path);
      }
      return;
    }

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = [...path, key];
      this.ensureNoPiiInKey(nextPath);
      this.ensureNoPii(entry, nextPath);
    }
  }

  private ensureNoPiiInKey(path: string[]): void {
    const joinedPath = path.join('.');

    if (PII_KEY_PATTERNS.some((pattern) => pattern.test(joinedPath))) {
      this.rejectPii(joinedPath);
    }
  }

  private ensureNoPiiInString(value: string, path: string[]): void {
    const joinedPath = path.join('.');
    const lowerPath = joinedPath.toLowerCase();

    if (EMAIL_VALUE_PATTERN.test(value)) {
      this.rejectPii(joinedPath);
    }

    if (PHONE_VALUE_PATTERN.test(value) && /phone|tel|mobile/i.test(lowerPath)) {
      this.rejectPii(joinedPath);
    }

    if (DOB_VALUE_PATTERN.test(value) && /dob|birth/i.test(lowerPath)) {
      this.rejectPii(joinedPath);
    }
  }

  private rejectPii(path: string): never {
    const message = `PII-bearing attribute rejected at ${path}`;
    this.logger.error('[AnalyticsTracker]', message);
    throw new Error(message);
  }

  private readOfflineBuffer(): StoredAnalyticsEvent[] {
    if (!this.storage) {
      return [];
    }

    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as StoredAnalyticsEvent[] : [];
    } catch {
      return [];
    }
  }

  private persistOfflineBuffer(events: StoredAnalyticsEvent[]): void {
    if (!this.storage) {
      return;
    }

    const next = events.slice(-this.offlineBufferLimit);
    this.storage.setItem(this.storageKey, JSON.stringify(next));
  }

  private async sendBatch(batch: StoredAnalyticsEvent[]): Promise<{kind: 'sent'} | {kind: 'discard'} | {kind: 'retry-later'; buffered: StoredAnalyticsEvent[]}> {
    if (batch.length === 0) {
      return {kind: 'sent'};
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpointUrl, {
        body: JSON.stringify({events: batch}),
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      });
    } catch (error) {
      this.logger.warn('[AnalyticsTracker] network error', error);
      return {kind: 'retry-later', buffered: batch};
    }

    if (response.ok) {
      return {kind: 'sent'};
    }

    if (response.status >= 400 && response.status < 500) {
      const errorPayload = await response.json().catch(() => ({})) as {error?: string};
      this.logger.error('[AnalyticsTracker] rejected by server', errorPayload.error ?? `HTTP ${response.status}`);
      return {kind: 'discard'};
    }

    this.logger.warn('[AnalyticsTracker] server unavailable', response.status);
    return {kind: 'retry-later', buffered: batch};
  }
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function readBrowserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
