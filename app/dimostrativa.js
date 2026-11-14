'use strict';
// Dati inventati per un'azienda dimostrativa: almeno una scheda in ogni sezione, con scadenze
// passate e future, firme, documenti, rischi. Serve per le prove e per mostrare il gestionale.
// api(azione, parametri) esegue le chiamate come amministratore dell'azienda.

const { addGiorni } = require('./regole');
const { oggi } = require('./engine');

const TUTTI_I_PACCHETTI = ['dpi', 'formazione', 'competenze', 'sanitaria', 'nc', 'attrezzature', 'fornitori', 'strumenti', 'documenti', 'rischi'];

async function semina(api, opz = {}) {
  const og = oggi();
  const S = async (entita, dati, figli) => (await api('salva', { entita, dati, figli })).riga.id;
  const F = (nome, par) => api('funzione', { nome, ...par });
  const firma = async (entita, id, ruoli) => { const d = await api('leggi', { entita, id }); for (const s of d.firme) if (!ruoli || ruoli.includes(s.ruolo)) if (s.metodi.includes('credenziali')) await api('firma', { entita, id, key: s.key, metodo: 'credenziali' }); };
  const io = (await api('avvio')).utente.id;

  await api('config.salva', { indirizzo: 'Via dell\'Industria 12', comune: '20100 Milano (MI)', piva: '01234567890', telefono: '02 1234567' });
  // Anagrafiche
  const sede = await S('Sedi', { codice: 'MI', denominazione: 'Stabilimento di Milano', indirizzo: 'Via dell\'Industria 12', comune: 'Milano', responsabileId: io });
  const sede2 = await S('Sedi', { codice: 'BG', denominazione: 'Magazzino di Bergamo', comune: 'Bergamo', responsabileId: io });
  const guanti = await S('TipiDpi', { codice: 'G-01', descrizione: 'Guanti antitaglio', normativa: 'EN 388', utilizzo: 'Movimentazione lamiere', scadenzaMesi: 6 });
  const scarpe = await S('TipiDpi', { codice: 'S-01', descrizione: 'Scarpe antinfortunistiche S3', normativa: 'EN ISO 20345', scadenzaMesi: 12 });
  const cuffie = await S('TipiDpi', { codice: 'C-01', descrizione: 'Cuffie antirumore', normativa: 'EN 352-1' });
  const antinc = await S('TipiCorso', { tipo: 'Antincendio rischio medio', area: 'Sicurezza', durataOre: 8, note: 'Principi della combustione, estintori, prova pratica', aggiornamento: 'SI', frequenzaMesi: 60, durataAggOre: 5 });
  const gen = await S('TipiCorso', { tipo: 'Formazione generale lavoratori', area: 'Sicurezza', durataOre: 4 });
  const carr = await S('TipiCorso', { tipo: 'Addetto carrelli elevatori', area: 'Sicurezza', durataOre: 12, aggiornamento: 'SI', frequenzaMesi: 60, durataAggOre: 4 });
  const sald = await S('Competenze', { area: 'Tecniche', descrizione: 'Saldatura a filo' });
  const dis = await S('Competenze', { area: 'Tecniche', descrizione: 'Lettura del disegno tecnico' });
  const dpiUso = await S('Competenze', { area: 'Sicurezza', descrizione: 'Uso corretto dei DPI' });
  const fatt = (await api('opzioni', { entita: 'FattoriRischio' })).slice(0, 3).map(f => f.id);
  const resp = await S('Mansioni', { ordine: 1, codice: 'RP', descrizione: 'Responsabile di produzione', descrizioneMansione: 'Pianifica e controlla la produzione.' });
  const op = await S('Mansioni', { ordine: 2, codice: 'OP', descrizione: 'Operaio di produzione', descrizioneMansione: 'Lavorazioni di carpenteria e saldatura.', riportaA: resp, sorveglianza: 'SI', fattoriRischio: fatt },
    { MansioniDpi: [{ dpiId: guanti, quantita: 2 }, { dpiId: scarpe, quantita: 1 }, { dpiId: cuffie, quantita: 1 }], MansioniCorsi: [{ tipoCorsoId: antinc }, { tipoCorsoId: carr, note: 'Solo per chi usa il carrello' }],
      MansioniCompetenze: [{ competenzaId: sald, valoreAtteso: '3' }, { competenzaId: dis, valoreAtteso: '3' }, { competenzaId: dpiUso, valoreAtteso: '4' }] });
  const uff = await S('Mansioni', { ordine: 3, codice: 'UFF', descrizione: 'Impiegato amministrativo', riportaA: resp });
  const agenzia = await S('Soggetti', { ragioneSociale: 'Lavoro Più Spa', comune: 'Milano', fornitore: 'SI', descrizioneFornitura: 'Somministrazione di lavoro' });
  const acciai = await S('Soggetti', { ragioneSociale: 'Acciai Lombardi Srl', piva: '09876543210', indirizzo: 'Via Brescia 4', comune: 'Brescia', email: 'vendite@acciai-lombardi.example', fornitore: 'SI', descrizioneFornitura: 'Lamiere e profilati' });
  const lab = await S('Soggetti', { ragioneSociale: 'Laboratorio Metrologico Alfa', comune: 'Monza', fornitore: 'SI', descrizioneFornitura: 'Tarature accreditate' });
  await S('Soggetti', { ragioneSociale: 'Costruzioni Edili Bianchi Spa', comune: 'Como', cliente: 'SI' });
  const luca = await S('Dipendenti', { cognome: 'Verdi', nome: 'Luca', cf: 'VRDLCU85C10F205X', mansioneId: op, sedeId: sede, contratto: 'Tempo indeterminato', dataAssunzione: '2019-04-01' });
  const paola = await S('Dipendenti', { cognome: 'Neri', nome: 'Paola', cf: 'NREPLA90A41F205Z', mansioneId: uff, mansioniAgg: [resp], sedeId: sede, contratto: 'Tempo indeterminato', dataAssunzione: '2021-09-01',
    ...(opz.emailUtente ? { email: opz.emailUtente, utente: 'SI', ruolo: 'Utente registrazioni' } : {}) });
  const sara = await S('Dipendenti', { cognome: 'Gialli', nome: 'Sara', cf: 'GLLSRA95D45F205K', mansioneId: op, sedeId: sede2, contratto: 'Apprendistato', dataAssunzione: addGiorni(og, -200) });
  await S('Dipendenti', { cognome: 'Bruni', nome: 'Ugo', mansioneId: op, sedeId: sede, tipoRapporto: 'Interinale (somministrazione)', agenziaId: agenzia, inizioMissione: addGiorni(og, -60), fineMissione: addGiorni(og, 20), rifContratto: 'ORD-2026/118' });
  await S('Dipendenti', { cognome: 'Grigi', nome: 'Aldo', cf: 'GRGLDA60A01F205W', mansioneId: op, sedeId: sede, dataAssunzione: '2005-03-01', dataLicenziamento: addGiorni(og, -90) });
  await api('pin.imposta', { dipId: luca, pin: '1234' });
  await api('pin.imposta', { dipId: sara, pin: '1234' });

  // DPI
  const c1 = await S('Consegne', { dipendenteId: luca, data: addGiorni(og, -170), note: 'Prima dotazione' }, { ConsegneRighe: [{ dpiId: guanti, quantita: 2, taglia: '9' }, { dpiId: scarpe, quantita: 1, taglia: '43' }] });
  await firma('Consegne', c1);
  await api('firma', { entita: 'Consegne', id: c1, key: (await api('leggi', { entita: 'Consegne', id: c1 })).firme.find(f => f.ruolo === 'Lavoratore').key, metodo: 'pin', pin: '1234' });
  await S('Consegne', { dipendenteId: sara, data: addGiorni(og, -5) }, { ConsegneRighe: [{ dpiId: guanti, quantita: 2, taglia: '7' }, { dpiId: cuffie, quantita: 1 }] });
  // Formazione
  await S('Corsi', { titolo: 'Antincendio rischio medio 2021', tipoCorsoId: antinc, luogo: 'Sala corsi', dataInizio: addGiorni(og, -1810), dataFine: addGiorni(og, -1810), durataOre: 8, programma: 'Teoria e prova pratica con estintore' },
    { CorsiPartecipanti: [{ dipendenteId: luca, ore: 8 }], CorsiDocenti: [{ tipo: 'Esterno', nominativo: 'Ing. Bianchi' }] });
  await S('Corsi', { titolo: 'Formazione generale lavoratori', tipoCorsoId: gen, dataInizio: addGiorni(og, -180), dataFine: addGiorni(og, -180), durataOre: 4, effDescrizione: 'Test finale superato da tutti', effModalita: 'Test scritto', effData: addGiorni(og, -180), effValutatoreId: io },
    { CorsiPartecipanti: [{ dipendenteId: luca }, { dipendenteId: paola }, { dipendenteId: sara }], CorsiDocenti: [{ tipo: 'Dipendente', dipendenteId: io }] });
  await S('Corsi', { titolo: 'Carrelli elevatori', tipoCorsoId: carr, dataInizio: addGiorni(og, -700), dataFine: addGiorni(og, -699), durataOre: 12 }, { CorsiPartecipanti: [{ dipendenteId: luca, ore: 12 }] });
  // Competenze
  const comp = await api('azione', { entita: 'ValutazioniCompetenze', nome: 'caricaCompetenze', mansioni: [op] });
  await S('ValutazioniCompetenze', { dipendenteId: luca, mansioneId: [op], data: addGiorni(og, -40), note: 'Valutazione annuale' }, { ValutazioniRighe: comp.map((c, i) => ({ competenzaId: c.competenzaId, valoreAtteso: c.valoreAtteso, valoreReale: String(i === 0 ? 4 : 3) })) });
  // Sorveglianza sanitaria
  await S('SorveglianzaSanitaria', { dipendenteId: luca, mansioniIds: [op], sedeId: sede, tipologia: 'Periodica', giudizio: 'Idoneo con prescrizioni', prescrizioni: 'Uso di otoprotettori', fattoriRischio: fatt, dataVisita: addGiorni(og, -350), periodicita: 'Annuale', medicoCompetente: 'Dott.ssa Colombo' });
  await S('SorveglianzaSanitaria', { dipendenteId: sara, mansioniIds: [op], tipologia: 'Preventiva', giudizio: 'Idoneo', dataVisita: addGiorni(og, -195), periodicita: 'Biennale', medicoCompetente: 'Dott.ssa Colombo' });
  // Fornitori
  const dom = await api('azione', { entita: 'QualificheFornitori', nome: 'caricaDomande' });
  await S('QualificheFornitori', { soggettoId: acciai, data: addGiorni(og, -90), note: 'Fornitore affidabile' }, { QualificheRighe: dom.map((d, i) => ({ domandaId: d.domandaId, voto: String(6 + (i % 4)) })) });
  await S('QualificheFornitori', { soggettoId: agenzia, data: addGiorni(og, -30) }, { QualificheRighe: dom.map((d, i) => ({ domandaId: d.domandaId, voto: i === 3 ? 'N.A.' : String(4 + (i % 3)) })) });
  // Non conformità e azioni
  const nc = await S('NC', { descrizione: 'Lotto 2231 con quote fuori tolleranza', riferimento: 'Ordine 4521', tipologia: 'Prodotto', reclamo: 'SI', data: addGiorni(og, -12), stato: 'In gestione', rilevatoreTipo: 'Fornitore', rilevatoreSoggId: acciai,
    gestione: 'Selezione e rilavorazione del lotto', analisiCause: 'Utensile usurato non sostituito', serveAzione: 'SI' }, { NcCosti: [{ descrizione: 'Rilavorazione', quantita: 3, costo: 45 }, { descrizione: 'Trasporto urgente', quantita: 1, costo: 80 }] });
  await S('NC', { descrizione: 'Documento di trasporto senza certificato del materiale', tipologia: 'Documentale', data: addGiorni(og, -60), stato: 'Chiusa', rilevatoreDipId: paola });
  await S('Azioni', { ncId: nc, descrizione: 'Controllo dimensionale a campione su ogni lotto', responsabileId: paola, dataPrevChiusura: addGiorni(og, -3) });
  const azChiusa = await S('Azioni', { ncId: nc, descrizione: 'Sostituzione programmata degli utensili ogni 500 pezzi', responsabileId: io, dataPrevChiusura: addGiorni(og, -1) });
  await F('azioni.completa', { id: azChiusa, note: 'Inserito il contapezzi sulla macchina' });
  await F('azioni.verifica', { id: azChiusa, esito: 'Efficace', note: 'Nessuna non conformità sugli ultimi tre lotti' });
  // Attrezzature e manutenzioni
  const piano = await S('PianiManutenzione', { codice: 'P-CAR', descrizione: 'Carrelli elevatori' }, { PianiAttivita: [{ attivita: 'Controllo freni e catene', frequenza: 3, unita: 'Mesi', istruzioni: 'Secondo il manuale del costruttore' }, { attivita: 'Verifica periodica di legge', frequenza: 1, unita: 'Anni' }] });
  const pianoC = await S('PianiManutenzione', { codice: 'P-COMP', descrizione: 'Compressori' }, { PianiAttivita: [{ attivita: 'Scarico condensa', frequenza: 1, unita: 'Settimane' }, { attivita: 'Sostituzione filtri', frequenza: 6, unita: 'Mesi' }] });
  const tipo = await S('TipiAttrezzatura', { codice: 'CAR', descrizione: 'Carrelli elevatori', pianoId: piano });
  const tipoC = await S('TipiAttrezzatura', { codice: 'COMP', descrizione: 'Compressori', pianoId: pianoC });
  const crea = async (dati, tipoId) => api('salva', { entita: 'Attrezzature', dati: { ...dati, tipoId }, figli: { AttrezzatureAttivita: await api('azione', { entita: 'Attrezzature', nome: 'applyPlan', tipoId }) } });
  const car = await crea({ codice: 'CAR-01', descrizione: 'Carrello elevatore Toyota', sedeId: sede, marca: 'Toyota', modello: '8FB', matricola: '8FB-12345', dataAcquisto: '2020-03-15', fornitoreId: acciai }, tipo);
  const cmp = await crea({ codice: 'COMP-01', descrizione: 'Compressore a vite', sedeId: sede2, marca: 'Atlas', matricola: 'GA-7781' }, tipoC);
  const m1 = await S('Manutenzioni', { attrezzaturaId: car.riga.id, data: addGiorni(og, -100), esecutoreDipId: luca, descrizione: 'Controllo trimestrale', costo: 0 }, { ManutenzioniRighe: [{ attivitaId: car.figli.AttrezzatureAttivita[0].id, note: 'Catene lubrificate' }] });
  await firma('Manutenzioni', m1);
  await S('Manutenzioni', { attrezzaturaId: cmp.riga.id, data: addGiorni(og, -3), tipo: 'Straordinaria', esito: 'Da ricontrollare', esecutoreTipo: 'Esterno', esecutoreSoggId: lab, esecutoreNome: 'Sig. Fumagalli', descrizione: 'Perdita d\'olio dalla guarnizione', costo: 180 });
  // Strumenti e tarature
  const camp = await S('Strumenti', { codice: 'CAMP-01', descrizione: 'Blocchetti piano-paralleli', tipologia: 'Calibro', campione: 'SI', ema: 0.001, frequenzaMesi: 24, sedeId: sede });
  const cal = await S('Strumenti', { codice: 'CAL-01', descrizione: 'Calibro digitale 150 mm', tipologia: 'Calibro', marca: 'Mitutoyo', matricola: 'A19-5520', campoMisura: '0-150 mm', risoluzione: '0,01 mm', unita: 'mm', ema: 0.03, frequenzaMesi: 12, assegnatarioId: luca, sedeId: sede });
  await S('Strumenti', { codice: 'MIC-01', descrizione: 'Micrometro 0-25 mm', tipologia: 'Micrometro', ema: 0.004, frequenzaMesi: 12, sedeId: sede });
  await S('Tarature', { strumentoId: camp, tipo: 'Esterna', data: addGiorni(og, -200), laboratorioId: lab, esitoDichiarato: 'Conforme', numCertificato: 'LAT 051/118' });
  await S('Tarature', { strumentoId: cal, campioneId: camp, data: addGiorni(og, -350), condizioni: '20 °C, 50% U.R.' }, { TaratureRighe: [{ punto: '10 mm', valoreCampione: 10, valoreStrumento: 10.01 }, { punto: '50 mm', valoreCampione: 50, valoreStrumento: 50.03 }, { punto: '100 mm', valoreCampione: 100, valoreStrumento: 100.02 }] });
  // Documenti
  const mod = await api('salva', { entita: 'Documenti', dati: { codice: 'MOD-01', titolo: 'Modulo di controllo dimensionale', tipologia: 'Modulo', redattoDa: io, approvatoDa: io, link: 'https://example.com/mod-01', distMansioni: [op], presaVisione: 'Nessuna' } });
  await firma('Documenti', mod.riga.id, ['Redatto da']); await firma('Documenti', mod.riga.id, ['Approvato da']);
  const doc = await api('salva', { entita: 'Documenti', dati: { codice: 'PR-01', titolo: 'Gestione degli ordini', tipologia: 'Procedura', modalitaRevisione: 'Prima emissione', redattoDa: io, approvatoDa: io, link: 'https://example.com/pr-01', distTutti: 'SI', riesameMesi: 12 },
    figli: { DocumentiCollegamenti: [{ tipo: 'Modulo da usare', collegatoId: mod.riga.id }] } });
  await firma('Documenti', doc.riga.id, ['Redatto da']); await firma('Documenti', doc.riga.id, ['Approvato da']);
  await S('Documenti', { codice: 'IO-01', titolo: 'Istruzione di saldatura', tipologia: 'Istruzione operativa', redattoDa: io, approvatoDa: io, distMansioni: [op] });
  const mia = (await F('documenti.miei')).inVigore.find(d => d.presa);
  if (mia) await api('firma', { entita: 'PreseVisione', id: mia.presa.id, key: mia.presa.key, metodo: 'credenziali' });
  // Rischi e opportunità
  const prc = await S('Processi', { codice: 'PRD', descrizione: 'Produzione', responsabileId: io });
  const acq = await S('Processi', { codice: 'ACQ', descrizione: 'Approvvigionamento', responsabileId: paola });
  const reg = Object.fromEntries((await F('rischi.metodi')).registri.map(r => [r.codice, r.id]));
  const r1 = await F('rischi.salva', { registroId: reg.QUALITA, processoId: acq, descrizione: 'Ritardo del fornitore critico di lamiere', causa: 'Fornitore unico', effetto: 'Fermo della produzione', fonte: 'Riesame della direzione', responsabileId: paola, valori: { P: 2, G: 3 }, trattamento: 'Qualificare un secondo fornitore', valoriResidui: { P: 1, G: 3 } });
  await F('rischi.salva', { registroId: reg.QUALITA, processoId: prc, descrizione: 'Errore di lettura del disegno', causa: 'Revisioni non aggiornate in reparto', effetto: 'Pezzi non conformi', responsabileId: io, valori: { P: 2, G: 2 } });
  await F('rischi.salva', { registroId: reg.QUALITA, processoId: prc, descrizione: 'Taratura scaduta di uno strumento', valori: { P: 1, G: 2 }, prossimoRiesame: addGiorni(og, 15) });
  await F('rischi.salva', { registroId: reg.QUALITA, descrizione: 'Perdita di competenze per turnover', stato: 'Proposta' });
  await F('rischi.salva', { registroId: reg.SICUREZZA, processoId: prc, descrizione: 'Investimento da carrello elevatore', causa: 'Percorsi promiscui', effetto: 'Infortunio grave', valori: { P: 2, G: 5 }, trattamento: 'Segnaletica orizzontale e specchi', valoriResidui: { P: 1, G: 5 } });
  await F('rischi.salva', { registroId: reg.SICUREZZA, descrizione: 'Esposizione al rumore in carpenteria', valori: { P: 4, G: 2 } });
  await F('rischi.salva', { registroId: reg.AMBIENTE, descrizione: 'Sversamento di olio dal compressore', valori: { P: 1, G: 3 } });
  await F('rischi.salva', { registroId: reg.OPPORTUNITA, descrizione: 'Certificazione ISO 45001', effetto: 'Accesso a nuove gare', valori: { B: 3, F: 2 } });
  await S('Azioni', { rischioId: r1.id, descrizione: 'Qualificare un secondo fornitore di lamiere', responsabileId: paola, dataPrevChiusura: addGiorni(og, 25) });
}

module.exports = { semina, TUTTI_I_PACCHETTI };
