export interface GroupRule {
  type: 'exact';
  skus: string[];
  groupId: string;
}

export interface CabinetRule {
  type: 'sku_prefix';
  skuPrefix: string;
  cabinetId: string;
}

export interface BrandRule {
  type: 'exact';
  skus: string[];
  brandId: string;
}

export interface ClassificationRules {
  cabinetRules: CabinetRule[];
  groupRules: GroupRule[];
  brandRules: BrandRule[];
  defaultBrandId: string;
}

let _rules: ClassificationRules = {
  cabinetRules: [
    { type: 'sku_prefix', skuPrefix: '3', cabinetId: 'cab-1' },
    { type: 'sku_prefix', skuPrefix: '4', cabinetId: 'cab-1' },
    { type: 'sku_prefix', skuPrefix: '5', cabinetId: 'cab-2' },
  ],
  groupRules: [
    { type: 'exact', skus: ['39024', '39979', '33396', '40290', '40195', '40199', '40226', '40021-1', '39080-1', '40194-1'], groupId: 'grp-1' },
    { type: 'exact', skus: ['40007', '40043', '40189', '40215', '40239', '40483', '40240'], groupId: 'grp-2' },
    { type: 'exact', skus: ['35946', '40001', '40024', '40196', '40200', '40286', '40410', '40466', '40188'], groupId: 'grp-3' },
    { type: 'exact', skus: ['40053', '40054', '40055', '40194', '40237', '40470'], groupId: 'grp-4' },
    { type: 'exact', skus: ['39080', '39469', '40006', '40021', '40416', '40208', '40209'], groupId: 'grp-5' },
    { type: 'exact', skus: ['40223', '40224', '40225', '40227', '40228', '40229', '40230', '40378', '40379', '40429', '40427', '40423'], groupId: 'grp-6' },
    { type: 'exact', skus: ['39375', '40197', '40198', '40048'], groupId: 'grp-7' },
    { type: 'exact', skus: ['40219', '40220', '40372', '40373', '40447', '40374', '40375', '40377'], groupId: 'grp-8' },
    { type: 'exact', skus: ['40032', '40211', '40057', '40058', '40216', '40069'], groupId: 'grp-9' },
    { type: 'exact', skus: ['40192', '40193', '40207', '40454', '40461', '40202', '40463', '40462'], groupId: 'grp-10' },
    { type: 'exact', skus: ['40184', '40336', '40337', '40306', '40310'], groupId: 'grp-11' },
    { type: 'exact', skus: ['50003', '50019', '50024', '50025', '50034', '50035', '50036', '50145', '50205', '50062'], groupId: 'grp-12' },
    { type: 'exact', skus: ['50022', '50027', '50028', '50056', '50057', '50058', '50059', '50060', '50061'], groupId: 'grp-13' },
    { type: 'exact', skus: ['50016', '50017', '50020', '50021', '50029', '50037', '50038', '50049', '50052', '50193'], groupId: 'grp-14' },
    { type: 'exact', skus: ['50001', '50002', '50004', '50078', '50010', '50011', '50012', '50013', '50014', '50015'], groupId: 'grp-15' },
    { type: 'exact', skus: ['50009', '50030', '50031', '50043', '50044', '50045', '50046', '50047', '50048', '50050', '50051', '50055'], groupId: 'grp-16' },
    { type: 'exact', skus: ['50396', '50032', '50040', '50041', '50042', '50033', '50039'], groupId: 'grp-17' },
    { type: 'exact', skus: ['50026', '50053', '50054', '50007', '50023'], groupId: 'grp-18' },
  ],
  brandRules: [
    { type: 'exact', skus: ['39024', '39979', '33396', '40290', '40195', '40199', '40226', '40021-1', '39080-1', '40194-1'], brandId: 'br-2' },
  ],
  defaultBrandId: 'br-1',
};

export function getRules(): ClassificationRules {
  return {
    cabinetRules: [..._rules.cabinetRules],
    groupRules: [..._rules.groupRules],
    brandRules: [..._rules.brandRules],
    defaultBrandId: _rules.defaultBrandId,
  };
}

export function setRules(rules: Partial<ClassificationRules>) {
  if (rules.cabinetRules) _rules.cabinetRules = rules.cabinetRules;
  if (rules.groupRules) _rules.groupRules = rules.groupRules;
  if (rules.brandRules) _rules.brandRules = rules.brandRules;
  if (rules.defaultBrandId) _rules.defaultBrandId = rules.defaultBrandId;
}

export function classifySku(sku: string) {
  let brandId = _rules.defaultBrandId;
  let cabinetId = '';
  const groupIds: string[] = [];

  // 1. Cabinet by prefix
  for (const rule of _rules.cabinetRules) {
    if (sku.startsWith(rule.skuPrefix)) {
      cabinetId = rule.cabinetId;
      break;
    }
  }

  // 2. Group by exact SKU match
  for (const rule of _rules.groupRules) {
    if (rule.type === 'exact' && rule.skus.includes(sku)) {
      groupIds.push(rule.groupId);
    }
  }

  // 3. Brand by exact SKU match (attribute only, no structural role)
  for (const rule of _rules.brandRules) {
    if (rule.type === 'exact' && rule.skus.includes(sku)) {
      brandId = rule.brandId;
      break;
    }
  }

  return { brandId, cabinetId, groupIds };
}
