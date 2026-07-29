import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Product } from '../types';
import {
  subscribe, getVersion, getCabinets, getBrands, getGroups, getMemberships,
  getProducts, addProduct, updateProduct,
} from '../data/store';
import { getWbImageUrls, rememberWbImageUrl } from '../data/images';

type QualityFilter = 'all' | 'complete' | 'missing_wb' | 'unassigned' | 'archived';

function ProductThumb({ product }: { product: Product }) {
  const urls = product.wb_sku ? getWbImageUrls(product.wb_sku) : [];
  return (
    <div className="registry-thumb">
      <span>{product.sku.slice(0, 1).toUpperCase()}</span>
      {urls[0] && (
        <img
          src={urls[0]}
          alt=""
          loading="lazy"
          data-url-index="0"
          onLoad={event => rememberWbImageUrl(product.wb_sku, event.currentTarget.currentSrc || event.currentTarget.src)}
          onError={event => {
            const image = event.currentTarget;
            const nextIndex = Number(image.dataset.urlIndex || '0') + 1;
            if (nextIndex < urls.length) {
              image.dataset.urlIndex = String(nextIndex);
              image.src = urls[nextIndex];
            } else {
              image.style.display = 'none';
            }
          }}
        />
      )}
    </div>
  );
}

function ProductEditor({ product, onClose }: { product: Product; onClose: () => void }) {
  const brands = getBrands();
  const cabinets = getCabinets();
  const groups = getGroups();
  const membership = getMemberships().find(item => item.product_id === product.id);
  const [form, setForm] = useState({
    sku: product.sku,
    wb_sku: product.wb_sku || '',
    name: product.name || '',
    category: product.category || '',
    brand_id: product.brand_id || '',
    cabinet_id: product.cabinet_id || '',
    group_id: membership?.group_id || '',
    aliases: (product.aliases || []).join(', '),
    status: product.status || 'active',
  });

  useEffect(() => {
    setForm({
      sku: product.sku,
      wb_sku: product.wb_sku || '',
      name: product.name || '',
      category: product.category || '',
      brand_id: product.brand_id || '',
      cabinet_id: product.cabinet_id || '',
      group_id: membership?.group_id || '',
      aliases: (product.aliases || []).join(', '),
      status: product.status || 'active',
    });
  }, [product.id]);

  const setField = (field: keyof typeof form, value: string) => setForm(current => ({ ...current, [field]: value }));
  const save = () => {
    updateProduct(product.id, {
      sku: form.sku.trim(),
      wb_sku: form.wb_sku.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      brand_id: form.brand_id,
      cabinet_id: form.cabinet_id,
      group_id: form.group_id,
      aliases: [...new Set(form.aliases.split(',').map(value => value.trim()).filter(Boolean))],
      status: form.status as Product['status'],
      data_source: 'manual',
    });
    onClose();
  };

  return (
    <aside className="registry-editor">
      <div className="registry-editor-head">
        <div>
          <span className="registry-eyebrow">Карточка товара</span>
          <h2>{product.sku}</h2>
        </div>
        <button className="registry-icon-btn" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      <div className="registry-editor-preview">
        <ProductThumb product={{ ...product, wb_sku: form.wb_sku }} />
        <div><strong>{form.name || form.sku}</strong><span>ID: {product.id}</span></div>
      </div>
      <div className="registry-form-grid">
        <label><span>Артикул продавца</span><input value={form.sku} onChange={e => setField('sku', e.target.value)} /></label>
        <label><span>Артикул WB</span><input value={form.wb_sku} onChange={e => setField('wb_sku', e.target.value)} /></label>
        <label className="registry-field-wide"><span>Название</span><input value={form.name} onChange={e => setField('name', e.target.value)} /></label>
        <label><span>Категория</span><input value={form.category} onChange={e => setField('category', e.target.value)} /></label>
        <label><span>Бренд</span><select value={form.brand_id} onChange={e => setField('brand_id', e.target.value)}><option value="">Не указан</option>{brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Кабинет</span><select value={form.cabinet_id} onChange={e => setField('cabinet_id', e.target.value)}><option value="">Не назначен</option>{cabinets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Склейка / группа</span><select value={form.group_id} onChange={e => setField('group_id', e.target.value)}><option value="">Без склейки</option>{groups.filter(item => !form.cabinet_id || item.cabinet_id === form.cabinet_id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="registry-field-wide"><span>Исторические артикулы и алиасы</span><textarea value={form.aliases} onChange={e => setField('aliases', e.target.value)} placeholder="Через запятую" /></label>
        <label><span>Статус</span><select value={form.status} onChange={e => setField('status', e.target.value)}><option value="active">Активен</option><option value="archived">Архив</option></select></label>
      </div>
      <div className="registry-editor-actions">
        <button className="dict-btn" onClick={onClose}>Отмена</button>
        <button className="dict-btn dict-btn-primary" onClick={save}>Сохранить</button>
      </div>
    </aside>
  );
}

export default function DictionaryPage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const products = useMemo(() => getProducts(), [version]);
  const brands = useMemo(() => getBrands(), [version]);
  const cabinets = useMemo(() => getCabinets(), [version]);
  const groups = useMemo(() => getGroups(), [version]);
  const memberships = useMemo(() => getMemberships(), [version]);
  const [query, setQuery] = useState('');
  const [quality, setQuality] = useState<QualityFilter>('all');
  const [cabinetId, setCabinetId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const brandMap = useMemo(() => new Map(brands.map(item => [item.id, item.name])), [brands]);
  const cabinetMap = useMemo(() => new Map(cabinets.map(item => [item.id, item.name])), [cabinets]);
  const groupMap = useMemo(() => new Map(groups.map(item => [item.id, item.name])), [groups]);
  const membershipMap = useMemo(() => new Map(memberships.map(item => [item.product_id, item.group_id])), [memberships]);

  const isComplete = (product: Product) => Boolean(product.sku && product.wb_sku && product.brand_id && product.cabinet_id && product.category);
  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter(product => {
      if (cabinetId && product.cabinet_id !== cabinetId) return false;
      if (quality === 'complete' && !isComplete(product)) return false;
      if (quality === 'missing_wb' && product.wb_sku) return false;
      if (quality === 'unassigned' && product.cabinet_id && membershipMap.get(product.id)) return false;
      if (quality === 'archived' && product.status !== 'archived') return false;
      if (quality !== 'archived' && product.status === 'archived') return false;
      if (!normalizedQuery) return true;
      return [product.sku, product.wb_sku, product.name, product.category, ...(product.aliases || [])]
        .some(value => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [products, query, quality, cabinetId, membershipMap]);

  const stats = {
    all: products.length,
    complete: products.filter(isComplete).length,
    missingWb: products.filter(product => !product.wb_sku).length,
    unassigned: products.filter(product => !product.cabinet_id || !membershipMap.get(product.id)).length,
  };
  const selectedProduct = products.find(item => item.id === selectedId);

  const createProduct = () => {
    const product = addProduct(`NEW-${Date.now()}`, 'Новый товар', brands[0]?.id || '');
    setSelectedId(product.id);
  };

  return (
    <div className="registry-page analytics-page-shell">
      <header className="registry-header analytics-page-header">
        <div><span className="registry-eyebrow">Единый товарный реестр</span><h1>Справочник товаров</h1><p>Постоянная карточка для всех исторических и будущих импортов.</p></div>
        <button className="dict-btn dict-btn-primary" onClick={createProduct}>+ Добавить товар</button>
      </header>
      <section className="registry-stats">
        <button onClick={() => setQuality('all')} className={quality === 'all' ? 'active' : ''}><span>Всего</span><strong>{stats.all}</strong></button>
        <button onClick={() => setQuality('complete')} className={quality === 'complete' ? 'active' : ''}><span>Полные карточки</span><strong>{stats.complete}</strong></button>
        <button onClick={() => setQuality('missing_wb')} className={quality === 'missing_wb' ? 'active' : ''}><span>Нет WB ID</span><strong>{stats.missingWb}</strong></button>
        <button onClick={() => setQuality('unassigned')} className={quality === 'unassigned' ? 'active' : ''}><span>Не распределены</span><strong>{stats.unassigned}</strong></button>
      </section>
      <section className="registry-surface">
        <div className="registry-toolbar">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по SKU, WB ID, названию или алиасу" />
          <select value={cabinetId} onChange={e => setCabinetId(e.target.value)}><option value="">Все кабинеты</option>{cabinets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select value={quality} onChange={e => setQuality(e.target.value as QualityFilter)}><option value="all">Все активные</option><option value="complete">Полные карточки</option><option value="missing_wb">Без WB ID</option><option value="unassigned">Не распределены</option><option value="archived">Архив</option></select>
          <span>Найдено: <strong>{visibleProducts.length}</strong></span>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead><tr><th>Товар</th><th>Артикул продавца</th><th>WB ID</th><th>Категория</th><th>Бренд</th><th>Кабинет</th><th>Склейка</th><th>Качество</th></tr></thead>
            <tbody>
              {visibleProducts.map(product => {
                const complete = isComplete(product);
                return (
                  <tr key={product.id} onClick={() => setSelectedId(product.id)}>
                    <td><div className="registry-product-cell"><ProductThumb product={product} /><div><strong>{product.name || product.sku}</strong><span>{product.aliases?.length ? `Алиасов: ${product.aliases.length}` : 'Без алиасов'}</span></div></div></td>
                    <td><strong>{product.sku}</strong></td>
                    <td>{product.wb_sku || <span className="registry-missing">Не указан</span>}</td>
                    <td>{product.category || '—'}</td>
                    <td>{brandMap.get(product.brand_id) || '—'}</td>
                    <td>{cabinetMap.get(product.cabinet_id) || '—'}</td>
                    <td>{groupMap.get(membershipMap.get(product.id) || '') || 'Без склейки'}</td>
                    <td><span className={`registry-status ${complete ? 'complete' : 'attention'}`}>{complete ? 'Полная' : 'Требует данных'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visibleProducts.length && <div className="registry-empty">Товары по выбранным условиям не найдены.</div>}
        </div>
      </section>
      {selectedProduct && <ProductEditor product={selectedProduct} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
