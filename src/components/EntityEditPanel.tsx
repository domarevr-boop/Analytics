import { useState } from 'react';
import type { Cabinet, ProductGroup, Product } from '../types';
import {
  updateCabinet, updateGroup, updateProduct, removeCabinet, removeGroup, removeProduct,
  getBrands, getGroups, getCabinets, getMemberships,
} from '../data/store';

interface Props {
  type: 'cabinet' | 'group' | 'product';
  entity: Cabinet | ProductGroup | Product;
  onClose: () => void;
}

export default function EntityEditPanel({ type, entity, onClose }: Props) {
  const [name, setName] = useState('name' in entity ? entity.name : '');
  const [sku, setSku] = useState('sku' in entity ? entity.sku : '');
  const [category, setCategory] = useState('category' in entity ? entity.category : '');
  const [selectedBrandId, setSelectedBrandId] = useState('brand_id' in entity ? entity.brand_id : '');
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    if ('id' in entity) {
      const m = getMemberships().find(m => m.product_id === (entity as Product).id);
      return m ? m.group_id : '';
    }
    return '';
  });
  const [selectedCabinetId, setSelectedCabinetId] = useState('cabinet_id' in entity ? entity.cabinet_id : '');

  const isProduct = type === 'product';
  const isGroup = type === 'group';
  const isCabinet = type === 'cabinet';

  const brands = getBrands();
  const cabinets = getCabinets();
  const groups = getGroups();

  const handleSave = () => {
    if (isCabinet) updateCabinet(entity.id, name);
    if (isGroup) updateGroup(entity.id, name);
    if (isProduct) updateProduct(entity.id, { name, sku, category });
  };

  return (
    <div className="dict-edit-panel">
      <div className="dict-edit-header">
        <span className="dict-edit-title">
          {isCabinet ? 'Кабинет' : isGroup ? 'Группа' : 'Артикул'}
        </span>
        <span className="dict-edit-id">{entity.id}</span>
        <button className="dict-btn dict-btn-close" onClick={onClose}>✕</button>
      </div>

      <div className="dict-edit-body">
        <label className="dict-field">
          <span className="dict-field-label">Название</span>
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>

        {isProduct && (
          <>
            <label className="dict-field">
              <span className="dict-field-label">Артикул (SKU)</span>
              <input value={sku} onChange={e => setSku(e.target.value)} />
            </label>
            <label className="dict-field">
              <span className="dict-field-label">Категория</span>
              <input value={category} onChange={e => setCategory(e.target.value)} />
            </label>
            <label className="dict-field">
              <span className="dict-field-label">Бренд</span>
              <select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)}>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="dict-field">
              <span className="dict-field-label">Группа</span>
              <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)}>
                <option value="">Без группы</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          </>
        )}

        {isGroup && (
          <label className="dict-field">
            <span className="dict-field-label">Кабинет</span>
            <select value={selectedCabinetId} onChange={e => setSelectedCabinetId(e.target.value)}>
              <option value="">— Не выбран —</option>
              {cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}

        <div className="dict-edit-actions">
          <button className="dict-btn dict-btn-primary" onClick={handleSave}>Сохранить</button>
          <button className="dict-btn dict-btn-danger" onClick={() => {
            if (isCabinet) removeCabinet(entity.id);
            if (isGroup) removeGroup(entity.id);
            if (isProduct) removeProduct(entity.id);
            onClose();
          }}>Удалить</button>
        </div>
      </div>
    </div>
  );
}
