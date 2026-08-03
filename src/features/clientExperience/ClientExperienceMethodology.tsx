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
        <div><span>РАБОЧАЯ МЕТОДОЛОГИЯ</span><h2>Как устроен анализ клиентского опыта</h2><p>От исходного отзыва до темы, тональности, CXI и приоритета улучшения.</p></div>
        <div className="cx-methodology-version"><span>Опубликованный словарь</span><strong>v{published?.versionNumber || '—'}</strong><small>{settings.groups.length} групп · {settings.topics.length} тем · {activeRules.length} правил</small></div>
      </section>

      <nav className="page-card cx-methodology-nav" aria-label="Разделы методологии">
        <a href="#cx-flow">Путь данных</a><a href="#cx-entities">Сущности</a><a href="#cx-formulas">Формулы</a><a href="#cx-interpretation">Интерпретация</a><a href="#cx-rules">Правила</a><a href="#cx-glossary">Словарь</a>
      </nav>

      <section id="cx-flow" className="page-card cx-methodology-section">
        <div className="cx-section-head"><div><span>КОНВЕЙЕР</span><h2>Путь данных и контроль качества</h2><p>Каждый следующий этап использует результат предыдущего.</p></div></div>
        <div className="cx-methodology-flow">
          <article><b>1</b><strong>Импорт</strong><p>Excel разбирается в браузере. На сервер передаются нормализованные строки, исходный файл после сверки удаляется.</p></article>
          <article><b>2</b><strong>Нормализация</strong><p>Хранятся исходный, очищенный и лемматизированный варианты. Этот слой не зависит от словаря тем.</p></article>
          <article><b>3</b><strong>Поиск тем</strong><p>Опубликованные правила создают связи отзыв ↔ тема. Один отзыв может относиться к нескольким темам.</p></article>
          <article><b>4</b><strong>Тональность совпадений</strong><p>Каждая связь получает позитивную, нейтральную или негативную тональность по версии модели и контексту темы.</p></article>
          <article><b>5</b><strong>Агрегация</strong><p>PostgreSQL рассчитывает показатели по фильтрам. Смена формулы обновляет только агрегаты и не классифицирует тексты повторно.</p></article>
        </div>
        <div className="cx-methodology-guardrail"><strong>Правило публикации</strong><span>Черновик не влияет на рабочие данные. При публикации неизменившиеся связи и их тональность переиспользуются; анализируются только новые отзывы и новые или изменённые совпадения.</span></div>
      </section>

      <section id="cx-entities" className="page-card cx-methodology-section">
        <div className="cx-section-head"><div><span>МОДЕЛЬ ДАННЫХ</span><h2>Сущности и связи</h2><p>Основные объекты, из которых собирается аналитика.</p></div></div>
        <div className="cx-entity-grid">
          <Entity name="Отзыв" source="reviews" text="Дата, товар, кабинет, оценка, исходный и подготовленный текст." />
          <Entity name="Группа опыта" source="cx_topic_groups" text="Верхний уровень: продукт, сервис или результат опыта." />
          <Entity name="Тема" source="cx_topics" text="Аналитическая сущность внутри группы: яркость, качество, доставка и другие." />
          <Entity name="Версия словаря" source="cx_dictionary_versions" text="Изолирует черновик, опубликованную и архивные конфигурации и фиксирует версии моделей." />
          <Entity name="Правило" source="cx_topic_rules" text="Условие обнаружения темы; принадлежит теме и версии словаря." />
          <Entity name="Совпадение" source="cx_review_topic_matches" text="Связь отзыв ↔ тема с числом срабатываний, тональностью и версией модели тональности." />
          <Entity name="Модель тональности" source="cx_sentiment_model_versions" text="Версия лексикона, окна контекста и правил обработки отрицаний для воспроизводимости." />
          <Entity name="Модель агрегации" source="cx_aggregation_model_versions" text="Версия формул тональности, оценочной доли и CXI; меняется без повторной классификации." />
        </div>
        <div className="cx-relation-line"><span>Отзыв</span><i>многие ко многим</i><span>Совпадение</span><i>принадлежит</i><span>Тема</span><i>входит в</i><span>Группа опыта</span></div>
      </section>

      <section id="cx-formulas" className="cx-methodology-formula-grid">
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ТОНАЛЬНОСТЬ</span><h2>Тональность темы</h2></div></div>
          <Formula value="Позитив ÷ (Позитив + Негатив) × 100" />
          <p>Нейтральные совпадения не влияют на оценку. Если позитивных и негативных совпадений нет, результат отсутствует и показывается как «—».</p>
        </article>
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ПОКРЫТИЕ ОЦЕНКОЙ</span><h2>Доля оценочных упоминаний</h2></div></div>
          <Formula value="(Позитив + Негатив) ÷ (Позитив + Нейтрально + Негатив) × 100" />
          <p>Показывает, какая часть упоминаний реально влияет на тональность. Нейтральные совпадения остаются в общем объёме темы.</p>
        </article>
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ОБЩИЙ ИНДЕКС</span><h2>CXI группы</h2></div></div>
          <Formula value="Σ(Оценочные упоминания × Тональность) ÷ Σ Оценочных упоминаний" />
          <p>В CXI входят только позитивные и негативные совпадения. Нейтральные сохраняются в объёме, но не смещают индекс к 50.</p>
        </article>
        <article className="page-card cx-methodology-section">
          <div className="cx-section-head"><div><span>ВКЛАД</span><h2>Вклад темы в CXI</h2></div></div>
          <Formula value="Вес оценочных упоминаний × Тональность темы" />
          <p>Вес — доля позитивных и негативных совпадений темы среди всех оценочных совпадений текущего среза.</p>
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

      <section id="cx-interpretation" className="page-card cx-methodology-section cx-methodology-interpretation">
        <div className="cx-section-head"><div><span>ЧТЕНИЕ РЕЗУЛЬТАТОВ</span><h2>Как интерпретировать показатели</h2><p>Средняя оценка описывает отзыв целиком, а тональность — только конкретную тему внутри него.</p></div></div>
        <div className="cx-interpretation-definitions">
          <article><span>ОБЩИЙ УРОВЕНЬ</span><strong>Средняя оценка</strong><b>1–5 ★</b><p>Среднее значение звёзд всех отзывов в выбранном срезе. Показывает итоговое впечатление покупателя от покупки.</p></article>
          <article><span>УРОВЕНЬ ТЕМЫ</span><strong>Тональность темы</strong><b>P ÷ (P + N)</b><p>Доля позитивных среди позитивных и негативных упоминаний конкретной темы.</p></article>
          <article><span>СТРУКТУРА ТЕМЫ</span><strong>Доля негатива</strong><b>N ÷ (P + U + N)</b><p>Негативные совпадения среди всех упоминаний темы, включая нейтральные.</p></article>
          <article><span>ОБЪЁМ</span><strong>Нейтральные упоминания</strong><b>U входит в объём</b><p>Не участвуют в тональности, но входят в число упоминаний и показывают распространённость темы.</p></article>
        </div>
        <div className="cx-interpretation-note"><strong>Почему линии расходятся</strong><p>Средняя оценка и тональность могут двигаться по-разному: первая относится ко всему отзыву, вторая — к отдельному аспекту опыта. Например, покупатель может поставить пять звёзд товару, но негативно описать доставку.</p></div>
        <div className="cx-section-head cx-interpretation-subhead"><div><span>МАТРИЦА СИГНАЛОВ</span><h2>Сочетания оценки и тональности</h2></div></div>
        <div className="cx-interpretation-matrix">
          <Interpretation state="Оба показателя растут" meaning="Общее впечатление и выбранная тема улучшаются одновременно." action="Проверить устойчивость роста и закрепить сильную практику." tone="good" />
          <Interpretation state="Оба показателя падают" meaning="Ухудшение темы совпадает с ухудшением общего опыта." action="Высокий приоритет: изучить негативные причины и товары-лидеры проблемы." tone="bad" />
          <Interpretation state="Оценка стабильна, тональность растёт" meaning="Тема улучшается, но пока недостаточно влияет на итоговую оценку." action="Проверить долю темы и продолжительность положительной динамики." tone="good" />
          <Interpretation state="Оценка растёт, тональность падает" meaning="Общий опыт улучшается за счёт других факторов, а выбранная тема ухудшается." action="Не маскировать локальную проблему общим ростом оценки." tone="warn" />
          <Interpretation state="Высокая оценка, низкая тональность" meaning="Покупатели довольны покупкой в целом, но системно критикуют конкретный аспект." action="Это точечная возможность улучшения без кризиса продукта целиком." tone="warn" />
          <Interpretation state="Низкая оценка, высокая тональность" meaning="Выбранная тема воспринимается хорошо, но итоговый опыт портят другие причины." action="Искать проблему в соседних темах и неклассифицированном тексте." tone="neutral" />
        </div>
        <div className="cx-interpretation-limits"><strong>Ограничения анализа</strong><ul><li>Нельзя напрямую сравнивать крутизну линий на разных шкалах.</li><li>Тональность нестабильна при малом числе оценочных упоминаний.</li><li>Корреляция не доказывает влияние темы на итоговую оценку.</li><li>Выводы проверяются по числу упоминаний, доле оценочных упоминаний и примерам отзывов.</li></ul></div>
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
          <Glossary term="Тональность" text="Позитивные совпадения ÷ сумму позитивных и негативных совпадений. Нейтральные не участвуют; при отсутствии оценочных совпадений значение отсутствует." />
          <Glossary term="Доля оценочных упоминаний" text="Доля позитивных и негативных совпадений среди всех совпадений темы." />
          <Glossary term="Доля негатива" text="Негативные совпадения темы ÷ все совпадения этой темы." />
          <Glossary term="Δ негатива" text="Текущая доля негатива минус доля за непосредственно предыдущий равный период." />
          <Glossary term="Риск" text="Категория Problem Index: низкий, средний или высокий по порогам методологии." />
        </div>
        <div className="cx-methodology-limit"><strong>Ограничения интерпретации</strong><p>Тематический анализ отражает содержание опубликованного словаря. Отсутствие темы означает отсутствие совпадения по правилам, а не доказанное отсутствие проблемы. Малые выборки и низкую долю оценочных упоминаний следует читать осторожно; звёздная оценка остаётся отдельной метрикой и не заменяет тематическую тональность.</p></div>
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

function Interpretation({ state, meaning, action, tone }: { state: string; meaning: string; action: string; tone: 'good' | 'bad' | 'warn' | 'neutral' }) {
  return <article className={tone}><strong>{state}</strong><p>{meaning}</p><small>{action}</small></article>;
}
