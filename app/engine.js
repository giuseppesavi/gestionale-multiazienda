'use strict';
// Motore generico delle schede: elenco, lettura, salvataggio (scheda + figli), eliminazione,
// validazioni, permessi, pacchetti attivi, numerazione automatica, registro.
//
// ctx = { st, utente:{id,email,nome,admin}, azienda:{id,classe,pacchetti}, pacchetti:Set, interno? }

const crypto = require('crypto');
const { SCHEMA, CONFIG_PREDEFINITA } = require('./schema');

class ErroreUtente extends Error {
  constructor(msg, codice) { super(msg); this.utente = true; this.codice = codice || ''; }
}

const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789';
function nuovoId() {
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALFABETO[b[i] % 36];
  return s;
}

const fmtData = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' });
function oggi() { return fmtData.format(new Date()); }
function adesso() { return new Date().toISOString(); }
function dataIt(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || ''); }

function config(st) { return { ...CONFIG_PREDEFINITA, ...(st.prop('config') || {}) }; }

// ---------- pacchetti e permessi ----------

function entita(e) {
  const E = SCHEMA[e];
  if (!E) throw new ErroreUtente('Scheda non riconosciuta.');
  return E;
}
function entitaAttiva(ctx, e) { return ctx.pacchetti.has(SCHEMA[e].pack); }
function campoAttivo(ctx, f) { return !f.ref || entitaAttiva(ctx, f.ref); }

function sanitariaOk(ctx) {
  return ctx.utente.admin || config(ctx.st).accessoSanitaria === 'Amministratori e utenti';
}
function puoLeggere(ctx, e) {
  if (ctx.interno) return true;
  const p = SCHEMA[e].perm;
  if (p === 'sys') return false;
  if (p === 'ro') return ctx.utente.admin;
  if (p === 'san') return sanitariaOk(ctx);
  return true;
}
function puoScrivere(ctx, e) {
  if (ctx.interno) return true;
  const p = SCHEMA[e].perm;
  if (p === 'admin' || p === 'doc') return ctx.utente.admin;
  if (p === 'reg') return true;
  if (p === 'san') return sanitariaOk(ctx);
  return false;
}
function esigi(ctx, e, scrittura) {
  const E = entita(e);
  if (!entitaAttiva(ctx, e)) throw new ErroreUtente('Questa funzione non è compresa nei pacchetti attivi per la tua azienda.', 'PACCHETTO');
  if (E.child && !ctx.interno) throw new ErroreUtente('Scheda non riconosciuta.');
  if (!(scrittura ? puoScrivere(ctx, e) : puoLeggere(ctx, e))) throw new ErroreUtente('Non hai i permessi per questa operazione.', 'PERMESSO');
  return E;
}

// ---------- valori ----------

function visibile(f, valori) {
  if (!f.showIf) return true;
  for (const [k, atteso] of Object.entries(f.showIf)) {
    const v = valori[k] ?? '';
    if (Array.isArray(atteso) ? !atteso.includes(v) : v !== atteso) return false;
  }
  return true;
}

function predefinito(ctx, f) {
  if (f.def === undefined) return f.type === 'bool' ? 'NO' : '';
  if (f.def === 'today') return oggi();
  if (f.def === 'me') return (ctx.utente && ctx.utente.id) || '';
  return f.type === 'number' ? Number(f.def) : f.def;
}

function normalizza(ctx, f, v, errori) {
  const err = m => { errori.push('«' + f.label + '»: ' + m); return ''; };
  if (v === null || v === undefined) v = '';
  switch (f.type) {
    case 'bool': {
      if (v === true) return 'SI';
      const s = String(v).trim().toUpperCase();
      return ['SI', 'SÌ', 'X', 'TRUE', '1'].includes(s) ? 'SI' : 'NO';
    }
    case 'number': {
      if (v === '') return '';
      const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
      return Number.isFinite(n) ? n : err('deve essere un numero');
    }
    case 'date': {
      v = String(v).trim();
      if (!v) return '';
      const d = new Date(v + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(d) || d.toISOString().slice(0, 10) !== v) return err('data non valida');
      return v;
    }
    case 'email': {
      v = String(v).trim().toLowerCase();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return err('indirizzo e-mail non valido');
      return v;
    }
    case 'select': {
      v = String(v).trim();
      if (v && !f.options.includes(v)) return err('valore non ammesso');
      return v;
    }
    case 'ref': {
      v = String(v).trim();
      if (v && !ctx.st.tabella(f.ref).has(v)) return err('la scheda collegata non esiste più');
      return v;
    }
    case 'multiref': {
      const ids = (Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim()).filter(Boolean);
      const t = ctx.st.tabella(f.ref);
      if (ids.some(i => !t.has(i))) return err('una delle schede collegate non esiste più');
      return [...new Set(ids)].join(',');
    }
    case 'file': {
      v = String(v).trim();
      if (v && !ctx.st.tabella('FileReg').has(v.split('|')[0])) return err('allegato non trovato: caricalo di nuovo');
      return v;
    }
    default: {
      v = String(v).trim();
      // Protezione dalle formule: i testi che iniziano con = + - @ vengono neutralizzati.
      if (['text', 'textarea', 'list'].includes(f.type) && /^[=+\-@]/.test(v)) v = "'" + v;
      return v;
    }
  }
}

// Costruisce la riga da salvare partendo dai dati ricevuti e dalla riga esistente.
function componi(ctx, E, dati, vecchia, errori) {
  const riga = {};
  const insieme = { ...(vecchia || {}), ...dati };
  for (const f of E.fields) {
    if (f.virtual || f.type === 'fk' || f.type === 'section') continue;
    const bloccato = f.ro || f.type === 'auto' || f.type === 'hidden' || f.type === 'datetime' || !campoAttivo(ctx, f);
    let v;
    if (bloccato && !ctx.interno) v = vecchia ? vecchia[f.name] : (campoAttivo(ctx, f) ? predefinito(ctx, f) : '');
    else if (dati[f.name] !== undefined) v = dati[f.name];
    else v = vecchia ? vecchia[f.name] : predefinito(ctx, f);
    v = campoAttivo(ctx, f) ? normalizza(ctx, f, v, errori) : (v ?? '');
    if (f.req && campoAttivo(ctx, f) && (v === '' || v === undefined) && visibile(f, insieme)) errori.push('«' + f.label + '»: campo obbligatorio');
    riga[f.name] = v;
  }
  return riga;
}

function controllaUnivoci(ctx, E, riga, errori) {
  for (const f of E.fields) {
    if (!f.uniq || riga[f.name] === '') continue;
    const v = String(riga[f.name]).toLowerCase();
    for (const r of ctx.st.tabella(E.name).values()) {
      if (r.id !== riga.id && String(r[f.name] ?? '').toLowerCase() === v) {
        errori.push('«' + f.label + '»: il valore "' + riga[f.name] + '" è già usato in un\'altra scheda');
        break;
      }
    }
  }
}

function prossimoNumero(ctx, E) {
  const pre = E.auto + '-' + oggi().slice(0, 4) + '-';
  let max = 0;
  for (const r of ctx.st.tabella(E.name).values()) {
    if (String(r.numero || '').startsWith(pre)) max = Math.max(max, parseInt(r.numero.slice(pre.length), 10) || 0);
  }
  return pre + String(max + 1).padStart(3, '0');
}

// ---------- titoli e uscita ----------

function titolo(ctx, e, riga, livello = 0) {
  if (!riga) return '';
  const E = SCHEMA[e];
  return E.title.map(n => {
    const f = E.fields.find(x => x.name === n);
    const v = riga[n];
    if (!f || v === '' || v === undefined) return '';
    if (f.type === 'ref') return livello > 2 ? '' : titolo(ctx, f.ref, ctx.st.tabella(f.ref).get(v), livello + 1);
    if (f.type === 'date') return dataIt(v);
    return String(v);
  }).filter(Boolean).join(' ');
}

function pubblica(ctx, e, riga) {
  const { CALC } = require('./regole');
  const E = SCHEMA[e];
  const out = { id: riga.id, createdAt: riga.createdAt, updatedAt: riga.updatedAt, createdBy: riga.createdBy };
  for (const f of E.fields) {
    if (f.type === 'hidden' || !campoAttivo(ctx, f)) continue;
    if (f.virtual) { const c = CALC[e] && CALC[e][f.name]; out[f.name] = c ? c(ctx, riga) : ''; }
    else out[f.name] = riga[f.name] ?? '';
  }
  return out;
}

function raccogliEtichette(ctx, e, righe, acc) {
  for (const f of SCHEMA[e].fields) {
    if (!f.ref || f.type === 'fk' || !campoAttivo(ctx, f)) continue;
    const t = ctx.st.tabella(f.ref);
    for (const r of righe) {
      for (const id of String(r[f.name] || '').split(',')) {
        if (id && !acc[id]) acc[id] = titolo(ctx, f.ref, t.get(id)) || '(scheda eliminata)';
      }
    }
  }
}

function figliDi(ctx, c, idMadre) {
  return [...ctx.st.tabella(c.e).values()].filter(r => r[c.fk] === idMadre).sort((a, b) => (a._ord || 0) - (b._ord || 0));
}

// ---------- operazioni ----------

function registra(ctx, evento, dettaglio) {
  ctx.st.metti('Log', {
    id: nuovoId(), createdAt: adesso(), data: adesso(),
    email: (ctx.utente && ctx.utente.email) || 'sistema', evento, dettaglio: String(dettaglio || '').slice(0, 500),
  });
}

function elenco(ctx, e, par = {}) {
  esigi(ctx, e, false);
  let righe = [...ctx.st.tabella(e).values()];
  const q = String(par.q || '').trim().toLowerCase();
  const pub = righe.map(r => pubblica(ctx, e, r));
  const etichette = {};
  raccogliEtichette(ctx, e, pub, etichette);
  let out = pub.map(r => ({ ...r, _titolo: titolo(ctx, e, r) }));
  if (q) out = out.filter(r => Object.entries(r).some(([k, v]) =>
    k !== 'id' && (String(v).toLowerCase().includes(q) || String(v).split(',').some(i => (etichette[i] || '').toLowerCase().includes(q)))));
  for (const [k, v] of Object.entries(par.filtri || {})) if (v !== '' && v !== undefined) out = out.filter(r => String(r[k] ?? '') === String(v));
  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { righe: out, etichette, puoScrivere: puoScrivere(ctx, e) };
}

function leggi(ctx, e, id) {
  const E = esigi(ctx, e, false);
  const riga = ctx.st.tabella(e).get(id);
  if (!riga) throw new ErroreUtente('La scheda non esiste più: potrebbe essere stata eliminata.');
  const out = { riga: pubblica(ctx, e, riga), figli: {}, etichette: {}, titolo: titolo(ctx, e, riga), puoScrivere: puoScrivere(ctx, e) };
  if (E.signers) { const fr = require('./firme'); out.firme = fr.stato(ctx, e, id); out.firmata = fr.haFirme(ctx.st, e, id); }
  raccogliEtichette(ctx, e, [out.riga], out.etichette);
  for (const c of E.children) {
    if (!entitaAttiva(ctx, c.e)) continue;
    out.figli[c.e] = figliDi(ctx, c, id).map(r => pubblica(ctx, c.e, r));
    raccogliEtichette(ctx, c.e, out.figli[c.e], out.etichette);
  }
  return out;
}

function salva(ctx, e, dati = {}, figli = {}) {
  const { HOOKS } = require('./regole');
  const E = esigi(ctx, e, true);
  const tab = ctx.st.tabella(e);
  const vecchia = dati.id ? tab.get(dati.id) : null;
  if (dati.id && !vecchia) throw new ErroreUtente('La scheda non esiste più: potrebbe essere stata eliminata.');
  if (vecchia && E.signers && !ctx.interno && require('./firme').haFirme(ctx.st, e, vecchia.id)) {
    throw new ErroreUtente('Questa scheda è già stata firmata e non si può più modificare. Per cambiarla, un amministratore deve prima annullare le firme.', 'FIRMATA');
  }

  const errori = [];
  const riga = componi(ctx, E, dati, vecchia, errori);
  riga.id = vecchia ? vecchia.id : nuovoId();
  riga.createdAt = vecchia ? vecchia.createdAt : adesso();
  riga.createdBy = vecchia ? vecchia.createdBy : ((ctx.utente && ctx.utente.email) || 'sistema');
  riga.updatedAt = adesso();
  if (E.auto && !riga.numero) riga.numero = prossimoNumero(ctx, E);
  controllaUnivoci(ctx, E, riga, errori);

  // Figli: se la griglia è presente nei dati ricevuti viene sostituita in blocco.
  const nuoviFigli = {};
  for (const c of E.children) {
    if (!entitaAttiva(ctx, c.e) || !Array.isArray(figli[c.e])) continue;
    const esistenti = new Map(figliDi(ctx, c, riga.id).map(r => [r.id, r]));
    nuoviFigli[c.e] = figli[c.e].map((d, i) => {
      const prec = d && d.id ? esistenti.get(d.id) : null;
      const errF = [];
      const r = componi(ctx, SCHEMA[c.e], d || {}, prec, errF);
      for (const m of errF) errori.push(c.l + ', riga ' + (i + 1) + ' – ' + m);
      r.id = prec ? prec.id : nuovoId();
      r[c.fk] = riga.id;
      r._ord = i + 1;
      r.createdAt = prec ? prec.createdAt : riga.updatedAt;
      r.updatedAt = riga.updatedAt;
      return r;
    });
  }
  if (errori.length) throw new ErroreUtente('Controlla i dati inseriti:\n• ' + errori.join('\n• '), 'VALIDAZIONE');

  const h = HOOKS[e] || {};
  if (h.before) h.before(ctx, { riga, vecchia, figli: nuoviFigli });

  ctx.st.metti(e, riga);
  for (const c of E.children) {
    if (!nuoviFigli[c.e]) continue;
    for (const r of figliDi(ctx, c, riga.id)) ctx.st.togli(c.e, r.id);
    for (const r of nuoviFigli[c.e]) ctx.st.metti(c.e, r);
  }
  if (h.after) h.after(ctx, { riga, vecchia, figli: nuoviFigli });
  registra(ctx, vecchia ? 'Modifica' : 'Inserimento', E.label + ': ' + titolo(ctx, e, riga));
  return ctx.interno ? { riga } : leggi(ctx, e, riga.id);
}

// Dove è usata una scheda (per bloccare l'eliminazione con un messaggio chiaro).
function riferimenti(ctx, e, id) {
  const usi = [];
  for (const E of Object.values(SCHEMA)) {
    const campi = E.fields.filter(f => f.ref === e && (f.type === 'ref' || f.type === 'multiref'));
    if (!campi.length) continue;
    let n = 0;
    for (const r of ctx.st.tabella(E.name).values()) {
      if (E.name === e && r.id === id) continue;
      if (campi.some(f => String(r[f.name] || '').split(',').includes(id))) n++;
    }
    if (n) usi.push((E.child ? SCHEMA[E.parent].label + ' › ' : '') + E.label + ' (' + n + ')');
  }
  return usi;
}

function elimina(ctx, e, id) {
  const E = esigi(ctx, e, true);
  if (!ctx.interno && !ctx.utente.admin) throw new ErroreUtente('Solo gli amministratori possono eliminare le schede.', 'PERMESSO');
  const riga = ctx.st.tabella(e).get(id);
  if (!riga) throw new ErroreUtente('La scheda non esiste più: potrebbe essere stata eliminata.');
  if (e === 'Dipendenti' && ctx.utente && ctx.utente.id === id) throw new ErroreUtente('Non puoi eliminare la tua stessa scheda.');
  if (E.signers && !ctx.interno && require('./firme').haFirme(ctx.st, e, id)) {
    throw new ErroreUtente('Questa scheda è firmata e non si può eliminare. Un amministratore deve prima annullare le firme.', 'FIRMATA');
  }
  for (const f of [...ctx.st.tabella('Firme').values()]) if (f.rifEntity === e && f.rifId === id && f.stato === 'In attesa') ctx.st.togli('Firme', f.id);
  const usi = riferimenti(ctx, e, id);
  if (usi.length) throw new ErroreUtente('Non è possibile eliminare questa scheda perché è usata in: ' + usi.join(', ') + '.', 'IN_USO');
  for (const c of E.children) for (const r of figliDi(ctx, c, id)) ctx.st.togli(c.e, r.id);
  ctx.st.togli(e, id);
  registra(ctx, 'Eliminazione', E.label + ': ' + titolo(ctx, e, riga));
  return { eliminata: true };
}

// Voci per i menu a tendina dei collegamenti.
function opzioni(ctx, e) {
  entita(e);
  if (!entitaAttiva(ctx, e) || !puoLeggere(ctx, e)) return [];
  return [...ctx.st.tabella(e).values()].map(r => ({ id: r.id, titolo: titolo(ctx, e, r) }))
    .sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
}

// Schema inviato al browser: solo entità e campi dei pacchetti attivi e visibili all'utente.
function schemaPerUtente(ctx) {
  const out = {};
  for (const E of Object.values(SCHEMA)) {
    if (!entitaAttiva(ctx, E.name)) continue;
    if (!E.child && !puoLeggere(ctx, E.name)) continue;
    out[E.name] = {
      label: E.label, group: E.group, perm: E.perm, pack: E.pack, signers: E.signers, child: E.child, title: E.title,
      puoScrivere: !E.child && puoScrivere(ctx, E.name),
      children: E.children.filter(c => entitaAttiva(ctx, c.e)),
      fields: E.fields.filter(f => f.type !== 'hidden' && campoAttivo(ctx, f)),
    };
  }
  return out;
}

module.exports = {
  ErroreUtente, nuovoId, oggi, adesso, dataIt, config, entitaAttiva, puoLeggere, puoScrivere,
  esigi, titolo, elenco, leggi, salva, elimina, opzioni, schemaPerUtente, registra, visibile,
};
