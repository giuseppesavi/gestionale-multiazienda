'use strict';
// Scadenzario, cruscotto e configurazione dell'azienda.

const eng = require('./engine');
const { ErroreUtente } = eng;
const { SCHEMA, CONFIG_PREDEFINITA } = require('./schema');
const regole = require('./regole');
const firme = require('./firme');
const lic = require('./licenza');

const tutte = (ctx, e) => [...ctx.st.tabella(e).values()];
const una = (ctx, e, id) => (id ? ctx.st.tabella(e).get(id) : undefined);
const vede = (ctx, e) => eng.entitaAttiva(ctx, e) && eng.puoLeggere(ctx, e);
const nomeDip = d => (d ? (d.cognome + ' ' + d.nome).trim() : '');
const tit = (ctx, e, id) => eng.titolo(ctx, e, una(ctx, e, id));

// Ogni riga: { data, stato, testo, entita, id } — cliccabile, apre la scheda.
function scadenzario(ctx, p = {}) {
  const giorni = Math.min(730, Math.max(1, Number(p.giorni) || 60));
  const og = eng.oggi(), limite = regole.addGiorni(og, giorni);
  const stato = d => (d < og ? 'Scaduta' : 'In scadenza');
  const attivi = tutte(ctx, 'Dipendenti').filter(d => !lic.cessato(d, og));
  const sezioni = [];
  const sez = (id, titolo, righe) => sezioni.push({ id, titolo, righe: righe.sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))) });

  if (vede(ctx, 'Manutenzioni')) {
    const r = [];
    for (const at of regole.attivitaInScadenza(ctx, null, giorni)) for (const a of at.attivita) {
      r.push({ data: a.prossima, stato: a.stato, testo: at.codice + ' ' + at.descrizione + ' – ' + a.attivita, entita: 'Attrezzature', id: at.attrezzaturaId });
    }
    sez('manutenzioni', 'Manutenzioni', r);
  }
  if (vede(ctx, 'Corsi')) {
    const r = [];
    for (const d of attivi) {
      const richieste = new Set(regole.formazioneRichiesta(ctx, d).map(t => t.id));
      const svolte = new Set();
      for (const pa of tutte(ctx, 'CorsiPartecipanti')) if (pa.dipendenteId === d.id) { const c = una(ctx, 'Corsi', pa.corsoId); if (c) svolte.add(c.tipoCorsoId); }
      for (const t of new Set([...richieste, ...svolte])) {
        const s = regole.statoFormazione(ctx, d.id, t);
        // Anche la formazione richiesta ma mai svolta compare nello scadenzario.
        if (!s.svolta) { if (richieste.has(t)) r.push({ data: '', stato: 'Mai svolta', testo: nomeDip(d) + ' – ' + s.tipo, entita: 'Dipendenti', id: d.id }); }
        else if (s.scadenza && s.scadenza <= limite) r.push({ data: s.scadenza, stato: stato(s.scadenza), testo: nomeDip(d) + ' – ' + s.tipo + (s.parziale ? ' (' + s.parziale + ')' : ''), entita: 'Dipendenti', id: d.id });
      }
    }
    sez('formazione', 'Formazione', r);
  }
  if (vede(ctx, 'Azioni')) {
    sez('azioni', 'Azioni di miglioramento', tutte(ctx, 'Azioni').filter(a => a.stato !== 'Chiusa' && a.dataPrevChiusura && a.dataPrevChiusura <= limite)
      .map(a => ({ data: a.dataPrevChiusura, stato: stato(a.dataPrevChiusura), testo: a.numero + ' – ' + a.descrizione + (a.responsabileId ? ' (' + tit(ctx, 'Dipendenti', a.responsabileId) + ')' : ''), entita: 'Azioni', id: a.id })));
  }
  if (vede(ctx, 'Rischi')) {
    sez('rischi', 'Riesame di rischi e opportunità', tutte(ctx, 'Rischi').filter(x => x.stato === 'Attivo' && x.prossimoRiesame && x.prossimoRiesame <= limite)
      .map(x => ({ data: x.prossimoRiesame, stato: stato(x.prossimoRiesame), testo: x.codice + ' – ' + x.descrizione, entita: 'Rischi', id: x.id, registroId: x.registroId })));
  }
  if (vede(ctx, 'Consegne')) {
    // Scadenza indicativa (non vincolante): ultima consegna + mesi indicati sul DPI.
    const ultime = new Map();
    for (const c of tutte(ctx, 'Consegne')) for (const x of tutte(ctx, 'ConsegneRighe')) {
      if (x.consegnaId !== c.id) continue;
      const k = c.dipendenteId + '|' + x.dpiId;
      if (!ultime.has(k) || ultime.get(k).data < c.data) ultime.set(k, { data: c.data, id: c.id, dip: c.dipendenteId, dpi: x.dpiId });
    }
    const r = [];
    for (const u of ultime.values()) {
      const dpi = una(ctx, 'TipiDpi', u.dpi), d = una(ctx, 'Dipendenti', u.dip);
      if (!dpi || !(Number(dpi.scadenzaMesi) > 0) || !d || lic.cessato(d, og)) continue;
      const sc = regole.addMesi(u.data, Number(dpi.scadenzaMesi));
      if (sc <= limite) r.push({ data: sc, stato: stato(sc), testo: nomeDip(d) + ' – ' + dpi.codice + ' ' + dpi.descrizione + ' (indicativa)', entita: 'Consegne', id: u.id });
    }
    sez('dpi', 'DPI', r);
  }
  if (vede(ctx, 'Strumenti')) {
    const r = [];
    for (const s of tutte(ctx, 'Strumenti')) {
      if (s.stato === 'Dismesso' || s.stato === 'Fuori servizio') continue;
      const x = regole.statoStrumento(ctx, s);
      if (x.stato === 'Mai tarato' || x.stato === 'Non conforme' || (x.scadenza && x.scadenza <= limite)) {
        r.push({ data: x.scadenza, stato: x.stato === 'Valida' || x.stato === 'Valida con avviso' ? 'In scadenza' : x.stato, testo: s.codice + ' ' + s.descrizione, entita: 'Strumenti', id: s.id });
      }
    }
    sez('strumenti', 'Strumenti di misura', r);
  }
  if (vede(ctx, 'Dipendenti')) {
    const r = attivi.filter(d => d.tipoRapporto === 'Interinale (somministrazione)' && d.fineMissione && d.fineMissione <= limite)
      .map(d => ({ data: d.fineMissione, stato: stato(d.fineMissione), testo: nomeDip(d) + (d.agenziaId ? ' – ' + tit(ctx, 'Soggetti', d.agenziaId) : ''), entita: 'Dipendenti', id: d.id }));
    if (r.length || attivi.some(d => d.tipoRapporto === 'Interinale (somministrazione)')) sez('missioni', 'Missioni degli interinali', r);
  }
  if (vede(ctx, 'SorveglianzaSanitaria')) {
    const r = [];
    for (const d of regole.lavoratoriSoggetti(ctx)) {
      const s = regole.statoSanitario(ctx, d.id);
      if (s.stato === 'Visita mancante' || s.stato === 'Data mancante') r.push({ data: '', stato: s.stato, testo: nomeDip(d), entita: s.visitaId ? 'SorveglianzaSanitaria' : 'Dipendenti', id: s.visitaId || d.id });
      else if (s.prossimaVisita <= limite) r.push({ data: s.prossimaVisita, stato: stato(s.prossimaVisita), testo: nomeDip(d) + ' – visita periodica', entita: 'SorveglianzaSanitaria', id: s.visitaId });
      if (s.inidoneitaFino && s.inidoneitaFino <= limite) r.push({ data: s.inidoneitaFino, stato: stato(s.inidoneitaFino), testo: nomeDip(d) + ' – fine dell\'inidoneità temporanea', entita: 'SorveglianzaSanitaria', id: s.visitaId });
    }
    sez('visite', 'Visite mediche', r);
  }
  if (vede(ctx, 'PreseVisione')) {
    const r = [];
    for (const pv of tutte(ctx, 'PreseVisione')) {
      if (!eng.visibileRiga(ctx, 'PreseVisione', pv) || firme.haFirme(ctx.st, 'PreseVisione', pv.id) || !pv.entroIl || pv.entroIl > limite) continue;
      const doc = una(ctx, 'Documenti', pv.documentoId) || {};
      r.push({ data: pv.entroIl, stato: stato(pv.entroIl), testo: tit(ctx, 'Dipendenti', pv.dipendenteId) + ' – ' + doc.codice + ' ' + doc.titolo, entita: 'PreseVisione', id: pv.id });
    }
    sez('prese', 'Prese visione dei documenti', r);
    const ries = [];
    for (const d of tutte(ctx, 'Documenti')) {
      if (d.stato !== 'In vigore' || !eng.visibileRiga(ctx, 'Documenti', d)) continue;
      const x = regole.CALC.Documenti.prossimoRiesame(ctx, d);
      if (x && x <= limite) ries.push({ data: x, stato: stato(x), testo: d.codice + ' ' + d.titolo + ' (rev. ' + d.revisione + ')', entita: 'Documenti', id: d.id });
    }
    sez('riesami', 'Riesame dei documenti', ries);
  }
  return { giorni, oggi: og, sezioni };
}

function cruscotto(ctx) {
  const og = eng.oggi(), da30 = regole.addGiorni(og, -30);
  const sc = scadenzario(ctx, { giorni: 30 });
  const conta = id => { const s = sc.sezioni.find(x => x.id === id); return s ? { scadute: s.righe.filter(r => r.stato !== 'In scadenza').length, inScadenza: s.righe.filter(r => r.stato === 'In scadenza').length } : null; };
  const out = { licenza: lic.statoLicenza(ctx.st, ctx.azienda, og), contatori: { dipendentiAttivi: lic.contaAttivi(ctx.st, og) }, scadenze: {} };
  if (vede(ctx, 'Consegne')) out.contatori.consegne30 = tutte(ctx, 'Consegne').filter(c => c.data >= da30).length;
  if (vede(ctx, 'NC')) out.contatori.ncAperte = tutte(ctx, 'NC').filter(n => n.stato !== 'Chiusa').length;
  if (vede(ctx, 'Azioni')) {
    const az = tutte(ctx, 'Azioni').filter(a => a.stato !== 'Chiusa');
    out.contatori.azioniAperte = az.length;
    out.contatori.azioniScadute = az.filter(a => a.dataPrevChiusura && a.dataPrevChiusura < og).length;
    out.mieAzioni = az.filter(a => a.responsabileId === ctx.utente.id).length;
  }
  if (vede(ctx, 'Rischi')) {
    const attivi = tutte(ctx, 'Rischi').filter(r => r.stato === 'Attivo');
    const perClasse = {};
    for (const r of attivi) { const v = r.valResidua || r.valIniziale; const k = v ? v.classe : 'Da valutare'; perClasse[k] = (perClasse[k] || 0) + 1; }
    out.rischi = { attivi: attivi.length, proposte: tutte(ctx, 'Rischi').filter(r => r.stato === 'Proposta').length, perClasse };
  }
  for (const id of ['manutenzioni', 'formazione', 'strumenti', 'visite', 'prese', 'riesami', 'rischi']) { const c = conta(id); if (c) out.scadenze[id] = c; }
  // Firme in attesa sulle schede degli ultimi 90 giorni.
  const da90 = regole.addGiorni(og, -90);
  let inAttesa = 0;
  for (const E of Object.values(SCHEMA)) {
    if (!E.signers || E.name === 'PreseVisione' || !vede(ctx, E.name)) continue;
    for (const r of tutte(ctx, E.name)) {
      if (String(r.createdAt || '').slice(0, 10) < da90 || !eng.visibileRiga(ctx, E.name, r)) continue;
      if ((firme.stato(ctx, E.name, r.id) || []).some(s => s.stato === 'Da firmare' || s.stato === 'Link inviato')) inAttesa++;
    }
  }
  out.firmeInAttesa = inAttesa;
  if (vede(ctx, 'Documenti')) {
    const miei = regole.funzione(ctx, { nome: 'documenti.miei' });
    out.documenti = { daLeggere: miei.inVigore.filter(d => d.presa && d.presa.stato !== 'Firmata').length, daFirmare: miei.daFirmare.length };
  }
  return out;
}

// ---------- configurazione ----------

function configPubblica(ctx) {
  const c = eng.config(ctx.st);
  return { ragioneSociale: c.ragioneSociale || ctx.azienda.nome, colore: c.colore, logo: c.logo || '' };
}
function configLeggi(ctx) {
  if (!ctx.utente.admin) throw new ErroreUtente('La configurazione è riservata agli amministratori.', 'PERMESSO');
  return eng.config(ctx.st);
}
function configSalva(ctx, p) {
  if (!ctx.utente.admin) throw new ErroreUtente('La configurazione è riservata agli amministratori.', 'PERMESSO');
  const c = { ...(ctx.st.prop('config') || {}) }, err = [];
  const testo = (k, max = 300) => { if (p[k] !== undefined) c[k] = String(p[k] ?? '').trim().slice(0, max); };
  const intero = (k, min, max, nome) => { if (p[k] === undefined) return; const n = Number(p[k]); if (!Number.isFinite(n) || n < min || n > max) err.push('«' + nome + '»: deve essere compreso tra ' + min + ' e ' + max); else c[k] = n; };
  const email = (k, nome) => { if (p[k] === undefined) return; const v = String(p[k] || '').trim().toLowerCase(); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) err.push('«' + nome + '»: indirizzo e-mail non valido'); else c[k] = v; };
  for (const k of ['ragioneSociale', 'indirizzo', 'comune', 'piva', 'cf', 'telefono', 'oggettoDpi']) testo(k);
  testo('dichiarazioneDpi', 3000);
  email('email', 'E-mail'); email('emailDpi', 'E-mail per i verbali DPI');
  intero('otpMinuti', 3, 30, 'Validità del codice di accesso (minuti)');
  intero('sessioneOre', 1, 6, 'Durata della sessione (ore)');
  intero('linkFirmaGiorni', 1, 30, 'Validità del link di firma (giorni)');
  intero('sogliaQualifica', 1, 10, 'Soglia di qualifica dei fornitori');
  if (p.colore !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(p.colore)) err.push('«Colore aziendale»: colore non valido'); else c.colore = p.colore; }
  if (p.accessoSanitaria !== undefined) { if (!['Solo amministratori', 'Amministratori e utenti'].includes(p.accessoSanitaria)) err.push('«Accesso alla sorveglianza sanitaria»: valore non ammesso'); else c.accessoSanitaria = p.accessoSanitaria; }
  if (p.logo !== undefined) {
    const reg = p.logo ? una(ctx, 'FileReg', String(p.logo).split('|')[0]) : null;
    if (p.logo && (!reg || !/^image\/(png|jpeg)$/.test(reg.mime))) err.push('«Logo»: carica un\'immagine PNG o JPG'); else c.logo = p.logo || '';
  }
  if (err.length) throw new ErroreUtente('Controlla i dati inseriti:\n• ' + err.join('\n• '), 'VALIDAZIONE');
  ctx.st.setProp('config', c);
  eng.registra(ctx, 'Configurazione', 'Dati azienda aggiornati');
  return eng.config(ctx.st);
}

// Valori degli elenchi personalizzabili, per i menu a tendina.
function elenchi(ctx) {
  const out = {};
  for (const r of tutte(ctx, 'Elenchi').sort((a, b) => (Number(a.ordine) || 0) - (Number(b.ordine) || 0))) (out[r.categoria] = out[r.categoria] || []).push(r.valore);
  return out;
}

module.exports = { scadenzario, cruscotto, configPubblica, configLeggi, configSalva, elenchi, CONFIG_PREDEFINITA };
