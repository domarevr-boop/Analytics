import type { DataChanges, DataSnapshot, IDataRepository, SaveResult } from '../types';
import { LocalRepository as LocalRepo } from './localRepository';
import { CloudRepository } from './cloudRepository';
import { RepositoryManager } from './repositoryManager';

class LocalRepository implements IDataRepository {
  readonly name = 'local';
  private inner = new LocalRepo();

  async initialize(): Promise<void> {
    await this.inner.initialize();
  }

  async loadAll(): Promise<DataSnapshot> {
    return this.inner.loadAll();
  }

  async saveAll(data: DataSnapshot): Promise<SaveResult> {
    return this.inner.saveAll(data);
  }

  async saveChanges(data: DataChanges): Promise<SaveResult> {
    return this.inner.saveChanges(data);
  }

  async clearAll(): Promise<void> {
    return this.inner.clearAll();
  }

  async deleteMetrics(opts: { productIds: string[]; dateStart?: string; dateEnd?: string }): Promise<void> {
    return this.inner.deleteMetrics(opts);
  }

  async deleteImportLog(logId: string): Promise<void> {
    return this.inner.deleteImportLog(logId);
  }

  async deleteProfitability(productId: string): Promise<void> {
    return this.inner.deleteProfitability(productId);
  }
}

const storageMode = import.meta.env.VITE_DATA_MODE ?? 'local';
export const isCloudStorage = storageMode === 'cloud';

export const repository: IDataRepository = isCloudStorage
  ? new RepositoryManager(new LocalRepo(), new CloudRepository(), { cloudFirst: true })
  : new LocalRepository();

export async function loadAllData(): Promise<DataSnapshot> {
  return repository.loadAll();
}

export async function saveAllData(data: DataSnapshot): Promise<SaveResult> {
  return repository.saveAll(data);
}
