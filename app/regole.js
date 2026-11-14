'use strict';
// Regole di dominio: ganci del salvataggio (HOOKS), campi calcolati (CALC),
// proposte per le maschere (AZIONI) e funzioni di pagina (FUNZIONI).

const { classe, cessato, contaAttivi, messaggioLimite } = require('./licenza');

function eng() { return require('./engine'); }
function errore(msg, codice) { const { ErroreUtente } = eng(); return new ErroreUtente(msg, codice); }
const validazione = msg => errore('Controlla i dati inseriti:\n• ' + msg, 'VALIDAZIONE');

// ---------- utilità ----------

const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
const lista = v => String(v || '').split(',').filter(Boolean);
const arrot = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

function addGiorni(iso, n) { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function addMesi(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + Number(n), 1));
  const ultimo = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, ultimo));
  return t.toISOString().slice(0, 10);
}
function addUnita(iso, n, unita) {
  if (unita === 'Giorni') return addGiorni(iso, n);
  if (unita === 'Settimane') return addGiorni(iso, n * 7);
  return addMesi(iso, unita === 'Anni' ? n * 12 : n);
}
// Regolare / In scadenza (entro 30 giorni) / Scaduta rispetto a oggi.
function statoScadenza(data, og, giorni = 30) {
  if (!data) return '';
  return data < og ? 'Scaduta' : data <= addGiorni(og, giorni) ? 'In scadenza' : 'Regolare';
}

const tutte = (ctx, e) => [...ctx.st.tabella(e).values()];
const una = (ctx, e, id) => (id ? ctx.st.tabella(e).get(id) : undefined);
function figli(ctx, e, fk, id) { return tutte(ctx, e).filter(r => r[fk] === id).sort((a, b) => (a._ord || 0) - (b._ord || 0)); }
const attivo = (ctx, pack) => ctx.pacchetti.has(pack);
const SCHEMA_PACK = e => require('./schema').SCHEMA[e].pack;
const nomeDip = d => (d ? (d.cognome + ' ' + d.nome).trim() : '');

// ---------- dipendenti ----------

function mansioniDi(d) { return [...new Set([d.mansioneId, ...lista(d.mansioniAgg)].filter(Boolean))]; }
const INTERINALE = 'Interinale (somministrazione)', DIRETTO = 'Dipendente diretto';

// Lo storico dei rapporti di lavoro si aggiorna da solo: apertura e chiusura di missioni e assunzioni.
function sincronizzaRapporti(ctx, d) {
  const { nuovoId, adesso } = eng();
  const rap = figli(ctx, 'RapportiLavoro', 'dipendenteId', d.id);
  const allinea = (tipo, dal, dati) => {
    if (!dal) return;
    const r = rap.find(x => x.tipo === tipo && x.dal === dal);
    const nuova = { ...(r || { id: nuovoId(), createdAt: adesso(), dipendenteId: d.id, _ord: rap.length + 1, note: '' }), tipo, dal, ...dati, updatedAt: adesso() };
    if (!r || Object.keys(dati).some(k => r[k] !== dati[k])) ctx.st.metti('RapportiLavoro', nuova);
  };
  if (d.tipoRapporto === INTERINALE) allinea(INTERINALE, d.inizioMissione, { agenziaId: d.agenziaId || '', al: d.fineMissione || '', contratto: d.contratto || '', rifContratto: d.rifContratto || '' });
  else allinea(DIRETTO, d.dataAssunzione, { agenziaId: '', al: d.dataLicenziamento || '', contratto: d.contratto || '', rifContratto: '' });
}

// ---------- formazione ----------

// Scadenza della formazione per dipendente e tipologia, scorrendo i corsi in ordine di data di fine.
function statoFormazione(ctx, dipId, tipoId) {
  const tipo = una(ctx, 'TipiCorso', tipoId) || {};
  const prevede = tipo.aggiornamento === 'SI' && num(tipo.frequenzaMesi) > 0;
  const freq = num(tipo.frequenzaMesi) || 0, richieste = num(tipo.durataAggOre) || 0;
  const svolti = [];
  for (const p of tutte(ctx, 'CorsiPartecipanti')) {
    if (p.dipendenteId !== dipId) continue;
    const c = una(ctx, 'Corsi', p.corsoId);
    if (c && c.tipoCorsoId === tipoId) svolti.push({ c, ore: num(p.ore) ?? num(c.durataOre) ?? 0 });
  }
  svolti.sort((a, b) => a.c.dataFine.localeCompare(b.c.dataFine));
  let scadenza = '', accumulo = 0, ultimo = '';
  for (const { c, ore } of svolti) {
    ultimo = c.dataFine;
    if (c.modalita !== 'Aggiornamento') { scadenza = prevede ? addMesi(c.dataFine, freq) : ''; accumulo = 0; continue; }
    accumulo += ore;
    if (accumulo >= richieste) {
      if (prevede) scadenza = (tipo.decorrenza !== 'Dalla data di completamento' && scadenza && c.dataFine <= scadenza) ? addMesi(scadenza, freq) : addMesi(c.dataFine, freq);
      accumulo = 0;
    }
  }
  const og = eng().oggi();
  let stato = !svolti.length ? 'Mai svolta' : !scadenza ? 'Svolta' : statoScadenza(scadenza, og);
  const parziale = accumulo > 0 ? 'parziale ' + accumulo + '/' + richieste + ' h' : '';
  return { svolta: svolti.length > 0, ultimo, scadenza, stato, parziale, tipo: tipo.tipo || '' };
}

// Una tipologia collegata ad almeno una mansione è richiesta solo a chi ha una di quelle mansioni;
// una tipologia non collegata a nessuna mansione è richiesta a tutti.
function formazioneRichiesta(ctx, d) {
  const mie = new Set(mansioniDi(d));
  const perTipo = new Map();
  for (const mc of tutte(ctx, 'MansioniCorsi')) {
    if (!perTipo.has(mc.tipoCorsoId)) perTipo.set(mc.tipoCorsoId, new Set());
    perTipo.get(mc.tipoCorsoId).add(mc.mansioneId);
  }
  return tutte(ctx, 'TipiCorso').filter(t => { const m = perTipo.get(t.id); return !m || [...m].some(x => mie.has(x)); });
}

// ---------- fornitori ----------

function esitoQualifica(ctx, q) {
  if (q.importata === 'SI') return { media: num(q.mediaImportata), esito: q.esitoImportato || 'Da valutare' };
  const voti = figli(ctx, 'QualificheRighe', 'qualificaId', q.id).filter(r => r.voto !== '' && r.voto !== undefined).map(r => Number(r.voto)).filter(v => Number.isFinite(v));
  if (!voti.length) return { media: null, esito: 'Da valutare' };
  const media = voti.reduce((a, b) => a + b, 0) / voti.length;
  const soglia = Number(eng().config(ctx.st).sogliaQualifica) || 0;
  return { media, esito: media > soglia ? 'Qualificato' : 'Non qualificato' };
}
function ultimaQualifica(ctx, soggId) {
  const q = tutte(ctx, 'QualificheFornitori').filter(x => x.soggettoId === soggId).sort((a, b) => b.data.localeCompare(a.data))[0];
  return q ? { q, ...esitoQualifica(ctx, q) } : null;
}
const fmtMedia = m => (m === null || m === undefined || Number.isNaN(m) ? '' : m.toFixed(2).replace('.', ','));

// ---------- strumenti e tarature ----------

function puntoTaratura(ctx, r, tar) {
  const str = una(ctx, 'Strumenti', tar && tar.strumentoId);
  const toll = num(r.ema) ?? num(str && str.ema);
  const scarto = arrot(Number(r.valoreStrumento) - Number(r.valoreCampione));
  if (toll === null) return { scarto, esito: 'Tolleranza mancante' };
  const a = Math.abs(scarto), eps = 1e-9;
  return { scarto, esito: a < toll - eps ? 'Conforme' : a <= toll + eps ? 'Al limite' : 'Non conforme' };
}
function esitoTaratura(ctx, t) {
  const punti = figli(ctx, 'TaratureRighe', 'taraturaId', t.id).map(r => puntoTaratura(ctx, r, t).esito);
  if (!punti.length) return t.esitoDichiarato || '';
  if (punti.includes('Non conforme')) return 'Non conforme';
  if (punti.includes('Al limite') || punti.includes('Tolleranza mancante')) return 'Conforme con avviso';
  return 'Conforme';
}
// Stato di taratura di uno strumento a una certa data (predefinita: oggi).
function statoStrumento(ctx, s, allaData) {
  const data = allaData || eng().oggi();
  const t = tutte(ctx, 'Tarature').filter(x => x.strumentoId === s.id && x.data <= data).sort((a, b) => b.data.localeCompare(a.data))[0];
  if (!t) return { stato: 'Mai tarato', ultima: '', esito: '', scadenza: '' };
  const esito = esitoTaratura(ctx, t);
  const scadenza = num(s.frequenzaMesi) ? addMesi(t.data, num(s.frequenzaMesi)) : '';
  const stato = esito === 'Non conforme' ? 'Non conforme' : scadenza && scadenza < data ? 'Scaduta' : esito === 'Conforme con avviso' ? 'Valida con avviso' : 'Valida';
  return { stato, ultima: t.data, esito, scadenza };
}

// ---------- attrezzature e manutenzioni ----------

function statoAttivita(a, og) {
  if (!a.ultimaEsecuzione) return { prossima: '', stato: 'Mai eseguita' };
  const prossima = addUnita(a.ultimaEsecuzione, num(a.frequenza) || 1, a.unita);
  return { prossima, stato: statoScadenza(prossima, og) };
}
// "Ultima esecuzione" di ogni attività = data più recente tra le manutenzioni che l'hanno eseguita.
function ricalcolaAttivita(ctx, attrId) {
  if (!attrId) return;
  const ultime = {};
  for (const m of tutte(ctx, 'Manutenzioni')) {
    if (m.attrezzaturaId !== attrId) continue;
    for (const r of figli(ctx, 'ManutenzioniRighe', 'manutenzioneId', m.id)) {
      if (r.eseguita === 'SI' && (!ultime[r.attivitaId] || ultime[r.attivitaId] < m.data)) ultime[r.attivitaId] = m.data;
    }
  }
  for (const a of figli(ctx, 'AttrezzatureAttivita', 'attrezzaturaId', attrId)) {
    const nuova = ultime[a.id] || '';
    if ((a.ultimaEsecuzione || '') !== nuova) ctx.st.metti('AttrezzatureAttivita', { ...a, ultimaEsecuzione: nuova });
  }
}
function attivitaInScadenza(ctx, sedeId, giorni) {
  const og = eng().oggi();
  const out = [];
  for (const at of tutte(ctx, 'Attrezzature')) {
    if (at.stato !== 'In uso' || (sedeId && at.sedeId !== sedeId)) continue;
    const att = figli(ctx, 'AttrezzatureAttivita', 'attrezzaturaId', at.id).filter(a => a.attiva === 'SI')
      .map(a => ({ id: a.id, attivita: a.attivita, ultimaEsecuzione: a.ultimaEsecuzione || '', ...statoAttivita(a, og) }))
      .filter(a => a.stato === 'Mai eseguita' || a.prossima <= addGiorni(og, giorni));
    if (att.length) out.push({ attrezzaturaId: at.id, codice: at.codice, descrizione: at.descrizione, sedeId: at.sedeId, attivita: att });
  }
  return out.sort((a, b) => a.codice.localeCompare(b.codice, 'it'));
}

// ---------- sorveglianza sanitaria ----------

const MESI_PERIODICITA = { Semestrale: 6, Annuale: 12, Biennale: 24, Triennale: 36, Quinquennale: 60 };
function ultimaVisita(ctx, dipId) {
  return tutte(ctx, 'SorveglianzaSanitaria').filter(v => v.dipendenteId === dipId).sort((a, b) => b.dataVisita.localeCompare(a.dataVisita))[0];
}
function statoSanitario(ctx, dipId) {
  const v = ultimaVisita(ctx, dipId), og = eng().oggi();
  if (!v) return { stato: 'Visita mancante' };
  const base = { visitaId: v.id, dataVisita: v.dataVisita, giudizio: v.giudizio, prossimaVisita: v.prossimaVisita || '',
    inidoneitaFino: v.giudizio === 'Temporaneamente non idoneo' ? (v.inidoneitaFino || '') : '' };
  return { ...base, stato: v.prossimaVisita ? statoScadenza(v.prossimaVisita, og) : 'Data mancante' };
}
// Lavoratori soggetti: quelli con mansioni "soggette"; se nessuna mansione è marcata, chi ha almeno una visita.
function lavoratoriSoggetti(ctx) {
  const og = eng().oggi();
  const soggette = new Set(tutte(ctx, 'Mansioni').filter(m => m.sorveglianza === 'SI').map(m => m.id));
  const attivi = tutte(ctx, 'Dipendenti').filter(d => !cessato(d, og));
  if (soggette.size) return attivi.filter(d => mansioniDi(d).some(m => soggette.has(m)));
  const conVisita = new Set(tutte(ctx, 'SorveglianzaSanitaria').map(v => v.dipendenteId));
  return attivi.filter(d => conVisita.has(d.id));
}

// =====================================================================================
// GANCI DEL SALVATAGGIO
// =====================================================================================

const HOOKS = {
  Dipendenti: {
    before(ctx, { riga, vecchia }) {
      const og = eng().oggi();
      if (riga.cf) {
        riga.cf = String(riga.cf).toUpperCase().replace(/\s/g, '');
        if (!/^[A-Z0-9]{16}$/.test(riga.cf) && !/^\d{11}$/.test(riga.cf)) throw validazione('«Codice fiscale»: deve avere 16 caratteri (lettere e numeri) oppure 11 cifre');
      }
      if (riga.utente === 'SI' && !riga.email) throw validazione('«E-mail»: obbligatoria per gli utenti del sistema (serve per ricevere il codice di accesso)');
      if (riga.tipoRapporto === INTERINALE && riga.inizioMissione && riga.fineMissione && riga.fineMissione < riga.inizioMissione) throw validazione('«Fine missione prevista»: non può precedere l\'inizio della missione');
      // Licenza: un nuovo addetto attivo (o un cessato che torna attivo) non può superare il limite della classe.
      const eraAttivo = !!vecchia && !cessato(vecchia, og);
      if (!cessato(riga, og) && !eraAttivo) {
        const c = classe(ctx.azienda.classe);
        if (contaAttivi(ctx.st, og) >= c.max) throw errore(messaggioLimite(c), 'LICENZA');
      }
    },
    after(ctx, { riga }) {
      sincronizzaRapporti(ctx, riga);
      if (attivo(ctx, 'documenti')) require('./documenti').allineaDipendente(ctx, riga);
    },
  },

  Corsi: {
    before(ctx, { riga }) {
      const tipo = una(ctx, 'TipiCorso', riga.tipoCorsoId);
      if (riga.modalita === 'Aggiornamento' && (!tipo || tipo.aggiornamento !== 'SI')) throw validazione('«Formazione iniziale o aggiornamento»: questa tipologia di corso non prevede aggiornamento');
      if (riga.dataFine < riga.dataInizio) throw validazione('«Data fine»: non può precedere la data di inizio');
    },
  },

  ValutazioniCompetenze: {
    // Per ogni competenza valutata indica quali mansioni la richiedono e, se manca, il valore atteso più alto.
    before(ctx, { riga, figli: f }) {
      if (!f.ValutazioniRighe) return;
      const mans = new Set(lista(riga.mansioneId));
      const richieste = tutte(ctx, 'MansioniCompetenze').filter(mc => mans.has(mc.mansioneId));
      for (const r of f.ValutazioniRighe) {
        const mie = richieste.filter(mc => mc.competenzaId === r.competenzaId);
        r.mansioniRif = [...new Set(mie.map(mc => mc.mansioneId))].join(',');
        if (!r.valoreAtteso && mie.length) r.valoreAtteso = String(Math.max(...mie.map(mc => Number(mc.valoreAtteso) || 0)));
      }
    },
  },

  Azioni: {
    before(ctx, { riga }) {
      if (riga.stato === 'Chiusa' && !riga.dataChiusura) riga.dataChiusura = eng().oggi();
    },
  },

  Tarature: {
    before(ctx, { riga }) {
      const str = una(ctx, 'Strumenti', riga.strumentoId);
      if (riga.tipo === 'Interna') {
        const camp = una(ctx, 'Strumenti', riga.campioneId);
        if (!camp || camp.campione !== 'SI') throw validazione('«Campione utilizzato»: lo strumento scelto non è marcato come campione di riferimento');
        if (riga.campioneId === riga.strumentoId) throw validazione('«Campione utilizzato»: uno strumento non può essere tarato con sé stesso');
      } else { riga.campioneId = ''; riga.eseguitaDaId = ''; }
      if (str && str.stato === 'Dismesso') throw validazione('«Strumento tarato»: lo strumento è dismesso');
    },
  },

  Manutenzioni: {
    before(ctx, { riga, figli: f }) {
      if (riga.esecutoreTipo === 'Interno') { riga.esecutoreSoggId = ''; riga.esecutoreNome = ''; } else riga.esecutoreDipId = '';
      if (!riga.responsabileId) { const at = una(ctx, 'Attrezzature', riga.attrezzaturaId); const sede = at && una(ctx, 'Sedi', at.sedeId); if (sede) riga.responsabileId = sede.responsabileId || ''; }
      for (const r of f.ManutenzioniRighe || []) {
        const a = una(ctx, 'AttrezzatureAttivita', r.attivitaId);
        if (!a || a.attrezzaturaId !== riga.attrezzaturaId) throw validazione('Attività eseguite: un\'attività non appartiene all\'attrezzatura scelta');
      }
    },
    after(ctx, { riga, vecchia }) {
      ricalcolaAttivita(ctx, riga.attrezzaturaId);
      if (vecchia && vecchia.attrezzaturaId !== riga.attrezzaturaId) ricalcolaAttivita(ctx, vecchia.attrezzaturaId);
    },
    dopoEliminazione(ctx, { riga }) { ricalcolaAttivita(ctx, riga.attrezzaturaId); },
  },

  SorveglianzaSanitaria: {
    // Prossima visita = data della visita + periodicità − 1 giorno (resta modificabile).
    before(ctx, { riga }) {
      if (riga.giudizio !== 'Temporaneamente non idoneo') riga.inidoneitaFino = '';
      if (riga.prossimaVisita) return;
      const mesi = riga.periodicita === 'Altra (indicare i mesi)' ? num(riga.periodicitaMesi) : MESI_PERIODICITA[riga.periodicita];
      if (!mesi || mesi <= 0) throw validazione('«Periodicità (mesi)»: indica ogni quanti mesi va ripetuta la visita');
      riga.prossimaVisita = addGiorni(addMesi(riga.dataVisita, mesi), -1);
    },
  },
};

// =====================================================================================
// CAMPI CALCOLATI
// =====================================================================================

const CALC = {
  Dipendenti: {
    stato: (ctx, r) => (cessato(r, eng().oggi()) ? 'Cessato' : 'Attivo'),
    inAziendaDal: (ctx, r) => {
      const date = [r.dataAssunzione, r.inizioMissione, ...figli(ctx, 'RapportiLavoro', 'dipendenteId', r.id).map(x => x.dal)].filter(Boolean).sort();
      return eng().dataIt(date[0] || '');
    },
    pinImpostato: (ctx, r) => (r.pinHash ? 'SI' : 'NO'),
  },
  Corsi: { nPartecipanti: (ctx, r) => String(figli(ctx, 'CorsiPartecipanti', 'corsoId', r.id).length) },
  CorsiPartecipanti: {
    scadenza: (ctx, r) => { const c = una(ctx, 'Corsi', r.corsoId); return c ? statoFormazione(ctx, r.dipendenteId, c.tipoCorsoId).scadenza : ''; },
  },
  ValutazioniCompetenze: {
    copertura: (ctx, r) => {
      const rr = figli(ctx, 'ValutazioniRighe', 'valutazioneId', r.id).filter(x => x.valoreAtteso);
      if (!rr.length) return '';
      const ok = rr.filter(x => Number(x.valoreReale) >= Number(x.valoreAtteso)).length;
      return Math.round(ok * 100 / rr.length) + '% (' + ok + '/' + rr.length + ')';
    },
  },
  NC: {
    costoTotale: (ctx, r) => arrot(figli(ctx, 'NcCosti', 'ncId', r.id).reduce((s, c) => s + (num(c.quantita) ?? 1) * (num(c.costo) || 0), 0), 2).toFixed(2).replace('.', ','),
  },
  NcCosti: { totale: (ctx, r) => arrot((num(r.quantita) ?? 1) * (num(r.costo) || 0), 2).toFixed(2).replace('.', ',') },
  Soggetti: {
    qualifica: (ctx, r) => { if (r.fornitore !== 'SI' || !attivo(ctx, 'fornitori')) return ''; const u = ultimaQualifica(ctx, r.id); return u ? u.esito : 'Da valutare'; },
    mediaQualifica: (ctx, r) => { const u = attivo(ctx, 'fornitori') && ultimaQualifica(ctx, r.id); return u ? fmtMedia(u.media) : ''; },
    dataQualifica: (ctx, r) => { const u = attivo(ctx, 'fornitori') && ultimaQualifica(ctx, r.id); return u ? u.q.data : ''; },
  },
  QualificheFornitori: {
    media: (ctx, r) => fmtMedia(esitoQualifica(ctx, r).media),
    esito: (ctx, r) => esitoQualifica(ctx, r).esito,
  },
  Strumenti: {
    ultimaTaratura: (ctx, r) => statoStrumento(ctx, r).ultima,
    esitoTaratura: (ctx, r) => statoStrumento(ctx, r).esito,
    scadenza: (ctx, r) => statoStrumento(ctx, r).scadenza,
    statoTaratura: (ctx, r) => statoStrumento(ctx, r).stato,
  },
  Tarature: {
    scadenza: (ctx, r) => { const s = una(ctx, 'Strumenti', r.strumentoId); return s && num(s.frequenzaMesi) ? addMesi(r.data, num(s.frequenzaMesi)) : ''; },
    esito: (ctx, r) => esitoTaratura(ctx, r),
    campioneInfo: (ctx, r) => {
      const c = una(ctx, 'Strumenti', r.campioneId);
      if (!c) return '';
      const s = statoStrumento(ctx, c, r.data);
      return s.stato + (s.scadenza ? ' (scadenza ' + eng().dataIt(s.scadenza) + ')' : '');
    },
  },
  TaratureRighe: {
    scarto: (ctx, r) => String(puntoTaratura(ctx, r, una(ctx, 'Tarature', r.taraturaId)).scarto).replace('.', ','),
    esitoPunto: (ctx, r) => puntoTaratura(ctx, r, una(ctx, 'Tarature', r.taraturaId)).esito,
  },
  Attrezzature: {
    responsabile: (ctx, r) => { const s = una(ctx, 'Sedi', r.sedeId); return s ? nomeDip(una(ctx, 'Dipendenti', s.responsabileId)) : ''; },
    prossimaScadenza: (ctx, r) => {
      const og = eng().oggi();
      const st = figli(ctx, 'AttrezzatureAttivita', 'attrezzaturaId', r.id).filter(a => a.attiva === 'SI').map(a => statoAttivita(a, og));
      if (!st.length) return '';
      if (st.some(s => s.stato === 'Mai eseguita')) return 'Mai eseguita';
      const p = st.map(s => s.prossima).sort()[0];
      return eng().dataIt(p) + ' – ' + statoScadenza(p, og);
    },
  },
  AttrezzatureAttivita: { prossima: (ctx, r) => statoAttivita(r, eng().oggi()).prossima },
  SorveglianzaSanitaria: {
    statoVisita: (ctx, r) => {
      const u = ultimaVisita(ctx, r.dipendenteId);
      if (u && u.id !== r.id) return 'Superata da una visita successiva';
      return r.prossimaVisita ? statoScadenza(r.prossimaVisita, eng().oggi()) : 'Data mancante';
    },
  },
};

// =====================================================================================
// PROPOSTE PER LE MASCHERE (sola lettura: restituiscono righe da inserire nelle griglie)
// =====================================================================================

// Filtri di visibilità sulle singole schede (oltre ai permessi dell'entità).
const FILTRI = {};

const AZIONI = {
  Consegne: {
    // DPI previsti dalle mansioni del dipendente (quantità più alta tra le mansioni).
    caricaDpi(ctx, p) {
      const d = una(ctx, 'Dipendenti', p.dipendenteId);
      if (!d) throw errore('Scegli prima il dipendente.');
      const mie = new Set(mansioniDi(d)), q = new Map();
      for (const md of tutte(ctx, 'MansioniDpi')) if (mie.has(md.mansioneId)) q.set(md.dpiId, Math.max(q.get(md.dpiId) || 0, num(md.quantita) || 1));
      return [...q].map(([dpiId, quantita]) => ({ dpiId, quantita, etichetta: eng().titolo(ctx, 'TipiDpi', una(ctx, 'TipiDpi', dpiId)) }));
    },
  },
  ValutazioniCompetenze: {
    // Competenze richieste dalle mansioni scelte, con il valore atteso più alto.
    caricaCompetenze(ctx, p) {
      const mans = new Set(Array.isArray(p.mansioni) ? p.mansioni : lista(p.mansioni));
      const per = new Map();
      for (const mc of tutte(ctx, 'MansioniCompetenze')) {
        if (!mans.has(mc.mansioneId)) continue;
        const x = per.get(mc.competenzaId) || { competenzaId: mc.competenzaId, valoreAtteso: 0, rif: [] };
        x.valoreAtteso = Math.max(x.valoreAtteso, Number(mc.valoreAtteso) || 0);
        x.rif.push(mc.mansioneId);
        per.set(mc.competenzaId, x);
      }
      return [...per.values()].map(x => ({ competenzaId: x.competenzaId, valoreAtteso: String(x.valoreAtteso), mansioniRif: x.rif.join(','),
        etichetta: eng().titolo(ctx, 'Competenze', una(ctx, 'Competenze', x.competenzaId)) }));
    },
  },
  QualificheFornitori: {
    caricaDomande(ctx) {
      return tutte(ctx, 'DomandeQualifica').filter(d => d.attiva === 'SI').sort((a, b) => (num(a.ordine) || 0) - (num(b.ordine) || 0))
        .map(d => ({ domandaId: d.id, etichetta: d.domanda }));
    },
  },
  Attrezzature: {
    // Attività del piano (dell'attrezzatura o, in mancanza, della sua tipologia) da copiare nell'attrezzatura.
    applyPlan(ctx, p) {
      const tipo = una(ctx, 'TipiAttrezzatura', p.tipoId);
      const pianoId = p.pianoId || (tipo && tipo.pianoId);
      if (!pianoId) throw errore('Scegli un piano di manutenzione (oppure una tipologia che abbia un piano standard).');
      return figli(ctx, 'PianiAttivita', 'pianoId', pianoId).map(a => ({ attivita: a.attivita, frequenza: a.frequenza, unita: a.unita, attiva: 'SI' }));
    },
  },
  Manutenzioni: {
    loadPlanRows(ctx, p) {
      if (!una(ctx, 'Attrezzature', p.attrezzaturaId)) throw errore('Scegli prima l\'attrezzatura.');
      const og = eng().oggi();
      return figli(ctx, 'AttrezzatureAttivita', 'attrezzaturaId', p.attrezzaturaId).filter(a => a.attiva === 'SI')
        .map(a => ({ attivitaId: a.id, eseguita: 'SI', etichetta: a.attivita, ...statoAttivita(a, og) }));
    },
  },
  SorveglianzaSanitaria: {
    // Nuova visita: propone mansioni, sede, fattori di rischio del protocollo e medico/struttura dell'ultima visita.
    nuovaVisita(ctx, p) {
      const d = una(ctx, 'Dipendenti', p.dipendenteId);
      if (!d) throw errore('Scegli prima il lavoratore.');
      const mans = mansioniDi(d), fattori = new Set();
      for (const id of mans) { const m = una(ctx, 'Mansioni', id); if (m && m.sorveglianza === 'SI') lista(m.fattoriRischio).forEach(f => fattori.add(f)); }
      const u = ultimaVisita(ctx, d.id) || {};
      return { mansioniIds: mans.join(','), sedeId: d.sedeId || '', fattoriRischio: [...fattori].join(','),
        medicoCompetente: u.medicoCompetente || '', strutturaId: u.strutturaId || '', periodicita: u.periodicita || 'Annuale', periodicitaMesi: u.periodicitaMesi ?? '' };
    },
  },
};

function azione(ctx, p) {
  eng().esigi(ctx, p.entita, false);
  const f = AZIONI[p.entita] && Object.prototype.hasOwnProperty.call(AZIONI[p.entita], p.nome) ? AZIONI[p.entita][p.nome] : null;
  if (!f) throw errore('Operazione non riconosciuta.');
  return f(ctx, p);
}

// =====================================================================================
// FUNZIONI DI PAGINA (riepiloghi, registri, operazioni in blocco)
// =====================================================================================

const FUNZIONI = {
  // Trasforma un interinale in dipendente diretto conservando la storia dei rapporti.
  'dipendenti.assumi': { entita: 'Dipendenti', scrive: true, fn(ctx, p) {
    const { adesso, registra, leggi, oggi } = eng();
    const d = una(ctx, 'Dipendenti', p.id);
    if (!d) throw errore('Dipendente non trovato.');
    if (d.tipoRapporto !== INTERINALE) throw errore('Il dipendente è già assunto direttamente.');
    const data = p.data || oggi();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw validazione('«Data assunzione»: data non valida');
    if (d.inizioMissione) sincronizzaRapporti(ctx, d);
    for (const r of figli(ctx, 'RapportiLavoro', 'dipendenteId', d.id)) {
      if (r.tipo === INTERINALE && (!r.al || r.al >= data)) ctx.st.metti('RapportiLavoro', { ...r, al: addGiorni(data, -1), updatedAt: adesso() });
    }
    const nuovo = { ...d, tipoRapporto: DIRETTO, dataAssunzione: data, agenziaId: '', inizioMissione: '', fineMissione: '', rifContratto: '', formGenAgenzia: 'NO',
      contratto: p.contratto || d.contratto || '', updatedAt: adesso() };
    ctx.st.metti('Dipendenti', nuovo);
    sincronizzaRapporti(ctx, nuovo);
    registra(ctx, 'Assunzione diretta', nomeDip(d));
    return leggi(ctx, 'Dipendenti', d.id);
  } },

  // Clona una mansione con competenze, DPI e corsi; serve un nuovo codice.
  'mansioni.clona': { entita: 'Mansioni', scrive: true, fn(ctx, p) {
    const m = una(ctx, 'Mansioni', p.id);
    if (!m) throw errore('Mansione non trovata.');
    if (!String(p.codice || '').trim()) throw validazione('«Codice mansione»: indica il codice della nuova mansione');
    const copia = (e, fk, campi) => (attivo(ctx, SCHEMA_PACK(e)) ? figli(ctx, e, fk, m.id).map(r => Object.fromEntries(campi.map(c => [c, r[c]]))) : undefined);
    return eng().salva(ctx, 'Mansioni', { ...m, id: undefined, codice: String(p.codice).trim(), descrizione: p.descrizione || m.descrizione + ' (copia)' }, {
      MansioniCompetenze: copia('MansioniCompetenze', 'mansioneId', ['competenzaId', 'valoreAtteso']),
      MansioniDpi: copia('MansioniDpi', 'mansioneId', ['dpiId', 'quantita']),
      MansioniCorsi: copia('MansioniCorsi', 'mansioneId', ['tipoCorsoId', 'note']) });
  } },

  'nc.riepilogo': { entita: 'NC', fn(ctx, p) {
    const { pubblica } = eng();
    const nc = tutte(ctx, 'NC').filter(r => (!p.dal || r.data >= p.dal) && (!p.al || r.data <= p.al) && (!p.stato || r.stato === p.stato) &&
      (!p.tipologia || r.tipologia === p.tipologia) && (!p.reclamo || r.reclamo === p.reclamo)).sort((a, b) => a.data.localeCompare(b.data));
    const ids = new Set(nc.map(r => r.id));
    const az = tutte(ctx, 'Azioni').filter(a => (a.ncId && ids.has(a.ncId)) || (!a.ncId && (!p.dal || a.data >= p.dal) && (!p.al || a.data <= p.al)));
    const costo = r => figli(ctx, 'NcCosti', 'ncId', r.id).reduce((s, c) => s + (num(c.quantita) ?? 1) * (num(c.costo) || 0), 0);
    const conta = (l, k) => l.reduce((o, r) => { const v = r[k] || '(non indicato)'; o[v] = (o[v] || 0) + 1; return o; }, {});
    const og = eng().oggi();
    return {
      nc: nc.map(r => pubblica(ctx, 'NC', r)), azioni: az.map(a => pubblica(ctx, 'Azioni', a)),
      totali: { nc: nc.length, reclami: nc.filter(r => r.reclamo === 'SI').length, costo: arrot(nc.reduce((s, r) => s + costo(r), 0), 2),
        perStato: conta(nc, 'stato'), perTipologia: conta(nc, 'tipologia'), azioni: az.length, azioniAperte: az.filter(a => a.stato !== 'Chiusa').length,
        azioniScadute: az.filter(a => a.stato !== 'Chiusa' && a.dataPrevChiusura && a.dataPrevChiusura < og).length },
    };
  } },

  'fornitori.qualificati': { entita: 'QualificheFornitori', fn(ctx) {
    return tutte(ctx, 'Soggetti').filter(s => s.fornitore === 'SI').map(s => {
      const u = ultimaQualifica(ctx, s.id);
      return { id: s.id, ragioneSociale: s.ragioneSociale, descrizioneFornitura: s.descrizioneFornitura || '', esito: u ? u.esito : 'Da valutare', media: u ? fmtMedia(u.media) : '', data: u ? u.q.data : '' };
    }).sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale, 'it'));
  } },

  'strumenti.registro': { entita: 'Strumenti', fn(ctx) {
    return tutte(ctx, 'Strumenti').sort((a, b) => a.codice.localeCompare(b.codice, 'it')).map(s => eng().pubblica(ctx, 'Strumenti', s));
  } },

  'manutenzioni.inScadenza': { entita: 'Manutenzioni', fn(ctx, p) {
    return attivitaInScadenza(ctx, p.sedeId, Math.min(730, Math.max(0, Number(p.giorni ?? 30) || 0)));
  } },

  // Manutenzione massiva per sede: una manutenzione per ogni attrezzatura selezionata.
  'manutenzioni.massiva': { entita: 'Manutenzioni', scrive: true, fn(ctx, p) {
    const elementi = (Array.isArray(p.elementi) ? p.elementi : []).filter(x => x && Array.isArray(x.attivita) && x.attivita.length);
    if (!elementi.length) throw errore('Scegli almeno un\'attività da registrare.');
    const create = [];
    for (const x of elementi) {
      const r = eng().salva(ctx, 'Manutenzioni', {
        data: p.data, attrezzaturaId: x.attrezzaturaId, tipo: 'Ordinaria', esito: p.esito || 'Conforme', descrizione: p.descrizione || 'Manutenzione ordinaria programmata',
        esecutoreTipo: p.esecutoreTipo || 'Interno', esecutoreDipId: p.esecutoreDipId, esecutoreSoggId: p.esecutoreSoggId, esecutoreNome: p.esecutoreNome, note: p.note,
      }, { ManutenzioniRighe: x.attivita.map(attivitaId => ({ attivitaId, eseguita: 'SI' })) });
      create.push(r.riga.id);
    }
    return { create };
  } },

  'sanitaria.registro': { entita: 'SorveglianzaSanitaria', fn(ctx) {
    return lavoratoriSoggetti(ctx).map(d => ({ dipendenteId: d.id, nome: nomeDip(d), mansioni: mansioniDi(d).map(id => eng().titolo(ctx, 'Mansioni', una(ctx, 'Mansioni', id))).join(', '),
      ...statoSanitario(ctx, d.id) })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  } },
};

function funzione(ctx, p) {
  const f = Object.prototype.hasOwnProperty.call(FUNZIONI, p.nome) ? FUNZIONI[p.nome] : null;
  if (!f) throw errore('Operazione non riconosciuta.');
  eng().esigi(ctx, f.entita, !!f.scrive);
  return f.fn(ctx, p);
}

module.exports = {
  HOOKS, CALC, FILTRI, FUNZIONI, azione, funzione, mansioniDi, statoFormazione, formazioneRichiesta, statoStrumento, statoAttivita, attivitaInScadenza,
  statoSanitario, lavoratoriSoggetti, esitoQualifica, ultimaQualifica, addMesi, addGiorni, addUnita, statoScadenza,
};

require('./documenti').installa(module.exports);
require('./rischi').installa(module.exports);
