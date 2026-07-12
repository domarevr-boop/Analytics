import { useState, useRef, useEffect, useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { subscribe, getVersion, getCabinets, getBrands, getGroups, getProducts, UNGROUPED_GROUP_ID } from '../data/store';

interface FilterBarProps {
  cabinetFilter: string;
  brandFilter: string;
  groupFilter: string;
  skuFilter: string;
  onCabinetChange: (v: string) => void;
  onBrandChange: (v: string) => void;
  onGroupChange: (v: string) => void;
  onSkuChange: (v: string) => void;
}

export default function FilterBar({
  cabinetFilter, brandFilter, groupFilter, skuFilter,
  onCabinetChange, onBrandChange, onGroupChange, onSkuChange,
}: FilterBarProps) {
  useSyncExternalStore(subscribe, getVersion);
  const cabinets = getCabinets();
  const brands = getBrands();
  const groups = getGroups();
  const products = getProducts();
  const filteredGroups = groups.filter(g => !cabinetFilter || g.cabinet_id === cabinetFilter);
  const allSkus = useMemo(() =>
    [...new Set(products.map(p => p.sku).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [products],
  );

  const [inputValue, setInputValue] = useState(skuFilter);
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(skuFilter);
  }, [skuFilter]);

  useEffect(() => {
    if (!showDropdown) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  const filteredSkus = useMemo(() => {
    if (!inputValue) return [];
    const q = inputValue.toLowerCase();
    return allSkus.filter(s => s.toLowerCase().includes(q)).slice(0, 50);
  }, [allSkus, inputValue]);

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
      <div className="sku-search" ref={ref}>
        <input
          className="sku-search-input"
          type="text"
          placeholder="Поиск артикула..."
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') setShowDropdown(false);
          }}
        />
        {skuFilter && (
          <button type="button" className="sku-search-clear" aria-label="Очистить поиск артикула" onClick={() => { onSkuChange(''); setInputValue(''); setShowDropdown(false); }}>
            ×
          </button>
        )}
        {showDropdown && inputValue && filteredSkus.length > 0 && (
          <div className="sku-search-dropdown">
            {filteredSkus.map(sku => (
              <div
                key={sku}
                className={`sku-search-item${sku === skuFilter ? ' selected' : ''}`}
                onClick={() => { onSkuChange(sku); setInputValue(sku); setShowDropdown(false); }}
              >
                {sku}
              </div>
            ))}
          </div>
        )}
        {showDropdown && inputValue && filteredSkus.length === 0 && (
          <div className="sku-search-dropdown sku-search-empty">Ничего не найдено</div>
        )}
      </div>
    </div>
  );
}
