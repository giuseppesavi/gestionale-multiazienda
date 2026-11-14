'use strict';
// Scheda dipendente, export Excel dei registri ed esportazione completa dei dati aziendali.

const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const eng = require('./engine');
const { ErroreUtente } = eng;
const { SCHEMA } = require('./schema');
const regole = require('./regole');
const lic = require('./licenza');

const tutte = (ctx, e) => [...ctx.st.tabella(e).values()];
const lista = v => String(v || '').split(',').filter(Boolean);
const attivo = (ctx, e) => eng.entitaAttiva(ctx, e) && eng.puoLeggere(ctx, e);

// Valore di un campo come lo legge una persona.
function leggibile(ctx, f, v) {
  if (v === '' || v === null || v === undefined) return '';
  if (f.type === 'ref' || f.type === 'fk') { const e = f.ref; return e ? eng.titolo(ctx, e, ctx.st.tabella(e).get(v)) : v; }
  if (f.type === 'multiref') return lista(v).map(id => eng.titolo(ctx, f.ref, ctx.st.tabella(f.ref).get(id))).filter(Boolean).join(', ');
  if (f.type === 'date') return eng.dataIt(v);
  if (f.type === 'datetime') return eng.dataIt(String(v).slice(0, 10)) + ' ' + new Date(v).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  if (f.type === 'bool') return v === 'SI' ? 'Sì' : 'No';
  if (f.type === 'file') return String(v).split('|')[1] || '';
  if (f.type === 'number' && typeof v === 'number') return String(v).replace('.', ',');
  return v;
}

// ---------- scheda dipendente ----------

function schedaDipendente(ctx, id) {
  eng.esigi(ctx, 'Dipendenti', false);
  const d = ctx.st.tabella('Dipendenti').get(id);
  if (!d) throw new ErroreUtente('Dipendente non trovato.');
  const tit = (e, i) => eng.titolo(ctx, e, ctx.st.tabella(e).get(i));
  const out = { dipendente: eng.pubblica(ctx, 'Dipendenti', d), nome: (d.cognome + ' ' + d.nome).trim(),
    mansioni: regole.mansioniDi(d).map(m => tit('Mansioni', m)), sede: tit('Sedi', d.sedeId) };
  if (attivo(ctx, 'Consegne')) {
    out.dpi = [];
    for (const c of tutte(ctx, 'Consegne').filter(x => x.dipendenteId === id).sort((a, b) => b.data.localeCompare(a.data))) {
      for (const r of tutte(ctx, 'ConsegneRighe').filter(x => x.consegnaId === c.id)) out.dpi.push({ consegnaId: c.id, data: c.data, dpi: tit('TipiDpi', r.dpiId), quantita: r.quantita, taglia: r.taglia || '' });
    }
  }
  if (attivo(ctx, 'Corsi')) {
    const richieste = new Set(regole.formazioneRichiesta(ctx, d).map(t => t.id));
    const svolte = new Set();
    for (const p of tutte(ctx, 'CorsiPartecipanti')) if (p.dipendenteId === id) { const c = ctx.st.tabella('Corsi').get(p.corsoId); if (c) svolte.add(c.tipoCorsoId); }
    out.formazione = [...new Set([...richieste, ...svolte])].map(t => ({ tipoId: t, richiesta: richieste.has(t), ...regole.statoFormazione(ctx, id, t) }))
      .sort((a, b) => a.tipo.localeCompare(b.tipo, 'it'));
  }
  if (attivo(ctx, 'ValutazioniCompetenze')) {
    out.valutazioni = tutte(ctx, 'ValutazioniCompetenze').filter(v => v.dipendenteId === id).sort((a, b) => b.data.localeCompare(a.data))
      .map(v => ({ id: v.id, data: v.data, mansioni: lista(v.mansioneId).map(m => tit('Mansioni', m)).join(', '), copertura: regole.CALC.ValutazioniCompetenze.copertura(ctx, v), valutatore: tit('Dipendenti', v.valutatoreId) }));
  }
  if (attivo(ctx, 'PreseVisione')) {
    out.documenti = tutte(ctx, 'PreseVisione').filter(p => p.dipendenteId === id && eng.visibileRiga(ctx, 'PreseVisione', p)).map(p => {
      const doc = ctx.st.tabella('Documenti').get(p.documentoId) || {};
      return { id: p.id, codice: doc.codice || '', titolo: doc.titolo || '', revisione: doc.revisione || '', entroIl: p.entroIl, stato: regole.CALC.PreseVisione.stato(ctx, p), dataLettura: regole.CALC.PreseVisione.dataLettura(ctx, p) };
    }).sort((a, b) => a.codice.localeCompare(b.codice, 'it'));
  }
  // Giudizio di idoneità: solo per chi è autorizzato alla sorveglianza sanitaria.
  if (attivo(ctx, 'SorveglianzaSanitaria')) out.sanitaria = regole.statoSanitario(ctx, id);
  return out;
}

function fogliScheda(ctx, id) {
  const s = schedaDipendente(ctx, id);
  const E = SCHEMA.Dipendenti;
  const fogli = [{ nome: 'Anagrafica', righe: [['Campo', 'Valore'], ...E.fields.filter(f => f.type !== 'hidden' && s.dipendente[f.name] !== undefined && s.dipendente[f.name] !== '')
    .map(f => [f.label, leggibile(ctx, f, s.dipendente[f.name])])] }];
  if (s.dpi) fogli.push({ nome: 'DPI consegnati', righe: [['Data', 'DPI', 'Quantità', 'Taglia'], ...s.dpi.map(r => [eng.dataIt(r.data), r.dpi, r.quantita, r.taglia])] });
  if (s.formazione) fogli.push({ nome: 'Formazione', righe: [['Tipologia', 'Richiesta', 'Ultimo corso', 'Scadenza', 'Stato', 'Note'],
    ...s.formazione.map(r => [r.tipo, r.richiesta ? 'Sì' : 'No', eng.dataIt(r.ultimo), eng.dataIt(r.scadenza), r.stato, r.parziale])] });
  if (s.valutazioni) fogli.push({ nome: 'Valutazioni', righe: [['Data', 'Mansioni', 'Copertura', 'Valutatore'], ...s.valutazioni.map(r => [eng.dataIt(r.data), r.mansioni, r.copertura, r.valutatore])] });
  if (s.documenti) fogli.push({ nome: 'Documenti', righe: [['Codice', 'Titolo', 'Revisione', 'Da firmare entro', 'Stato', 'Firmata il'], ...s.documenti.map(r => [r.codice, r.titolo, r.revisione, eng.dataIt(r.entroIl), r.stato, eng.dataIt(r.dataLettura)])] });
  if (s.sanitaria) fogli.push({ nome: 'Sorveglianza sanitaria', righe: [['Stato', 'Ultima visita', 'Giudizio', 'Prossima visita'], [s.sanitaria.stato, eng.dataIt(s.sanitaria.dataVisita), s.sanitaria.giudizio || '', eng.dataIt(s.sanitaria.prossimaVisita)]] });
  return { nome: 'scheda-' + s.nome.replace(/[^A-Za-z0-9]+/g, '-') + '.xlsx', fogli };
}

// ---------- export Excel dei registri ----------

function foglioEntita(ctx, e, righe) {
  const E = SCHEMA[e];
  const campi = E.fields.filter(f => f.type !== 'hidden' && f.type !== 'section' && (!f.ref || eng.entitaAttiva(ctx, f.ref) || ctx.interno));
  const fkMadre = E.child ? SCHEMA[E.parent].children.find(c => c.e === e).fk : null;
  const { CALC } = regole;
  return { nome: E.label, righe: [campi.map(f => (f.type === 'fk' ? SCHEMA[E.parent].label : f.label)), ...righe.map(r => campi.map(f => {
    if (f.type === 'fk') return eng.titolo(ctx, E.parent, ctx.st.tabella(E.parent).get(r[fkMadre]));
    const v = f.virtual ? (CALC[e] && CALC[e][f.name] ? CALC[e][f.name](ctx, r) : '') : r[f.name];
    return leggibile(ctx, f, v);
  }))] };
}

const EXPORT = {
  'dipendente.scheda': (ctx, p) => fogliScheda(ctx, p.id),
  'strumenti.registro': ctx => { eng.esigi(ctx, 'Strumenti', false); return { nome: 'registro-strumenti.xlsx', fogli: [foglioEntita(ctx, 'Strumenti', tutte(ctx, 'Strumenti').sort((a, b) => a.codice.localeCompare(b.codice, 'it')))] }; },
  'sanitaria.registro': ctx => {
    const righe = regole.funzione(ctx, { nome: 'sanitaria.registro' });
    return { nome: 'registro-sorveglianza-sanitaria.xlsx', fogli: [{ nome: 'Registro', righe: [['Lavoratore', 'Mansioni', 'Stato', 'Ultima visita', 'Giudizio', 'Prossima visita', 'Non idoneo fino al'],
      ...righe.map(r => [r.nome, r.mansioni, r.stato, eng.dataIt(r.dataVisita), r.giudizio || '', eng.dataIt(r.prossimaVisita), eng.dataIt(r.inidoneitaFino)])] }] };
  },
};
function esporta(ctx, p) {
  const f = Object.prototype.hasOwnProperty.call(EXPORT, p.nome) ? EXPORT[p.nome] : null;
  if (!f) throw new ErroreUtente('Esportazione non riconosciuta.');
  return f(ctx, p);
}

// ---------- esportazione completa dei dati aziendali ----------

const FORMATO = 'gestionale-sq';
function ripulisci(e, r) {
  const c = { ...r };
  if (e === 'Dipendenti') { delete c.pinHash; delete c.pinSalt; }   // i PIN non vengono mai esportati
  if (e === 'Firme') { c.token = ''; c.tokenScad = ''; }
  return c;
}

// ctx: amministratore dell'azienda oppure contesto interno della piattaforma.
// p.pacchetti: sottoinsieme da esportare (predefinito: tutti quelli visibili); p.allegati: includi i file.
async function esportaAzienda(ctx, p, leggiFile) {
  if (!ctx.interno && !ctx.utente.admin) throw new ErroreUtente('L\'esportazione dei dati è riservata agli amministratori.', 'PERMESSO');
  const disponibili = lic.PACCHETTI.map(x => x.id).filter(x => ctx.interno || ctx.pacchetti.has(x));
  const scelti = new Set(['base', ...(Array.isArray(p.pacchetti) && p.pacchetti.length ? p.pacchetti.filter(x => disponibili.includes(x)) : disponibili)]);
  const note = [];
  const entita = Object.values(SCHEMA).filter(E => {
    if (!E.packs.some(x => scelti.has(x))) return false;
    if (E.perm === 'san' && !ctx.interno && !eng.puoLeggere(ctx, E.name)) { note.push('Sorveglianza sanitaria esclusa: chi ha esportato non è autorizzato a vederla.'); return false; }
    return true;
  });
  const nomi = new Set(entita.map(E => E.name));
  const tabelle = {}, fogli = [];
  const fileUsati = new Map();
  const segna = v => { const [id, nome] = String(v || '').split('|'); if (id && ctx.st.tabella('FileReg').has(id)) fileUsati.set(id, nome || ctx.st.tabella('FileReg').get(id).nome); };
  for (const E of entita) {
    let righe = tutte(ctx, E.name);
    if (E.name === 'Firme') righe = righe.filter(f => f.stato !== 'In attesa' && nomi.has(f.rifEntity));
    if (E.name === 'FileReg') continue;
    tabelle[E.name] = righe.map(r => ripulisci(E.name, r));
    for (const f of E.fields) if (f.type === 'file') for (const r of righe) segna(r[f.name]);
    if (E.perm !== 'sys' && righe.length) fogli.push(foglioEntita({ ...ctx, interno: true }, E.name, righe));
  }
  const cfg = eng.config(ctx.st);
  if (cfg.logo) segna(cfg.logo);
  tabelle.FileReg = [...fileUsati.keys()].map(id => ctx.st.tabella('FileReg').get(id));
  const dati = { formato: FORMATO, versione: 1, esportato: eng.adesso(), azienda: { codice: ctx.azienda.id, nome: ctx.azienda.nome, classe: ctx.azienda.classe, pacchetti: ctx.azienda.pacchetti },
    pacchettiEsportati: [...scelti], config: ctx.st.prop('config') || {}, tabelle };
  const xlsx = require('../server/xlsx');
  const zip = {
    'LEGGIMI.txt': strToU8(['ESPORTAZIONE DEI DATI AZIENDALI', '', 'Azienda: ' + ctx.azienda.nome + ' (' + ctx.azienda.id + ')', 'Data: ' + eng.dataIt(eng.oggi()),
      'Pacchetti: ' + lic.PACCHETTI.filter(x => scelti.has(x.id)).map(x => x.nome).join(', '), '',
      'dati-leggibili.xlsx   un foglio per ogni tabella, da aprire con Excel.',
      'dati-ripristino.json  copia completa, da usare per ripristinare o trasferire l\'azienda.',
      p.allegati ? 'allegati/             i file caricati (documenti, attestati, firme, scansioni).' : 'Gli allegati non sono inclusi in questa esportazione.', '',
      'I PIN di firma, i codici di accesso e le sessioni non vengono mai esportati.', ...note].join('\r\n')),
    'dati-leggibili.xlsx': new Uint8Array(xlsx.scrivi(fogli.length ? fogli : [{ nome: 'Vuoto', righe: [['Nessun dato']] }])),
    'dati-ripristino.json': strToU8(JSON.stringify(dati)),
  };
  let nAllegati = 0;
  if (p.allegati) for (const [id, nome] of fileUsati) {
    const buf = await leggiFile(id);
    if (buf) { zip['allegati/' + id + '_' + String(nome).replace(/[\\/:*?"<>|]/g, '_')] = [new Uint8Array(buf), { level: 0 }]; nAllegati++; }
  }
  eng.registra(ctx.interno ? { st: ctx.st, utente: { email: 'piattaforma' } } : ctx, 'Esportazione dati',
    'Pacchetti: ' + [...scelti].join(', ') + (p.allegati ? '; ' + nAllegati + ' allegati' : '; senza allegati'));
  return { nome: ctx.azienda.id + '_' + eng.oggi() + '.zip', buffer: Buffer.from(zipSync(zip, { level: 6 })) };
}

// Legge un archivio esportato: restituisce i dati e gli allegati.
function leggiEsportazione(buffer) {
  let z;
  try { z = unzipSync(new Uint8Array(buffer)); } catch (e) { throw new ErroreUtente('Il file non è un\'esportazione valida del gestionale.'); }
  if (!z['dati-ripristino.json']) throw new ErroreUtente('Nell\'archivio manca il file dati-ripristino.json.');
  let dati;
  try { dati = JSON.parse(strFromU8(z['dati-ripristino.json'])); } catch (e) { dati = null; }
  if (!dati || dati.formato !== FORMATO || typeof dati.tabelle !== 'object') throw new ErroreUtente('Il file dati-ripristino.json non è valido.');
  const allegati = [];
  for (const [nome, contenuto] of Object.entries(z)) { const m = /^allegati\/([a-z0-9]{12})_/.exec(nome); if (m) allegati.push({ id: m[1], contenuto: Buffer.from(contenuto) }); }
  for (const e of Object.keys(dati.tabelle)) if (!SCHEMA[e] || !Array.isArray(dati.tabelle[e])) delete dati.tabelle[e];
  return { dati, allegati };
}

module.exports = { schedaDipendente, esporta, esportaAzienda, leggiEsportazione, leggibile, foglioEntita };
