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

interface MetricReferenceItem {
  name: string;
  code?: string;
  meaning: string;
  source: string;
  formula: string;
  interpretation: string;
  warning?: string;
}

interface MetricReferenceGroup {
  title: string;
  description: string;
  items: MetricReferenceItem[];
}

const metricReferenceGroups: MetricReferenceGroup[] = [
  {
    title: 'Исходные данные и объёмы',
    description: 'Поля отзыва и показатели обзорной вкладки. Здесь учитываются как текстовые, так и агрегированные пустые отзывы.',
    items: [
      {
        name: 'Отзыв', code: 'reviews',
        meaning: 'Исходная запись покупателя: дата, товар, кабинет, оценка, текст, достоинства, недостатки и ответ продавца.',
        source: 'Импорт WB → таблица reviews. Поля товара сохраняются снимком на момент импорта.',
        formula: 'Не рассчитывается — исходная запись.',
        interpretation: 'Один отзыв может содержать несколько тематических совпадений. Имя автора в аналитический интерфейс не передаётся.',
      },
      {
        name: 'Всего отзывов', code: 'total_reviews',
        meaning: 'Полный объём оценок в выбранном срезе, включая строки без текста.',
        source: 'get_cx_review_summary: reviews + empty_review_stats.',
        formula: 'Отзывы с текстом + отзывы без текста.',
        interpretation: 'Базовый denominator для доли негатива по звёздам, покрытия текстом и связи с товаром.',
      },
      {
        name: 'Отзывы с текстом', code: 'text_reviews',
        meaning: 'Отзывы, у которых сохранён покупательский текст, достоинства или недостатки.',
        source: 'Таблица reviews; обзор — get_cx_review_summary, темы — get_cx_topics_workspace_v2.',
        formula: 'Количество строк reviews после применения фильтров.',
        interpretation: 'Это база тематической классификации. Пустые отзывы не участвуют в поиске тем.',
      },
      {
        name: 'Отзывы без текста', code: 'empty_reviews',
        meaning: 'Оценки без букв и цифр одновременно в тексте, достоинствах и недостатках.',
        source: 'Агрегированная таблица empty_review_stats.',
        formula: 'Сумма review_count после применения фильтров.',
        interpretation: 'Участвуют в общей средней оценке и звёздном негативе, но не в темах и CXI.',
      },
      {
        name: 'Оценка', code: 'rating',
        meaning: 'Поставленная покупателем оценка от 1 до 5 звёзд.',
        source: 'Поле rating в reviews и empty_review_stats.',
        formula: 'Не рассчитывается — исходное поле.',
        interpretation: 'Описывает отзыв целиком и не подменяет аспектную тональность отдельной темы.',
      },
      {
        name: 'Средняя оценка', code: 'average_rating',
        meaning: 'Средняя звёздная оценка выбранного набора отзывов, диапазон 1–5.',
        source: 'get_cx_review_summary; для темы и товара — get_cx_topics_workspace_v2.',
        formula: 'Σ(оценка × количество строк) ÷ Σ количество строк. В обзоре учитываются текстовые и пустые отзывы; для темы — только отзывы с совпадением темы.',
        interpretation: 'Рост означает улучшение общего впечатления. Сравнивать направление со сменой тональности можно, но значения находятся на разных шкалах.',
      },
      {
        name: 'Негатив 1–3★', code: 'negative_reviews',
        meaning: 'Количество и доля отзывов с оценкой 1, 2 или 3 звезды.',
        source: 'get_cx_review_summary и get_cx_problem_products.',
        formula: 'Количество отзывов с rating ≤ 3; доля = это количество ÷ все отзывы × 100.',
        interpretation: 'Это звёздный негатив всего отзыва, а не негативная тональность темы.',
      },
      {
        name: 'Покрытие текстом', code: 'text_coverage',
        meaning: 'Доля отзывов, доступных для чтения и тематического анализа.',
        source: 'Frontend по значениям get_cx_review_summary.',
        formula: 'Отзывы с текстом ÷ все отзывы × 100.',
        interpretation: 'Низкое значение означает, что значительная часть оценок не объяснена текстом и не может попасть в темы.',
      },
      {
        name: 'Ответы продавца', code: 'answered_share',
        meaning: 'Доля текстовых отзывов, на которые сохранён непустой ответ продавца.',
        source: 'seller_response в reviews → get_cx_review_summary.',
        formula: 'Текстовые отзывы с ответом ÷ все отзывы с текстом × 100.',
        interpretation: 'Denominator — только отзывы с текстом. Показатель не оценивает качество или скорость ответа.',
      },
      {
        name: 'Связано с товаром', code: 'matched_share',
        meaning: 'Доля отзывов, сопоставленных с локальной карточкой товара.',
        source: 'local_product_id в reviews и empty_review_stats → get_cx_review_summary.',
        formula: 'Отзывы с local_product_id ÷ все отзывы × 100.',
        interpretation: 'Показывает готовность данных к товарным срезам. Несопоставленные отзывы остаются в общих показателях.',
      },
      {
        name: 'Распределение оценок', code: 'rating_distribution',
        meaning: 'Количество отзывов отдельно для каждой оценки от 1 до 5.',
        source: 'get_cx_rating_distribution: reviews + empty_review_stats.',
        formula: 'Σ количества строк внутри каждого значения rating.',
        interpretation: 'Позволяет видеть структуру средней оценки и долю крайних оценок без дополнительной модели.',
      },
      {
        name: 'Полезно / не полезно', code: 'helpful_up / helpful_down',
        meaning: 'Счётчики пользовательских отметок полезности конкретного отзыва.',
        source: 'Поля helpful_up и helpful_down в reviews.',
        formula: 'Не рассчитывается — исходные поля.',
        interpretation: 'Показываются в раскрытой строке отзыва и не участвуют в тональности, CXI или Problem Index.',
      },
    ],
  },
  {
    title: 'Классификация и тональность',
    description: 'Показатели строятся по связям отзыв ↔ тема опубликованной и полностью рассчитанной версии словаря.',
    items: [
      {
        name: 'Классифицированные отзывы', code: 'classified_reviews',
        meaning: 'Уникальные текстовые отзывы, в которых найдена хотя бы одна тема.',
        source: 'cx_review_topic_matches → get_cx_topics_workspace_v2.',
        formula: 'Количество уникальных review_id среди тематических совпадений.',
        interpretation: 'Один отзыв считается один раз независимо от количества найденных тем.',
      },
      {
        name: 'Покрытие классификацией', code: 'coverage',
        meaning: 'Доля текстовых отзывов, для которых словарь нашёл хотя бы одну тему.',
        source: 'get_cx_topics_workspace_v2.',
        formula: 'Классифицированные отзывы ÷ все отзывы с текстом × 100.',
        interpretation: 'Рост означает большее покрытие словарём, но не гарантирует правильность каждого совпадения.',
      },
      {
        name: 'Упоминания темы', code: 'review_count / mentions',
        meaning: 'Количество связей отзыв ↔ выбранная тема; это не количество найденных слов.',
        source: 'Строки cx_review_topic_matches опубликованной версии.',
        formula: 'Количество совпадений review_id + topic_id после фильтров.',
        interpretation: 'Один отзыв может дать по одному упоминанию нескольким темам. Число срабатываний правил хранится отдельно.',
      },
      {
        name: 'Позитивные упоминания и доля', code: 'positive_share',
        meaning: 'Совпадения темы, классифицированные как positive.',
        source: 'sentiment в cx_review_topic_matches → workspace/timeseries RPC.',
        formula: 'Positive share = Positive ÷ (Positive + Neutral + Negative) × 100.',
        interpretation: 'Denominator — все упоминания выбранной темы, включая neutral.',
      },
      {
        name: 'Нейтральные упоминания и доля', code: 'neutral_share',
        meaning: 'Совпадения темы без подтверждённой позитивной или негативной окраски.',
        source: 'sentiment = neutral в cx_review_topic_matches; агрегируется сервером.',
        formula: 'Neutral share = Neutral ÷ (Positive + Neutral + Negative) × 100.',
        interpretation: 'Neutral — самостоятельная часть классификации. Она входит в объём темы, но не входит в числитель или denominator тональности.',
      },
      {
        name: 'Негативные упоминания и доля', code: 'negative_share',
        meaning: 'Совпадения темы, классифицированные как negative.',
        source: 'sentiment в cx_review_topic_matches → workspace/timeseries RPC.',
        formula: 'Negative share = Negative ÷ (Positive + Neutral + Negative) × 100.',
        interpretation: 'Это тематический негатив среди всех упоминаний темы; он отличается от доли отзывов с оценкой 1–3★.',
      },
      {
        name: 'Оценочные упоминания', code: 'evaluative_mentions',
        meaning: 'Упоминания, которые участвуют в тональности и CXI.',
        source: 'get_cx_cxi_summary.',
        formula: 'Positive + Negative.',
        interpretation: 'Neutral сохраняется в общем объёме, но не получает искусственный вес в CXI.',
      },
      {
        name: 'Доля оценочных упоминаний', code: 'evaluative_share',
        meaning: 'Какая часть упоминаний темы имеет позитивную или негативную оценку.',
        source: 'cx_evaluative_share → workspace/timeseries/CXI RPC.',
        formula: '(Positive + Negative) ÷ (Positive + Neutral + Negative) × 100.',
        interpretation: 'Низкая доля требует осторожно читать тональность даже при большом общем числе упоминаний.',
      },
      {
        name: 'Тональность темы', code: 'topic_score / tonality',
        meaning: 'Баланс позитивных и негативных оценочных упоминаний, шкала 0–100.',
        source: 'cx_tonality → get_cx_topics_workspace_v2, get_cx_topic_timeseries_v2 и get_cx_cxi_summary.',
        formula: 'Positive ÷ (Positive + Negative) × 100.',
        interpretation: 'Neutral полностью исключён. Если Positive + Negative = 0, значение отсутствует и показывается как «—».',
      },
    ],
  },
  {
    title: 'Темы, веса и CXI',
    description: 'Метрики распространённости и вклада темы в общий индекс клиентского опыта.',
    items: [
      {
        name: 'Доля отзывов с темой', code: 'share / topic_share',
        meaning: 'Распространённость выбранной темы среди текстовых отзывов.',
        source: 'get_cx_topics_workspace_v2 и get_cx_topic_timeseries_v2.',
        formula: 'Упоминания темы ÷ все отзывы с текстом × 100.',
        interpretation: 'Denominator — текстовые отзывы, а не сумма упоминаний всех тем. Один отзыв может входить в несколько тем.',
      },
      {
        name: 'Вес темы в группе', code: 'group_weight',
        meaning: 'Доля оценочных упоминаний темы внутри её группы опыта.',
        source: 'get_cx_cxi_summary.',
        formula: 'Оценочные упоминания темы ÷ оценочные упоминания всех тем группы × 100.',
        interpretation: 'Показывает, насколько тема определяет Product, Service или Outcome CXI.',
      },
      {
        name: 'Общий вес темы', code: 'overall_weight',
        meaning: 'Доля оценочных упоминаний темы среди всех групп опыта.',
        source: 'get_cx_cxi_summary.',
        formula: 'Оценочные упоминания темы ÷ оценочные упоминания всех тем × 100.',
        interpretation: 'Используется для вклада в Overall CXI; neutral не увеличивает вес.',
      },
      {
        name: 'Вклад темы в CXI', code: 'contribution',
        meaning: 'Часть Overall CXI, сформированная конкретной темой.',
        source: 'get_cx_cxi_summary.',
        formula: '(Общий вес темы ÷ 100) × тональность темы.',
        interpretation: 'Сумма вкладов тем образует Overall CXI. Высокая тональность при малом весе даёт небольшой вклад.',
      },
      {
        name: 'Product / Service / Outcome CXI', code: 'group cxi',
        meaning: 'Индекс клиентского опыта внутри одной группы тем, шкала 0–100.',
        source: 'get_cx_cxi_summary по group_code.',
        formula: 'Σ Positive группы ÷ Σ(Positive + Negative) группы × 100.',
        interpretation: 'Neutral не участвует. Если в группе нет оценочных упоминаний, индекс отсутствует.',
      },
      {
        name: 'Overall CXI', code: 'overall.cxi',
        meaning: 'Общая тональность всех оценочных упоминаний всех активных тем, шкала 0–100.',
        source: 'get_cx_cxi_summary.',
        formula: 'Σ Positive всех тем ÷ Σ(Positive + Negative) всех тем × 100; эквивалентно сумме вкладов тем.',
        interpretation: 'Рост означает улучшение баланса оценочных тематических упоминаний. Индекс не является средней звёздной оценкой.',
      },
      {
        name: 'Изменение вклада темы', code: 'contribution_delta',
        meaning: 'Насколько тема изменила свой вклад в Overall CXI относительно прошлого периода.',
        source: 'get_cx_cxi_summary для текущего и предыдущего равного периода.',
        formula: 'Текущий вклад − предыдущий вклад, в пунктах CXI.',
        interpretation: 'Положительные и отрицательные значения формируют блок драйверов роста и снижения CXI.',
      },
    ],
  },
  {
    title: 'Проблемность и сравнение периодов',
    description: 'Приоритеты улучшения и правила чтения изменений к непосредственно предыдущему равному периоду.',
    items: [
      {
        name: 'Problem Index', code: 'problem_index',
        meaning: 'Композитный приоритет проблемы по распространённости, негативу, ускорению и уверенности выборки, шкала 0–100.',
        source: 'get_cx_topics_workspace; параметры — опубликованная cx_methodology_versions.',
        formula: '100 × нормированная взвешенная сумма: 40% распространённость + 35% негатив + 15% рост негатива + 10% уверенность. Каждый фактор ограничен диапазоном 0–1.',
        interpretation: 'Большее значение означает более высокий приоритет проверки, а не доказанный финансовый ущерб.',
      },
      {
        name: 'Фактор распространённости', code: 'exposure',
        meaning: 'Насколько доля отзывов с темой приблизилась к порогу распространённой проблемы.',
        source: 'Problem Index; текущий порог методологии — 15%.',
        formula: 'min(1, доля отзывов с темой ÷ 15%).',
        interpretation: 'После достижения порога фактор перестаёт расти; дальнейший приоритет задают другие факторы.',
      },
      {
        name: 'Фактор негатива', code: 'negativity',
        meaning: 'Текущая доля негативных совпадений выбранной темы.',
        source: 'Problem Index по sentiment тематических совпадений.',
        formula: 'min(1, Negative ÷ (Positive + Neutral + Negative)).',
        interpretation: 'Neutral входит в denominator и снижает фактор по сравнению с базой только из оценочных упоминаний.',
      },
      {
        name: 'Фактор роста негатива', code: 'acceleration',
        meaning: 'Учитывает только увеличение доли негатива к предыдущему равному периоду.',
        source: 'Problem Index и negative_delta.',
        formula: 'min(1, max(0, текущая доля негатива − предыдущая доля негатива)), доли предварительно переведены в 0–1.',
        interpretation: 'Снижение негатива даёт фактор 0 и не уменьшает остальные составляющие индекса ниже нуля.',
      },
      {
        name: 'Уверенность выборки', code: 'confidence',
        meaning: 'Достаточность общего количества упоминаний темы для приоритизации.',
        source: 'Problem Index; confident_mentions_threshold опубликованной методологии.',
        formula: 'min(1, упоминания темы ÷ порог уверенной выборки). Текущий fallback-порог — 30.',
        interpretation: 'Малая выборка ограничивает вклад фактора, но не скрывает тему полностью.',
      },
      {
        name: 'Уровень риска', code: 'risk',
        meaning: 'Категория Problem Index: низкий, средний или высокий.',
        source: 'Пороги risk_thresholds опубликованной методологии.',
        formula: 'Низкий: < 45; средний: 45–69,999…; высокий: ≥ 70.',
        interpretation: 'Цвет — сокращённое представление Problem Index, а не отдельная модель.',
      },
      {
        name: 'Предыдущий равный период', code: 'previous period',
        meaning: 'Диапазон той же продолжительности непосредственно перед текущим.',
        source: 'Серверные workspace, timeseries и CXI RPC.',
        formula: 'Предыдущий конец = текущая дата начала − 1 день; начало сдвигается назад на длину текущего диапазона.',
        interpretation: 'Все CXI-delta и сравнения темы используют одну и ту же календарную базу.',
      },
      {
        name: 'Изменение показателя', code: 'delta / delta_percent',
        meaning: 'Разница текущего и предыдущего периода.',
        source: 'get_cx_topic_timeseries_v2 и get_cx_cxi_summary.',
        formula: 'Для долей и индексов: current − previous в пунктах. Для объёмов: (current − previous) ÷ previous × 100%.',
        interpretation: 'Процентное изменение объёма и изменение доли в процентных пунктах нельзя читать как одну единицу.',
      },
      {
        name: 'Причины негатива', code: 'negative_reasons',
        meaning: 'Частота выражений правил, сработавших в негативных совпадениях выбранной темы.',
        source: 'matched_rules внутри cx_review_topic_matches → get_cx_topics_workspace_v2.',
        formula: 'Количество негативных совпадений, содержащих каждый pattern правила.',
        interpretation: 'Это диагностика словаря, а не автоматически доказанная первопричина недовольства.',
      },
    ],
  },
  {
    title: 'Товары, качество данных и операции',
    description: 'Товарная детализация темы, серверная выборка отзывов и состояние рабочего словаря.',
    items: [
      {
        name: 'Упоминания темы по товару', code: 'products.mentions',
        meaning: 'Количество совпадений выбранной темы, связанных с товаром.',
        source: 'selected_matches → get_cx_topics_workspace_v2; Top-15 по количеству.',
        formula: 'Количество совпадений темы внутри entity_key товара.',
        interpretation: 'Показывает объём темы по товару; товары без локального ID группируются по кабинету, SKU и WB ID.',
      },
      {
        name: 'Доля упоминаний темы у товара', code: 'mention_share',
        meaning: 'Доля всех упоминаний выбранной темы, которая приходится на товар.',
        source: 'product_rows в get_cx_topics_workspace.',
        formula: 'Упоминания темы у товара ÷ все упоминания выбранной темы × 100.',
        interpretation: 'Показывает вклад товара в общий объём темы, а не долю отзывов этого товара с темой.',
        warning: 'В таблице UI колонка сейчас называется «Доля в товаре», хотя фактический denominator — все упоминания выбранной темы.',
      },
      {
        name: 'Тональность темы по товару', code: 'products positive/neutral/negative share',
        meaning: 'Структура позитивных, нейтральных и негативных совпадений темы внутри товара.',
        source: 'product_rows → get_cx_topics_workspace_v2.',
        formula: 'Каждая доля = соответствующий sentiment ÷ все упоминания темы у товара × 100.',
        interpretation: 'Три доли используют общий denominator и в пределах округления дают 100%.',
      },
      {
        name: 'Проблемные товары', code: 'get_cx_problem_products',
        meaning: 'Товары с наибольшей долей отзывов 1–3★, имеющие минимум три отзыва.',
        source: 'reviews + empty_review_stats.',
        formula: 'Доля = отзывы с rating ≤ 3 ÷ все отзывы товара × 100; сортировка по доле, затем по объёму.',
        interpretation: 'Это звёздный товарный риск, не тематический Problem Index.',
      },
      {
        name: 'Строки после фильтрации', code: 'reviews total_count',
        meaning: 'Количество текстовых отзывов, соответствующих фильтрам и поиску.',
        source: 'get_cx_reviews_page; count(*) over() до пагинации.',
        formula: 'Количество строк reviews после фильтров периода, кабинета, товара, оценки и поиска.',
        interpretation: 'В браузер загружается по 50 строк; число показывает полный серверный результат.',
      },
      {
        name: 'Версия рабочего словаря', code: 'dictionary version',
        meaning: 'Опубликованный и полностью рассчитанный снимок групп, тем, правил и моделей.',
        source: 'cx_dictionary_versions + cx_methodology_versions.',
        formula: 'Не рассчитывается — версия и статусы хранятся сервером.',
        interpretation: 'Черновик не влияет на рабочие показатели до полной сверки и атомарной публикации.',
      },
      {
        name: 'Прогресс перерасчёта', code: 'processed_reviews / total_reviews',
        meaning: 'Число обработанных отзывов относительно общего объёма активного запуска.',
        source: 'cx_analysis_runs.',
        formula: 'Обработано ÷ всего; завершение разрешено только после серверной сверки строк.',
        interpretation: 'Полный запуск создаёт новую версию, диапазонный обновляет только выбранные даты текущим словарём.',
      },
      {
        name: 'Гранулярность динамики', code: 'day / week / month',
        meaning: 'Размер серверного временного бакета для графика выбранной темы.',
        source: 'get_cx_topic_timeseries_v2.',
        formula: 'Автоматически: день до 45 дней, неделя до 180 дней, далее месяц; пользователь может переключить вручную.',
        interpretation: 'Меняет только группировку графика, а не исходные совпадения или итоговые показатели периода.',
      },
    ],
  },
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
  const referenceGroups = useMemo(() => metricReferenceGroups.map(group => ({
    ...group,
    items: group.items.map(item => {
      if (item.code === 'problem_index') return {
        ...item,
        formula: `100 × нормированная взвешенная сумма: ${percent(thresholds.exposureWeight)} распространённость + ${percent(thresholds.negativityWeight)} негатив + ${percent(thresholds.accelerationWeight)} рост негатива + ${percent(thresholds.confidenceWeight)} уверенность. Каждый фактор ограничен диапазоном 0–1.`,
      };
      if (item.code === 'exposure') return { ...item, source: `Problem Index; порог опубликованной методологии — ${percent(thresholds.exposure)}.`, formula: `min(1, доля отзывов с темой ÷ ${percent(thresholds.exposure)}).` };
      if (item.code === 'confidence') return { ...item, formula: `min(1, упоминания темы ÷ ${thresholds.confident}).` };
      if (item.code === 'risk') return { ...item, formula: `Низкий: < ${thresholds.mediumRisk}; средний: от ${thresholds.mediumRisk} до ${thresholds.highRisk}; высокий: ≥ ${thresholds.highRisk}.` };
      return item;
    }),
  })), [thresholds.accelerationWeight, thresholds.confidenceWeight, thresholds.confident, thresholds.exposure, thresholds.exposureWeight, thresholds.highRisk, thresholds.mediumRisk, thresholds.negativityWeight]);

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
        <div className="cx-methodology-guardrail"><strong>Два режима перерасчёта</strong><span>Полный перерасчёт используется при изменении словаря или логики анализа и завершается атомарной публикацией новой версии. Диапазонный перерасчёт использует текущий опубликованный словарь, обновляет только выбранные даты после импорта и сверяет число обработанных отзывов перед завершением.</span></div>
        <div className="cx-methodology-params">
          <div><span>Начальный срез</span><strong>последний месяц с данными</strong></div>
          <div><span>Полный режим</span><strong>новая версия словаря</strong></div>
          <div><span>Диапазонный режим</span><strong>только выбранные даты</strong></div>
          <div><span>Контроль</span><strong>сверка обработанных строк</strong></div>
        </div>
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
          <div className="cx-section-head"><div><span>OVERALL CXI</span><h2>Общий индекс опыта</h2></div></div>
          <Formula value="Σ вкладов всех тем" />
          <p>Общая тональность всех оценочных упоминаний. Product, Service и Result CXI рассчитываются по той же формуле внутри своей группы.</p>
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

      <section id="cx-glossary" className="page-card cx-methodology-section cx-metric-reference">
        <div className="cx-section-head"><div><span>ПОЛНЫЙ СПРАВОЧНИК</span><h2>Сущности и показатели CX</h2><p>Фактические определения, источники, формулы и правила чтения текущей реализации.</p></div></div>
        <div className="cx-reference-key">
          <span><b>Значение</b>что измеряется</span><span><b>Источник</b>откуда берутся данные</span>
          <span><b>Формула</b>как считается</span><span><b>Интерпретация</b>как читать результат</span>
        </div>
        <div className="cx-reference-groups">
          {referenceGroups.map((group, groupIndex) => (
            <section key={group.title} className="cx-reference-group">
              <header><div><span>{String(groupIndex + 1).padStart(2, '0')}</span><h3>{group.title}</h3></div><p>{group.description}</p><b>{group.items.length}</b></header>
              <div className="cx-reference-list">
                {group.items.map(item => <MetricReference key={item.name} item={item} />)}
              </div>
            </section>
          ))}
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

function MetricReference({ item }: { item: MetricReferenceItem }) {
  return <details className="cx-reference-item">
    <summary><span><strong>{item.name}</strong>{item.code && <code>{item.code}</code>}</span><p>{item.meaning}</p><i aria-hidden="true">+</i></summary>
    <dl>
      <div><dt>Значение</dt><dd>{item.meaning}</dd></div>
      <div><dt>Источник</dt><dd>{item.source}</dd></div>
      <div className="formula"><dt>Формула</dt><dd>{item.formula}</dd></div>
      <div><dt>Интерпретация</dt><dd>{item.interpretation}</dd></div>
    </dl>
    {item.warning && <div className="cx-reference-warning"><strong>Расхождение</strong><span>{item.warning}</span></div>}
  </details>;
}

function Interpretation({ state, meaning, action, tone }: { state: string; meaning: string; action: string; tone: 'good' | 'bad' | 'warn' | 'neutral' }) {
  return <article className={tone}><strong>{state}</strong><p>{meaning}</p><small>{action}</small></article>;
}
