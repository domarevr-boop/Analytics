import type { IDataRepository, DataSnapshot, SaveResult } from '../types';

export interface RepoStatus {
  cloudAvailable: boolean;
  lastSyncTime: Date | null;
}

export class RepositoryManager implements IDataRepository {
  private readonly DEV = import.meta.env.DEV;
  readonly name = 'manager';
  private local: IDataRepository;
  private cloud: IDataRepository;
  private _cloudAvailable = false;
  private _lastSyncTime: Date | null = null;

  constructor(local: IDataRepository, cloud: IDataRepository) {
    this.local = local;
    this.cloud = cloud;
  }

  getStatus(): RepoStatus {
    return {
      cloudAvailable: this._cloudAvailable,
      lastSyncTime: this._lastSyncTime,
    };
  }

  async initialize(): Promise<void> {
    await this.local.initialize();
    try {
      await this.cloud.initialize();
      this._cloudAvailable = true;
      if (this.DEV) console.log('[repo] cloud available');
    } catch (err) {
      this._cloudAvailable = false;
      if (this.DEV) console.log('[repo] cloud unavailable, offline mode');
    }
  }

  async loadAll(): Promise<DataSnapshot> {
    const localSnapshot = await this.local.loadAll();
    if (localSnapshot.cabinets.length > 0) {
      return localSnapshot;
    }
    if (this._cloudAvailable) {
      try {
        const cloudSnapshot = await this.cloud.loadAll();
        if (cloudSnapshot.cabinets.length > 0) {
          await this.local.saveAll(cloudSnapshot);
          this._lastSyncTime = new Date();
          return cloudSnapshot;
        }
      } catch (err) {
        console.warn('[repo] cloud load failed:', err);
      }
    }
    return localSnapshot;
  }

  async saveAll(data: DataSnapshot): Promise<SaveResult> {
    const localResult = await this.local.saveAll(data);
    if (!localResult.ok) {
      return localResult;
    }
    if (this._cloudAvailable) {
      const cloudResult = await this.cloud.saveAll(data);
      if (cloudResult.ok) {
        this._lastSyncTime = new Date();
      } else {
        this._cloudAvailable = false;
        console.warn('[repo] cloud sync failed:', cloudResult.errors.join('; '));
      }
      return cloudResult;
    }
    return { ok: true, errors: [] };
  }
}
