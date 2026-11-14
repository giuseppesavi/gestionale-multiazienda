'use strict';
// Server dimostrativo per provare l'interfaccia in locale:  node test/demo.js
// Usa un database in memoria (i dati si perdono alla chiusura) e NON invia posta:
// i codici di accesso vengono scritti sul terminale. Da non usare in produzione.
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');
const { addGiorni } = require('../app/regole');
const { oggi } = require('../app/engine');

(async () => {
  const registro = [];
  const postino = { registro, configurata: false, async invia(m) {
    registro.unshift({ data: new Date().toISOString(), a: m.a, oggetto: m.oggetto, esito: 'Non inviata: server dimostrativo', testo: m.testo });
    const c = /è: (\d{6})/.exec(m.testo);
    console.log(c ? '[DEMO] codice per ' + m.a + ': ' + c[1] : '[DEMO] e-mail a ' + m.a + ': ' + m.oggetto);
    return true;
  } };
  const sis = creaSistema({ db: await apriDb({}), postino, adminKey: process.env.ADMIN_KEY || 'demo', emailPiattaforma: 'fornitore@esempio.it' });
  const A = 'rossi';
  await sis.admin('aziende.crea', { codice: A, nome: 'Rossi Impianti Srl', classe: 2, pacchetti: ['dpi', 'formazione', 'competenze', 'sanitaria', 'nc', 'attrezzature', 'fornitori', 'strumenti', 'documenti', 'rischi'],
    admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@rossi.it' } });
  const { codice } = await sis.admin('accesso.codice', { codice: A, email: 'mario@rossi.it' });
  const t = (await sis.api(A, [null, 'otp.verifica', { email: 'mario@rossi.it', codice }], 'demo')).token;
  const api = (azione, par) => sis.api(A, [t, azione, par || {}], 'demo');
  const S = async (entita, dati, figli) => (await api('salva', { entita, dati, figli })).riga.id;
  const og = oggi(), io = (await api('avvio')).utente.id;
  await api('config.salva', { indirizzo: 'Via dell\'Industria 12', comune: '20100 Milano (MI)', piva: '01234567890', telefono: '02 1234567', emailDpi: 'rspp@rossi.it' });
  const sede = await S('Sedi', { codice: 'MI', denominazione: 'Stabilimento di Milano', responsabileId: io });
  const guanti = await S('TipiDpi', { codice: 'G-01', descrizione: 'Guanti antitaglio', normativa: 'EN 388', scadenzaMesi: 6 });
  const scarpe = await S('TipiDpi', { codice: 'S-01', descrizione: 'Scarpe antinfortunistiche S3', normativa: 'EN ISO 20345', scadenzaMesi: 12 });
  const antinc = await S('TipiCorso', { tipo: 'Antincendio rischio medio', area: 'Sicurezza', durataOre: 8, aggiornamento: 'SI', frequenzaMesi: 60, durataAggOre: 5 });
  const gen = await S('TipiCorso', { tipo: 'Formazione generale lavoratori', area: 'Sicurezza', durataOre: 4 });
  const sald = await S('Competenze', { area: 'Tecniche', descrizione: 'Saldatura a filo' });
  const fatt = (await api('opzioni', { entita: 'FattoriRischio' })).slice(0, 2).map(f => f.id);
  const op = await S('Mansioni', { codice: 'OP', descrizione: 'Operaio di produzione', sorveglianza: 'SI', fattoriRischio: fatt },
    { MansioniDpi: [{ dpiId: guanti, quantita: 2 }, { dpiId: scarpe, quantita: 1 }], MansioniCorsi: [{ tipoCorsoId: antinc }], MansioniCompetenze: [{ competenzaId: sald, valoreAtteso: '3' }] });
  const uff = await S('Mansioni', { codice: 'UFF', descrizione: 'Impiegato' });
  const luca = await S('Dipendenti', { cognome: 'Verdi', nome: 'Luca', cf: 'VRDLCU85C10F205X', mansioneId: op, sedeId: sede, dataAssunzione: '2019-04-01' });
  const paola = await S('Dipendenti', { cognome: 'Neri', nome: 'Paola', cf: 'NREPLA90A41F205Z', email: 'paola@rossi.it', utente: 'SI', ruolo: 'Utente registrazioni', mansioneId: uff, sedeId: sede, dataAssunzione: '2021-09-01' });
  const agenzia = await S('Soggetti', { ragioneSociale: 'Lavoro Più Spa', fornitore: 'SI', descrizioneFornitura: 'Somministrazione di lavoro' });
  await S('Dipendenti', { cognome: 'Bruni', nome: 'Ugo', mansioneId: op, sedeId: sede, tipoRapporto: 'Interinale (somministrazione)', agenziaId: agenzia, inizioMissione: addGiorni(og, -60), fineMissione: addGiorni(og, 20) });
  await api('pin.imposta', { dipId: luca, pin: '1234' });
  await S('Consegne', { dipendenteId: luca, data: addGiorni(og, -170) }, { ConsegneRighe: [{ dpiId: guanti, quantita: 2, taglia: '9' }, { dpiId: scarpe, quantita: 1, taglia: '43' }] });
  await S('Corsi', { titolo: 'Antincendio 2021', tipoCorsoId: antinc, dataInizio: addGiorni(og, -1810), dataFine: addGiorni(og, -1810), durataOre: 8 }, { CorsiPartecipanti: [{ dipendenteId: luca, ore: 8 }], CorsiDocenti: [{ tipo: 'Esterno', nominativo: 'Ing. Bianchi', email: 'bianchi@studio.it' }] });
  await S('Corsi', { titolo: 'Formazione generale', tipoCorsoId: gen, dataInizio: addGiorni(og, -400), dataFine: addGiorni(og, -400), durataOre: 4 }, { CorsiPartecipanti: [{ dipendenteId: luca }, { dipendenteId: paola }] });
  const acciai = await S('Soggetti', { ragioneSociale: 'Acciai Lombardi Srl', piva: '09876543210', comune: 'Brescia', fornitore: 'SI', descrizioneFornitura: 'Lamiere e profilati' });
  const dom = await api('azione', { entita: 'QualificheFornitori', nome: 'caricaDomande' });
  await S('QualificheFornitori', { soggettoId: acciai, data: addGiorni(og, -90) }, { QualificheRighe: dom.map((d, i) => ({ domandaId: d.domandaId, voto: String(6 + (i % 4)) })) });
  const nc = await S('NC', { descrizione: 'Lotto 2231 con quote fuori tolleranza', tipologia: 'Prodotto', reclamo: 'SI', data: addGiorni(og, -12), stato: 'In gestione' }, { NcCosti: [{ descrizione: 'Rilavorazione', quantita: 3, costo: 45 }] });
  await S('Azioni', { ncId: nc, descrizione: 'Controllo dimensionale a campione su ogni lotto', responsabileId: paola, dataPrevChiusura: addGiorni(og, -3) });
  const piano = await S('PianiManutenzione', { codice: 'P-CAR', descrizione: 'Carrelli elevatori' }, { PianiAttivita: [{ attivita: 'Controllo freni e catene', frequenza: 3, unita: 'Mesi' }, { attivita: 'Verifica periodica di legge', frequenza: 1, unita: 'Anni' }] });
  const tipo = await S('TipiAttrezzatura', { codice: 'CAR', descrizione: 'Carrelli elevatori', pianoId: piano });
  const righe = await api('azione', { entita: 'Attrezzature', nome: 'applyPlan', tipoId: tipo });
  const car = await api('salva', { entita: 'Attrezzature', dati: { codice: 'CAR-01', descrizione: 'Carrello elevatore Toyota', tipoId: tipo, sedeId: sede, marca: 'Toyota', matricola: '8FB-12345' }, figli: { AttrezzatureAttivita: righe } });
  await S('Manutenzioni', { attrezzaturaId: car.riga.id, data: addGiorni(og, -100), esecutoreDipId: luca }, { ManutenzioniRighe: [{ attivitaId: car.figli.AttrezzatureAttivita[0].id }] });
  const camp = await S('Strumenti', { codice: 'CAMP-01', descrizione: 'Blocchetti piano-paralleli', campione: 'SI', ema: 0.001, frequenzaMesi: 24 });
  const cal = await S('Strumenti', { codice: 'CAL-01', descrizione: 'Calibro digitale 150 mm', ema: 0.03, frequenzaMesi: 12, matricola: 'A19-5520', assegnatarioId: luca, sedeId: sede });
  await S('Tarature', { strumentoId: camp, tipo: 'Esterna', data: addGiorni(og, -200), esitoDichiarato: 'Conforme', numCertificato: 'LAT 051/118' });
  await S('Tarature', { strumentoId: cal, campioneId: camp, data: addGiorni(og, -350) }, { TaratureRighe: [{ punto: '10 mm', valoreCampione: 10, valoreStrumento: 10.01 }, { punto: '100 mm', valoreCampione: 100, valoreStrumento: 100.02 }] });
  await S('SorveglianzaSanitaria', { dipendenteId: luca, tipologia: 'Periodica', giudizio: 'Idoneo con prescrizioni', prescrizioni: 'Uso di otoprotettori', dataVisita: addGiorni(og, -350), periodicita: 'Annuale', medicoCompetente: 'Dott.ssa Colombo' });
  const doc = await api('salva', { entita: 'Documenti', dati: { codice: 'PR-01', titolo: 'Gestione degli ordini', tipologia: 'Procedura', redattoDa: io, approvatoDa: io, link: 'https://example.com/pr-01', distTutti: 'SI', riesameMesi: 12 } });
  for (const ruolo of ['Redatto da', 'Approvato da']) await api('firma', { entita: 'Documenti', id: doc.riga.id, key: doc.firme.find(f => f.ruolo === ruolo).key, metodo: 'credenziali' });
  const reg = Object.fromEntries((await api('funzione', { nome: 'rischi.metodi' })).registri.map(r => [r.codice, r.id]));
  const R = par => api('funzione', { nome: 'rischi.salva', ...par });
  const r1 = await R({ registroId: reg.QUALITA, descrizione: 'Ritardo del fornitore critico di lamiere', causa: 'Fornitore unico', effetto: 'Fermo della produzione', responsabileId: paola, valori: { P: 2, G: 3 }, trattamento: 'Qualificare un secondo fornitore', valoriResidui: { P: 1, G: 3 } });
  await R({ registroId: reg.QUALITA, descrizione: 'Errore di lettura del disegno', causa: 'Revisioni non aggiornate in reparto', effetto: 'Pezzi non conformi', valori: { P: 2, G: 2 } });
  await R({ registroId: reg.QUALITA, descrizione: 'Taratura scaduta di uno strumento', valori: { P: 1, G: 2 } });
  await R({ registroId: reg.QUALITA, descrizione: 'Perdita di competenze per turnover', stato: 'Proposta' });
  await R({ registroId: reg.SICUREZZA, descrizione: 'Investimento da carrello elevatore', causa: 'Percorsi promiscui', effetto: 'Infortunio grave', valori: { P: 2, G: 5 } });
  await R({ registroId: reg.OPPORTUNITA, descrizione: 'Certificazione ISO 45001', valori: { B: 3, F: 2 } });
  await S('Azioni', { rischioId: r1.id, descrizione: 'Qualificare un secondo fornitore di lamiere', responsabileId: paola, dataPrevChiusura: addGiorni(og, 25) });
  await api('esci');

  const porta = Number(process.env.PORT) || 3210;
  sis.app.listen(porta, () => console.log('[DEMO] Gestionale: http://localhost:' + porta + '/a/rossi/  (utenti: mario@rossi.it amministratore, paola@rossi.it)\n[DEMO] Piattaforma: http://localhost:' + porta + '/admin  (chiave: ' + (process.env.ADMIN_KEY || 'demo') + ')'));
})().catch(e => { console.error(e); process.exit(1); });
