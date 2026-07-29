import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { subscribe, getVersion, getCabinets, getBrands, getGroups, getProducts, getMemberships, UNGROUPED_GROUP_ID } from '../data/store';
import { getFilteredProductIds } from '../data/productFilters';

export interface FilterBarProps {
  cabinetFilter: string;
  categoryFilter?: string;
  brandFilter: string;
  groupFilter: string;
  skuFilter: string;
  onCabinetChange: (v: string) => void;
  onCategoryChange?: (v: string) => void;
  onBrandChange: (v: string) => void;
  onGroupChange: (v: string) => void;
  onSkuChange: (v: string) => void;
  variant?: 'compact' | 'dashboard';
  afterControls?: ReactNode;
}

export default function FilterBar({
  cabinetFilter, categoryFilter = '', brandFilter, groupFilter, skuFilter,
  onCabinetChange, onCategoryChange = () => undefined, onBrandChange, onGroupChange, onSkuChange,
  variant = 'compact',
  afterControls,
}: FilterBarProps) {
  useSyncExternalStore(subscribe, getVersion);
  const cabinets = getCabinets();
  const brands = getBrands();
  const groups = getGroups();
  const products = getProducts();
  const memberships = getMemberships();
  const categories = [...new Set(products
    .filter(product => !cabinetFilter || product.cabinet_id === cabinetFilter)
    .map(product => product.category || 'Без категории'))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const productsBeforeGroup = getFilteredProductIds(products, memberships, {
    cabinetFilter,
    categoryFilter,
    brandFilter,
  });
  const filteredGroups = groups.filter(group => {
    if (group.id === UNGROUPED_GROUP_ID) return false;
    if (cabinetFilter && group.cabinet_id !== cabinetFilter) return false;
    if (!brandFilter) return true;
    return memberships.some(membership =>
      membership.group_id === group.id && productsBeforeGroup.has(membership.product_id)
    );
  });
  const filteredProductIds = getFilteredProductIds(products, memberships, {
    cabinetFilter,
    categoryFilter,
    brandFilter,
    groupFilter,
  });
  const productOptions = products
    .filter(product => filteredProductIds.has(product.id))
    .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));

  const [inputValue, setInputValue] = useState(skuFilter);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDropdown) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setShowAdvanced(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  const filteredProducts = inputValue
    ? productOptions.filter(product => {
        const query = inputValue.toLowerCase();
        return product.sku.toLowerCase().includes(query)
          || product.name.toLowerCase().includes(query)
          || product.wb_sku?.toLowerCase().includes(query);
      }).slice(0, 50)
    : [];
  const selectedCabinet = cabinets.find(cabinet => cabinet.id === cabinetFilter);
  const selectedCategory = categoryFilter || '';
  const selectedBrand = brands.find(brand => brand.id === brandFilter);
  const selectedGroup = groupFilter === UNGROUPED_GROUP_ID
    ? { name: 'Без склейки' }
    : groups.find(group => group.id === groupFilter);
  const activeFilterCount = [cabinetFilter, categoryFilter, brandFilter, groupFilter, skuFilter].filter(Boolean).length;
  const resultCount = getFilteredProductIds(products, memberships, {
    cabinetFilter,
    categoryFilter,
    brandFilter,
    groupFilter,
    skuFilter,
  }).size;

  const clearSku = () => {
    onSkuChange('');
    setInputValue('');
    setShowDropdown(false);
  };

  const resetFilters = () => {
    onCabinetChange('');
    onCategoryChange('');
    onBrandChange('');
    onGroupChange('');
    clearSku();
    setShowAdvanced(false);
  };

  const search = (
    <div className="sku-search">
      <span className="sku-search-icon" aria-hidden="true">⌕</span>
      <input
        className="sku-search-input"
        type="text"
        placeholder="Название, SKU или WB ID"
        value={inputValue}
        onChange={e => { setInputValue(e.target.value); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        onKeyDown={e => {
          if (e.key === 'Escape') setShowDropdown(false);
        }}
      />
      {skuFilter && (
        <button type="button" className="sku-search-clear" aria-label="Очистить поиск товара" onClick={clearSku}>
          ×
        </button>
      )}
      {showDropdown && inputValue && filteredProducts.length > 0 && (
        <div className="sku-search-dropdown">
          {filteredProducts.map(product => (
            <button
              type="button"
              key={product.id}
              className={`sku-search-item${product.sku === skuFilter ? ' selected' : ''}`}
              onClick={() => { onSkuChange(product.sku); setInputValue(product.sku); setShowDropdown(false); }}
            >
              <span className="sku-search-item-name">{product.name}</span>
              <span className="sku-search-item-meta">SKU {product.sku}{product.wb_sku ? ` · WB ${product.wb_sku}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {showDropdown && inputValue && filteredProducts.length === 0 && (
        <div className="sku-search-dropdown sku-search-empty">Ничего не найдено</div>
      )}
    </div>
  );

  if (variant === 'dashboard') {
    return (
      <div className="filterbar filterbar-dashboard" ref={ref}>
        <div className="filterbar-primary">
          <label className="filter-control">
            <span className="filter-control-label">Кабинет</span>
            <select value={cabinetFilter} onChange={e => { onCabinetChange(e.target.value); onCategoryChange(''); onBrandChange(''); onGroupChange(''); clearSku(); }}>
              <option value="">Все кабинеты</option>
              {cabinets.map(cabinet => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}
            </select>
          </label>
          <label className="filter-control">
            <span className="filter-control-label">Категория</span>
            <select value={categoryFilter} onChange={e => { onCategoryChange(e.target.value); onBrandChange(''); onGroupChange(''); clearSku(); }}>
              <option value="">Все категории</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          {search}
          <div className="filter-more-wrap">
            <button
              type="button"
              className={`filter-more-btn${showAdvanced ? ' active' : ''}`}
              onClick={() => setShowAdvanced(value => !value)}
            >
              Фильтры
              {(brandFilter || groupFilter) && <span className="filter-count">{[brandFilter, groupFilter].filter(Boolean).length}</span>}
            </button>
            {showAdvanced && (
              <div className="filter-popover">
                <label className="filter-popover-field">
                  <span>Бренд</span>
                  <select value={brandFilter} onChange={e => { onBrandChange(e.target.value); onGroupChange(''); clearSku(); }}>
                    <option value="">Все бренды</option>
                    {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                  </select>
                </label>
                <label className="filter-popover-field">
                  <span>Группа</span>
                  <select value={groupFilter} onChange={e => { onGroupChange(e.target.value); clearSku(); }}>
                    <option value="">Все группы</option>
                    {filteredGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                    <option value={UNGROUPED_GROUP_ID}>Без склейки</option>
                  </select>
                </label>
              </div>
            )}
          </div>
          {afterControls}
        </div>
        <div className="filterbar-status">
          <span className="filter-result-count">Найдено товаров: <strong>{resultCount}</strong></span>
          <div className="filter-chips">
            {selectedCabinet && <button type="button" className="filter-chip" onClick={() => { onCabinetChange(''); onCategoryChange(''); onBrandChange(''); onGroupChange(''); clearSku(); }}>Кабинет: {selectedCabinet.name}<span>×</span></button>}
            {selectedCategory && <button type="button" className="filter-chip" onClick={() => { onCategoryChange(''); onBrandChange(''); onGroupChange(''); clearSku(); }}>Категория: {selectedCategory}<span>×</span></button>}
            {selectedBrand && <button type="button" className="filter-chip" onClick={() => { onBrandChange(''); onGroupChange(''); clearSku(); }}>Бренд: {selectedBrand.name}<span>×</span></button>}
            {selectedGroup && <button type="button" className="filter-chip" onClick={() => { onGroupChange(''); clearSku(); }}>Группа: {selectedGroup.name}<span>×</span></button>}
            {skuFilter && <button type="button" className="filter-chip" onClick={clearSku}>SKU: {skuFilter}<span>×</span></button>}
          </div>
          {activeFilterCount > 0 && <button type="button" className="filter-reset" onClick={resetFilters}>Сбросить всё</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="filterbar" ref={ref}>
      <select value={cabinetFilter} onChange={e => { onCabinetChange(e.target.value); onBrandChange(''); onGroupChange(''); onSkuChange(''); setInputValue(''); }}>
        <option value="">Все кабинеты</option>
        {cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={brandFilter} onChange={e => { onBrandChange(e.target.value); onGroupChange(''); onSkuChange(''); setInputValue(''); }}>
        <option value="">Все бренды</option>
        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <select value={groupFilter} onChange={e => { onGroupChange(e.target.value); onSkuChange(''); setInputValue(''); }}>
        <option value="">Все группы</option>
        {filteredGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        <option value={UNGROUPED_GROUP_ID}>Без склейки</option>
      </select>
      {search}
    </div>
  );
}
