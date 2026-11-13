'use strict';
// Import da Excel/CSV (solo amministratori): modello, verifica (anteprima senza scrittura), importa.
// La verifica esegue l'import per intero e poi annulla tutto: l'anteprima è quindi identica al risultato reale.

const eng = require('./engine');
const { ErroreUtente } = eng;
const { SCHEMA } = require('./schema');

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\([^)]*\)/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const chiave = s => norm(s).replace(/[^a-z0-9]/g, '');
const testo = v => String(v ?? '').trim();
const tutte = (ctx, e) => [...ctx.st.tabella(e).values()];

function aData(v) {
  if (typeof v === 'number') {
    if (v < 1 || v > 110000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);   // data di Excel
  }
  const s = testo(v);
  let m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  let iso = m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
const aBool = v => (['si', 'x', 'true', '1', 's', 'yes'].includes(norm(v)) ? 'SI' : 'NO');
function aNumero(v) { if (typeof v === 'number') return v; const s = testo(v); const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; }
function opzione(e, campo, v, pred) {
  if (!testo(v)) return pred;
  const o = SCHEMA[e].fields.find(f => f.name === campo).options.find(x => norm(x) === norm(v));
  if (!o) throw new ErroreUtente('«' + SCHEMA[e].fields.find(f => f.name === campo).label + '»: valore "' + testo(v) + '" non ammesso');
  return o;
}
const perCodice = (ctx, e, campo = 'codice') => new Map(tutte(ctx, e).map(r => [norm(r[campo]), r]));
function cerca(mappa, v, cosa) { const r = mappa.get(norm(v)); if (!r) throw new ErroreUtente(cosa + ' "' + testo(v) + '" non trovato'); return r; }

// I dipendenti si riconoscono per "Cognome Nome", "Nome Cognome" o codice fiscale.
function trovaDip(ctx, v) {
  const k = chiave(v);
  if (!k) return null;
  return tutte(ctx, 'Dipendenti').find(d => chiave(d.cf) === k || chiave(d.cognome + d.nome) === k || chiave(d.nome + d.cognome) === k) || null;
}
function trovaSoggetto(ctx, v) {
  const k = chiave(v);
  if (!k) return null;
  return tutte(ctx, 'Soggetti').find(s => (s.piva && chiave(s.piva) === k) || chiave(s.ragioneSociale) === k) || null;
}

// ---------- definizioni ----------
// col: [intestazione, chiave, tipo]   (intestazione con * = obbligatoria; tipo: data | bool | num)

const IMPORT = {
  attrezzature: {
    titolo: 'Attrezzature', entita: 'Attrezzature',
    fogli: [{ nome: 'Attrezzature', col: [['Codice*', 'codice'], ['Descrizione*', 'descrizione'], ['Codice tipologia*', 'tipo'], ['Codice sede*', 'sede'], ['Marca', 'marca'], ['Modello', 'modello'],
      ['Matricola', 'matricola'], ['Data acquisto', 'dataAcquisto', 'data'], ['P.IVA fornitore', 'piva'], ['Stato', 'stato'], ['Note', 'note']],
      esempio: ['CAR-01', 'Carrello elevatore', 'CAR', 'S1', 'Toyota', '8FB', '12345', '15/03/2020', '01234567890', 'In uso', ''] }],
    consulta: ctx => [['Tipologie', 'TipiAttrezzatura'], ['Sedi', 'Sedi']],
    esegui(ctx, R) {
      const tipi = perCodice(ctx, 'TipiAttrezzatura'), sedi = perCodice(ctx, 'Sedi'), esistenti = perCodice(ctx, 'Attrezzature');
      R.righe('Attrezzature', r => {
        if (esistenti.has(norm(r.codice))) return 'doppione';
        const forn = r.piva ? trovaSoggetto(ctx, r.piva) : null;
        if (r.piva && !forn) R.avviso('Attrezzature', r, 'fornitore con P.IVA ' + r.piva + ' non trovato: campo lasciato vuoto');
        const tipo = cerca(tipi, r.tipo, 'Codice tipologia');
        const x = R.salva('Attrezzature', { codice: r.codice, descrizione: r.descrizione, tipoId: tipo.id, sedeId: cerca(sedi, r.sede, 'Codice sede').id, marca: r.marca, modello: r.modello,
          matricola: r.matricola, dataAcquisto: r.dataAcquisto, fornitoreId: forn ? forn.id : '', stato: opzione('Attrezzature', 'stato', r.stato, 'In uso'), pianoId: tipo.pianoId || '', note: r.note });
        esistenti.set(norm(r.codice), x);
      });
    },
  },

  dipendenti: {
    titolo: 'Dipendenti', entita: 'Dipendenti',
    fogli: [{ nome: 'Dipendenti', col: [['Cognome*', 'cognome'], ['Nome*', 'nome'], ['Codice fiscale*', 'cf'], ['E-mail', 'email'], ['Codice mansione', 'mansione'], ['Codice sede', 'sede'],
      ['Tipo contratto', 'contratto'], ['Data assunzione', 'dataAssunzione', 'data'], ['Data cessazione', 'dataLicenziamento', 'data']],
      esempio: ['Rossi', 'Mario', 'RSSMRA80A01H501U', 'mario.rossi@esempio.it', 'OP', 'S1', 'Tempo indeterminato', '01/02/2015', ''] }],
    consulta: ctx => [['Mansioni', 'Mansioni'], ['Sedi', 'Sedi']],
    esegui(ctx, R) {
      const mans = perCodice(ctx, 'Mansioni'), sedi = perCodice(ctx, 'Sedi');
      const cf = new Set(tutte(ctx, 'Dipendenti').map(d => chiave(d.cf)).filter(Boolean));
      R.righe('Dipendenti', r => {
        if (cf.has(chiave(r.cf))) return 'doppione';
        R.salva('Dipendenti', { cognome: r.cognome, nome: r.nome, cf: r.cf, email: r.email, mansioneId: r.mansione ? cerca(mans, r.mansione, 'Codice mansione').id : '',
          sedeId: r.sede ? cerca(sedi, r.sede, 'Codice sede').id : '', contratto: r.contratto, dataAssunzione: r.dataAssunzione, dataLicenziamento: r.dataLicenziamento });
        cf.add(chiave(r.cf));
      });
    },
  },

  formazione: {
    titolo: 'Formazione storica', entita: 'Corsi',
    fogli: [{ nome: 'Formazione', col: [['CF dipendente*', 'dip'], ['Tipologia corso*', 'tipo'], ['Modalità', 'modalita'], ['Data inizio', 'dataInizio', 'data'], ['Data fine*', 'dataFine', 'data'],
      ['Ore', 'ore', 'num'], ['Titolo', 'titolo'], ['Ente/docente', 'ente'], ['Luogo', 'luogo'], ['Programma', 'programma']],
      esempio: ['RSSMRA80A01H501U', 'Formazione generale lavoratori', 'Formazione iniziale', '10/03/2021', '10/03/2021', 4, '', 'Ente Formazione Srl', 'Sede', ''] }],
    consulta: ctx => [['Tipologie corso', 'TipiCorso']],
    esegui(ctx, R) {
      const tipi = perCodice(ctx, 'TipiCorso', 'tipo');
      const gruppi = new Map();
      R.righe('Formazione', r => {
        const tipo = cerca(tipi, r.tipo, 'Tipologia corso');
        const d = trovaDip(ctx, r.dip);
        if (!d) throw new ErroreUtente('dipendente "' + r.dip + '" non trovato');
        const k = tipo.id + '|' + r.dataFine + '|' + norm(r.titolo);
        if (!gruppi.has(k)) gruppi.set(k, { tipo, r, part: [] });
        const g = gruppi.get(k);
        if (g.part.some(p => p.dipendenteId === d.id)) return 'doppione';
        g.part.push({ dipendenteId: d.id, ore: r.ore, _r: r });
        return 'rinvia';   // l'esito definitivo arriva quando si salva il corso
      });
      // I partecipanti con stessa tipologia, data e titolo finiscono nello stesso corso (marcato "importato", senza firme).
      for (const g of gruppi.values()) {
        const titolo = g.r.titolo || g.tipo.tipo + ' ' + eng.dataIt(g.r.dataFine);
        const esistente = tutte(ctx, 'Corsi').find(c => c.importato === 'SI' && c.tipoCorsoId === g.tipo.id && c.dataFine === g.r.dataFine && norm(c.titolo) === norm(titolo));
        const gia = esistente ? tutte(ctx, 'CorsiPartecipanti').filter(p => p.corsoId === esistente.id).sort((a, b) => (a._ord || 0) - (b._ord || 0)) : [];
        const nuovi = g.part.filter(p => !gia.some(x => x.dipendenteId === p.dipendenteId));
        for (const p of g.part) if (!nuovi.includes(p)) R.esito('Formazione', p._r, 'doppione');
        if (!nuovi.length) continue;
        try {
          const ore = Math.max(0, ...g.part.map(p => Number(p.ore) || 0));
          R.salva('Corsi', esistente ? { id: esistente.id } : { titolo, tipoCorsoId: g.tipo.id, modalita: norm(g.r.modalita).startsWith('agg') ? 'Aggiornamento' : 'Formazione iniziale',
            dataInizio: g.r.dataInizio || g.r.dataFine, dataFine: g.r.dataFine, durataOre: ore || '', enteFormatore: g.r.ente, luogo: g.r.luogo, programma: g.r.programma, importato: 'SI' },
          { CorsiPartecipanti: [...gia.map(x => ({ id: x.id })), ...nuovi.map(p => ({ dipendenteId: p.dipendenteId, ore: p.ore }))] });
          for (const p of nuovi) R.esito('Formazione', p._r, 'ok');
        } catch (e) { if (!e.utente) throw e; for (const p of nuovi) R.esito('Formazione', p._r, e); }
      }
    },
  },

  soggetti: {
    titolo: 'Clienti e fornitori', entita: 'Soggetti',
    fogli: [{ nome: 'Soggetti', col: [['Ragione sociale*', 'ragioneSociale'], ['P.IVA', 'piva'], ['CF', 'cf'], ['Indirizzo', 'indirizzo'], ['Comune', 'comune'], ['E-mail', 'email'],
      ['Fornitore', 'fornitore', 'bool'], ['Cliente', 'cliente', 'bool'], ['Descrizione fornitura', 'descrizioneFornitura']],
      esempio: ['Acciai Srl', '01234567890', '', 'Via Roma 1', 'Milano', 'info@acciai.it', 'Sì', 'No', 'Lamiere'] },
    { nome: 'Valutazioni', facoltativo: true, col: [['Fornitore*', 'fornitore'], ['Data*', 'data', 'data'], ['Punteggio medio', 'media', 'num'], ['Esito', 'esito'], ['Valutatore', 'valutatore'], ['Note', 'note']],
      esempio: ['Acciai Srl', '15/01/2025', 7.5, 'Qualificato', 'Mario Rossi', ''] }],
    consulta: () => [],
    esegui(ctx, R) {
      R.righe('Soggetti', r => {
        if (trovaSoggetto(ctx, r.piva) || trovaSoggetto(ctx, r.ragioneSociale)) return 'doppione';   // per P.IVA o ragione sociale normalizzata
        R.salva('Soggetti', { ...r, piva: testo(r.piva), cf: testo(r.cf) });
      });
      if (!R.haFoglio('Valutazioni')) return;
      if (!ctx.pacchetti.has('fornitori')) { R.avvisoGenerale('Il foglio "Valutazioni" è stato ignorato: il pacchetto Qualifica fornitori non è attivo.'); return; }
      R.righe('Valutazioni', r => {
        const s = trovaSoggetto(ctx, r.fornitore);
        if (!s) throw new ErroreUtente('fornitore "' + r.fornitore + '" non trovato');
        if (tutte(ctx, 'QualificheFornitori').some(q => q.soggettoId === s.id && q.data === r.data && q.importata === 'SI')) return 'doppione';
        const e = norm(r.esito);
        R.salva('QualificheFornitori', { soggettoId: s.id, data: r.data, valutatoreId: '', importata: 'SI', mediaImportata: r.media,
          esitoImportato: e.startsWith('non') ? 'Non qualificato' : e.includes('qualif') ? 'Qualificato' : '', valutatoreTesto: r.valutatore, note: r.note });
        if (s.fornitore !== 'SI') ctx.st.metti('Soggetti', { ...s, fornitore: 'SI' });
      });
    },
  },

  nc: {
    titolo: 'Non conformità e azioni', entita: 'NC',
    fogli: [{ nome: 'NC', col: [['Numero', 'numero'], ['Data*', 'data', 'data'], ['Riferimento', 'riferimento'], ['Stato', 'stato'], ['Reclamo', 'reclamo', 'bool'], ['NC', 'isNc', 'bool'], ['Tipologia', 'tipologia'],
      ['Redatto da', 'redatto'], ['Descrizione*', 'descrizione'], ['Rilevato da', 'rilevatoDa'], ['Rilevatore', 'rilevatore'], ['Gestione', 'gestione'], ['Cause', 'cause'], ['Costo totale', 'costo', 'num'], ['Serve azione', 'serveAzione', 'bool']],
      esempio: ['NC-2024-001', '12/04/2024', 'Ordine 55', 'Chiusa', 'No', 'Sì', 'Prodotto', 'Mario Rossi', 'Pezzo fuori tolleranza', 'Interno', 'Luca Verdi', 'Rilavorazione', 'Utensile usurato', 120, 'Sì'] },
    { nome: 'Azioni', facoltativo: true, col: [['Numero NC', 'numeroNc'], ['Numero azione', 'numero'], ['Data', 'data', 'data'], ['Stato', 'stato'], ['Descrizione*', 'descrizione'], ['Responsabile', 'responsabile'],
      ['Data prevista', 'dataPrevChiusura', 'data'], ['Data chiusura', 'dataChiusura', 'data'], ['Efficacia', 'effValutazione'], ['Data valutazione', 'effData', 'data'], ['Valutatore', 'valutatore']],
      esempio: ['NC-2024-001', 'AZ-2024-001', '15/04/2024', 'Chiusa', 'Sostituzione utensili ogni 500 pezzi', 'Mario Rossi', '30/04/2024', '28/04/2024', 'Efficace', '30/06/2024', 'Mario Rossi'] }],
    consulta: () => [],
    esegui(ctx, R) {
      const numeri = perCodice(ctx, 'NC', 'numero'), numeriAz = perCodice(ctx, 'Azioni', 'numero');
      const tipologie = new Set(tutte(ctx, 'Elenchi').filter(x => x.categoria === 'Tipologia NC').map(x => norm(x.valore)));
      const dip = (v, foglio, r, cosa) => { const d = trovaDip(ctx, v); if (testo(v) && !d) R.avviso(foglio, r, cosa + ' "' + v + '" non trovato tra i dipendenti: campo lasciato vuoto'); return d ? d.id : ''; };
      R.righe('NC', r => {
        if (r.numero && numeri.has(norm(r.numero))) return 'doppione';
        const tipo = norm(r.rilevatoDa).startsWith('forn') ? 'Fornitore' : norm(r.rilevatoDa).startsWith('int') || !testo(r.rilevatoDa) ? 'Interno' : 'Altro';
        const dati = { numero: r.numero, data: r.data, riferimento: r.riferimento, stato: opzione('NC', 'stato', r.stato, 'Aperta'), reclamo: r.reclamo || 'NO', isNc: testo(r._grezzo.isNc) ? r.isNc : 'SI',
          tipologia: r.tipologia, redattoDa: dip(r.redatto, 'NC', r, 'Redatto da'), descrizione: r.descrizione, rilevatoreTipo: tipo, gestione: r.gestione, analisiCause: r.cause,
          serveAzione: r.serveAzione || 'NO', importata: 'SI', rilevatoreDipId: '', rilevatoreSoggId: '', rilevatoreTesto: '' };
        if (tipo === 'Interno') { const d = trovaDip(ctx, r.rilevatore); if (d) dati.rilevatoreDipId = d.id; else if (testo(r.rilevatore)) { dati.rilevatoreTipo = 'Altro'; dati.rilevatoreTesto = r.rilevatore; } }
        else if (tipo === 'Fornitore') { const s = trovaSoggetto(ctx, r.rilevatore); if (s) dati.rilevatoreSoggId = s.id; else { dati.rilevatoreTipo = 'Altro'; dati.rilevatoreTesto = r.rilevatore; } }
        else dati.rilevatoreTesto = r.rilevatore || r.rilevatoDa;
        const x = R.salva('NC', dati, r.costo ? { NcCosti: [{ descrizione: 'Costo totale (da archivio)', quantita: 1, costo: r.costo }] } : {});
        numeri.set(norm(x.numero), x);
        if (r.tipologia && !tipologie.has(norm(r.tipologia))) {   // le tipologie nuove vengono aggiunte all'elenco
          R.salva('Elenchi', { categoria: 'Tipologia NC', valore: r.tipologia, ordine: tipologie.size + 1 });
          tipologie.add(norm(r.tipologia));
        }
      });
      if (!R.haFoglio('Azioni')) return;
      R.righe('Azioni', r => {
        if (r.numero && numeriAz.has(norm(r.numero))) return 'doppione';
        const nc = r.numeroNc ? cerca(numeri, r.numeroNc, 'NC numero') : null;
        const x = R.salva('Azioni', { numero: r.numero, ncId: nc ? nc.id : '', data: r.data || (nc ? nc.data : eng.oggi()), stato: opzione('Azioni', 'stato', r.stato, 'Aperta'), descrizione: r.descrizione,
          responsabileId: dip(r.responsabile, 'Azioni', r, 'Responsabile'), dataPrevChiusura: r.dataPrevChiusura, dataChiusura: r.dataChiusura, effValutazione: r.effValutazione, effData: r.effData,
          effValutatoreId: dip(r.valutatore, 'Azioni', r, 'Valutatore') });
        numeriAz.set(norm(x.numero), x);
      });
    },
  },

  documenti: {
    titolo: 'Elenco documenti', entita: 'Documenti',
    fogli: [{ nome: 'Documenti', col: [['Codice*', 'codice'], ['Titolo*', 'titolo'], ['Tipologia', 'tipologia'], ['Revisione*', 'revisione'], ['Data revisione*', 'dataRevisione', 'data'], ['Modalità', 'modalitaRevisione'],
      ['Descrizione modifica', 'descrizioneModifica'], ['Redatto da', 'redatto'], ['Verificato da', 'verificato'], ['Approvato da', 'approvato'], ['Data approvazione', 'dataApprovazione', 'data'], ['Link', 'link'],
      ['Stato', 'stato'], ['Codici mansioni destinatarie', 'mansioni'], ['Tutti i dipendenti', 'distTutti', 'bool'], ['Riesame mesi', 'riesameMesi', 'num'], ['Note', 'note']],
      esempio: ['PR-01', 'Gestione ordini', 'Procedura', '2', '10/01/2025', 'Revisione parziale', 'Aggiornato il paragrafo 3', 'Mario Rossi', '', 'Paola Neri', '15/01/2025', 'https://intranet.esempio.it/pr01', '', 'OP, CAR', 'No', 12, ''] },
    { nome: 'Collegamenti', facoltativo: true, col: [['Codice documento*', 'codice'], ['Tipo', 'tipo'], ['Codice collegato*', 'collegato'], ['Note', 'note']], esempio: ['PR-01', 'Modulo da usare', 'MOD-01', ''] }],
    consulta: ctx => [['Mansioni', 'Mansioni']],
    esegui(ctx, R) {
      const mans = perCodice(ctx, 'Mansioni');
      const dip = (v, r, cosa, obbligatorio) => {
        const d = trovaDip(ctx, v);
        if (d) return d.id;
        if (obbligatorio) { R.avviso('Documenti', r, cosa + (testo(v) ? ' "' + v + '" non trovato' : ' non indicato') + ': è stato indicato chi esegue l\'import'); return ctx.utente.id; }
        if (testo(v)) R.avviso('Documenti', r, cosa + ' "' + v + '" non trovato tra i dipendenti: campo lasciato vuoto');
        return '';
      };
      // Stato vuoto: la revisione più alta di ogni codice va in vigore, le altre sono superate.
      const ordine = r => { const n = Number(r.revisione); return Number.isFinite(n) && testo(r.revisione) !== '' ? [0, n, ''] : [1, 0, String(r.dataRevisione || '')]; };
      const piuAlta = new Map();
      for (const r of R.grezze('Documenti')) {
        if (testo(r.stato) || !testo(r.codice)) continue;
        const k = norm(r.codice), p = piuAlta.get(k), a = ordine(r), b = p ? ordine(p) : null;
        if (!p || a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) piuAlta.set(k, r);
      }
      R.righe('Documenti', r => {
        const stessi = tutte(ctx, 'Documenti').filter(d => norm(d.codice) === norm(r.codice));
        if (stessi.some(d => norm(d.revisione) === norm(r.revisione))) return 'doppione';
        let stato = opzione('Documenti', 'stato', r.stato, '');
        if (!stato) stato = piuAlta.get(norm(r.codice)) === r._grezzo && !stessi.some(d => d.stato === 'In vigore') ? 'In vigore' : 'Superato';
        if (stato === 'In vigore' && stessi.some(d => d.stato === 'In vigore')) throw new ErroreUtente('esiste già una revisione in vigore del documento ' + r.codice);
        const codici = testo(r.mansioni).split(/[,;]/).map(testo).filter(Boolean);
        R.salva('Documenti', { codice: r.codice, titolo: r.titolo, tipologia: r.tipologia, revisione: testo(r.revisione), dataRevisione: r.dataRevisione, modalitaRevisione: r.modalitaRevisione,
          descrizioneModifica: r.descrizioneModifica, redattoDa: dip(r.redatto, r, 'Redatto da', true), verificatoDa: dip(r.verificato, r, 'Verificato da'), approvatoDa: dip(r.approvato, r, 'Approvato da', true),
          dataApprovazione: r.dataApprovazione || (stato === 'Bozza' || stato === 'In approvazione' ? '' : r.dataRevisione), link: r.link, stato, distMansioni: codici.map(c => cerca(mans, c, 'Codice mansione').id),
          distTutti: r.distTutti || 'NO', riesameMesi: r.riesameMesi, note: r.note, importato: 'SI', presaVisione: 'Tutti i destinatari' });
      });
      if (!R.haFoglio('Collegamenti')) return;
      const corrente = cod => { const l = tutte(ctx, 'Documenti').filter(d => norm(d.codice) === norm(cod)); return l.find(d => d.stato === 'In vigore') || l.sort((a, b) => String(b.dataRevisione).localeCompare(String(a.dataRevisione)))[0]; };
      R.righe('Collegamenti', r => {
        const da = corrente(r.codice), a = corrente(r.collegato);
        if (!da) throw new ErroreUtente('documento "' + r.codice + '" non trovato');
        if (!a) throw new ErroreUtente('documento collegato "' + r.collegato + '" non trovato');
        const gia = tutte(ctx, 'DocumentiCollegamenti').filter(c => c.documentoId === da.id).sort((x, y) => (x._ord || 0) - (y._ord || 0));
        const codiceDi = id => { const d = ctx.st.tabella('Documenti').get(id); return d ? norm(d.codice) : ''; };
        if (gia.some(c => codiceDi(c.collegatoId) === norm(r.collegato))) return 'doppione';
        R.salva('Documenti', { id: da.id }, { DocumentiCollegamenti: [...gia.map(c => ({ id: c.id })), { tipo: opzione('DocumentiCollegamenti', 'tipo', r.tipo, 'Richiama'), collegatoId: a.id, note: r.note }] });
      });
    },
  },
};

// ---------- motore ----------

function definizione(ctx, tipo) {
  const def = Object.prototype.hasOwnProperty.call(IMPORT, tipo) ? IMPORT[tipo] : null;
  if (!def) throw new ErroreUtente('Importazione non riconosciuta.');
  if (!ctx.utente.admin) throw new ErroreUtente('Le importazioni sono riservate agli amministratori.', 'PERMESSO');
  eng.esigi(ctx, def.entita, true);
  return def;
}

// Modello .xlsx: fogli dati con intestazioni ed esempio, fogli di consultazione, istruzioni.
function modello(ctx, tipo) {
  const def = definizione(ctx, tipo);
  const fogli = def.fogli.map(f => ({ nome: f.nome, righe: [f.col.map(c => c[0]), f.esempio.map((v, i) => (i === 0 ? '(esempio) ' + v : v))] }));
  for (const [nome, e] of def.consulta(ctx)) {
    const campi = SCHEMA[e].title;
    fogli.push({ nome: 'Elenco ' + nome, righe: [campi.map(c => SCHEMA[e].fields.find(f => f.name === c).label), ...tutte(ctx, e).map(r => campi.map(c => r[c] ?? ''))] });
  }
  fogli.push({ nome: 'Istruzioni', righe: [['Come compilare il modello "' + def.titolo + '"'],
    ['1. Compila il foglio "' + def.fogli[0].nome + '" una riga per elemento. Le colonne con * sono obbligatorie.'],
    ['2. Le righe che iniziano con "(esempio)" vengono ignorate: puoi lasciarle o cancellarle.'],
    ['3. Le date si scrivono come gg/mm/aaaa. Per Sì/No vanno bene Sì, No, SI, NO oppure X.'],
    ['4. I codici (mansioni, sedi, tipologie) devono esistere già: li trovi nei fogli "Elenco…".'],
    ['5. Nel gestionale premi prima "Verifica": vedrai le righe valide e gli errori senza modificare nulla. Poi premi "Importa".'],
    ['6. Le righe con errori e i doppioni vengono saltati; puoi correggere il file e importarlo di nuovo.'],
    ...def.fogli.filter(f => f.facoltativo).map(f => ['Il foglio "' + f.nome + '" è facoltativo.'])] });
  return { nome: 'modello-' + tipo + '.xlsx', fogli };
}

function esegui(ctx, tipo, fogliLetti, prova) {
  const def = definizione(ctx, tipo);
  const rep = { tipo: def.titolo, prova: !!prova, valide: 0, doppioni: 0, errori: [], avvisi: [], perFoglio: {} };
  const tabelle = {};
  def.fogli.forEach((f, i) => {
    const letto = fogliLetti.find(x => norm(x.nome) === norm(f.nome)) || (i === 0 && fogliLetti.length && !fogliLetti.some(x => def.fogli.some(y => norm(y.nome) === norm(x.nome))) ? fogliLetti[0] : null);
    if (!letto) { if (!f.facoltativo) throw new ErroreUtente('Nel file manca il foglio "' + f.nome + '". Scarica il modello e usa quello.'); return; }
    const intest = (letto.righe[0] || []).map(norm);
    const pos = f.col.map(c => intest.indexOf(norm(c[0])));
    const mancanti = f.col.filter((c, k) => c[0].includes('*') && pos[k] < 0).map(c => c[0].replace('*', ''));
    if (mancanti.length) throw new ErroreUtente('Nel foglio "' + f.nome + '" mancano le colonne obbligatorie: ' + mancanti.join(', ') + '.');
    const righe = [];
    letto.righe.slice(1).forEach((celle, n) => {
      if (!celle || celle.every(v => testo(v) === '') || /^\(esempio\)/i.test(testo(celle[0]))) return;
      const g = { _n: n + 2 };
      f.col.forEach((c, k) => { g[c[1]] = pos[k] >= 0 ? celle[pos[k]] ?? '' : ''; });
      righe.push(g);
    });
    tabelle[f.nome] = righe;
    rep.perFoglio[f.nome] = { righe: righe.length, valide: 0, doppioni: 0, errori: 0 };
  });

  const ctxI = { ...ctx, interno: true, silenzioso: true };
  const pulisci = m => String(m).replace('Controlla i dati inseriti:\n• ', '').replace(/\n• /g, '; ');
  const R = {
    haFoglio: n => !!tabelle[n],
    grezze: n => tabelle[n] || [],
    salva: (e, dati, figli) => eng.salva(ctxI, e, dati, figli).riga,
    avviso: (foglio, r, m) => rep.avvisi.push({ foglio, riga: r._n, messaggio: m }),
    avvisoGenerale: m => rep.avvisi.push({ foglio: '', riga: 0, messaggio: m }),
    esito(foglio, r, cosa) {
      const p = rep.perFoglio[foglio];
      if (cosa === 'doppione') { rep.doppioni++; p.doppioni++; }
      else if (cosa === 'ok') { rep.valide++; p.valide++; }
      else { p.errori++; rep.errori.push({ foglio, riga: r._n, messaggio: pulisci(cosa.message), licenza: cosa.codice === 'LICENZA' || undefined }); }
    },
    righe(foglio, fn) {
      const f = def.fogli.find(x => x.nome === foglio);
      for (const g of tabelle[foglio] || []) {
        const r = { _n: g._n, _grezzo: g };
        try {
          for (const c of f.col) {
            const v = g[c[1]], vuoto = testo(v) === '';
            if (vuoto && c[0].includes('*')) throw new ErroreUtente('«' + c[0].replace('*', '') + '»: campo obbligatorio');
            if (c[2] === 'data') { r[c[1]] = vuoto ? '' : aData(v); if (r[c[1]] === null) throw new ErroreUtente('«' + c[0].replace('*', '') + '»: data "' + testo(v) + '" non valida (usa gg/mm/aaaa)'); }
            else if (c[2] === 'bool') r[c[1]] = vuoto ? '' : aBool(v);
            else if (c[2] === 'num') { r[c[1]] = vuoto ? '' : aNumero(v); if (r[c[1]] === null) throw new ErroreUtente('«' + c[0].replace('*', '') + '»: "' + testo(v) + '" non è un numero'); }
            else r[c[1]] = typeof v === 'number' ? String(v) : testo(v);
          }
          const esito = fn(r);
          if (esito !== 'rinvia') R.esito(foglio, r, esito === 'doppione' ? 'doppione' : 'ok');
        } catch (e) { if (!e.utente) throw e; R.esito(foglio, r, e); }
      }
    },
  };
  def.esegui(ctx, R);
  if (!prova) eng.registra(ctx, 'Importazione', def.titolo + ': ' + rep.valide + ' righe importate, ' + rep.doppioni + ' doppioni, ' + rep.errori.length + ' errori');
  return rep;
}

module.exports = { modello, esegui, IMPORT, aData, trovaDip };
