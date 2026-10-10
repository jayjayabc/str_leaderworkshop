// SPEC.md 에서 항목·라벨·목표 비율을 읽는다 (build.mjs 용. validate.mjs 는 같은 파서를 내장한다)
import fs from 'node:fs';
export function parseSpec(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  const items = {};
  let cur = null;
  for (const l of lines) {
    const h = l.match(/^###\s+(Q\d-\d[ab]?)\s+(.*)$/);
    if (h) { cur = h[1]; items[cur] = { title: h[2].trim(), labels: [] }; continue; }
    if (/^##\s/.test(l)) { cur = null; continue; }
    if (!cur) continue;
    const m = l.match(/^\|\s*([a-z_]+)\s*\|\s*(\d+)%\s*(?:—\s*([^|]*?))?\s*\|(?:\s*([^|]*?)\s*\|)?\s*$/);
    if (m) items[cur].labels.push({ id: m[1], pct: Number(m[2]), desc: (m[3] || m[4] || '').trim() });
  }
  return items;
}
