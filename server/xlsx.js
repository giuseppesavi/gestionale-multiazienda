'use strict';
// Lettura e scrittura minimale di file .xlsx (zip + XML) e lettura di .csv.

const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');

const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
function colonna(i) { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
function indiceColonna(rif) { let n = 0; for (const c of rif.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }

// fogli: [{ nome, righe: [[valori]] }]. La prima riga di ogni foglio è in grassetto.
function scrivi(fogli) {
  const usati = new Set();
  const nomi = fogli.map((f, i) => {
    let n = String(f.nome || 'Foglio' + (i + 1)).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Foglio' + (i + 1);
    for (let k = 2; usati.has(n.toLowerCase()); k++) n = n.slice(0, 28) + ' ' + k;
    usati.add(n.toLowerCase());
    return n;
  });
  const file = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      fogli.map((f, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      nomi.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      fogli.map((f, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (fogli.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
  };
  fogli.forEach((f, i) => {
    const righe = f.righe || [];
    const larghezze = [];
    const corpo = righe.map((riga, r) => '<row r="' + (r + 1) + '">' + riga.map((v, c) => {
      if (v === null || v === undefined || v === '') return '';
      const rif = colonna(c) + (r + 1), stile = r === 0 ? ' s="1"' : '';
      larghezze[c] = Math.min(60, Math.max(larghezze[c] || 8, String(v).length + 2));
      if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + rif + '"' + stile + '><v>' + v + '</v></c>';
      return '<c r="' + rif + '" t="inlineStr"' + stile + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    }).join('') + '</row>').join('');
    const cols = larghezze.length ? '<cols>' + Array.from(larghezze, (w, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (w || 8) + '" customWidth="1"/>').join('') + '</cols>' : '';
    file['xl/worksheets/sheet' + (i + 1) + '.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + corpo + '</sheetData></worksheet>';
  });
  const zip = {};
  for (const [k, v] of Object.entries(file)) zip[k] = strToU8(v);
  return Buffer.from(zipSync(zip, { level: 6 }));
}

function leggiXlsx(buf) {
  let totale = 0;
  const z = unzipSync(new Uint8Array(buf), { filter: f => { totale += f.originalSize; if (totale > 200 * 1024 * 1024) throw new Error('file troppo grande'); return /^(xl\/|_rels\/)/.test(f.name); } });
  const testo = n => (z[n] ? strFromU8(z[n]) : '');
  const attr = (s, n) => { const m = new RegExp('(?:^|\\s)' + n + '="([^"]*)"').exec(s); return m ? unesc(m[1]) : null; };
  const condivise = [];
  for (const m of testo('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    condivise.push([...m[1].replace(/<rPh>[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join(''));
  }
  const rel = {};
  for (const m of testo('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s([^>]*)\/?>/g)) rel[attr(m[1], 'Id')] = attr(m[1], 'Target');
  const fogli = [];
  for (const m of testo('xl/workbook.xml').matchAll(/<sheet\s([^>]*)\/?>/g)) {
    const bersaglio = String(rel[attr(m[1], 'r:id')] || '').replace(/^\/?(xl\/)?/, '');
    const xml = testo('xl/' + bersaglio);
    const righe = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const riga = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const rif = attr(c[1], 'r'), t = attr(c[1], 't'), dentro = c[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(dentro);
        let val = '';
        if (t === 's') val = v ? condivise[Number(v[1])] ?? '' : '';
        else if (t === 'inlineStr') val = [...dentro.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join('');
        else if (t === 'str' || t === 'e') val = v ? unesc(v[1]) : '';
        else if (t === 'b') val = v && v[1] === '1' ? 'SI' : 'NO';
        else if (v) { const n = Number(v[1]); val = Number.isFinite(n) ? n : unesc(v[1]); }
        riga[rif ? indiceColonna(rif) : riga.length] = val;
      }
      const n = Number(attr(r[1], 'r'));
      righe[n > 0 ? n - 1 : righe.length] = Array.from(riga, x => x ?? '');
    }
    fogli.push({ nome: attr(m[1], 'name') || '', righe: Array.from(righe, x => x || []) });
  }
  return fogli;
}

function leggiCsv(buf) {
  const t = buf.toString('utf8').replace(/^﻿/, '');
  const prima = t.split(/\r?\n/, 1)[0];
  const sep = (prima.match(/;/g) || []).length >= (prima.match(/,/g) || []).length ? ';' : ',';
  const righe = [];
  let riga = [], cella = '', tra = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (tra) { if (c === '"') { if (t[i + 1] === '"') { cella += '"'; i++; } else tra = false; } else cella += c; }
    else if (c === '"') tra = true;
    else if (c === sep) { riga.push(cella); cella = ''; }
    else if (c === '\n') { riga.push(cella); righe.push(riga); riga = []; cella = ''; }
    else if (c !== '\r') cella += c;
  }
  if (cella !== '' || riga.length) { riga.push(cella); righe.push(riga); }
  return [{ nome: 'Dati', righe }];
}

// Riconosce il formato dal contenuto (i file .xlsx sono archivi zip).
function leggi(buf) { return buf[0] === 0x50 && buf[1] === 0x4b ? leggiXlsx(buf) : leggiCsv(buf); }

module.exports = { scrivi, leggi, leggiXlsx, leggiCsv };
