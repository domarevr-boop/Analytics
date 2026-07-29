export function appendToMap<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value) {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}
