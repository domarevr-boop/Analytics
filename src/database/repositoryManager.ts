import type { DataChanges, IDataRepository, DataSnapshot, SaveResult } from '../types';

export interface RepoStatus {
  cloudAvailable: boolean;
  lastSyncTime: Date | null;
}

export class RepositoryManager implements IDataRepository {
  private readonly DEV = import.meta.env.DEV;
  readonly name = 'manager';
  private _cloudAvailable = false;
  private _lastSyncTime: Date | null = null;
  private readonly cloudFirst: boolean;
  private readonly local: IDataRepository;
  private readonly cloud: IDataRepository;

  constructor(
    local: IDataRepository,
    cloud: IDataRepository,
    options?: { cloudFirst?: boolean },
  ) {
    this.local = local;
    this.cloud = cloud;
    this.cloudFirst = options?.cloudFirst ?? false;
  }

  getStatus(): RepoStatus {
    return { cloudAvailable: this._cloudAvailable, lastSyncTime: this._lastSyncTime };
  }

  async initialize(): Promise<void> {
    await this.local.initialize();
    try {
      await this.cloud.initialize();
      this._cloudAvailable = true;
      if (this.DEV) console.log('[repo] cloud available');
    } catch {
      this._cloudAvailable = false;
      if (this.DEV) console.log('[repo] cloud unavailable, offline mode');
    }
  }

  async loadAll(): Promise<DataSnapshot> {
    const localSnapshot = await this.local.loadAll();

    // Group history and aggregate planning are intentionally local-only. Keep
    // them when a cloud snapshot is used for the rest of the report data.
    const withLocalData = (cloudSnapshot: DataSnapshot): DataSnapshot => ({
      ...cloudSnapshot,
      groupHistory: localSnapshot.groupHistory,
      aggregatePlans: localSnapshot.aggregatePlans,
      planningSettings: localSnapshot.planningSettings,
    });

    if (this.cloudFirst && this._cloudAvailable) {
      try {
        const cloudSnapshot = await this.cloud.loadAll();
        if (cloudSnapshot.cabinets.length > 0) {
          const mergedSnapshot = withLocalData(cloudSnapshot);
          await this.local.saveAll(mergedSnapshot);
          this._lastSyncTime = new Date();
          return mergedSnapshot;
        }
      } catch (error) {
        console.warn('[repo] cloud load failed:', error);
        if (localSnapshot.cabinets.length === 0) throw error;
      }
    }

    if (localSnapshot.cabinets.length > 0) return localSnapshot;

    if (this._cloudAvailable) {
      try {
        const cloudSnapshot = await this.cloud.loadAll();
        if (cloudSnapshot.cabinets.length > 0) {
          const mergedSnapshot = withLocalData(cloudSnapshot);
          await this.local.saveAll(mergedSnapshot);
          this._lastSyncTime = new Date();
          return mergedSnapshot;
        }
      } catch (error) {
        console.warn('[repo] cloud load failed:', error);
        if (this.cloudFirst) throw error;
      }
    }

    return localSnapshot;
  }

  async saveAll(data: DataSnapshot): Promise<SaveResult> {
    if (this.cloudFirst && this._cloudAvailable) {
      const cloudResult = await this.cloud.saveAll(data);
      if (!cloudResult.ok) {
        this._cloudAvailable = false;
        console.warn('[repo] cloud sync failed:', cloudResult.errors.join('; '));
        return cloudResult;
      }
      const localResult = await this.local.saveAll(data);
      if (localResult.ok) this._lastSyncTime = new Date();
      return localResult;
    }

    const localResult = await this.local.saveAll(data);
    if (!localResult.ok) return localResult;
    if (!this._cloudAvailable) return { ok: true, errors: [] };

    const cloudResult = await this.cloud.saveAll(data);
    if (cloudResult.ok) {
      this._lastSyncTime = new Date();
    } else {
      this._cloudAvailable = false;
      console.warn('[repo] cloud sync failed:', cloudResult.errors.join('; '));
    }
    return cloudResult;
  }

  async saveChanges(data: DataChanges): Promise<SaveResult> {
    if (this.cloudFirst && this._cloudAvailable) {
      const cloudResult = await this.cloud.saveChanges(data);
      if (!cloudResult.ok) {
        this._cloudAvailable = false;
        console.warn('[repo] cloud sync failed:', cloudResult.errors.join('; '));
        return cloudResult;
      }
      const localResult = await this.local.saveChanges(data);
      if (localResult.ok) this._lastSyncTime = new Date();
      return localResult;
    }

    const localResult = await this.local.saveChanges(data);
    if (!localResult.ok) return localResult;
    if (!this._cloudAvailable) return { ok: true, errors: [] };

    const cloudResult = await this.cloud.saveChanges(data);
    if (cloudResult.ok) this._lastSyncTime = new Date();
    else {
      this._cloudAvailable = false;
      console.warn('[repo] cloud sync failed:', cloudResult.errors.join('; '));
    }
    return cloudResult;
  }
}
