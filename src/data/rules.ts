import { loadClassificationRules } from './seedLoader';
import type { ClassificationRules } from './seedLoader';

export type { ClassificationRules };

let _rules: ClassificationRules | null = null;

export function initRules() {
  if (_rules) return;
  _rules = loadClassificationRules();
}

export function getRules(): ClassificationRules {
  initRules();
  return {
    cabinetRules: [..._rules!.cabinetRules],
    groupRules: [..._rules!.groupRules],
    brandRules: [..._rules!.brandRules],
    defaultBrandId: _rules!.defaultBrandId,
  };
}

export function setRules(rules: Partial<ClassificationRules>) {
  initRules();
  if (rules.cabinetRules) _rules!.cabinetRules = rules.cabinetRules;
  if (rules.groupRules) _rules!.groupRules = rules.groupRules;
  if (rules.brandRules) _rules!.brandRules = rules.brandRules;
  if (rules.defaultBrandId) _rules!.defaultBrandId = rules.defaultBrandId;
}

export function classifySku(sku: string) {
  initRules();
  let brandId = _rules!.defaultBrandId;
  let cabinetId = '';
  const groupIds: string[] = [];

  for (const rule of _rules!.cabinetRules) {
    if (sku.startsWith(rule.skuPrefix)) {
      cabinetId = rule.cabinetId;
      break;
    }
  }

  for (const rule of _rules!.groupRules) {
    if (rule.type === 'exact' && rule.skus.includes(sku)) {
      groupIds.push(rule.groupId);
    }
  }

  for (const rule of _rules!.brandRules) {
    if (rule.type === 'exact' && rule.skus.includes(sku)) {
      brandId = rule.brandId;
      break;
    }
  }

  return { brandId, cabinetId, groupIds };
}
