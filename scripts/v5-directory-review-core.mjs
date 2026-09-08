import { createHash } from 'node:crypto';

const REASON_LABELS = {
  missing_or_ambiguous_cabinet: 'кабинет отсутствует или неоднозначен',
  multiple_wb_sku: 'несколько WB ID',
  multiple_seller_sku: 'несколько артикулов продавца',
  multiple_categories: 'несколько категорий',
  multiple_brands: 'несколько брендов',
  unknown_brand: 'неизвестный бренд',
  missing_identity: 'нет устойчивого идентификатора',
  unknown_group: 'неизвестная склейка',
  group_cabinet_mismatch: 'склейка относится к другому кабинету',
  different_groups_after_identity_merge: 'конфликт склеек после объединения identity',
};

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function markdown(value) {
  return clean(value).replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ') || '—';
}

function reviewKey(item) {
  const ids = Array.isArray(item.legacyProductIds) ? [...item.legacyProductIds].map(clean).filter(Boolean).sort() : [];
  return `${clean(item.type) || 'unknown'}:${ids.join('+')}`;
}

export function fingerprintDirectoryReview(reviewQueue) {
  if (!Array.isArray(reviewQueue)) throw new Error('Directory review: reviewQueue must be an array');
  return createHash('sha256').update(JSON.stringify(reviewQueue)).digest('hex');
}

export function buildDirectoryReviewArtifacts(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Directory review: invalid manifest');
  if (!manifest.source || typeof manifest.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(manifest.source.sha256)) {
    throw new Error('Directory review: manifest source hash is missing');
  }
  if (!Array.isArray(manifest.reviewQueue)) throw new Error('Directory review: reviewQueue must be an array');

  const reviewFingerprint = fingerprintDirectoryReview(manifest.reviewQueue);
  const decisions = manifest.reviewQueue.map((item, index) => ({
    reviewKey: reviewKey(item),
    reviewIndex: index + 1,
    type: clean(item.type),
    legacyProductIds: Array.isArray(item.legacyProductIds) ? item.legacyProductIds.map(clean).filter(Boolean) : [],
    reasons: Array.isArray(item.reasons) ? item.reasons.map(clean).filter(Boolean) : [],
    action: null,
    note: '',
    resolution: null,
  }));

  const lines = [
    '# Разбор неоднозначностей справочника V5',
    '',
    `Источник: SHA-256 \`${manifest.source.sha256}\`.`,
    '',
    `Всего решений: **${decisions.length}**. Этот отчёт локальный и не публикует данные в Supabase.`,
    '',
    'Для каждой компоненты нужно выбрать одно действие: `merge` — это один товар; `split` — несколько товаров с явным распределением legacy ID; `exclude` — осознанно не переносить. Пустое решение нельзя публиковать.',
    '',
    'Для `merge` и `split` поле `resolution` в JSON имеет вид `{ "products": [...] }`. Каждый товар обязан содержать `legacyProductIds`, `cabinetExternalKey`, `sellerSku`, `wbSku`, `name`, `category`, `brandExternalKey`, `brandName`, `aliases` и `status` (`active`/`archived`). `brandName` нужен только для нового brand ID. При `exclude` поле `resolution` остаётся `null`, а комментарий `note` обязателен.',
    '',
  ];

  manifest.reviewQueue.forEach((item, index) => {
    const reasons = Array.isArray(item.reasons) ? item.reasons : [];
    const candidates = Array.isArray(item.candidates) ? item.candidates : [];
    lines.push(`## ${index + 1}. ${reviewKey(item)}`, '');
    lines.push(`Причины: ${reasons.map(reason => REASON_LABELS[reason] || clean(reason)).join('; ') || 'не указаны'}.`, '');
    if (candidates.length) {
      lines.push('| Legacy ID | Кабинет | Артикул продавца | WB ID | Название | Категория | Бренд | Алиасы | Статус |', '|---|---|---|---|---|---|---|---|---|');
      for (const candidate of candidates) {
        const aliases = Array.isArray(candidate.aliases) ? candidate.aliases.join(', ') : '';
        lines.push(`| ${markdown(candidate.legacyProductId)} | ${markdown(candidate.cabinetExternalKey)} | ${markdown(candidate.sellerSku)} | ${markdown(candidate.wbSku)} | ${markdown(candidate.name)} | ${markdown(candidate.category)} | ${markdown(candidate.brandExternalKey)} | ${markdown(aliases)} | ${markdown(candidate.status)} |`);
      }
      lines.push('');
    }
    const history = Array.isArray(item.groupHistoryCandidates) ? item.groupHistoryCandidates : [];
    if (history.length) {
      lines.push('| История: Legacy ID | Дата | Код склейки | Источник |', '|---|---|---|---|');
      for (const row of history) lines.push(`| ${markdown(row.legacyProductId)} | ${markdown(row.date)} | ${markdown(row.legacyGroupId)} | ${markdown(row.source)} |`);
      lines.push('');
    }
    lines.push('- Действие (`merge` / `split` / `exclude`):', '- Комментарий:', '- Итоговый кабинет и identity либо состав разделения:', '');
  });

  return {
    report: `${lines.join('\n')}\n`,
    decisions: {
      schemaVersion: 1,
      sourceBackupSha256: manifest.source.sha256,
      reviewFingerprint,
      decisions,
    },
  };
}
