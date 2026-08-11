export interface AnalyticsHelpMetric {
  name: string;
  code?: string;
  meaning: string;
  source: string;
  formula: string;
  interpretation: string;
  warning?: string;
}

export interface AnalyticsHelpGroup {
  title: string;
  description: string;
  items: AnalyticsHelpMetric[];
}

export interface AnalyticsHelpCard {
  title: string;
  text: string;
  label?: string;
}

export interface AnalyticsHelpData {
  slug: string;
  title: string;
  description: string;
  scope: string;
  scopeNote: string;
  flow: AnalyticsHelpCard[];
  reading: AnalyticsHelpCard[];
  formulas: AnalyticsHelpCard[];
  groups: AnalyticsHelpGroup[];
  limitations: string[];
}

export default function AnalyticsHelp({ data, onClose }: { data: AnalyticsHelpData; onClose: () => void }) {
  const id = (section: string) => `${data.slug}-help-${section}`;

  return <div className="cx-methodology-page analytics-help-page">
    <section className="page-card cx-methodology-hero">
      <div><span>СПРАВКА ПО АНАЛИТИКЕ</span><h2>{data.title}</h2><p>{data.description}</p></div>
      <div className="cx-methodology-version analytics-help-version"><span>Область расчёта</span><strong>{data.scope}</strong><small>{data.scopeNote}</small><button type="button" onClick={onClose}>Вернуться к аналитике</button></div>
    </section>

    <nav className="page-card cx-methodology-nav" aria-label={`Разделы справки «${data.title}»`}>
      <a href={`#${id('flow')}`}>Путь данных</a><a href={`#${id('reading')}`}>Как читать</a><a href={`#${id('formulas')}`}>Ключевые формулы</a><a href={`#${id('metrics')}`}>Показатели</a><a href={`#${id('limits')}`}>Ограничения</a>
    </nav>

    <section id={id('flow')} className="page-card cx-methodology-section">
      <div className="cx-section-head"><div><span>КОНВЕЙЕР</span><h2>Путь данных</h2><p>От исходных локальных отчётов до показателей текущего среза.</p></div></div>
      <div className="cx-methodology-flow analytics-help-flow">{data.flow.map((item, index) => <article key={item.title}><b>{index + 1}</b><strong>{item.title}</strong><p>{item.text}</p></article>)}</div>
      <div className="cx-methodology-guardrail"><strong>Фильтры страницы</strong><span>Справка описывает действующие расчёты. Период и фильтры меняют состав исходных строк и итоговые значения, но не формулы.</span></div>
    </section>

    <section id={id('reading')} className="page-card cx-methodology-section">
      <div className="cx-section-head"><div><span>ЧТЕНИЕ РЕЗУЛЬТАТОВ</span><h2>Как читать основные блоки</h2><p>Сначала оцените объём и покрытие данных, затем доли, динамику и диагностические сигналы.</p></div></div>
      <div className="cx-entity-grid analytics-help-reading">{data.reading.map(item => <article key={item.title}><span>{item.label || 'БЛОК'}</span><strong>{item.title}</strong><p>{item.text}</p></article>)}</div>
    </section>

    <section id={id('formulas')} className="cx-methodology-formula-grid analytics-help-formulas">
      {data.formulas.map(item => <article className="page-card cx-methodology-section" key={item.title}><div className="cx-section-head"><div><span>{item.label || 'ФОРМУЛА'}</span><h2>{item.title}</h2></div></div><div className="cx-formula"><span>{item.text}</span></div></article>)}
    </section>

    <section id={id('metrics')} className="page-card cx-methodology-section cx-metric-reference">
      <div className="cx-section-head"><div><span>ПОЛНЫЙ СПРАВОЧНИК</span><h2>Сущности и показатели</h2><p>Определения, фактические источники, формулы и правила чтения текущей реализации.</p></div></div>
      <div className="cx-reference-key"><span><b>Значение</b>что измеряется</span><span><b>Источник</b>откуда берутся данные</span><span><b>Формула</b>как считается</span><span><b>Интерпретация</b>как читать результат</span></div>
      <div className="cx-reference-groups">{data.groups.map((group, groupIndex) => <section key={group.title} className="cx-reference-group"><header><div><span>{String(groupIndex + 1).padStart(2, '0')}</span><h3>{group.title}</h3></div><p>{group.description}</p><b>{group.items.length}</b></header><div className="cx-reference-list">{group.items.map(item => <MetricReference key={item.name} item={item} />)}</div></section>)}</div>
    </section>

    <section id={id('limits')} className="page-card cx-methodology-section">
      <div className="cx-section-head"><div><span>ГРАНИЦЫ МЕТОДА</span><h2>Ограничения интерпретации</h2><p>Учитывайте их до принятия решений по отдельным территориям, источникам или запросам.</p></div></div>
      <div className="cx-methodology-limit analytics-help-limit"><ul>{data.limitations.map(item => <li key={item}>{item}</li>)}</ul></div>
    </section>
  </div>;
}

function MetricReference({ item }: { item: AnalyticsHelpMetric }) {
  return <details className="cx-reference-item"><summary><span><strong>{item.name}</strong>{item.code && <code>{item.code}</code>}</span><p>{item.meaning}</p><i aria-hidden="true">+</i></summary><dl><div><dt>Значение</dt><dd>{item.meaning}</dd></div><div><dt>Источник</dt><dd>{item.source}</dd></div><div className="formula"><dt>Формула</dt><dd>{item.formula}</dd></div><div><dt>Интерпретация</dt><dd>{item.interpretation}</dd></div></dl>{item.warning && <div className="cx-reference-warning"><strong>Важно</strong><span>{item.warning}</span></div>}</details>;
}
