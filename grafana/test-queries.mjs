import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH = 'Basic ' + Buffer.from('admin:mes360').toString('base64');
const URL = 'http://localhost:3003/api/ds/query';

function walk(d, acc=[]) { for (const f of readdirSync(d)) { const p=join(d,f); if(statSync(p).isDirectory()) walk(p,acc); else if(f.endsWith('.json')) acc.push(p);} return acc; }

function subst(sql) {
  return sql
    .replaceAll("'$factory'", "'SIDCO'")
    .replaceAll("'$area'", "''").replaceAll("'$line'", "''").replaceAll("'$machine'", "''")
    .replaceAll("'$shift'", "''").replaceAll("'$product'", "''").replaceAll("'$batch'", "''")
    .replaceAll("$factory", "SIDCO").replaceAll("$area","").replaceAll("$line","")
    .replaceAll("$machine","").replaceAll("$shift","").replaceAll("$product","").replaceAll("$batch","");
}

const queries = []; // {file, kind, title, sql}
for (const file of walk('grafana/dashboards')) {
  const d = JSON.parse(readFileSync(file));
  for (const v of d.templating?.list ?? []) if (v.query) queries.push({file:file.split(/[\/]/).pop(), kind:'var:'+v.name, title:v.name, sql:v.query});
  for (const p of d.panels ?? []) for (const t of p.targets ?? []) if (t.rawSql) queries.push({file:file.split(/[\/]/).pop(), kind:'panel', title:p.title, sql:t.rawSql});
}

let ok=0, errs=[];
for (const q of queries) {
  const body = JSON.stringify({ queries:[{refId:'A', datasource:{type:'postgres',uid:'mes_postgres'}, rawSql: subst(q.sql), format:'table', intervalMs:3600000, maxDataPoints:100}], from:'now-7d', to:'now' });
  try {
    const res = await fetch(URL, { method:'POST', headers:{Authorization:AUTH,'Content-Type':'application/json'}, body });
    const j = await res.json();
    const r = j.results?.A;
    if (r?.error || r?.status >= 400) { errs.push({...q, error: r.error || ('status '+r.status)}); }
    else ok++;
  } catch(e) { errs.push({...q, error: e.message}); }
}
console.log(`Tested ${queries.length} queries: OK=${ok}, ERRORS=${errs.length}\n`);
// dedupe errors by message
const seen = new Map();
for (const e of errs) { const k=e.error.slice(0,120); if(!seen.has(k)) seen.set(k,[]); seen.get(k).push(e); }
for (const [msg, list] of seen) {
  console.log(`\n❌ ${msg}`);
  console.log(`   (${list.length}×) e.g. ${list[0].file} / ${list[0].kind} / "${list[0].title}"`);
}
