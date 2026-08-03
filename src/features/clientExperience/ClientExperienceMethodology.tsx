import { useEffect, useMemo, useState } from 'react';
import { getCxAnalysisSettings, type CxAnalysisSettings } from './analysisSettingsApi';

const EMPTY: CxAnalysisSettings = { groups: [], topics: [], versions: [], rules: [], methodologies: [], analysisRuns: [] };

const ruleDescriptions = [
  ['Точное слово', 'Буквальное совпадение отдельного очищенного слова.'],
  ['Точная фраза', 'Буквальное совпадение последовательности слов.'],
  ['Лемма', 'Совпадение слова по нормальной форме: формы и окончания объединяются.'],
  ['Фраза по леммам', 'Последовательность нормальных форм без ручного перечисления словоформ.'],
  ['Контекст', 'Обязательные и альтернативные леммы должны находиться в заданном расстоянии.'],
  ['Исключение', 'Отменяет тематическое совпадение при наличии ложного контекста.'],
];

function nested(config: Record<string, unknown>, path: string[], fallback: number) {
  let value: unknown = config;
  for (const key of path) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function percent(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value * 100)}%`;
}

export default function ClientExperienceMethodology() {
  const [settings, setSettings] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getCxAnalysisSettings().then(data => {
      if (!cancelled) setSettings(data);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const published = settings.versions.find(version => version.status === 'published');
  const methodology = useMemo(() => (
    settings.methodologies.find(item => item.dictionaryVersionId === published?.id)?.config || {}
  ), [published?.id, settings.methodologies]);
  const activeRules = settings.rules.filter(rule => rule.dictionaryVersionId === published?.id && rule.isActive);
  const thresholds = {
    confident: nested(methodology, ['confident_mentions_threshold'], 30),
    exposure: nested(methodology, ['problem_index', 'exposure_threshold'], 0.15),
    exposureWeight: nested(methodology, ['problem_index', 'exposure_weight'], 0.40),
    negativityWeight: nested(methodology, ['problem_index', 'negativity_weight'], 0.35),
    accelerationWeight: nested(methodology, ['problem_index', 'acceleration_weight'], 0.15),
    confidenceWeight: nested(methodology, ['problem_index', 'confidence_weight'], 0.10),
    mediumRisk: nested(methodology, ['risk_thresholds', 'medium'], 45),
    highRisk: nested(methodology, ['risk_thresholds', 'high'], 70),
  };

  if (loading) return <div className="cx-settings-loading">Загрузка методологии…</div>;
  if (error) return <div className="cx-error">{error}</div>;

  return (
    <div className="cx-methodology-page">
      <section className="page-card cx-methodology-hero">
        <div><span>РАБОЧАЯ МЕТОДОЛОГИЯ</span><h2>Как устроен анализ клиентского опыта</h2><p>От исходного отзыва до темы, сантимента, CXI и приоритета улучшения.</p></div>
        <div className="cx-methodology-version"><span>Опубликованный словарь</span><strong>v{published?.versionNumber || '—'}</strong><small>{settings.groups.length} групп · {settings.topics.length} тем · {activeRules.length} правил</small></div>
      </section>

      <nav className="page-card cx-methodology-nav" aria-label="Разделы методологии">
        <a href="#cx-flow">Путь данных</a><a href="#cx-entities">Сущности</a><a href="#cx-formulas">Формулы</a><a href="#cx-rules">Правила</a><a href="#cx-glossary">Словарь</a>
      </nav>

      <section id="cx-flow" className="page-card cx-methodology-section">
        <div className="cx-section-head"><div><span>КОНВЕЙЕР</span><h2>Путь данных и контроль качества</h2><p>Каждый следующий этап использует результат предыдущего.</p></div></div>
        <div className="cx-methodology-flow">
          <article><b>1</b><strong>Импорт</strong><p>Excel разбирается в браузере. На сервер передаются нормализованные строки, исходный файл после сверки удаляется.</p></article>
          <article><b>2</b><strong>Подготовка текста</strong><p>Хранятся исходный, очищенный и лемматизированный варианты. Пустые отзывы учитываются отдельно.</p></article>
          <article><b>3</b><strong>Классификация</strong><p>Опубликованные правила находят темы. Один отзыв может относиться к нескольким темам.</p></article>
          <article><b>4</b><strong>Сантимент</strong><p>Тональность определяется в контексте конкретной темы по лексикону и отрицаниям, а не только по звёздам.</p></article>
          <article><b>5</b><strong>Агрегация</strong><p>PostgreSQL рассчитывает показатели по фильтрам и возвращает frontend только агрегаты и ограниченные выборки.</p></article>
        </div>
        <div className="cx-methodology-guardrail"><strong>Правило публикации</strong><span>Черновик не влияет на рабочие данные. Новая версия становится активной только после полного пакетного пересчёта и сверки количества обработанных отзывов.</span></div>
      </section>

      <section id="cx-entities" className="page-card cx-methodology-section">
        <div className="cx-section-head"><div><span>МОДЕЛЬ ДАННЫХ</span><h2>Сущности и связи</h2><p>Основные объекты, из которых собирается аналитика.</p></div></div>
        <div className="cx-entity-grid">
          <Entity name="Отзыв" source="reviews" text="Дата, товар, кабинет, оценка, исходный и подготовленный текст." />
          <Entity name="Группа опыта" source="cx_topic_groups" text="Верхний уровень: продукт, сервис или результат опыта." />
          <Entity name="Тема" source="cx_topics" text="Аналитическая сущность внутри группы: яркость, качество, доставка и другие." />
          <Entity name="Версия словаря" source="cx_dictionary_versions" text="Изолирует черновик, опубликованную и архивные конфигурации." />
          <Entity name="Правило" source="cx_topic_rules" text="Условие обнаружения темы; принадлежит теме и версии словаря." />
          <Entity name="Совпадение" source="cx_review_topic_matches" text="Связь отзыв ↔ тема с числом срабатываний и тематическим сантиментом." />
        </div>
        <div className="cx-relation-line"><span>Отзыв</span><i>многие ко многим</i><span>Совпадение</span><i>принадлежит</i><span>Тема</span><i>входит в</i><span>Группа опыта</span></div>
      </section>

      <section id="cx-formulas" className="cx-methodology-formula-grid">
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ТОНАЛЬНОСТЬ</span><h2>Сантимент темы</h2></div></div>
          <Formula value="Позитив + 0,5 × Нейтрально" />
          <p>Шкала 0–100. Значение 100 означает полностью позитивные совпадения, 0 — полностью негативные. Нейтральные совпадения дают половину веса.</p>
        </article>
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ОБЩИЙ ИНДЕКС</span><h2>CXI группы</h2></div></div>
          <Formula value="Σ(Упоминания темы × Сантимент) ÷ Σ Упоминаний" />
          <p>Темы с большим количеством упоминаний сильнее влияют на индекс своей группы опыта.</p>
        </article>
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ВКЛАД</span><h2>Вклад темы в CXI</h2></div></div>
          <Formula value="Вес темы × Сантимент темы" />
          <p>Вес — доля упоминаний темы среди всех тематических упоминаний в текущем срезе.</p>
        </article>
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ПРИОРИТЕТ</span><h2>Problem Index</h2></div></div>
          <Formula value="100 × взвешенная сумма факторов" />
          <dl className="cx-formula-weights">
            <div><dt>Распространённость</dt><dd>{percent(thresholds.exposureWeight)}</dd></div><div><dt>Негатив</dt><dd>{percent(thresholds.negativityWeight)}</dd></div>
            <div><dt>Рост негатива</dt><dd>{percent(thresholds.accelerationWeight)}</dd></div><div><dt>Уверенность выборки</dt><dd>{percent(thresholds.confidenceWeight)}</dd></div>
          </dl>
          <p>Факторы нормируются в диапазон 0–1. Порог распространённости — {percent(thresholds.exposure)} отзывов с темой.</p>
        </article>
      </section>

      <section id="cx-rules" className="page-card cx-methodology-section">
        <div className="cx-section-head"><div><span>СЛОВАРЬ</span><h2>Как находятся темы</h2><p>Режимы правил дополняют друг друга и уменьшают ручное перечисление словоформ.</p></div></div>
        <div className="cx-rule-method-grid">{ruleDescriptions.map(([name, text]) => <article key={name}><strong>{name}</strong><p>{text}</p></article>)}</div>
        <div className="cx-methodology-params">
          <div><span>Уверенная выборка</span><strong>{thresholds.confident} упоминаний</strong></div>
          <div><span>Средний риск</span><strong>от {thresholds.mediumRisk}</strong></div>
          <div><span>Высокий риск</span><strong>от {thresholds.highRisk}</strong></div>
          <div><span>Сравнение</span><strong>предыдущий равный период</strong></div>
        </div>
      </section>

      <section id="cx-glossary" className="page-card cx-methodology-section">
        <div className="cx-section-head"><div><span>СПРАВОЧНИК</span><h2>Что означают показатели</h2></div></div>
        <div className="cx-glossary-grid">
          <Glossary term="Классифицировано" text="Уникальные отзывы, в которых найдена хотя бы одна тема." />
          <Glossary term="Упоминания темы" text="Количество связей отзыв ↔ выбранная тема; не число найденных слов." />
          <Glossary term="Доля отзывов с темой" text="Упоминания темы ÷ все отзывы с текстом в выбранном срезе." />
          <Glossary term="Доля негатива" text="Негативные совпадения темы ÷ все совпадения этой темы." />
          <Glossary term="Δ негатива" text="Текущая доля негатива минус доля за непосредственно предыдущий равный период." />
          <Glossary term="Риск" text="Категория Problem Index: низкий, средний или высокий по порогам методологии." />
        </div>
        <div className="cx-methodology-limit"><strong>Ограничения интерпретации</strong><p>Тематический анализ отражает содержание опубликованного словаря. Отсутствие темы означает отсутствие совпадения по правилам, а не доказанное отсутствие проблемы. Малые выборки следует читать осторожно; звёздная оценка остаётся отдельной метрикой и не заменяет тематический сантимент.</p></div>
      </section>
    </div>
  );
}

function Entity({ name, source, text }: { name: string; source: string; text: string }) {
  return <article><span>{source}</span><strong>{name}</strong><p>{text}</p></article>;
}

function Formula({ value }: { value: string }) {
  return <div className="cx-formula"><span>{value}</span></div>;
}

function Glossary({ term, text }: { term: string; text: string }) {
  return <article><strong>{term}</strong><p>{text}</p></article>;
}
