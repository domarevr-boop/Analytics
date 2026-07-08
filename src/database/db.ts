import type { DataSnapshot, IDataRepository, SaveResult } from '../types';
import { LocalRepository as LocalRepo } from './localRepository';

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

export const repository: IDataRepository = new LocalRepository();

export async function loadAllData(): Promise<DataSnapshot> {
  return repository.loadAll();
}

export async function saveAllData(data: DataSnapshot): Promise<SaveResult> {
  return repository.saveAll(data);
}
