import type { IDataRepository, DataSnapshot } from '../types';

export interface RepoStatus {
  cloudAvailable: boolean;
  lastSyncTime: Date | null;
}

export class RepositoryManager implements IDataRepository {
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
      console.log('[repo] cloud available');
    } catch (err) {
      this._cloudAvailable = false;
      console.log('[repo] cloud unavailable, offline mode');
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

  async saveAll(data: DataSnapshot): Promise<void> {
    await this.local.saveAll(data);
    if (this._cloudAvailable) {
      this.cloud.saveAll(data).then(() => {
        this._lastSyncTime = new Date();
      }).catch(err => {
        console.warn('[repo] cloud sync failed:', err);
      });
    }
  }
}
