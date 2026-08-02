import { useEffect, useMemo, useState } from 'react';
import {
  createCxDictionaryDraft, deleteCxTopicRule, getCxAnalysisSettings, saveCxTopic, saveCxTopicRule,
  cancelCxAnalysis, publishCxDictionary, testCxDictionaryRules, type CxAnalysisRun, type CxAnalysisSettings,
  type CxRuleTestResult, type CxRuleType, type CxSentiment,
} from './analysisSettingsApi';
import { backfillReviewLemmas, getLemmaBackfillPending } from './lemmaBackfill';

const EMPTY: CxAnalysisSettings = { groups: [], topics: [], versions: [], rules: [], methodologies: [], analysisRuns: [] };

export default function ClientExperienceSettings() {
  const [settings, setSettings] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [topicName, setTopicName] = useState('');
  const [topicDescription, setTopicDescription] = useState('');
  const [topicGroupId, setTopicGroupId] = useState('');
  const [ruleType, setRuleType] = useState<CxRuleType>('exact_keyword');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleComment, setRuleComment] = useState('');
  const [ruleSentiment, setRuleSentiment] = useState<CxSentiment>('neutral');
  const [contextRequired, setContextRequired] = useState('');
  const [contextAnyOf, setContextAnyOf] = useState('');
  const [contextDistance, setContextDistance] = useState(4);
  const [testText, setTestText] = useState('');
  const [testResults, setTestResults] = useState<CxRuleTestResult[]>([]);
  const [testing, setTesting] = useState(false);
  const [lemmaPending, setLemmaPending] = useState({ reviews: 0, fragments: 0 });
  const [lemmaProgress, setLemmaProgress] = useState({ reviews: 0, fragments: 0 });
  const [lemmatizing, setLemmatizing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState<CxAnalysisRun | null>(null);

  const load = async () => {
    const data = await getCxAnalysisSettings();
    setSettings(data);
    setSelectedTopicId(current => current || data.topics[0]?.id || '');
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getCxAnalysisSettings(), getLemmaBackfillPending()]).then(([data, pending]) => {
      if (cancelled) return;
      setSettings(data);
      setLemmaPending(pending);
      setSelectedTopicId(data.topics[0]?.id || '');
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const draft = settings.versions.find(version => version.status === 'draft');
  const published = settings.versions.find(version => version.status === 'published');
  const activeVersion = draft || published;
  const selectedTopic = settings.topics.find(topic => topic.id === selectedTopicId);
  const rules = useMemo(() => settings.rules.filter(rule => (
    rule.topicId === selectedTopicId && rule.dictionaryVersionId === activeVersion?.id
  )), [activeVersion?.id, selectedTopicId, settings.rules]);
  const methodology = settings.methodologies.find(item => item.dictionaryVersionId === activeVersion?.id)?.config || {};
  const activeRun = settings.analysisRuns.find(run => run.status === 'processing' && run.dictionaryVersionId === draft?.id);

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError('');
    try {
      await action();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const startTopicEdit = () => {
    if (!selectedTopic) return;
    setTopicName(selectedTopic.name);
    setTopicDescription(selectedTopic.description);
    setTopicGroupId(selectedTopic.groupId);
  };

  if (loading) return <div className="cx-settings-loading">Загрузка настроек анализа…</div>;

  return (
    <div className="cx-settings">
      {error && <div className="cx-error">{error}</div>}
      <section className="page-card cx-settings-version">
        <div>
          <span>СЛОВАРЬ</span>
          <h2>{draft ? `Черновик v${draft.versionNumber}` : `Опубликована v${published?.versionNumber || '—'}`}</h2>
          <p>{draft ? 'Изменения изолированы и не влияют на рабочие метрики.' : 'Для редактирования создайте новый черновик.'}</p>
        </div>
        {!draft && <button disabled={saving} onClick={() => void run(() => createCxDictionaryDraft('Рабочий черновик'))}>Создать черновик</button>}
        <div className="cx-settings-actions">
          {(lemmaPending.reviews > 0 || lemmaPending.fragments > 0) && <button disabled={lemmatizing} onClick={() => {
            setLemmatizing(true); setError('');
            void backfillReviewLemmas(progress => setLemmaProgress(progress)).then(() => getLemmaBackfillPending()).then(setLemmaPending)
              .catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLemmatizing(false));
          }}>{lemmatizing ? `Лемматизация ${lemmaProgress.reviews} / ${lemmaPending.reviews}` : `Подготовить леммы · ${lemmaPending.reviews}`}</button>}
          {draft && <button disabled={publishing || lemmatizing || lemmaPending.reviews > 0} onClick={() => {
            setPublishing(true); setError('');
            void publishCxDictionary(setPublishProgress, activeRun?.id).then(load)
              .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
              .finally(() => setPublishing(false));
          }}>{publishing
            ? `Перерасчёт ${publishProgress?.processedReviews || 0} / ${publishProgress?.totalReviews || activeRun?.totalReviews || 0}`
            : activeRun ? `Продолжить перерасчёт · ${activeRun.processedReviews}/${activeRun.totalReviews}` : 'Опубликовать словарь'}</button>}
          {activeRun && !publishing && <button className="cx-secondary-action" onClick={() => {
            void run(() => cancelCxAnalysis(activeRun.id));
          }}>Остановить</button>}
          {draft && <span className="cx-draft-badge">Черновик · не опубликован</span>}
        </div>
      </section>

      <div className="cx-settings-grid">
        <section className="page-card cx-settings-topics">
          <div className="cx-section-head"><div><span>ТАКСОНОМИЯ</span><h2>Темы</h2></div><small>{settings.topics.length} тем</small></div>
          <div className="cx-topic-list">
            {settings.groups.map(group => (
              <div key={group.id} className="cx-topic-group">
                <strong>{group.name}</strong>
                {settings.topics.filter(topic => topic.groupId === group.id).map(topic => (
                  <button key={topic.id} className={topic.id === selectedTopicId ? 'active' : ''} onClick={() => setSelectedTopicId(topic.id)}>
                    <span>{topic.name}</span><small>{settings.rules.filter(rule => rule.topicId === topic.id && rule.dictionaryVersionId === activeVersion?.id).length}</small>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="page-card cx-settings-editor">
          <div className="cx-section-head">
            <div><span>ТЕМА</span><h2>{selectedTopic?.name || 'Выберите тему'}</h2><p>{selectedTopic?.description || 'Описание пока не задано'}</p></div>
            {draft && selectedTopic && <button className="cx-secondary-action" onClick={startTopicEdit}>Редактировать</button>}
          </div>

          {topicName && draft && (
            <form className="cx-topic-form" onSubmit={event => {
              event.preventDefault();
              void run(() => saveCxTopic({ id: selectedTopicId, groupId: topicGroupId, name: topicName, description: topicDescription, isActive: true })).then(() => setTopicName(''));
            }}>
              <input value={topicName} onChange={event => setTopicName(event.target.value)} placeholder="Название темы" />
              <select value={topicGroupId} onChange={event => setTopicGroupId(event.target.value)}>{settings.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
              <input value={topicDescription} onChange={event => setTopicDescription(event.target.value)} placeholder="Описание" />
              <button disabled={saving}>Сохранить</button>
              <button type="button" className="cx-secondary-action" onClick={() => setTopicName('')}>Отмена</button>
            </form>
          )}

          <div className="cx-rules-head"><strong>Правила активной версии</strong><span>{rules.length}</span></div>
          <div className="cx-rules-table">
            {rules.map(rule => (
              <div key={rule.id}>
                <span className={`cx-rule-type ${rule.ruleType}`}>{ruleTypeLabel(rule.ruleType)}</span>
                <strong>{rule.ruleType === 'context'
                  ? `${(rule.ruleConfig.required as string[] | undefined)?.join(', ') || '—'} → ${(rule.ruleConfig.anyOf as string[] | undefined)?.join(', ') || '—'}`
                  : rule.pattern}</strong>
                <small>{rule.comment || `Приоритет ${rule.priority}`}</small>
                {draft ? <select className={`cx-sentiment-select cx-sentiment-${rule.sentiment}`} value={rule.sentiment} onChange={event => {
                  const sentiment = event.target.value as CxSentiment;
                  void run(() => saveCxTopicRule({
                    id: rule.id, topicId: rule.topicId, ruleType: rule.ruleType, pattern: rule.pattern,
                    ruleConfig: rule.ruleConfig, sentiment, priority: rule.priority, isActive: rule.isActive, comment: rule.comment,
                  }));
                }}>
                  <option value="positive">Позитив</option>
                  <option value="neutral">Нейтрально</option>
                  <option value="negative">Негатив</option>
                </select> : <span className={`cx-sentiment cx-sentiment-${rule.sentiment}`}>{sentimentLabel(rule.sentiment)}</span>}
                {draft && <button disabled={saving} onClick={() => void run(() => deleteCxTopicRule(rule.id))}>Удалить</button>}
              </div>
            ))}
            {rules.length === 0 && <p className="cx-settings-empty">Для этой темы ещё нет правил.</p>}
          </div>

          {draft && selectedTopic && (
            <form className={`cx-rule-form${ruleType === 'context' ? ' context' : ''}`} onSubmit={event => {
              event.preventDefault();
              const required = contextRequired.split(',').map(value => value.trim()).filter(Boolean);
              const anyOf = contextAnyOf.split(',').map(value => value.trim()).filter(Boolean);
              const ruleConfig = ruleType === 'context' ? { required, anyOf, maxDistance: contextDistance } : {};
              const pattern = ruleType === 'context' ? `${required.join('+')} → ${anyOf.join('|')}` : rulePattern;
              void run(() => saveCxTopicRule({ id: null, topicId: selectedTopicId, ruleType, pattern, ruleConfig, sentiment: ruleSentiment, priority: 100, isActive: true, comment: ruleComment }))
                .then(() => { setRulePattern(''); setRuleComment(''); setContextRequired(''); setContextAnyOf(''); });
            }}>
              <select value={ruleType} onChange={event => setRuleType(event.target.value as CxRuleType)}>
                <option value="exact_keyword">Точное слово</option>
                <option value="exact_phrase">Точная фраза</option>
                <option value="lemma">Лемма</option>
                <option value="lemma_phrase">Фраза по леммам</option>
                <option value="context">Контекст</option>
                <option value="regex">Регулярное выражение</option>
                <option value="exclusion">Исключение</option>
              </select>
              {ruleType === 'context' ? <>
                <input value={contextRequired} onChange={event => setContextRequired(event.target.value)} placeholder="Обязательно: свет, яркость" required />
                <input value={contextAnyOf} onChange={event => setContextAnyOf(event.target.value)} placeholder="Любое: мало, хватать, достаточно" required />
                <input type="number" min={1} max={20} value={contextDistance} onChange={event => setContextDistance(Number(event.target.value) || 4)} title="Максимальное расстояние между словами" />
              </> : <input value={rulePattern} onChange={event => setRulePattern(event.target.value)} placeholder="Шаблон правила" required />}
              <select value={ruleType === 'exclusion' ? 'neutral' : ruleSentiment} disabled={ruleType === 'exclusion'} onChange={event => setRuleSentiment(event.target.value as CxSentiment)}>
                <option value="positive">Позитив</option>
                <option value="neutral">Нейтрально</option>
                <option value="negative">Негатив</option>
              </select>
              <input value={ruleComment} onChange={event => setRuleComment(event.target.value)} placeholder="Комментарий" />
              <button disabled={saving}>Добавить</button>
            </form>
          )}
        </section>
      </div>

      <div className="cx-settings-bottom">
        <section className="page-card cx-rule-test">
          <div className="cx-section-head"><div><span>ПРОВЕРКА</span><h2>Тестирование словаря</h2></div></div>
          <textarea value={testText} onChange={event => setTestText(event.target.value)} placeholder="Введите пример отзыва…" />
          <button disabled={!testText.trim() || testing} onClick={() => {
            setTesting(true); setError('');
            void testCxDictionaryRules(testText).then(setTestResults).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setTesting(false));
          }}>{testing ? 'Проверка…' : 'Проверить правила'}</button>
          <div className="cx-test-results">
            {testResults.map(result => <div key={result.topicId} className={result.excluded ? 'excluded' : ''}><strong>{result.topicName}</strong><span>{result.groupName}</span><small>{result.excluded ? 'Исключено правилом' : <><span className={`cx-sentiment cx-sentiment-${result.sentiment}`}>{sentimentLabel(result.sentiment)}</span>{result.matchedRules.map(rule => rule.pattern).join(', ')}</>}</small></div>)}
            {!testing && testText && testResults.length === 0 && <p>Совпадений нет</p>}
          </div>
        </section>

        <section className="page-card cx-methodology">
          <div className="cx-section-head"><div><span>МЕТОДОЛОГИЯ</span><h2>Централизованные параметры</h2></div></div>
          <MethodRow label="Минимум упоминаний" value={methodology.minimum_mentions} />
          <MethodRow label="Порог уверенности" value={methodology.minimum_confidence} />
          <MethodRow label="Уверенная выборка" value={methodology.confident_mentions_threshold} />
          <MethodRow label="Высокий риск" value={(methodology.risk_thresholds as Record<string, unknown> | undefined)?.high} />
          <p>Редактирование методологии будет включено вместе с batch-анализатором, чтобы каждое изменение запускало контролируемый перерасчёт.</p>
        </section>

        <section className="page-card cx-version-history">
          <div className="cx-section-head"><div><span>ИСТОРИЯ</span><h2>Версии словаря</h2></div></div>
          {settings.versions.map(version => <div key={version.id}><strong>v{version.versionNumber}</strong><span className={`cx-version-status ${version.status}`}>{version.status}</span><small>{version.description || 'Без описания'}</small></div>)}
          {draft && <p>При публикации новая версия сначала полностью пересчитывается. Рабочий словарь переключается только после сверки всех отзывов.</p>}
        </section>
      </div>
    </div>
  );
}

function MethodRow({ label, value }: { label: string; value: unknown }) {
  return <div className="cx-method-row"><span>{label}</span><strong>{value === undefined ? '—' : String(value)}</strong></div>;
}

function ruleTypeLabel(type: CxRuleType) {
  return ({
    exact_keyword: 'точное', exact_phrase: 'фраза', lemma: 'лемма', lemma_phrase: 'лемма-фраза',
    context: 'контекст', regex: 'regex', exclusion: 'исключение',
  } satisfies Record<CxRuleType, string>)[type];
}

function sentimentLabel(sentiment: CxSentiment) {
  return ({ positive: 'Позитив', neutral: 'Нейтрально', negative: 'Негатив' } satisfies Record<CxSentiment, string>)[sentiment];
}
