// 由 spec-*.json 生成 Mermaid / PlantUML 源码，便于在其它工具中二次编辑。
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'sources';
fs.mkdirSync(outDir, { recursive: true });

const shapeToMermaid = {
  process: (id, t) => `${id}["${t}"]`,
  terminal: (id, t) => `${id}(["${t}"])`,
  decision: (id, t) => `${id}{"${t}"}`,
  io: (id, t) => `${id}[/"${t}"/]`,
  doc: (id, t) => `${id}("${t}")`,
  store: (id, t) => `${id}[("${t}")]`,
  predefined: (id, t) => `${id}[["${t}"]]`,
  connector: (id, t) => `${id}(("${t}"))`,
  comment: (id, t) => `${id}["${t}"]`,
  usecase: (id, t) => `${id}("${t}")`,
  actor: (id, t) => `${id}("${t}")`,
  frame: (id, t) => `${id}["${t}"]`,
  class: (id, t) => `${id}["${t}"]`,
};

const esc = (s) => String(s ?? '').replace(/\n/g, '<br>').replace(/"/g, '#quot;');

function flowchart(fig) {
  const lines = ['---', `title: ${fig.caption}`, '---', 'flowchart TB'];
  const grouped = new Map();
  for (const g of fig.groups ?? []) {
    const members = (fig.nodes ?? []).filter((n) => +n.row >= +g.row0 && +n.row <= +g.row1);
    grouped.set(members.map((m) => m.id).join(','), g.label);
  }
  const claimed = new Set();
  let i = 0;
  for (const [key, label] of grouped) {
    i++;
    lines.push(`  subgraph SG${i}["${label.replace(/\n/g, ' ')}"]`);
    for (const id of key.split(',')) {
      claimed.add(id);
      const n = fig.nodes.find((x) => x.id === id);
      lines.push('    ' + (shapeToMermaid[n.shape ?? 'process'] ?? shapeToMermaid.process)(id, esc(n.label + (n.sub ? '\n' + n.sub : ''))));
    }
    lines.push('  end');
  }
  for (const n of fig.nodes ?? []) {
    if (claimed.has(n.id)) continue;
    lines.push('  ' + (shapeToMermaid[n.shape ?? 'process'] ?? shapeToMermaid.process)(n.id, esc(n.label + (n.sub ? '\n' + n.sub : ''))));
  }
  for (const e of fig.edges ?? []) {
    const arrow = e.style === 'dashed' ? '-.->' : e.style === 'line' ? '---' : '-->';
    const label = e.label ? `|${esc(e.label)}|` : '';
    lines.push(`  ${e.from} ${arrow}${label} ${e.to}`);
  }
  return lines.join('\n') + '\n';
}

function classDiagram(fig) {
  const lines = ['classDiagram'];
  const name = new Map(fig.nodes.map((n) => [n.id, String(n.lines[0]).replace(/[^\w]/g, '') || n.id]));
  for (const n of fig.nodes) {
    const attrs = (n.lines ?? []).slice(1).flatMap((a) => String(a).split(' / '));
    lines.push(`  class ${name.get(n.id)} {`);
    for (const a of attrs) lines.push(`    +${a.trim()}`);
    lines.push('  }');
  }
  for (const e of fig.edges ?? []) {
    const rel = e.style === 'dashed' ? '..>' : '-->';
    lines.push(`  ${name.get(e.from)} ${rel} ${name.get(e.to)} : ${e.label ?? ''}`);
  }
  return lines.join('\n') + '\n';
}

function useCase(fig) {
  const frame = fig.nodes.find((n) => n.shape === 'frame');
  const lines = ['@startuml', 'left to right direction', 'skinparam packageStyle rectangle'];
  if (frame) {
    lines.push(`rectangle "${frame.label}" {`);
    for (const n of fig.nodes.filter((x) => x.shape === 'usecase')) {
      lines.push(`  usecase "${n.label}" as ${n.id}`);
    }
    lines.push('}');
  }
  for (const n of fig.nodes.filter((x) => x.shape === 'actor')) {
    lines.push(`actor "${n.label}" as ACT${n.id}`);
  }
  for (const n of fig.nodes.filter((x) => x.shape === 'comment')) {
    lines.push(`note "${esc(n.sub ?? n.label)}" as N1`);
  }
  const alias = (id) => (fig.nodes.find((n) => n.id === id)?.shape === 'actor' ? `ACT${id}` : id);
  for (const e of fig.edges ?? []) {
    if (e.style === 'dashed') lines.push(`${alias(e.from)} ..> ${alias(e.to)} : ${String(e.label ?? '').replace(/[«»]/g, '')}`);
    else lines.push(`${alias(e.from)} -- ${alias(e.to)}`);
  }
  lines.push('@enduml');
  return lines.join('\n') + '\n';
}

const report = [];
for (const spec of ['spec-a.json', 'spec-b.json', 'spec-c.json']) {
  const data = JSON.parse(fs.readFileSync(spec, 'utf8'));
  for (const fig of data.figures) {
    const key = fig.file.split('-')[0];
    const hasClass = (fig.nodes ?? []).some((n) => n.shape === 'class');
    const hasUsecase = (fig.nodes ?? []).some((n) => n.shape === 'usecase');
    const text = hasClass ? classDiagram(fig) : hasUsecase ? useCase(fig) : flowchart(fig);
    const ext = hasUsecase ? 'pu' : 'mmd';
    const file = path.join(outDir, `${key}.${ext}`);
    fs.writeFileSync(file, text);
    report.push(file);
  }
}
console.log(report.join('\n'));
