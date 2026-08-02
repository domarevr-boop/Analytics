import { supabase } from '../../lib/supabaseClient';
import { cleanReviewText, lemmatizeRussianText } from './russianMorphology';

export type CxRuleType = 'exact_keyword' | 'exact_phrase' | 'lemma' | 'lemma_phrase' | 'context' | 'regex' | 'exclusion';

export interface CxTopicGroup {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CxTopic {
  id: string;
  groupId: string;
  parentTopicId: string | null;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CxDictionaryVersion {
  id: string;
  versionNumber: number;
  status: 'draft' | 'published' | 'archived';
  description: string;
  createdAt: string;
  publishedAt: string | null;
  analysisStatus: string;
}

export interface CxTopicRule {
  id: string;
  topicId: string;
  dictionaryVersionId: string;
  ruleType: CxRuleType;
  pattern: string;
  priority: number;
  isActive: boolean;
  comment: string;
  ruleConfig: Record<string, unknown>;
}

export interface CxMethodology {
  dictionaryVersionId: string;
  config: Record<string, unknown>;
}

export interface CxAnalysisSettings {
  groups: CxTopicGroup[];
  topics: CxTopic[];
  versions: CxDictionaryVersion[];
  rules: CxTopicRule[];
  methodologies: CxMethodology[];
}

export interface CxRuleTestResult {
  topicId: string;
  topicName: string;
  groupName: string;
  matchedRules: Array<{ id: string; type: CxRuleType; pattern: string }>;
  excluded: boolean;
}

type Row = Record<string, unknown>;

function apiError(context: string, error: { message: string } | null) {
  if (error) throw new Error(`[CX] ${context}: ${error.message}`);
}

function array(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Row[] : [];
}

export async function getCxAnalysisSettings(): Promise<CxAnalysisSettings> {
  const { data, error } = await supabase.rpc('get_cx_analysis_settings');
  apiError('настройки анализа', error);
  const payload = (data || {}) as Row;
  return {
    groups: array(payload.groups).map(row => ({
      id: String(row.id || ''), code: String(row.code || ''), name: String(row.name || ''),
      sortOrder: Number(row.sort_order) || 0, isActive: row.is_active !== false,
    })),
    topics: array(payload.topics).map(row => ({
      id: String(row.id || ''), groupId: String(row.group_id || ''),
      parentTopicId: row.parent_topic_id ? String(row.parent_topic_id) : null,
      code: String(row.code || ''), name: String(row.name || ''), description: String(row.description || ''),
      sortOrder: Number(row.sort_order) || 0, isActive: row.is_active !== false,
    })),
    versions: array(payload.versions).map(row => ({
      id: String(row.id || ''), versionNumber: Number(row.version_number) || 0,
      status: String(row.status || 'archived') as CxDictionaryVersion['status'], description: String(row.description || ''),
      createdAt: String(row.created_at || ''), publishedAt: row.published_at ? String(row.published_at) : null,
      analysisStatus: String(row.analysis_status || 'not_started'),
    })),
    rules: array(payload.rules).map(row => ({
      id: String(row.id || ''), topicId: String(row.topic_id || ''), dictionaryVersionId: String(row.dictionary_version_id || ''),
      ruleType: String(row.rule_type || 'exact_keyword') as CxRuleType, pattern: String(row.pattern || ''),
      priority: Number(row.priority) || 100, isActive: row.is_active !== false, comment: String(row.comment || ''),
      ruleConfig: row.rule_config && typeof row.rule_config === 'object' ? row.rule_config as Record<string, unknown> : {},
    })),
    methodologies: array(payload.methodologies).map(row => ({
      dictionaryVersionId: String(row.dictionary_version_id || ''),
      config: row.config && typeof row.config === 'object' ? row.config as Record<string, unknown> : {},
    })),
  };
}

export async function createCxDictionaryDraft(description: string) {
  const { data, error } = await supabase.rpc('create_cx_dictionary_draft', { p_description: description });
  apiError('создание черновика', error);
  return String(data || '');
}

export async function saveCxTopic(input: { id: string | null; groupId: string; name: string; description: string; isActive: boolean }) {
  const { data, error } = await supabase.rpc('save_cx_topic', {
    p_id: input.id, p_group_id: input.groupId, p_name: input.name,
    p_description: input.description, p_is_active: input.isActive,
  });
  apiError('сохранение темы', error);
  return String(data || '');
}

export async function saveCxTopicRule(input: {
  id: string | null; topicId: string; ruleType: CxRuleType; pattern: string;
  ruleConfig: Record<string, unknown>; priority: number; isActive: boolean; comment: string;
}) {
  let pattern = input.pattern;
  let ruleConfig = input.ruleConfig;
  if (input.ruleType === 'lemma' || input.ruleType === 'lemma_phrase') {
    pattern = await lemmatizeRussianText(pattern);
  } else if (input.ruleType === 'context') {
    const required = Array.isArray(ruleConfig.required) ? await Promise.all(ruleConfig.required.map(value => lemmatizeRussianText(String(value)))) : [];
    const anyOf = Array.isArray(ruleConfig.anyOf) ? await Promise.all(ruleConfig.anyOf.map(value => lemmatizeRussianText(String(value)))) : [];
    ruleConfig = { ...ruleConfig, required, anyOf };
    pattern = `${required.join('+')} → ${anyOf.join('|')}`;
  } else if (input.ruleType !== 'regex') {
    pattern = cleanReviewText(pattern);
  }
  const { data, error } = await supabase.rpc('save_cx_topic_rule', {
    p_id: input.id, p_topic_id: input.topicId, p_rule_type: input.ruleType, p_pattern: pattern,
    p_rule_config: ruleConfig,
    p_priority: input.priority, p_is_active: input.isActive, p_comment: input.comment,
  });
  apiError('сохранение правила', error);
  return String(data || '');
}

export async function deleteCxTopicRule(id: string) {
  const { data, error } = await supabase.rpc('delete_cx_topic_rule', { p_id: id });
  apiError('удаление правила', error);
  return Boolean(data);
}

export async function testCxDictionaryRules(text: string): Promise<CxRuleTestResult[]> {
  const cleaned = cleanReviewText(text);
  const lemmatized = await lemmatizeRussianText(text);
  const { data, error } = await supabase.rpc('test_cx_dictionary_rules', {
    p_text: text, p_cleaned_text: cleaned, p_lemmatized_text: lemmatized,
  });
  apiError('тестирование правил', error);
  return (data || []).map((row: Row) => ({
    topicId: String(row.topic_id || ''), topicName: String(row.topic_name || ''), groupName: String(row.group_name || ''),
    matchedRules: array(row.matched_rules).map(rule => ({
      id: String(rule.id || ''), type: String(rule.type || 'keyword') as CxRuleType, pattern: String(rule.pattern || ''),
    })),
    excluded: Boolean(row.excluded),
  }));
}
