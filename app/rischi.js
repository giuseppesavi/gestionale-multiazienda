'use strict';
// Analisi e gestione dei rischi e delle opportunità (portata da Risks.gs del progetto SGI):
// registri, metodi di valutazione configurabili, valutazione iniziale e residua, azioni, piano.
// Ogni valutazione salva un'istantanea del metodo usato: cambiare metodo non altera le valutazioni storiche.

function eng() { return require('./engine'); }
function reg() { return require('./regole'); }
function errore(msg, codice) { const { ErroreUtente } = eng(); return new ErroreUtente(msg, codice); }
const validazione = msg => errore('Controlla i dati inseriti:\n• ' + msg, 'VALIDAZIONE');
const tutte = (ctx, e) => [...ctx.st.tabella(e).values()];
const una = (ctx, e, id) => (id ? ctx.st.tabella(e).get(id) : undefined);
const testo = v => String(v ?? '').trim();
const nomeDip = d => (d ? (d.cognome + ' ' + d.nome).trim() : '');

const classi3 = [{ nome: 'Basso', min: 1, max: 2, colore: '#2F855A', indicazione: 'Accettabile, monitorare', riesameMesi: 12 },
  { nome: 'Medio', min: 3, max: 4, colore: '#B7791F', indicazione: 'Azioni pianificate', riesameMesi: 6 },
  { nome: 'Alto', min: 5, max: 9, colore: '#9B2C2C', indicazione: 'Azioni prioritarie', riesameMesi: 3 }];
const PRESET = {
  PG3: { nome: 'Probabilità × Gravità 3×3', definizione: {
    fattori: [{ codice: 'P', nome: 'Probabilità', livelli: [[1, 'Bassa'], [2, 'Media'], [3, 'Alta']] }, { codice: 'G', nome: 'Gravità', livelli: [[1, 'Lieve'], [2, 'Moderata'], [3, 'Grave']] }],
    classi: classi3 } },
  PG5: { nome: 'Probabilità × Gravità 5×5', definizione: {
    fattori: [{ codice: 'P', nome: 'Probabilità', livelli: [[1, 'Improbabile'], [2, 'Poco probabile'], [3, 'Possibile'], [4, 'Probabile'], [5, 'Quasi certa']] },
      { codice: 'G', nome: 'Gravità', livelli: [[1, 'Trascurabile'], [2, 'Lieve'], [3, 'Moderata'], [4, 'Grave'], [5, 'Molto grave']] }],
    classi: [{ nome: 'Basso', min: 1, max: 4, colore: '#2F855A', indicazione: 'Accettabile, monitorare', riesameMesi: 12 },
      { nome: 'Medio', min: 5, max: 9, colore: '#B7791F', indicazione: 'Azioni da pianificare', riesameMesi: 6 },
      { nome: 'Alto', min: 10, max: 16, colore: '#C05621', indicazione: 'Azioni prioritarie', riesameMesi: 3 },
      { nome: 'Critico', min: 17, max: 25, colore: '#9B2C2C', indicazione: 'Azioni immediate', riesameMesi: 1 }] } },
  PGR: { nome: 'Probabilità × Gravità × Rilevabilità', definizione: {
    fattori: [{ codice: 'P', nome: 'Probabilità', livelli: [[1, 'Remota'], [2, 'Bassa'], [3, 'Media'], [4, 'Alta'], [5, 'Molto alta']] },
      { codice: 'G', nome: 'Gravità', livelli: [[1, 'Trascurabile'], [2, 'Lieve'], [3, 'Moderata'], [4, 'Grave'], [5, 'Molto grave']] },
      { codice: 'R', nome: 'Rilevabilità (1 = facilmente rilevabile)', livelli: [[1, 'Certa'], [2, 'Alta'], [3, 'Media'], [4, 'Bassa'], [5, 'Nulla']] }],
    classi: [{ nome: 'Basso', min: 1, max: 20, colore: '#2F855A', indicazione: 'Accettabile, monitorare', riesameMesi: 12 },
      { nome: 'Medio', min: 21, max: 50, colore: '#B7791F', indicazione: 'Azioni da pianificare', riesameMesi: 6 },
      { nome: 'Alto', min: 51, max: 125, colore: '#9B2C2C', indicazione: 'Azioni prioritarie', riesameMesi: 3 }] } },
  BF3: { nome: 'Opportunità: Beneficio × Fattibilità 3×3', definizione: {
    fattori: [{ codice: 'B', nome: 'Beneficio', livelli: [[1, 'Basso'], [2, 'Medio'], [3, 'Alto']] }, { codice: 'F', nome: 'Fattibilità', livelli: [[1, 'Difficile'], [2, 'Possibile'], [3, 'Agevole']] }],
    classi: [{ nome: 'Priorità bassa', min: 1, max: 2, colore: '#718096', indicazione: 'Valutare in futuro', riesameMesi: 12 },
      { nome: 'Priorità media', min: 3, max: 4, colore: '#2B6CB0', indicazione: 'Pianificare', riesameMesi: 6 },
      { nome: 'Priorità alta', min: 5, max: 9, colore: '#2F855A', indicazione: 'Perseguire', riesameMesi: 3 }] } },
};
// Registri iniziali (modificabili dall'amministratore).
const REGISTRI_INIZIALI = [
  { codice: 'QUALITA', nome: 'Rischi per la qualità', prefisso: 'RQ', tipo: 'Rischi', preset: 'PG3' },
  { codice: 'SICUREZZA', nome: 'Rischi per la salute e sicurezza', prefisso: 'RS', tipo: 'Rischi', preset: 'PG5' },
  { codice: 'AMBIENTE', nome: 'Rischi ambientali', prefisso: 'RA', tipo: 'Rischi', preset: 'PG3' },
  { codice: 'OPPORTUNITA', nome: 'Opportunità di miglioramento', prefisso: 'OP', tipo: 'Opportunità', preset: 'BF3' },
];

// ---------- metodi ----------

function definizioneValida(j) {
  if (!j || !Array.isArray(j.fattori) || !j.fattori.length) throw validazione('Il metodo deve avere almeno un fattore.');
  if (j.fattori.length > 4) throw validazione('Il metodo può avere al massimo 4 fattori.');
  let prodotti = [1];
  const codici = new Set();
  for (const f of j.fattori) {
    if (!f || !/^[A-Z]{1,3}$/.test(f.codice || '')) throw validazione('Codice del fattore non valido (da 1 a 3 lettere maiuscole): ' + (f && f.codice));
    if (codici.has(f.codice)) throw validazione('Il codice del fattore ' + f.codice + ' è ripetuto.');
    codici.add(f.codice);
    if (!testo(f.nome)) throw validazione('Ogni fattore deve avere un nome.');
    if (!Array.isArray(f.livelli) || f.livelli.length < 2 || f.livelli.length > 10) throw validazione('Il fattore ' + f.codice + ' deve avere da 2 a 10 livelli.');
    const nuovi = [];
    for (const l of f.livelli) {
      const n = Number(l && l[0]);
      if (!Number.isInteger(n) || n < 1 || n > 100) throw validazione('I livelli devono essere numeri interi positivi.');
      for (const p of prodotti) nuovi.push(p * n);
    }
    prodotti = [...new Set(nuovi)];
  }
  if (!Array.isArray(j.classi) || !j.classi.length) throw validazione('Definisci almeno una classe.');
  for (const c of j.classi) {
    if (!c || !testo(c.nome) || !Number.isFinite(Number(c.min)) || !Number.isFinite(Number(c.max)) || Number(c.min) > Number(c.max)) throw validazione('Ogni classe deve avere nome, minimo e massimo validi.');
    if (c.colore && !/^#[0-9a-fA-F]{6}$/.test(c.colore)) throw validazione('Il colore della classe ' + c.nome + ' non è valido.');
  }
  const scoperti = prodotti.filter(p => !j.classi.some(c => p >= Number(c.min) && p <= Number(c.max))).sort((a, b) => a - b);
  if (scoperti.length) throw validazione('Punteggi non coperti da alcuna classe: ' + scoperti.join(', '));
  return {
    fattori: j.fattori.map(f => ({ codice: f.codice, nome: testo(f.nome), livelli: f.livelli.map(l => [Number(l[0]), testo(l[1])]) })),
    classi: j.classi.map(c => ({ nome: testo(c.nome), min: Number(c.min), max: Number(c.max), colore: c.colore || '#718096', indicazione: testo(c.indicazione), riesameMesi: Number(c.riesameMesi) > 0 ? Number(c.riesameMesi) : 12 })),
  };
}

function metodoDi(ctx, registro) {
  const m = una(ctx, 'MetodiRischio', registro.metodoId);
  if (!m || !m.definizione) throw errore('Metodo di valutazione non configurato per il registro "' + registro.nome + '".');
  return { id: m.id, nome: m.nome, definizione: m.definizione };
}
// Il punteggio è il prodotto dei fattori; la classe è quella il cui intervallo lo contiene.
function valuta(metodo, valori) {
  const v = {};
  let p = 1;
  for (const f of metodo.definizione.fattori) {
    const x = Number((valori || {})[f.codice]);
    if (!f.livelli.some(l => Number(l[0]) === x)) throw validazione('Valore non valido per «' + f.nome + '».');
    v[f.codice] = x; p *= x;
  }
  const cl = metodo.definizione.classi.find(c => p >= c.min && p <= c.max) || { nome: 'n.d.', colore: '#718096', riesameMesi: 12 };
  return { metodoId: metodo.id, metodoNome: metodo.nome, metodo: metodo.definizione, valori: v, punteggio: p, classe: cl.nome,
    colore: cl.colore, indicazione: cl.indicazione || '', riesameMesi: cl.riesameMesi, data: eng().adesso() };
}
const haValori = (metodo, valori) => !!valori && metodo.definizione.fattori.every(f => valori[f.codice] !== undefined && valori[f.codice] !== '' && valori[f.codice] !== null);
const stessi = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const breveVal = v => (v ? v.punteggio + ' – ' + v.classe : '');

// Valori iniziali: i quattro metodi predefiniti e i registri.
function predefiniti(ctx) {
  const { nuovoId, adesso } = eng();
  if (ctx.st.tabella('MetodiRischio').size || ctx.st.tabella('RegistriRischio').size) return;
  const ids = {};
  for (const [k, p] of Object.entries(PRESET)) {
    ids[k] = nuovoId();
    ctx.st.metti('MetodiRischio', { id: ids[k], createdAt: adesso(), updatedAt: adesso(), createdBy: 'sistema', nome: p.nome, attivo: 'SI', definizione: p.definizione });
  }
  for (const r of REGISTRI_INIZIALI) {
    ctx.st.metti('RegistriRischio', { id: nuovoId(), createdAt: adesso(), updatedAt: adesso(), createdBy: 'sistema', codice: r.codice, nome: r.nome, prefisso: r.prefisso, tipo: r.tipo, metodoId: ids[r.preset], attivo: 'SI' });
  }
}

// ---------- registro ----------

function registro(ctx, id) {
  const r = una(ctx, 'RegistriRischio', id);
  if (!r) throw errore('Registro non valido.');
  return r;
}
function azioniDi(ctx, rischioId) {
  return tutte(ctx, 'Azioni').filter(a => a.rischioId === rischioId).sort((a, b) => String(a.dataPrevChiusura).localeCompare(String(b.dataPrevChiusura)));
}
function completa(ctx, r) {
  const pr = una(ctx, 'Processi', r.processoId);
  return { ...r, valIniziale: r.valIniziale || null, valResidua: r.valResidua || null, responsabile: nomeDip(una(ctx, 'Dipendenti', r.responsabileId)),
    processo: pr ? pr.codice + ' ' + pr.descrizione : '',
    azioni: azioniDi(ctx, r.id).map(a => ({ id: a.id, numero: a.numero, descrizione: a.descrizione, stato: a.stato, scadenza: a.dataPrevChiusura, dataChiusura: a.dataChiusura || '',
      responsabileId: a.responsabileId, responsabile: nomeDip(una(ctx, 'Dipendenti', a.responsabileId)), esitoEfficacia: a.esitoEfficacia || '' })) };
}

function salva(ctx, d) {
  const { nuovoId, adesso, oggi, registra } = eng();
  const cur = d.id ? una(ctx, 'Rischi', d.id) : null;
  if (d.id && !cur) throw errore('Voce non trovata.');
  const rg = registro(ctx, cur ? cur.registroId : d.registroId);
  if (!cur && rg.attivo !== 'SI') throw errore('Il registro non è attivo.');
  if (!testo(d.descrizione ?? (cur && cur.descrizione))) throw validazione('«Descrizione»: campo obbligatorio');
  for (const [k, e, etichetta] of [['processoId', 'Processi', 'Processo'], ['responsabileId', 'Dipendenti', 'Responsabile']]) {
    if (d[k] && !una(ctx, e, d[k])) throw validazione('«' + etichetta + '»: la scheda collegata non esiste più');
  }
  if (d.stato && !['Proposta', 'Attivo', 'Chiuso'].includes(d.stato)) throw validazione('«Stato»: valore non ammesso');
  if (d.prossimoRiesame && !/^\d{4}-\d{2}-\d{2}$/.test(d.prossimoRiesame)) throw validazione('«Prossimo riesame»: data non valida');
  const metodo = metodoDi(ctx, rg);
  const rec = { ...(cur || {}) };
  const pulito = v => { v = testo(v); return /^[=+\-@]/.test(v) ? "'" + v : v; };
  for (const k of ['descrizione', 'causa', 'effetto', 'fonte', 'trattamento', 'efficacia', 'note']) if (d[k] !== undefined || !cur) rec[k] = pulito(d[k]);
  for (const k of ['processoId', 'responsabileId']) if (d[k] !== undefined || !cur) rec[k] = d[k] || '';
  let cambiata = false;
  if (haValori(metodo, d.valori)) {
    const prec = cur && cur.valIniziale;
    if (!(prec && stessi(prec.valori, valuta(metodo, d.valori).valori) && prec.metodoId === metodo.id)) { rec.valIniziale = valuta(metodo, d.valori); cambiata = true; }
  }
  if (haValori(metodo, d.valoriResidui)) {
    const precR = cur && cur.valResidua;
    if (!(precR && stessi(precR.valori, valuta(metodo, d.valoriResidui).valori))) { rec.valResidua = valuta(metodo, d.valoriResidui); cambiata = true; }
  } else if (d.valoriResidui === null && rec.valResidua) { rec.valResidua = ''; cambiata = true; }
  const rif = rec.valResidua || rec.valIniziale;
  if (d.prossimoRiesame) rec.prossimoRiesame = d.prossimoRiesame;
  else if (cambiata || !rec.prossimoRiesame) rec.prossimoRiesame = rif ? reg().addMesi(oggi(), rif.riesameMesi || 12) : '';
  rec.updatedAt = adesso();
  if (cur) { if (d.stato) rec.stato = d.stato; }
  else {
    const pre = rg.prefisso + '-';
    const max = tutte(ctx, 'Rischi').filter(r => r.registroId === rg.id).reduce((m, r) => Math.max(m, parseInt(String(r.codice).slice(pre.length), 10) || 0), 0);
    Object.assign(rec, { id: nuovoId(), registroId: rg.id, codice: pre + String(max + 1).padStart(3, '0'), stato: d.stato || 'Attivo', createdAt: adesso(), createdBy: ctx.utente.email });
  }
  ctx.st.metti('Rischi', rec);
  registra(ctx, cur ? 'Modifica' : 'Inserimento', (rg.tipo === 'Opportunità' ? 'Opportunità ' : 'Rischio ') + rec.codice + ' – ' + rec.descrizione);
  return completa(ctx, rec);
}

// Dati del piano: metodo, voci attive, azioni.
function datiPiano(ctx, registroId) {
  const rg = registro(ctx, registroId);
  if (rg.attivo !== 'SI') throw errore('Il registro non è attivo.');
  const righe = tutte(ctx, 'Rischi').filter(r => r.registroId === rg.id && r.stato === 'Attivo').sort((a, b) => a.codice.localeCompare(b.codice)).map(r => completa(ctx, r));
  if (!righe.length) throw errore('Nessuna voce attiva nel registro.');
  return { registro: rg, metodo: metodoDi(ctx, rg), righe };
}

// ---------- installazione nelle regole ----------

function installa(R) {
  const F = R.FUNZIONI;

  R.CALC.MetodiRischio = {
    riepilogo: (ctx, m) => (m.definizione ? m.definizione.fattori.map(f => f.codice + ' (' + f.livelli.length + ' livelli)').join(' × ') + ' – ' + m.definizione.classi.map(c => c.nome).join(', ') : ''),
  };
  R.CALC.Rischi = {
    valutazione: (ctx, r) => breveVal(r.valIniziale),
    residua: (ctx, r) => breveVal(r.valResidua),
    nAzioni: (ctx, r) => { const a = azioniDi(ctx, r.id); return a.length ? a.filter(x => x.stato !== 'Chiusa').length + ' aperte su ' + a.length : ''; },
  };
  // Metodi e voci dei registri si salvano solo dalle pagine dedicate (servono i controlli sulla valutazione).
  const soloPagina = { before(ctx) { if (!ctx.interno) throw errore('Questa scheda si modifica dalla pagina "Rischi e opportunità".'); } };
  R.HOOKS.MetodiRischio = soloPagina;
  R.HOOKS.Rischi = soloPagina;
  R.HOOKS.RegistriRischio = { before(ctx, { riga }) {
    riga.prefisso = String(riga.prefisso).toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(riga.prefisso)) throw validazione('«Prefisso dei codici»: da 1 a 6 lettere o numeri, senza spazi');
    const m = una(ctx, 'MetodiRischio', riga.metodoId);
    if (m && m.attivo !== 'SI') throw validazione('«Metodo di valutazione»: il metodo scelto non è attivo');
  } };

  // Azioni: comuni a non conformità e rischi. Quelle nate da un rischio richiedono responsabile e scadenza.
  R.HOOKS.Azioni = {
    before(ctx, { riga }) {
      if (riga.stato === 'Chiusa' && !riga.dataChiusura) riga.dataChiusura = eng().oggi();
      if (riga.rischioId && (!riga.responsabileId || !riga.dataPrevChiusura)) throw validazione('Per le azioni collegate a un rischio o a un\'opportunità servono il responsabile e la data prevista di chiusura');
    },
    // Avviso via e-mail al responsabile quando gli viene assegnata un'azione.
    after(ctx, { riga, vecchia }) {
      if (ctx.interno || !riga.responsabileId || (vecchia && vecchia.responsabileId === riga.responsabileId) || riga.responsabileId === ctx.utente.id) return;
      const d = una(ctx, 'Dipendenti', riga.responsabileId), postino = ctx.servizi && ctx.servizi.postino;
      const origine = una(ctx, 'Rischi', riga.rischioId) || una(ctx, 'NC', riga.ncId);
      if (d && d.email && postino) postino.invia({ a: d.email, oggetto: 'Azione assegnata' + (origine ? ' (' + (origine.codice || origine.numero) + ')' : '') + ' – ' + ctx.azienda.nome,
        testo: 'Ti è stata assegnata l\'azione ' + riga.numero + ':\n\n' + riga.descrizione + '\n\n' + (riga.dataPrevChiusura ? 'Scadenza: ' + eng().dataIt(riga.dataPrevChiusura) + '\n' : '') + 'Accedi al gestionale per i dettagli.' }).catch(() => {});
    },
  };

  F['rischi.metodi'] = { entita: 'MetodiRischio', fn(ctx) {
    return { metodi: tutte(ctx, 'MetodiRischio').map(m => ({ id: m.id, nome: m.nome, definizione: m.definizione, attivo: m.attivo === 'SI' })).sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
      registri: tutte(ctx, 'RegistriRischio').map(r => ({ id: r.id, codice: r.codice, nome: r.nome, prefisso: r.prefisso, tipo: r.tipo, metodoId: r.metodoId, attivo: r.attivo === 'SI' })).sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
      preset: PRESET };
  } };

  F['rischi.metodoSalva'] = { entita: 'MetodiRischio', scrive: true, fn(ctx, p) {
    const { nuovoId, adesso, registra } = eng();
    if (!testo(p.nomeMetodo)) throw validazione('«Nome del metodo»: campo obbligatorio');
    let j = p.definizione;
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { j = null; } }
    const definizione = definizioneValida(j);
    const cur = p.id ? una(ctx, 'MetodiRischio', p.id) : null;
    if (p.id && !cur) throw errore('Metodo non trovato.');
    const rec = { ...(cur || { id: nuovoId(), createdAt: adesso(), createdBy: ctx.utente.email }), nome: testo(p.nomeMetodo), definizione, attivo: p.attivo === false ? 'NO' : 'SI', updatedAt: adesso() };
    if (rec.attivo === 'NO' && tutte(ctx, 'RegistriRischio').some(r => r.metodoId === rec.id && r.attivo === 'SI')) throw errore('Il metodo è usato da un registro attivo: assegna prima un altro metodo al registro.');
    ctx.st.metti('MetodiRischio', rec);
    registra(ctx, cur ? 'Modifica' : 'Inserimento', 'Metodo di valutazione: ' + rec.nome + (cur ? ' (le valutazioni esistenti conservano la definizione precedente)' : ''));
    return F['rischi.metodi'].fn(ctx);
  } };

  F['rischi.elenco'] = { entita: 'Rischi', fn(ctx, p) {
    const rg = registro(ctx, p.registroId);
    return { registro: { id: rg.id, codice: rg.codice, nome: rg.nome, tipo: rg.tipo, prefisso: rg.prefisso, attivo: rg.attivo === 'SI' }, metodo: metodoDi(ctx, rg), puoScrivere: eng().puoScrivere(ctx, 'Rischi'),
      righe: tutte(ctx, 'Rischi').filter(r => r.registroId === rg.id && (p.chiusi || r.stato !== 'Chiuso')).sort((a, b) => a.codice.localeCompare(b.codice)).map(r => completa(ctx, r)) };
  } };

  F['rischi.salva'] = { entita: 'Rischi', scrive: true, fn: (ctx, p) => salva(ctx, p) };

  // Conferma delle voci proposte: devono essere già valutate.
  F['rischi.conferma'] = { entita: 'Rischi', scrive: true, fn(ctx, p) {
    let n = 0;
    for (const id of Array.isArray(p.ids) ? p.ids : []) {
      const r = una(ctx, 'Rischi', id);
      if (!r || r.stato !== 'Proposta') continue;
      if (!r.valIniziale) throw errore('Valuta la voce ' + r.codice + ' prima di confermarla.');
      ctx.st.metti('Rischi', { ...r, stato: 'Attivo', updatedAt: eng().adesso() }); n++;
    }
    eng().registra(ctx, 'Rischi', n + ' voci confermate');
    return { confermate: n };
  } };

  // Una proposta si scarta; una voce attiva si chiude indicando il motivo (resta nello storico).
  F['rischi.elimina'] = { entita: 'Rischi', scrive: true, fn(ctx, p) {
    const { registra, dataIt, oggi, adesso } = eng();
    const r = una(ctx, 'Rischi', p.id);
    if (!r) throw errore('Voce non trovata.');
    if (r.stato === 'Proposta') {
      if (azioniDi(ctx, r.id).length) throw errore('La proposta ha azioni collegate: eliminale prima di scartarla.');
      ctx.st.togli('Rischi', r.id); registra(ctx, 'Eliminazione', 'Proposta scartata: ' + r.codice);
      return { scartata: true };
    }
    if (!testo(p.motivo)) throw errore('Indica il motivo della chiusura.');
    ctx.st.metti('Rischi', { ...r, stato: 'Chiuso', updatedAt: adesso(), note: (r.note ? r.note + '\n' : '') + 'Chiuso il ' + dataIt(oggi()) + ': ' + testo(p.motivo) });
    registra(ctx, 'Rischi', 'Chiusa la voce ' + r.codice + ': ' + testo(p.motivo));
    return { chiusa: true };
  } };

  // Piano di gestione: documento controllato generato dal registro (PDF allegato a un documento in bozza o a una nuova revisione).
  F['rischi.piano'] = { entita: 'Rischi', scrive: true, async fn(ctx, p) {
    const dati = datiPiano(ctx, p.registroId);
    if (!eng().entitaAttiva(ctx, 'Documenti')) throw errore('Per creare il documento controllato serve il pacchetto Documentazione. In alternativa usa la stampa "Piano di gestione".', 'PACCHETTO');
    const pdf = await require('./stampe').genera(ctx, { nome: 'pianoRischi', registroId: p.registroId });
    const codice = 'PIANO-' + dati.registro.prefisso;
    const docs = tutte(ctx, 'Documenti').filter(d => String(d.codice).toLowerCase() === codice.toLowerCase());
    let bozza = docs.find(d => d.stato === 'Bozza' || d.stato === 'In approvazione');
    if (bozza && require('./firme').haFirme(ctx.st, 'Documenti', bozza.id)) throw errore('Il piano è in approvazione: completa o annulla le firme prima di aggiornarlo.');
    const file = await ctx.servizi.salvaFile({ nome: pdf.nome, mime: 'application/pdf', buffer: pdf.buffer, tipo: 'piano' });
    const descr = 'Aggiornamento del registro al ' + eng().dataIt(eng().oggi());
    if (!bozza) {
      const vigente = docs.find(d => d.stato === 'In vigore');
      if (vigente) bozza = R.FUNZIONI['documenti.nuovaRevisione'].fn(ctx, { id: vigente.id }).riga;
    }
    const out = bozza
      ? eng().salva(ctx, 'Documenti', { id: bozza.id, file, link: '', dataRevisione: eng().oggi(), descrizioneModifica: descr })
      : eng().salva(ctx, 'Documenti', { codice, titolo: 'Piano di gestione – ' + dati.registro.nome, tipologia: 'Piano', redattoDa: ctx.utente.id, approvatoDa: p.approvatoDa || ctx.utente.id,
        file, presaVisione: 'Nessuna', modalitaRevisione: 'Prima emissione', descrizioneModifica: 'Generato dal registro «' + dati.registro.nome + '»', riesameMesi: 12 });
    eng().registra(ctx, 'Rischi', 'Piano di gestione generato: ' + codice + ' rev. ' + out.riga.revisione);
    return { documentoId: out.riga.id, codice, revisione: out.riga.revisione, stato: out.riga.stato };
  } };

  // ---------- azioni: completamento e verifica dell'efficacia ----------

  const azione = (ctx, id) => { const a = una(ctx, 'Azioni', id); if (!a) throw errore('Azione non trovata.'); return a; };

  F['azioni.mie'] = { entita: 'Azioni', fn(ctx) {
    return tutte(ctx, 'Azioni').filter(a => a.responsabileId === ctx.utente.id && a.stato !== 'Chiusa').sort((a, b) => String(a.dataPrevChiusura).localeCompare(String(b.dataPrevChiusura)))
      .map(a => { const o = una(ctx, 'Rischi', a.rischioId) || una(ctx, 'NC', a.ncId); return { id: a.id, numero: a.numero, descrizione: a.descrizione, stato: a.stato, scadenza: a.dataPrevChiusura, origine: o ? (o.codice || o.numero) : '' }; });
  } };

  F['azioni.completa'] = { entita: 'Azioni', scrive: true, fn(ctx, p) {
    const a = azione(ctx, p.id);
    if (a.responsabileId !== ctx.utente.id && !ctx.utente.admin) throw errore('Solo il responsabile può completare l\'azione.', 'PERMESSO');
    if (a.stato === 'Chiusa') throw errore('L\'azione è già stata completata.');
    if (!testo(p.note)) throw errore('Descrivi cosa è stato fatto.');
    ctx.st.metti('Azioni', { ...a, stato: 'Chiusa', dataChiusura: eng().oggi(), noteEsecuzione: testo(p.note), esitoEfficacia: '', updatedAt: eng().adesso() });
    eng().registra(ctx, 'Azione completata', a.numero + ' – ' + a.descrizione);
    return eng().leggi(ctx, 'Azioni', a.id);
  } };

  // Efficace: l'azione resta chiusa e verificata. Non efficace: l'azione viene riaperta.
  F['azioni.verifica'] = { entita: 'Azioni', scrive: true, fn(ctx, p) {
    if (!ctx.utente.admin) throw errore('La verifica dell\'efficacia è riservata agli amministratori.', 'PERMESSO');
    const a = azione(ctx, p.id);
    if (a.stato !== 'Chiusa') throw errore('Si può verificare solo un\'azione completata.');
    if (!['Efficace', 'Non efficace'].includes(p.esito)) throw errore('Esito non valido.');
    if (!testo(p.note)) throw errore('Descrivi le evidenze della verifica di efficacia.');
    const base = { ...a, esitoEfficacia: p.esito, effValutazione: testo(p.note), effData: eng().oggi(), effValutatoreId: ctx.utente.id, updatedAt: eng().adesso() };
    ctx.st.metti('Azioni', p.esito === 'Efficace' ? base : { ...base, stato: 'Aperta', dataChiusura: '' });
    eng().registra(ctx, 'Verifica efficacia', a.numero + ': ' + p.esito + ' – ' + testo(p.note));
    return eng().leggi(ctx, 'Azioni', a.id);
  } };
}

module.exports = { installa, predefiniti, datiPiano, definizioneValida, valuta, PRESET };
