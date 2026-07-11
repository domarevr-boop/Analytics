import { useState, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getCabinets, getBrands, getGroups, getMemberships, getProducts as getProductsStore, addCabinet, addGroup, addProduct, UNGROUPED_GROUP_ID } from '../data/store';
import EntityEditPanel from './EntityEditPanel';

type EntityType = 'cabinet' | 'group' | 'product';

interface Selected {
  type: EntityType;
  id: string;
}

export default function DictionaryPage() {
  const version = useSyncExternalStore(subscribe, getVersion);
  void version;
  const cabinets = getCabinets();
  const brands = getBrands();
  const groups = getGroups();
  const products = getProductsStore();
  const memberships = getMemberships();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(cabinets.map(c => c.id)));
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  const [addingProduct, setAddingProduct] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [addingCabinet, setAddingCabinet] = useState(false);
  const [newCabinetName, setNewCabinetName] = useState('');

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const brandMap = new Map(brands.map(b => [b.id, b.name]));

  const selectedEntity = selected
    ? (selected.type === 'cabinet' ? cabinets.find(c => c.id === selected.id) : null)
    ?? (selected.type === 'group' ? groups.find(g => g.id === selected.id) : null)
    ?? (selected.type === 'product' ? products.find(p => p.id === selected.id) : null)
    : null;

  const handleAddCabinet = () => {
    const name = newCabinetName.trim();
    if (!name) return;
    const cab = addCabinet(name);
    setNewCabinetName('');
    setAddingCabinet(false);
    setExpanded(prev => { const next = new Set(prev); next.add(cab.id); return next; });
  };

  const handleAddGroup = (cabinetId: string) => {
    const name = newName.trim();
    if (!name) return;
    const grp = addGroup(name, cabinetId);
    setNewName('');
    setAddingGroup(null);
    setExpanded(prev => { const next = new Set(prev); next.add(grp.id); return next; });
  };

  const handleAddProduct = (_groupId: string) => {
    const name = newName.trim();
    if (!name) return;
    const defaultBrandId = brands[0]?.id || '';
    addProduct(name, name, defaultBrandId);
    setNewName('');
    setAddingProduct(null);
  };

  return (
    <div className="dict-page">
      <div className="dict-tree">
        <div className="dict-tree-header">
          <span>Справочник</span>
          <button className="dict-btn dict-btn-sm" onClick={() => setAddingCabinet(true)}>+ Кабинет</button>
        </div>
        <div className="dict-tree-scroll">
          {addingCabinet && (
            <div className="dict-inline-form">
              <input value={newCabinetName} onChange={e => setNewCabinetName(e.target.value)} placeholder="Название кабинета" autoFocus />
              <button className="dict-btn dict-btn-primary dict-btn-xs" onClick={handleAddCabinet}>OK</button>
              <button className="dict-btn dict-btn-xs" onClick={() => { setAddingCabinet(false); setNewCabinetName(''); }}>✕</button>
            </div>
          )}
          {cabinets.map(cab => {
            const cabGroups = groups.filter(g => g.cabinet_id === cab.id);
            const isExp = expanded.has(cab.id);
            const isSel = selected?.id === cab.id;
            return (
              <div key={cab.id}>
                <div
                  className={`dict-node dict-cabinet ${isSel ? 'selected' : ''}`}
                  style={{ paddingLeft: 4 }}
                  onClick={() => setSelected({ type: 'cabinet', id: cab.id })}
                >
                  <span className="dict-toggle" onClick={e => { e.stopPropagation(); toggle(cab.id); }}>
                    {cabGroups.length ? (isExp ? '−' : '+') : ' '}
                  </span>
                  <span className="dict-node-icon">◆</span>
                  {cab.name}
                  <span className="dict-add-btn" onClick={e => { e.stopPropagation(); setAddingGroup(cab.id); setNewName(''); }}>
                    + гр.
                  </span>
                </div>
                {isExp && (
                  <>
                    {addingGroup === cab.id && (
                      <div className="dict-inline-form" style={{ paddingLeft: 28 }}>
                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Название группы" autoFocus />
                        <button className="dict-btn dict-btn-primary dict-btn-xs" onClick={() => handleAddGroup(cab.id)}>OK</button>
                        <button className="dict-btn dict-btn-xs" onClick={() => setAddingGroup(null)}>✕</button>
                      </div>
                    )}
                    {cabGroups.map(grp => {
                      const grpMemberships = memberships.filter(m => m.group_id === grp.id);
                      const grpProducts = products.filter(p =>
                        grpMemberships.some(m => m.product_id === p.id)
                      );
                      const isGrpExp = expanded.has(grp.id);
                      const isGrpSel = selected?.id === grp.id;
                      return (
                        <div key={grp.id}>
                          <div
                            className={`dict-node dict-group ${isGrpSel ? 'selected' : ''}`}
                            style={{ paddingLeft: 24 }}
                            onClick={() => setSelected({ type: 'group', id: grp.id })}
                          >
                            <span className="dict-toggle" onClick={e => { e.stopPropagation(); toggle(grp.id); }}>
                              {grpProducts.length ? (isGrpExp ? '−' : '+') : ' '}
                            </span>
                              <span className="dict-node-icon">▦</span>
                            {grp.name}
                            <span className="dict-add-btn" onClick={e => { e.stopPropagation(); setAddingProduct(grp.id); setNewName(''); }}>
                              + тов.
                            </span>
                          </div>
                          {isGrpExp && (
                            <>
                              {addingProduct === grp.id && (
                                <div className="dict-inline-form" style={{ paddingLeft: 48 }}>
                                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="SKU или название" autoFocus />
                                  <button className="dict-btn dict-btn-primary dict-btn-xs" onClick={() => handleAddProduct(grp.id)}>OK</button>
                                  <button className="dict-btn dict-btn-xs" onClick={() => setAddingProduct(null)}>✕</button>
                                </div>
                              )}
                              {grpProducts.map(pr => {
                                const isPrSel = selected?.id === pr.id;
                                const brandName = brandMap.get(pr.brand_id) || '';
                                return (
                                  <div
                                    key={pr.id}
                                    className={`dict-node dict-product ${isPrSel ? 'selected' : ''}`}
                                    style={{ paddingLeft: 44 }}
                                    onClick={() => setSelected({ type: 'product', id: pr.id })}
                                  >
                                    <span className="dict-toggle"> </span>
                                    <span className="dict-node-icon">·</span>
                                    <span className="dict-sku">{pr.sku}</span> {pr.name}
                                    {brandName && <span className="dict-brand-tag">{brandName}</span>}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      );
                    })}
                    {/* Без склейки */}
                    {(() => {
                      const ungroupedProducts = products.filter(p =>
                        memberships.some(m => m.product_id === p.id && m.group_id === UNGROUPED_GROUP_ID) &&
                        p.cabinet_id === cab.id
                      );
                      if (!ungroupedProducts.length) return null;
                      const ugId = cab.id + '-' + UNGROUPED_GROUP_ID;
                      const isUgExp = expanded.has(ugId);
                      const isUgSel = selected?.id === ugId;
                      return (
                        <div key={ugId}>
                          <div
                            className={`dict-node dict-group ${isUgSel ? 'selected' : ''}`}
                            style={{ paddingLeft: 24 }}
                            onClick={() => setSelected({ type: 'group', id: ugId })}
                          >
                            <span className="dict-toggle" onClick={e => { e.stopPropagation(); toggle(ugId); }}>
                              {ungroupedProducts.length ? (isUgExp ? '−' : '+') : ' '}
                            </span>
                              <span className="dict-node-icon">▦</span>
                            Без склейки
                          </div>
                          {isUgExp && ungroupedProducts.map(pr => {
                            const isPrSel = selected?.id === pr.id;
                            const brandName = brandMap.get(pr.brand_id) || '';
                            return (
                              <div
                                key={pr.id}
                                className={`dict-node dict-product ${isPrSel ? 'selected' : ''}`}
                                style={{ paddingLeft: 44 }}
                                onClick={() => setSelected({ type: 'product', id: pr.id })}
                              >
                                <span className="dict-toggle"> </span>
                                <span className="dict-node-icon">·</span>
                                <span className="dict-sku">{pr.sku}</span> {pr.name}
                                {brandName && <span className="dict-brand-tag">{brandName}</span>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            );
          })}
          {!cabinets.length && (
            <div style={{ padding: 16, color: '#9CA3AF' }}>Нет данных</div>
          )}
        </div>
      </div>
      <div className="dict-edit">
        {selectedEntity ? (
          <EntityEditPanel
            type={selected!.type}
            entity={selectedEntity}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="dict-edit-empty">Выберите элемент в дереве слева</div>
        )}
      </div>
    </div>
  );
}
