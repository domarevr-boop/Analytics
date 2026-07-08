import { useSyncExternalStore } from 'react';
import { subscribe, getVersion, getCabinets, getBrands, getGroups, getProducts, UNGROUPED_GROUP_ID } from '../data/store';

interface FilterBarProps {
  cabinetFilter: string;
  brandFilter: string;
  groupFilter: string;
  searchQuery: string;
  onCabinetChange: (v: string) => void;
  onBrandChange: (v: string) => void;
  onGroupChange: (v: string) => void;
  onSearchChange: (v: string) => void;
}

export default function FilterBar({
  cabinetFilter, brandFilter, groupFilter, searchQuery,
  onCabinetChange, onBrandChange, onGroupChange, onSearchChange,
}: FilterBarProps) {
  useSyncExternalStore(subscribe, getVersion);
  const cabinets = getCabinets();
  const brands = getBrands();
  const groups = getGroups();
  const products = getProducts();
  const filteredGroups = groups.filter(g => !cabinetFilter || g.cabinet_id === cabinetFilter);
  const allSkus = [...new Set(products.map(p => p.sku).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="filterbar">
      <select value={cabinetFilter} onChange={e => { onCabinetChange(e.target.value); onBrandChange(''); onGroupChange(''); }}>
        <option value="">Все кабинеты</option>
        {cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={brandFilter} onChange={e => { onBrandChange(e.target.value); onGroupChange(''); }}>
        <option value="">Все бренды</option>
        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <select value={groupFilter} onChange={e => onGroupChange(e.target.value)}>
        <option value="">Все группы</option>
        {filteredGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        <option value={UNGROUPED_GROUP_ID}>Без склейки</option>
      </select>
      <select value={searchQuery} onChange={e => onSearchChange(e.target.value)} className="filterbar-sku">
        <option value="">Все артикулы</option>
        {allSkus.map(sku => <option key={sku} value={sku}>{sku}</option>)}
      </select>
    </div>
  );
}
