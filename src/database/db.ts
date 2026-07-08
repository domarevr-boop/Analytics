import type { DataSnapshot, IDataRepository } from '../types';
import { CloudRepository } from './cloudRepository';

export type RepoStatus = { cloudAvailable: boolean; lastSyncTime: Date | null };

const _status: RepoStatus = { cloudAvailable: false, lastSyncTime: null };
const _statusListeners = new Set<(s: RepoStatus) => void>();

function notifyStatus() {
  _statusListeners.forEach(fn => fn({ ..._status }));
}

export function getSyncStatus(): RepoStatus {
  return { ..._status };
}

export function subscribeSyncStatus(fn: (s: RepoStatus) => void) {
  _statusListeners.add(fn);
  return () => _statusListeners.delete(fn);
}

function markSyncSuccess() {
  _status.cloudAvailable = true;
  _status.lastSyncTime = new Date();
  notifyStatus();
}

function markSyncError() {
  _status.cloudAvailable = false;
  notifyStatus();
}

class CloudOnlyRepository implements IDataRepository {
  readonly name = 'cloud-only';
  private cloud = new CloudRepository();

  async initialize(): Promise<void> {
    try {
      await this.cloud.initialize();
      markSyncSuccess();
    } catch {
      markSyncError();
    }
  }

  async loadAll(): Promise<DataSnapshot> {
    try {
      const result = await this.cloud.loadAll();
      markSyncSuccess();
      return result;
    } catch (err) {
      markSyncError();
      throw err;
    }
  }

  async saveAll(data: DataSnapshot): Promise<void> {
    try {
      await this.cloud.saveAll(data);
      markSyncSuccess();
    } catch (err) {
      markSyncError();
      throw err;
    }
  }

  async deleteMetrics(opts: { productIds: string[]; dateStart?: string; dateEnd?: string }): Promise<void> {
    try {
      await this.cloud.deleteMetrics(opts);
      markSyncSuccess();
    } catch (err) {
      markSyncError();
      throw err;
    }
  }

  async deleteImportLog(logId: string): Promise<void> {
    try {
      await this.cloud.deleteImportLog(logId);
      markSyncSuccess();
    } catch (err) {
      markSyncError();
      throw err;
    }
  }

  async deleteProfitability(productId: string): Promise<void> {
    try {
      await this.cloud.deleteProfitability(productId);
      markSyncSuccess();
    } catch (err) {
      markSyncError();
      throw err;
    }
  }
}

export const repository: IDataRepository = new CloudOnlyRepository();
export { CloudRepository };

export async function loadAllData(): Promise<DataSnapshot> {
  return repository.loadAll();
}

export async function saveAllData(data: DataSnapshot): Promise<void> {
  return repository.saveAll(data);
}
