import type { Feature } from '../types.js';
import type { TrackDefinition } from './project-config.js';

interface QueueItem {
  featureId: number;
  isRetry: boolean;
  isResume?: boolean;
  extraContext?: string;
  previousSessionId?: string;
}

interface TrackQueues {
  main: QueueItem[];
  retry: QueueItem[];
  resume: QueueItem[];
}

export class QueueManager {
  private tracks: Map<string, TrackQueues> = new Map();
  private trackDefinitions: TrackDefinition[];

  constructor(trackDefinitions: TrackDefinition[]) {
    this.trackDefinitions = trackDefinitions;
    for (const def of trackDefinitions) {
      this.tracks.set(def.name, { main: [], retry: [], resume: [] });
    }
  }

  initializeQueues(features: Feature[]): void {
    // Clear existing queues
    for (const [name] of this.tracks) {
      this.tracks.set(name, { main: [], retry: [], resume: [] });
    }

    // Filter and sort open features by id ascending
    const openFeatures = features
      .filter((feature) => feature.status === 'open')
      .sort((a, b) => a.id - b.id);

    // Populate main queues based on category
    for (const feature of openFeatures) {
      const queueItem: QueueItem = {
        featureId: feature.id,
        isRetry: false,
      };

      const trackName = this.getTrack(feature);
      const queues = this.tracks.get(trackName);
      if (queues) {
        queues.main.push(queueItem);
      }
    }
  }

  dequeue(track: string): QueueItem | null {
    const queues = this.tracks.get(track);
    if (!queues) return null;

    // Resume queue has highest priority
    if (queues.resume.length > 0) {
      return queues.resume.shift() || null;
    }

    // Retry queue has priority
    if (queues.retry.length > 0) {
      return queues.retry.shift() || null;
    }

    // Fall back to main queue
    if (queues.main.length > 0) {
      return queues.main.shift() || null;
    }

    return null;
  }

  enqueueRetry(featureId: number, track: string, extraContext: string, previousSessionId?: string): void {
    const queues = this.tracks.get(track);
    if (!queues) return;

    queues.retry.push({
      featureId,
      isRetry: true,
      extraContext,
      previousSessionId,
    });
  }

  enqueueResume(featureId: number, track: string, extraContext: string, previousSessionId?: string): void {
    const queues = this.tracks.get(track);
    if (!queues) return;

    queues.resume.push({
      featureId,
      isRetry: true,
      isResume: true,
      extraContext,
      previousSessionId,
    });
  }

  getQueueStatus(track: string): { queued: number; retryQueued: number; resumeQueued: number } {
    const queues = this.tracks.get(track);
    if (!queues) return { queued: 0, retryQueued: 0, resumeQueued: 0 };

    return {
      queued: queues.main.length,
      retryQueued: queues.retry.length,
      resumeQueued: queues.resume.length,
    };
  }

  isEmpty(track: string): boolean {
    const queues = this.tracks.get(track);
    if (!queues) return true;
    return queues.main.length === 0 && queues.retry.length === 0 && queues.resume.length === 0;
  }

  /**
   * Determine which track a feature belongs to based on its category
   * and the track definitions.
   */
  getTrack(feature: Feature): string {
    // Find a track whose categories include this feature's category
    for (const def of this.trackDefinitions) {
      if (def.categories.includes(feature.category)) {
        return def.name;
      }
    }

    // Fall back to the default track
    const defaultTrack = this.trackDefinitions.find(d => d.isDefault);
    if (defaultTrack) return defaultTrack.name;

    // Last resort: first track
    return this.trackDefinitions[0]?.name || 'default';
  }

  getTrackNames(): string[] {
    return Array.from(this.tracks.keys());
  }
}
