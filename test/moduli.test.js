'use strict';
// Test della fase 4: regole di dominio dei pacchetti (documentazione esclusa, ha un file a parte).
const test = require('node:test');
const assert = require('node:assert/strict');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');
const { oggi } = require('../app/engine');
const { addGiorni, addMesi } = require('../app/regole');

const A = 'moduli';
let sis, posta, ta, tu, mario;
const api = (t, azione, par) => sis.api(A, [t, azione, par || {}], '8.8.8.8');
const S = async (entita, dati, figli) => api(ta, 'salva', { entita, dati, figli });
const id = async (entita, dati, figli) => (await S(entita, dati, figli)).riga.id;
const L = (entita, i) => api(ta, 'leggi', { entita, id: i });
const rifiuta = (p, codice, testo) => assert.rejects(p, e => {
  assert.ok(e.utente, 'atteso un errore per l\'utente: ' + e.stack);
  if (codice) assert.equal(e.codice, codice);
  if (testo) assert.match(e.message, testo);
  return true;
});
async function accedi(email, ip) {
  await sis.api(A, [null, 'otp.richiedi', { email }], ip);
  const m = posta.inviate.filter(x => x.a === email).pop();
  return (await sis.api(A, [null, 'otp.verifica', { email, codice: /è: (\d{6})/.exec(m.testo)[1] }], ip)).token;
}
const og = oggi();

test.before(async () => {
  const db = await apriDb({});
  posta = { inviate: [], registro: [], async invia(m) { this.inviate.push(m); return true; } };
  sis = creaSistema({ db, postino: posta, adminKey: 'k' });
  await sis.admin('aziende.crea', { codice: A, nome: 'Moduli Srl', classe: 2,
    pacchetti: ['dpi', 'formazione', 'competenze', 'sanitaria', 'nc', 'attrezzature', 'fornitori', 'strumenti'],
    admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@moduli.it' } });
  ta = await accedi('mario@moduli.it', '1.0.0.1');
  mario = (await api(ta, 'avvio')).utente.id;
  await S('Dipendenti', { cognome: 'Neri', nome: 'Paola', email: 'paola@moduli.it', utente: 'SI', ruolo: 'Utente registrazioni' });
  tu = await accedi('paola@moduli.it', '1.0.0.2');
});

test('interinali: lo storico dei rapporti si aggiorna da solo e "Assumi direttamente" conserva la storia', async () => {
  const ag = await id('Soggetti', { ragioneSociale: 'Agenzia Lavoro Spa', fornitore: 'SI' });
  await rifiuta(S('Dipendenti', { cognome: 'Blu', nome: 'Ugo', tipoRapporto: 'Interinale (somministrazione)', inizioMissione: '2026-05-01', fineMissione: '2026-04-01' }), 'VALIDAZIONE');
  const d = await S('Dipendenti', { cognome: 'Blu', nome: 'Ugo', tipoRapporto: 'Interinale (somministrazione)', agenziaId: ag, inizioMissione: '2026-05-01', fineMissione: '2026-12-31' });
  assert.equal(d.figli.RapportiLavoro.length, 1);
  assert.equal(d.figli.RapportiLavoro[0].al, '2026-12-31');
  assert.equal(d.riga.inAziendaDal, '01/05/2026');
  await rifiuta(api(tu, 'funzione', { nome: 'dipendenti.assumi', id: d.riga.id }), 'PERMESSO');
  const a = await api(ta, 'funzione', { nome: 'dipendenti.assumi', id: d.riga.id, data: '2026-09-01' });
  assert.equal(a.riga.tipoRapporto, 'Dipendente diretto');
  assert.equal(a.riga.dataAssunzione, '2026-09-01');
  assert.equal(a.riga.inAziendaDal, '01/05/2026');
  assert.deepEqual(a.figli.RapportiLavoro.map(r => [r.tipo, r.dal, r.al]), [
    ['Interinale (somministrazione)', '2026-05-01', '2026-08-31'], ['Dipendente diretto', '2026-09-01', '']]);
  await rifiuta(api(ta, 'funzione', { nome: 'dipendenti.assumi', id: d.riga.id }), '', /già assunto/);
});

test('DPI: "Carica DPI della mansione" considera mansione principale e aggiuntive', async () => {
  const guanti = await id('TipiDpi', { codice: 'G', descrizione: 'Guanti' });
  const casco = await id('TipiDpi', { codice: 'C', descrizione: 'Casco' });
  const m1 = await id('Mansioni', { codice: 'M1', descrizione: 'Operaio' }, { MansioniDpi: [{ dpiId: guanti, quantita: 2 }] });
  const m2 = await id('Mansioni', { codice: 'M2', descrizione: 'Carrellista' }, { MansioniDpi: [{ dpiId: guanti, quantita: 3 }, { dpiId: casco }] });
  const d = await id('Dipendenti', { cognome: 'Gialli', nome: 'Ada', mansioneId: m1, mansioniAgg: m2 });
  const r = await api(tu, 'azione', { entita: 'Consegne', nome: 'caricaDpi', dipendenteId: d });
  assert.deepEqual(r.map(x => [x.etichetta, x.quantita]).sort(), [['C Casco', 1], ['G Guanti', 3]]);
});

test('formazione: scadenze con aggiornamenti frazionati e le due decorrenze', async () => {
  const dip = await id('Dipendenti', { cognome: 'Viola', nome: 'Rita' });
  const corso = async (tipo, modalita, fine, ore) => S('Corsi', { titolo: 'Corso ' + fine, tipoCorsoId: tipo, modalita, dataInizio: fine, dataFine: fine },
    { CorsiPartecipanti: [{ dipendenteId: dip, ore }] });
  const scad = c => c.figli.CorsiPartecipanti[0].scadenza;

  const t1 = await id('TipiCorso', { tipo: 'Lavoratori', area: 'Sicurezza', aggiornamento: 'SI', frequenzaMesi: 60, durataAggOre: 6 });
  assert.equal(scad(await corso(t1, 'Formazione iniziale', '2021-03-10', 8)), '2026-03-10');
  assert.equal(scad(await corso(t1, 'Aggiornamento', '2025-11-01', 3)), '2026-03-10');   // 3 ore su 6: parziale
  assert.equal(scad(await corso(t1, 'Aggiornamento', '2026-02-01', 3)), '2031-03-10');   // completato in tempo: dalla scadenza precedente

  const t2 = await id('TipiCorso', { tipo: 'Carrelli', area: 'Sicurezza', aggiornamento: 'SI', frequenzaMesi: 12, durataAggOre: 4, decorrenza: 'Dalla data di completamento' });
  await corso(t2, 'Formazione iniziale', '2021-03-10', 12);
  assert.equal(scad(await corso(t2, 'Aggiornamento', '2022-01-15', 4)), '2023-01-15');

  const t3 = await id('TipiCorso', { tipo: 'Primo soccorso', area: 'Sicurezza', aggiornamento: 'SI', frequenzaMesi: 12, durataAggOre: 4 });
  await corso(t3, 'Formazione iniziale', '2020-01-01', 12);
  const tardi = await corso(t3, 'Aggiornamento', '2021-06-01', 4);                        // completato in ritardo: dalla data di completamento
  assert.equal(scad(tardi), '2022-06-01');
  assert.equal(tardi.riga.nPartecipanti, '1');

  const t4 = await id('TipiCorso', { tipo: 'Qualità base', area: 'Qualità' });
  await rifiuta(corso(t4, 'Aggiornamento', '2026-01-01', 2), 'VALIDAZIONE', /non prevede aggiornamento/);
  await rifiuta(S('Corsi', { titolo: 'Date', tipoCorsoId: t4, dataInizio: '2026-02-02', dataFine: '2026-02-01' }), 'VALIDAZIONE');
  assert.equal(scad(await corso(t4, 'Formazione iniziale', '2026-01-01', 2)), '');
});

test('competenze: proposta dalle mansioni, "richiesta da" e copertura', async () => {
  const c1 = await id('Competenze', { area: 'Tecniche', descrizione: 'Lettura disegno' });
  const c2 = await id('Competenze', { area: 'Sicurezza', descrizione: 'Uso DPI' });
  const ma = await id('Mansioni', { codice: 'CA', descrizione: 'Addetto A' }, { MansioniCompetenze: [{ competenzaId: c1, valoreAtteso: '3' }, { competenzaId: c2, valoreAtteso: '2' }] });
  const mb = await id('Mansioni', { codice: 'CB', descrizione: 'Addetto B' }, { MansioniCompetenze: [{ competenzaId: c2, valoreAtteso: '4' }] });
  const prop = await api(tu, 'azione', { entita: 'ValutazioniCompetenze', nome: 'caricaCompetenze', mansioni: [ma, mb] });
  assert.deepEqual(prop.map(p => [p.etichetta, p.valoreAtteso]).sort(), [['Lettura disegno', '3'], ['Uso DPI', '4']]);
  const v = await api(tu, 'salva', { entita: 'ValutazioniCompetenze', dati: { dipendenteId: mario, mansioneId: [ma, mb] },
    figli: { ValutazioniRighe: [{ competenzaId: c1, valoreReale: '3' }, { competenzaId: c2, valoreReale: '3' }] } });
  assert.equal(v.riga.copertura, '50% (1/2)');
  assert.equal(v.figli.ValutazioniRighe[1].valoreAtteso, '4');
  assert.deepEqual(v.figli.ValutazioniRighe[1].mansioniRif.split(',').sort(), [ma, mb].sort());
});

test('NC e azioni: costi, chiusura e riepilogo', async () => {
  const nc = await S('NC', { descrizione: 'Lotto difettoso', reclamo: 'SI', tipologia: 'Prodotto', data: '2026-03-05' },
    { NcCosti: [{ descrizione: 'Rilavorazione', quantita: 3, costo: 12.5 }, { descrizione: 'Trasporto', costo: 20 }] });
  assert.equal(nc.riga.costoTotale, '57,50');
  assert.equal(nc.figli.NcCosti[0].totale, '37,50');
  await S('NC', { descrizione: 'Documento mancante', tipologia: 'Documentale', data: '2026-04-01', stato: 'Chiusa' });
  const az = await S('Azioni', { ncId: nc.riga.id, descrizione: 'Controllo in ingresso', stato: 'Chiusa' });
  assert.equal(az.riga.dataChiusura, og);
  assert.match(az.riga.numero, /^AZ-\d{4}-001$/);
  await S('Azioni', { ncId: nc.riga.id, descrizione: 'Formazione operatori', dataPrevChiusura: '2026-01-01' });
  const r = await api(tu, 'funzione', { nome: 'nc.riepilogo', dal: '2026-03-01', al: '2026-12-31' });
  assert.deepEqual(r.totali, { nc: 2, reclami: 1, costo: 57.5, perStato: { Aperta: 1, Chiusa: 1 }, perTipologia: { Prodotto: 1, Documentale: 1 }, azioni: 2, azioniAperte: 1, azioniScadute: 1 });
  assert.equal((await api(tu, 'funzione', { nome: 'nc.riepilogo', reclamo: 'SI' })).nc.length, 1);
});

test('fornitori: media dei voti applicabili, soglia ed esito sul soggetto', async () => {
  const f = await id('Soggetti', { ragioneSociale: 'Acciai Srl', fornitore: 'SI' });
  assert.equal((await L('Soggetti', f)).riga.qualifica, 'Da valutare');
  const dom = await api(tu, 'azione', { entita: 'QualificheFornitori', nome: 'caricaDomande' });
  assert.equal(dom.length, 6);
  const q = (data, voti) => api(tu, 'salva', { entita: 'QualificheFornitori', dati: { soggettoId: f, data }, figli: { QualificheRighe: voti.map((voto, i) => ({ domandaId: dom[i].domandaId, voto })) } });
  let r = await q('2025-01-10', ['6', '6', 'N.A.', '']);
  assert.deepEqual([r.riga.media, r.riga.esito], ['6,00', 'Non qualificato']);   // serve una media MAGGIORE della soglia
  r = await q('2026-01-10', ['7', '6', 'N.A.']);
  assert.deepEqual([r.riga.media, r.riga.esito], ['6,50', 'Qualificato']);
  r = await q('2024-01-10', []);
  assert.equal(r.riga.esito, 'Da valutare');
  const s = (await L('Soggetti', f)).riga;
  assert.deepEqual([s.qualifica, s.mediaQualifica, s.dataQualifica], ['Qualificato', '6,50', '2026-01-10']);
  const el = await api(tu, 'funzione', { nome: 'fornitori.qualificati' });
  assert.equal(el.find(x => x.id === f).esito, 'Qualificato');
});

test('strumenti: punti di misura, esito della taratura, stato dello strumento e del campione', async () => {
  const camp = await id('Strumenti', { codice: 'CAMP1', descrizione: 'Blocchetti campione', campione: 'SI', ema: 0.001, frequenzaMesi: 24 });
  const str = await id('Strumenti', { codice: 'CAL1', descrizione: 'Calibro 150', ema: 0.05, frequenzaMesi: 12 });
  const vecchio = await id('Strumenti', { codice: 'CAL2', descrizione: 'Calibro vecchio', ema: 0.05, frequenzaMesi: 12 });
  assert.equal((await L('Strumenti', str)).riga.statoTaratura, 'Mai tarato');
  await rifiuta(S('Tarature', { strumentoId: str, campioneId: vecchio }), 'VALIDAZIONE', /non è marcato come campione/);
  await rifiuta(S('Tarature', { strumentoId: str }), 'VALIDAZIONE', /Campione utilizzato/);
  await S('Tarature', { strumentoId: camp, tipo: 'Esterna', data: addGiorni(og, -30), esitoDichiarato: 'Conforme', numCertificato: 'LAT-123' });
  assert.equal((await L('Strumenti', camp)).riga.statoTaratura, 'Valida');

  const t = await S('Tarature', { strumentoId: str, campioneId: camp, data: addGiorni(og, -10) }, { TaratureRighe: [
    { punto: '10 mm', valoreCampione: 10, valoreStrumento: 10.02 }, { punto: '20 mm', valoreCampione: 20, valoreStrumento: 20.05 },
    { punto: '50 mm', valoreCampione: 50, valoreStrumento: 50.03, ema: 0.1 }] });
  assert.deepEqual(t.figli.TaratureRighe.map(r => [r.scarto, r.esitoPunto]), [['0,02', 'Conforme'], ['0,05', 'Al limite'], ['0,03', 'Conforme']]);
  assert.equal(t.riga.esito, 'Conforme con avviso');
  assert.equal(t.riga.scadenza, addMesi(addGiorni(og, -10), 12));
  assert.match(t.riga.campioneInfo, /^Valida \(scadenza /);
  assert.equal(t.firme.length, 2);
  assert.equal((await L('Strumenti', str)).riga.statoTaratura, 'Valida con avviso');
  await S('Tarature', { strumentoId: str, campioneId: camp, data: og }, { TaratureRighe: [{ valoreCampione: 10, valoreStrumento: 10.2 }] });
  assert.equal((await L('Strumenti', str)).riga.statoTaratura, 'Non conforme');

  await S('Tarature', { strumentoId: vecchio, campioneId: camp, data: addGiorni(og, -400) }, { TaratureRighe: [{ valoreCampione: 10, valoreStrumento: 10 }] });
  const v = (await L('Strumenti', vecchio)).riga;
  assert.deepEqual([v.statoTaratura, v.esitoTaratura], ['Scaduta', 'Conforme']);
  const reg = await api(tu, 'funzione', { nome: 'strumenti.registro' });
  assert.deepEqual(reg.map(s => s.codice), ['CAL1', 'CAL2', 'CAMP1']);
});

test('attrezzature: piano, manutenzione ordinaria, scadenze, manutenzione massiva per sede', async () => {
  const sede = await id('Sedi', { codice: 'S1', denominazione: 'Stabilimento', responsabileId: mario });
  await rifiuta(S('Sedi', { codice: 'S2', denominazione: 'Senza responsabile' }), 'VALIDAZIONE');
  const piano = await id('PianiManutenzione', { codice: 'P1', descrizione: 'Piano carrelli' },
    { PianiAttivita: [{ attivita: 'Controllo freni', frequenza: 2, unita: 'Mesi' }, { attivita: 'Verifica periodica', frequenza: 1, unita: 'Anni' }] });
  const tipo = await id('TipiAttrezzatura', { codice: 'CAR', descrizione: 'Carrelli', pianoId: piano });
  const righe = await api(ta, 'azione', { entita: 'Attrezzature', nome: 'applyPlan', tipoId: tipo });
  assert.equal(righe.length, 2);
  const a1 = await S('Attrezzature', { codice: 'A1', descrizione: 'Carrello 1', tipoId: tipo, sedeId: sede }, { AttrezzatureAttivita: righe });
  const a2 = await S('Attrezzature', { codice: 'A2', descrizione: 'Carrello 2', tipoId: tipo, sedeId: sede }, { AttrezzatureAttivita: righe });
  assert.equal(a1.riga.prossimaScadenza, 'Mai eseguita');
  assert.equal(a1.riga.responsabile, 'Rossi Mario');
  const [freni, verifica] = a1.figli.AttrezzatureAttivita.map(x => x.id);

  const prop = await api(tu, 'azione', { entita: 'Manutenzioni', nome: 'loadPlanRows', attrezzaturaId: a1.riga.id });
  assert.deepEqual(prop.map(p => p.stato), ['Mai eseguita', 'Mai eseguita']);
  await rifiuta(api(tu, 'salva', { entita: 'Manutenzioni', dati: { attrezzaturaId: a1.riga.id }, figli: { ManutenzioniRighe: [{ attivitaId: a2.figli.AttrezzatureAttivita[0].id }] } }), 'VALIDAZIONE', /non appartiene/);
  const m = await api(tu, 'salva', { entita: 'Manutenzioni', dati: { attrezzaturaId: a1.riga.id, data: addGiorni(og, -70) },
    figli: { ManutenzioniRighe: [{ attivitaId: freni }, { attivitaId: verifica, eseguita: 'NO' }] } });
  assert.equal(m.riga.responsabileId, mario);                    // preso dalla sede
  let att = (await L('Attrezzature', a1.riga.id)).figli.AttrezzatureAttivita;
  assert.equal(att[0].ultimaEsecuzione, addGiorni(og, -70));
  assert.equal(att[0].prossima, addMesi(addGiorni(og, -70), 2));
  assert.equal(att[1].ultimaEsecuzione, '');
  // una riga usata in una manutenzione non si può togliere dall'attrezzatura
  await rifiuta(S('Attrezzature', { id: a1.riga.id }, { AttrezzatureAttivita: [att[1]] }), 'VALIDAZIONE', /non si può togliere/);

  let scad = await api(tu, 'funzione', { nome: 'manutenzioni.inScadenza', sedeId: sede });
  assert.deepEqual(scad.map(x => [x.codice, x.attivita.map(y => y.stato)]), [['A1', ['Scaduta', 'Mai eseguita']], ['A2', ['Mai eseguita', 'Mai eseguita']]]);
  const fatto = await api(tu, 'funzione', { nome: 'manutenzioni.massiva', data: og, esecutoreDipId: mario,
    elementi: scad.map(x => ({ attrezzaturaId: x.attrezzaturaId, attivita: x.attivita.map(y => y.id) })) });
  assert.equal(fatto.create.length, 2);
  scad = await api(tu, 'funzione', { nome: 'manutenzioni.inScadenza', sedeId: sede });
  assert.equal(scad.length, 0);
  assert.match((await L('Attrezzature', a1.riga.id)).riga.prossimaScadenza, /– Regolare$/);

  // eliminando la manutenzione massiva di A1 l'ultima esecuzione torna a quella precedente
  await api(ta, 'elimina', { entita: 'Manutenzioni', id: fatto.create[0] });
  att = (await L('Attrezzature', a1.riga.id)).figli.AttrezzatureAttivita;
  assert.deepEqual(att.map(x => x.ultimaEsecuzione), [addGiorni(og, -70), '']);
});

test('sorveglianza sanitaria: prossima visita, stati, registro e riservatezza', async () => {
  const fattori = (await api(ta, 'opzioni', { entita: 'FattoriRischio' })).slice(0, 2).map(f => f.id);
  const mans = await id('Mansioni', { codice: 'SALD', descrizione: 'Saldatore', sorveglianza: 'SI', fattoriRischio: fattori });
  const d1 = await id('Dipendenti', { cognome: 'Arancio', nome: 'Leo', mansioneId: mans });
  const d2 = await id('Dipendenti', { cognome: 'Bruno', nome: 'Eva', mansioniAgg: mans });
  await rifiuta(api(tu, 'elenco', { entita: 'SorveglianzaSanitaria' }), 'PERMESSO');
  await rifiuta(api(tu, 'funzione', { nome: 'sanitaria.registro' }), 'PERMESSO');
  assert.ok(!(await api(tu, 'avvio')).schema.SorveglianzaSanitaria);

  const prop = await api(ta, 'azione', { entita: 'SorveglianzaSanitaria', nome: 'nuovaVisita', dipendenteId: d1 });
  assert.deepEqual(prop.fattoriRischio.split(',').sort(), [...fattori].sort());
  const base = { dipendenteId: d1, tipologia: 'Periodica', giudizio: 'Idoneo' };
  const v1 = await S('SorveglianzaSanitaria', { ...base, dataVisita: '2026-10-07', periodicita: 'Annuale' });
  assert.equal(v1.riga.prossimaVisita, '2027-10-06');
  await rifiuta(S('SorveglianzaSanitaria', { ...base, dataVisita: '2026-10-07', periodicita: 'Altra (indicare i mesi)' }), 'VALIDAZIONE');
  const v0 = await S('SorveglianzaSanitaria', { ...base, dataVisita: '2024-02-29', periodicita: 'Altra (indicare i mesi)', periodicitaMesi: 18 });
  assert.equal(v0.riga.prossimaVisita, '2025-08-28');
  assert.equal(v0.riga.statoVisita, 'Superata da una visita successiva');
  const man = await S('SorveglianzaSanitaria', { ...base, dataVisita: '2020-01-01', prossimaVisita: '2020-06-30', giudizio: 'Temporaneamente non idoneo', inidoneitaFino: '2020-03-01' });
  assert.equal(man.riga.prossimaVisita, '2020-06-30');             // la data inserita a mano resta

  const reg = await api(ta, 'funzione', { nome: 'sanitaria.registro' });
  assert.deepEqual(reg.map(r => [r.nome, r.stato]), [['Arancio Leo', statoAtteso('2027-10-06')], ['Bruno Eva', 'Visita mancante']]);
  // con la configurazione "Amministratori e utenti" anche l'utente registrazioni vede la sorveglianza
  await sis.archivio.conAzienda(A, async st => st.setProp('config', { ...(st.prop('config') || {}), accessoSanitaria: 'Amministratori e utenti' }));
  assert.equal((await api(tu, 'funzione', { nome: 'sanitaria.registro' })).length, 2);
  void d2;
});

function statoAtteso(data) { return data < og ? 'Scaduta' : data <= addGiorni(og, 30) ? 'In scadenza' : 'Regolare'; }
