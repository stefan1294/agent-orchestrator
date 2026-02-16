import { readFile, writeFile } from 'fs/promises';
import type { Feature } from '../types.js';
import { withFileLock } from '../utils/lock.js';

export class FeatureStore {
  private featuresFilePath: string;

  constructor(featuresFilePath: string) {
    this.featuresFilePath = featuresFilePath;
  }

  private parseFeatures(content: string): Feature[] {
    const parsed = JSON.parse(content);
    // Support both array format and { features: [...] } wrapper
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.features)) return parsed.features;
    throw new Error('Invalid features.json format: expected array or { features: [...] }');
  }

  async loadFeatures(): Promise<Feature[]> {
    return withFileLock(this.featuresFilePath, async () => {
      const content = await readFile(this.featuresFilePath, 'utf-8');
      return this.parseFeatures(content);
    });
  }

  async getFeature(id: number): Promise<Feature | undefined> {
    const features = await this.loadFeatures();
    return features.find((f) => f.id === id);
  }

  async updateFeatureStatus(
    id: number,
    status: 'open' | 'verifying' | 'passed' | 'failed',
    failureReason?: string,
    failureCategory?: 'environment' | 'test_only' | 'implementation' | 'verification' | 'unknown',
    progress?: string
  ): Promise<void> {
    return withFileLock(this.featuresFilePath, async () => {
      const content = await readFile(this.featuresFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      const isWrapped = !Array.isArray(parsed) && parsed?.features;
      const features: Feature[] = isWrapped ? parsed.features : parsed;

      const featureIndex = features.findIndex((f) => f.id === id);
      if (featureIndex === -1) {
        throw new Error(`Feature with id ${id} not found`);
      }

      features[featureIndex].status = status;

      if (status === 'failed' && failureReason) {
        features[featureIndex].failure_reason = failureReason;
        features[featureIndex].failure_category = failureCategory || 'unknown';
      } else if (status === 'passed' || status === 'open') {
        delete features[featureIndex].failure_reason;
        delete features[featureIndex].failure_category;
      }

      if (progress) {
        features[featureIndex].progress = progress;
      }

      // Write back in the same format it was read
      const output = isWrapped ? { ...parsed, features } : features;
      await writeFile(
        this.featuresFilePath,
        JSON.stringify(output, null, 2),
        'utf-8'
      );
    });
  }

  async getFeaturesByCategory(category: string): Promise<Feature[]> {
    const features = await this.loadFeatures();
    return features.filter((f) => f.category === category);
  }

  async getFeaturesByTrack(
    track: string,
    trackCategories?: string[]
  ): Promise<Feature[]> {
    const features = await this.loadFeatures();

    if (trackCategories && trackCategories.length > 0) {
      return features.filter((f) => trackCategories.includes(f.category));
    }

    // Legacy fallback
    if (track === 'marketing') {
      return features.filter((f) => f.category === 'marketing');
    }

    return features.filter((f) => f.category !== 'marketing');
  }
}
