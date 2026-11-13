'use strict';
// Gestione documentale: revisioni, ciclo Bozza → In approvazione → In vigore → Superato/Ritirato,
// distribuzione, prese visione, visibilità per mansione.

const { cessato } = require('./licenza');

function eng() { return require('./engine'); }
function reg() { return require('./regole'); }
function firme() { return require('./firme'); }
function errore(msg, codice) { const { ErroreUtente } = eng(); return new ErroreUtente(msg, codice); }
const validazione = msg => errore('Controlla i dati inseriti:\n• ' + msg, 'VALIDAZIONE');

const IN_LAVORAZIONE = ['Bozza', 'In approvazione'];
const lista = v => String(v || '').split(',').filter(Boolean);
const tutte = (ctx, e) => [...ctx.st.tabella(e).values()];
const stessoCodice = (a, b) => String(a.codice).trim().toLowerCase() === String(b.codice).trim().toLowerCase();

function aggiorna(ctx, doc, campi) {
  const n = { ...doc, ...campi, updatedAt: eng().adesso() };
  ctx.st.metti('Documenti', n);
  return n;
}
function ruoliFirmati(ctx, docId) {
  return new Set(tutte(ctx, 'Firme').filter(f => f.rifEntity === 'Documenti' && f.rifId === docId && f.stato === 'Firmata').map(f => f.ruolo));
}
const preseDi = (ctx, docId) => tutte(ctx, 'PreseVisione').filter(p => p.documentoId === docId);
const presaFirmata = (ctx, p) => firme().haFirme(ctx.st, 'PreseVisione', p.id);

function annullaPreseNonFirmate(ctx, docId) {
  for (const p of preseDi(ctx, docId)) {
    if (presaFirmata(ctx, p)) continue;
    for (const f of tutte(ctx, 'Firme')) if (f.rifEntity === 'PreseVisione' && f.rifId === p.id) ctx.st.togli('Firme', f.id);
    ctx.st.togli('PreseVisione', p.id);
  }
}

// ---------- destinatari e distribuzione ----------

function destinatario(ctx, doc, d) {
  if (doc.distTutti === 'SI') return true;
  if (lista(doc.distDipendenti).includes(d.id)) return true;
  if (d.sedeId && lista(doc.distSedi).includes(d.sedeId)) return true;
  const mans = new Set(lista(doc.distMansioni));
  return reg().mansioniDi(d).some(m => mans.has(m));   // mansione principale e aggiuntive
}
function haLettoPrecedenti(ctx, doc, dipId) {
  const altre = new Set(tutte(ctx, 'Documenti').filter(x => x.id !== doc.id && stessoCodice(x, doc)).map(x => x.id));
  return tutte(ctx, 'PreseVisione').some(p => p.dipendenteId === dipId && altre.has(p.documentoId) && presaFirmata(ctx, p));
}
function deveLeggere(ctx, doc, d) {
  if (doc.presaVisione === 'Nessuna' || !destinatario(ctx, doc, d)) return false;
  if (preseDi(ctx, doc.id).some(p => p.dipendenteId === d.id)) return false;
  return !(doc.presaVisione === 'Solo chi non ha letto le revisioni precedenti' && haLettoPrecedenti(ctx, doc, d.id));
}
function creaPresa(ctx, doc, d) {
  const { nuovoId, adesso, oggi } = eng();
  const og = oggi();
  ctx.st.metti('PreseVisione', { id: nuovoId(), createdAt: adesso(), updatedAt: adesso(), createdBy: 'sistema',
    documentoId: doc.id, dipendenteId: d.id, assegnataIl: og, entroIl: reg().addGiorni(og, Number(doc.giorniPresa) > 0 ? Number(doc.giorniPresa) : 15), note: '' });
}
function distribuisci(ctx, doc) {
  const og = eng().oggi();
  let n = 0;
  for (const d of tutte(ctx, 'Dipendenti')) {
    if (cessato(d, og) || !deveLeggere(ctx, doc, d)) continue;
    creaPresa(ctx, doc, d);
    n++;
    const postino = ctx.servizi && ctx.servizi.postino;
    if (postino && doc.avvisoEmail === 'SI' && d.utente === 'SI' && d.email) {
      postino.invia({ a: d.email, oggetto: 'Nuovo documento da leggere – ' + doc.codice + ' ' + doc.titolo,
        testo: 'È entrato in vigore il documento ' + doc.codice + ' "' + doc.titolo + '" (revisione ' + doc.revisione + ').\n' +
          'Accedi al gestionale, apri "I miei documenti" e conferma la presa visione.' }).catch(() => {});
    }
  }
  aggiorna(ctx, ctx.st.tabella('Documenti').get(doc.id), { distribuitoIl: og });
  return n;
}
// Nuovi dipendenti o cambio di mansione: ricevono da soli le prese visione dei documenti già distribuiti.
function allineaDipendente(ctx, d) {
  if (cessato(d, eng().oggi())) return;
  for (const doc of tutte(ctx, 'Documenti')) {
    if (doc.stato === 'In vigore' && doc.distribuitoIl && deveLeggere(ctx, doc, d)) creaPresa(ctx, doc, d);
  }
}

function mettiInVigore(ctx, doc) {
  const prec = tutte(ctx, 'Documenti').find(x => x.id !== doc.id && stessoCodice(x, doc) && x.stato === 'In vigore');
  if (prec) { aggiorna(ctx, prec, { stato: 'Superato' }); annullaPreseNonFirmate(ctx, prec.id); }
  const nuovo = aggiorna(ctx, doc, { stato: 'In vigore', dataApprovazione: eng().oggi(), sostituisceId: prec ? prec.id : '' });
  distribuisci(ctx, nuovo);
}

// Revisione corrente del codice a cui punta un collegamento.
function corrente(ctx, docId) {
  const d = ctx.st.tabella('Documenti').get(docId);
  if (!d) return null;
  return tutte(ctx, 'Documenti').find(x => stessoCodice(x, d) && x.stato === 'In vigore') || d;
}

// ---------- visibilità ----------

function coinvolto(doc, dipId) { return [doc.redattoDa, doc.verificatoDa, doc.approvatoDa].includes(dipId); }
function visibileDoc(ctx, doc) {
  if (!ctx.utente || ctx.utente.admin) return !!ctx.utente;
  const io = ctx.st.tabella('Dipendenti').get(ctx.utente.id);
  if (!io) return false;
  if (coinvolto(doc, io.id)) return true;
  if (preseDi(ctx, doc.id).some(p => p.dipendenteId === io.id)) return true;
  return doc.stato === 'In vigore' && destinatario(ctx, doc, io);
}

// ---------- installazione nelle regole ----------

function installa(R) {
  R.FILTRI.Documenti = visibileDoc;
  R.FILTRI.PreseVisione = (ctx, p) => {
    if (!ctx.utente) return false;
    if (ctx.utente.admin || p.dipendenteId === ctx.utente.id) return true;
    const doc = ctx.st.tabella('Documenti').get(p.documentoId);
    return !!doc && visibileDoc(ctx, doc);
  };

  R.HOOKS.Documenti = {
    before(ctx, { riga, vecchia }) {
      riga.codice = String(riga.codice).trim();
      riga.revisione = String(riga.revisione).trim();
      if (riga.link) {
        if (!/^[a-z][a-z0-9+.-]*:/i.test(riga.link)) riga.link = 'https://' + riga.link;
        if (!/^https?:\/\/[^\s]+$/i.test(riga.link)) throw validazione('«Link al documento»: sono ammessi solo indirizzi che iniziano con http:// o https://');
      }
      for (const x of tutte(ctx, 'Documenti')) {
        if (x.id === riga.id || !stessoCodice(x, riga)) continue;
        if (String(x.revisione).toLowerCase() === riga.revisione.toLowerCase()) throw validazione('«Revisione»: esiste già la revisione ' + x.revisione + ' del documento ' + x.codice);
        if (!ctx.interno && IN_LAVORAZIONE.includes(x.stato) && IN_LAVORAZIONE.includes(riga.stato)) throw validazione('Esiste già una revisione in lavorazione del documento ' + x.codice + ' (revisione ' + x.revisione + ')');
      }
      if (vecchia && !ctx.interno && !IN_LAVORAZIONE.includes(vecchia.stato)) throw errore('Il documento non è più in lavorazione: per modificarlo crea una nuova revisione.', 'FIRMATA');
    },
    primaDiFirmare(ctx, { riga, firmatario }) {
      if (!IN_LAVORAZIONE.includes(riga.stato)) throw errore('Il documento non è in lavorazione e non può essere firmato.');
      if (firmatario.ruolo !== 'Approvato da') return;
      const fatti = ruoliFirmati(ctx, riga.id);
      if (!fatti.has('Redatto da') || (riga.verificatoDa && !fatti.has('Verificato da'))) throw errore('L\'approvazione è possibile solo dopo le firme di chi ha redatto e verificato il documento.');
    },
    dopoFirma(ctx, { riga }) {
      const fatti = ruoliFirmati(ctx, riga.id);
      if (fatti.has('Approvato da')) mettiInVigore(ctx, riga);
      else if (fatti.has('Redatto da') && riga.stato === 'Bozza') aggiorna(ctx, riga, { stato: 'In approvazione' });
    },
    // Annullando l'approvazione il documento torna "In approvazione" e la revisione precedente torna in vigore.
    dopoAnnullamento(ctx, { riga, firma }) {
      if (firma.ruolo === 'Approvato da' && riga.stato === 'In vigore') {
        annullaPreseNonFirmate(ctx, riga.id);
        aggiorna(ctx, riga, { stato: 'In approvazione', dataApprovazione: '', distribuitoIl: '' });
        const prec = riga.sostituisceId && ctx.st.tabella('Documenti').get(riga.sostituisceId);
        if (prec && prec.stato === 'Superato') aggiorna(ctx, prec, { stato: 'In vigore' });
      } else if (IN_LAVORAZIONE.includes(riga.stato)) {
        aggiorna(ctx, riga, { stato: ruoliFirmati(ctx, riga.id).has('Redatto da') ? 'In approvazione' : 'Bozza' });
      }
    },
  };

  R.HOOKS.PreseVisione = {
    before(ctx, { riga }) {
      const doc = ctx.st.tabella('Documenti').get(riga.documentoId);
      if (!doc || doc.stato !== 'In vigore') throw validazione('«Documento»: la presa visione si assegna solo ai documenti in vigore');
      if (preseDi(ctx, riga.documentoId).some(p => p.id !== riga.id && p.dipendenteId === riga.dipendenteId)) throw validazione('Per questo dipendente esiste già la presa visione di questo documento');
    },
    primaDiFirmare(ctx, { riga }) {
      const doc = ctx.st.tabella('Documenti').get(riga.documentoId);
      if (!doc || doc.stato !== 'In vigore') throw errore('Il documento non è più in vigore: la presa visione non è più richiesta.');
    },
  };

  R.CALC.Documenti = {
    corrente: (ctx, r) => (r.stato === 'In vigore' ? 'SI' : 'NO'),
    letture: (ctx, r) => { const p = preseDi(ctx, r.id); return p.length ? p.filter(x => presaFirmata(ctx, x)).length + '/' + p.length : ''; },
    prossimoRiesame: (ctx, r) => (r.stato === 'In vigore' && Number(r.riesameMesi) > 0 ? reg().addMesi(r.dataApprovazione || r.dataRevisione, Number(r.riesameMesi)) : ''),
  };
  const firmaPresa = (ctx, r) => tutte(ctx, 'Firme').find(f => f.rifEntity === 'PreseVisione' && f.rifId === r.id && f.stato === 'Firmata');
  R.CALC.PreseVisione = {
    stato: (ctx, r) => (firmaPresa(ctx, r) ? 'Firmata' : r.entroIl && r.entroIl < eng().oggi() ? 'Scaduta' : 'Da firmare'),
    dataLettura: (ctx, r) => { const f = firmaPresa(ctx, r); return f ? String(f.dataFirma).slice(0, 10) : ''; },
  };

  const F = R.FUNZIONI;
  const documento = (ctx, id) => {
    const d = ctx.st.tabella('Documenti').get(id);
    if (!d || !visibileDoc(ctx, d)) throw errore('Documento non trovato.');
    return d;
  };

  // Copia dati e collegamenti in una nuova Bozza.
  F['documenti.nuovaRevisione'] = { entita: 'Documenti', scrive: true, fn(ctx, p) {
    const d = documento(ctx, p.id);
    if (d.stato !== 'In vigore') throw errore('Si può creare una nuova revisione solo da un documento in vigore.');
    const n = Number(d.revisione);
    const revisione = String(p.revisione || (Number.isInteger(n) ? n + 1 : '')).trim();
    if (!revisione) throw errore('Indica il numero della nuova revisione.');
    const dati = {};
    for (const k of ['codice', 'titolo', 'tipologia', 'redattoDa', 'verificatoDa', 'approvatoDa', 'link', 'file', 'distTutti', 'distMansioni', 'distSedi', 'distDipendenti',
      'presaVisione', 'giorniPresa', 'avvisoEmail', 'riesameMesi', 'note']) dati[k] = d[k];
    const coll = tutte(ctx, 'DocumentiCollegamenti').filter(c => c.documentoId === d.id).sort((a, b) => (a._ord || 0) - (b._ord || 0))
      .map(c => ({ tipo: c.tipo, collegatoId: c.collegatoId, note: c.note }));
    return eng().salva(ctx, 'Documenti', { ...dati, revisione, dataRevisione: eng().oggi() }, { DocumentiCollegamenti: coll });
  } };

  F['documenti.ritira'] = { entita: 'Documenti', scrive: true, fn(ctx, p) {
    const d = documento(ctx, p.id);
    if (d.stato !== 'In vigore') throw errore('Si può ritirare solo un documento in vigore.');
    annullaPreseNonFirmate(ctx, d.id);
    aggiorna(ctx, d, { stato: 'Ritirato' });
    eng().registra(ctx, 'Documento ritirato', d.codice + ' rev. ' + d.revisione);
    return eng().leggi(ctx, 'Documenti', d.id);
  } };

  F['documenti.distribuisci'] = { entita: 'Documenti', scrive: true, fn(ctx, p) {
    const d = documento(ctx, p.id);
    if (d.stato !== 'In vigore') throw errore('Si possono distribuire solo i documenti in vigore.');
    const n = distribuisci(ctx, d);
    eng().registra(ctx, 'Distribuzione', d.codice + ' rev. ' + d.revisione + ': ' + n + ' prese visione create');
    return { create: n };
  } };

  // Collegamenti risolti sulla revisione corrente, "Citato in", storico delle revisioni, registro delle prese visione.
  F['documenti.dettaglio'] = { entita: 'Documenti', fn(ctx, p) {
    const d = documento(ctx, p.id);
    const breve = x => ({ id: x.id, codice: x.codice, titolo: x.titolo, revisione: x.revisione, stato: x.stato, dataRevisione: x.dataRevisione });
    const coll = tutte(ctx, 'DocumentiCollegamenti');
    const citatoIn = [];
    for (const c of coll) {
      const bersaglio = ctx.st.tabella('Documenti').get(c.collegatoId);
      const da = ctx.st.tabella('Documenti').get(c.documentoId);
      if (bersaglio && da && stessoCodice(bersaglio, d) && da.stato === 'In vigore' && da.id !== d.id && visibileDoc(ctx, da)) citatoIn.push({ ...breve(da), tipo: c.tipo });
    }
    const out = {
      collegamenti: coll.filter(c => c.documentoId === d.id).map(c => { const x = corrente(ctx, c.collegatoId); return x ? { tipo: c.tipo, note: c.note, ...breve(x) } : null; }).filter(Boolean),
      citatoIn,
      storico: tutte(ctx, 'Documenti').filter(x => stessoCodice(x, d)).sort((a, b) => String(b.dataRevisione).localeCompare(String(a.dataRevisione))).map(breve),
    };
    if (ctx.utente.admin) {
      out.preseVisione = preseDi(ctx, d.id).map(pv => {
        const dip = ctx.st.tabella('Dipendenti').get(pv.dipendenteId);
        return { id: pv.id, nome: dip ? (dip.cognome + ' ' + dip.nome).trim() : '', entroIl: pv.entroIl, stato: R.CALC.PreseVisione.stato(ctx, pv), dataLettura: R.CALC.PreseVisione.dataLettura(ctx, pv) };
      }).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    }
    return out;
  } };

  // Pagina "I miei documenti": documenti da firmare e documenti in vigore per l'utente, con la presa visione.
  F['documenti.miei'] = { entita: 'Documenti', fn(ctx) {
    const io = ctx.st.tabella('Dipendenti').get(ctx.utente.id);
    const daFirmare = [], inVigore = [];
    for (const d of tutte(ctx, 'Documenti')) {
      const breve = { id: d.id, codice: d.codice, titolo: d.titolo, revisione: d.revisione, stato: d.stato, link: d.link || '', file: d.file || '' };
      if (IN_LAVORAZIONE.includes(d.stato) && coinvolto(d, io.id)) {
        const fatti = ruoliFirmati(ctx, d.id);
        for (const s of firme().stato(ctx, 'Documenti', d.id)) {
          if (!s.metodi.includes('credenziali')) continue;
          const pronto = s.ruolo !== 'Approvato da' || (fatti.has('Redatto da') && (!d.verificatoDa || fatti.has('Verificato da')));
          daFirmare.push({ ...breve, ruolo: s.ruolo, key: s.key, pronto });
        }
      }
      if (d.stato !== 'In vigore') continue;
      const pv = preseDi(ctx, d.id).find(x => x.dipendenteId === io.id);
      if (!pv && !destinatario(ctx, d, io)) continue;
      inVigore.push({ ...breve, presa: pv ? { id: pv.id, entroIl: pv.entroIl, stato: R.CALC.PreseVisione.stato(ctx, pv), dataLettura: R.CALC.PreseVisione.dataLettura(ctx, pv), key: 'Lavoratore:' + io.id } : null });
    }
    const ord = (a, b) => a.codice.localeCompare(b.codice, 'it');
    return { daFirmare: daFirmare.sort(ord), inVigore: inVigore.sort(ord) };
  } };
}

module.exports = { installa, allineaDipendente, distribuisci, destinatario, visibileDoc, corrente, preseDi };
