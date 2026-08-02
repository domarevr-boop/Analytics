let initialization: Promise<void> | null = null;
let azModule: typeof import('az') | null = null;
const lemmaCache = new Map<string, string>();

function dictionaryPath() {
  return `${import.meta.env.BASE_URL}az-dicts`;
}

async function ensureMorphology() {
  if (!initialization) {
    initialization = import('az').then(module => new Promise<void>((resolve, reject) => {
      azModule = module;
      module.default.Morph.init(dictionaryPath(), error => error ? reject(error) : resolve());
    }));
  }
  return initialization;
}

export function cleanReviewText(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function lemmatizeRussianText(value: string) {
  const cleaned = cleanReviewText(value);
  if (!cleaned) return '';
  await ensureMorphology();
  const Az = azModule!.default;
  return cleaned.split(' ').map(token => {
    const cached = lemmaCache.get(token);
    if (cached) return cached;
    if (!/[а-я]/i.test(token)) return token;
    const parse = Az.Morph(token)[0];
    const normalized = parse?.normalize();
    const lemma = normalized && normalized.word ? normalized.word.replace(/ё/g, 'е') : token;
    lemmaCache.set(token, lemma);
    return lemma;
  }).join(' ');
}
