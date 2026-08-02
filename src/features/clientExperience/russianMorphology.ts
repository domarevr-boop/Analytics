interface AzMorphWord {
  normalize(): { word: string };
}

interface BrowserAz {
  Morph: {
    init(path: string, callback: (error?: Error | null) => void): void;
    (word: string): AzMorphWord[];
  };
}

declare global {
  interface Window { Az?: BrowserAz }
}

let initialization: Promise<BrowserAz> | null = null;
const lemmaCache = new Map<string, string>();

function dictionaryPath() {
  return `${import.meta.env.BASE_URL}az-dicts`;
}

function browserRuntimePath() {
  return `${import.meta.env.BASE_URL}az/az.min.js`;
}

function loadBrowserRuntime() {
  if (window.Az) return Promise.resolve(window.Az);
  return new Promise<BrowserAz>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-az-runtime]');
    const script = existing || document.createElement('script');
    const finish = () => window.Az ? resolve(window.Az) : reject(new Error('Az runtime did not initialize'));
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Не удалось загрузить русскую морфологию')), { once: true });
    if (!existing) {
      script.src = browserRuntimePath();
      script.async = true;
      script.dataset.azRuntime = 'true';
      document.head.appendChild(script);
    }
  });
}

function ensureMorphology() {
  if (!initialization) {
    initialization = loadBrowserRuntime().then(az => new Promise<BrowserAz>((resolve, reject) => {
      az.Morph.init(dictionaryPath(), error => error ? reject(error) : resolve(az));
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
  const az = await ensureMorphology();
  return cleaned.split(' ').map(token => {
    const cached = lemmaCache.get(token);
    if (cached) return cached;
    if (!/[а-я]/i.test(token)) return token;
    const normalized = az.Morph(token)[0]?.normalize();
    const lemma = normalized?.word ? normalized.word.replace(/ё/g, 'е') : token;
    lemmaCache.set(token, lemma);
    return lemma;
  }).join(' ');
}
