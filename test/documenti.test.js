'use strict';
// Test della gestione documentale: ciclo delle revisioni, visibilità per mansione, distribuzione,
// prese visione, nuova revisione, annullamento della firma di approvazione, ritiro, collegamenti.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');
const { oggi } = require('../app/engine');
const { addGiorni, addMesi } = require('../app/regole');

const A = 'docs';
let sis, posta, ta, tp, ts, mario, paola, luca, sara, m1, m2, pr0, pr1, io1;
const api = (t, azione, par) => sis.api(A, [t, azione, par || {}], '7.7.7.7');
const S = (entita, dati, figli) => api(ta, 'salva', { entita, dati, figli });
const F = (t, nome, par) => api(t, 'funzione', { nome, ...par });
const doc = (t, i) => api(t, 'leggi', { entita: 'Documenti', id: i });
const firma = (t, entita, i, ruolo, extra) => api(t, 'leggi', { entita, id: i }).then(s =>
  api(t, 'firma', { entita, id: i, key: s.firme.find(f => f.ruolo === ruolo).key, metodo: 'credenziali', ...extra }));
const prese = async i => (await api(ta, 'elenco', { entita: 'PreseVisione' })).righe.filter(p => p.documentoId === i);
const nomi = async i => { const r = await api(ta, 'elenco', { entita: 'PreseVisione' }); return r.righe.filter(p => p.documentoId === i).map(p => r.etichette[p.dipendenteId]).sort(); };
const rifiuta = (p, codice, testo) => assert.rejects(p, e => {
  assert.ok(e.utente, 'atteso un errore per l\'utente: ' + e.stack);
  if (codice) assert.equal(e.codice, codice);
  if (testo) assert.match(e.message, testo);
  return true;
});
async function accedi(email, ip) {
  await sis.api(A, [null, 'otp.richiedi', { email }], ip);
  const m = posta.inviate.filter(x => x.a === email && /Codice di accesso/.test(x.oggetto)).pop();
  return (await sis.api(A, [null, 'otp.verifica', { email, codice: /è: (\d{6})/.exec(m.testo)[1] }], ip)).token;
}
const og = oggi();

test.before(async () => {
  const db = await apriDb({});
  posta = { inviate: [], registro: [], async invia(m) { this.inviate.push(m); return true; } };
  sis = creaSistema({ db, postino: posta, adminKey: 'k' });
  await sis.admin('aziende.crea', { codice: A, nome: 'Docs Srl', classe: 2, pacchetti: ['documenti'], admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@docs.it' } });
  ta = await accedi('mario@docs.it', '1.0.0.1');
  mario = (await api(ta, 'avvio')).utente.id;
  m1 = (await S('Mansioni', { codice: 'M1', descrizione: 'Produzione' })).riga.id;
  m2 = (await S('Mansioni', { codice: 'M2', descrizione: 'Ufficio' })).riga.id;
  const dip = async d => (await S('Dipendenti', d)).riga.id;
  paola = await dip({ cognome: 'Neri', nome: 'Paola', email: 'paola@docs.it', utente: 'SI', ruolo: 'Utente registrazioni', mansioneId: m1 });
  luca = await dip({ cognome: 'Verdi', nome: 'Luca', mansioneId: m1 });
  sara = await dip({ cognome: 'Blu', nome: 'Sara', email: 'sara@docs.it', utente: 'SI', ruolo: 'Utente registrazioni', mansioneId: m2 });
  await api(ta, 'pin.imposta', { dipId: luca, pin: '2468' });
  tp = await accedi('paola@docs.it', '1.0.0.2');
  ts = await accedi('sara@docs.it', '1.0.0.3');
});

test('bozza: controlli su link, revisioni doppie e revisioni in lavorazione; visibile solo a chi è coinvolto', async () => {
  const base = { codice: 'PR-01', titolo: 'Gestione ordini', tipologia: 'Procedura', redattoDa: mario, approvatoDa: paola, distMansioni: [m1] };
  await rifiuta(S('Documenti', { ...base, link: 'javascript:alert(1)' }), 'VALIDAZIONE', /http/);
  const d = await S('Documenti', { ...base, link: 'intranet.esempio.it/pr01', stato: 'In vigore' });
  pr0 = d.riga.id;
  assert.equal(d.riga.link, 'https://intranet.esempio.it/pr01');
  assert.equal(d.riga.stato, 'Bozza');                              // lo stato non si imposta a mano
  assert.equal(d.riga.revisione, '0');
  await rifiuta(S('Documenti', { ...base }), 'VALIDAZIONE', /esiste già la revisione 0/);
  await rifiuta(S('Documenti', { ...base, revisione: '1' }), 'VALIDAZIONE', /in lavorazione/);
  await rifiuta(api(tp, 'salva', { entita: 'Documenti', dati: { id: pr0, titolo: 'Modificato' } }), 'PERMESSO');
  assert.equal((await api(tp, 'elenco', { entita: 'Documenti' })).righe.length, 1);   // Paola è l'approvatrice
  assert.equal((await api(ts, 'elenco', { entita: 'Documenti' })).righe.length, 0);   // Sara non c'entra
  await rifiuta(doc(ts, pr0), '', /non esiste più/);
  assert.equal((await api(ts, 'opzioni', { entita: 'Documenti' })).length, 0);
});

test('approvazione: solo dopo la firma di chi ha redatto; alla messa in vigore partono le prese visione', async () => {
  await rifiuta(firma(tp, 'Documenti', pr0, 'Approvato da'), '', /solo dopo le firme/);
  let miei = await F(tp, 'documenti.miei');
  assert.deepEqual(miei.daFirmare.map(x => [x.ruolo, x.pronto]), [['Approvato da', false]]);
  await firma(ta, 'Documenti', pr0, 'Redatto da');
  assert.equal((await doc(ta, pr0)).riga.stato, 'In approvazione');
  await rifiuta(firma(ta, 'Documenti', pr0, 'Approvato da'), '', /solo a tuo nome/);
  await firma(tp, 'Documenti', pr0, 'Approvato da');               // approva anche chi non è amministratore
  const d = await doc(ta, pr0);
  assert.deepEqual([d.riga.stato, d.riga.corrente, d.riga.dataApprovazione, d.riga.letture], ['In vigore', 'SI', og, '0/2']);
  assert.deepEqual(await nomi(pr0), ['Neri Paola', 'Verdi Luca']);
  assert.equal((await prese(pr0))[0].entroIl, addGiorni(og, 15));
  assert.ok(posta.inviate.some(m => m.a === 'paola@docs.it' && /Nuovo documento da leggere/.test(m.oggetto)));
  assert.ok(!posta.inviate.some(m => /Nuovo documento/.test(m.oggetto) && m.a !== 'paola@docs.it'));   // Luca non è utente
  await rifiuta(S('Documenti', { id: pr0, titolo: 'X' }), 'FIRMATA');
});

test('prese visione: "Ho letto" con le credenziali, PIN davanti a un incaricato, niente link', async () => {
  let miei = await F(tp, 'documenti.miei');
  assert.equal(miei.daFirmare.length, 0);
  assert.equal(miei.inVigore[0].presa.stato, 'Da firmare');
  const mia = miei.inVigore[0].presa;
  await api(tp, 'firma', { entita: 'PreseVisione', id: mia.id, key: mia.key, metodo: 'credenziali' });
  miei = await F(tp, 'documenti.miei');
  assert.deepEqual([miei.inVigore[0].presa.stato, miei.inVigore[0].presa.dataLettura], ['Firmata', og]);
  const diLuca = (await prese(pr0)).find(p => p.dipendenteId === luca);
  const st = await api(tp, 'leggi', { entita: 'PreseVisione', id: diLuca.id });
  assert.deepEqual(st.firme[0].metodi, ['pin', 'disegno', 'scansione']);
  await rifiuta(api(tp, 'firma.link', { entita: 'PreseVisione', id: diLuca.id, key: st.firme[0].key }), '', /non si firmano tramite link/);
  await api(tp, 'firma', { entita: 'PreseVisione', id: diLuca.id, key: st.firme[0].key, metodo: 'pin', pin: '2468' });
  assert.equal((await doc(ta, pr0)).riga.letture, '2/2');
  assert.equal((await api(ts, 'elenco', { entita: 'PreseVisione' })).righe.length, 0);
});

test('nuovi dipendenti e cambio di mansione ricevono da soli le prese visione', async () => {
  await S('Dipendenti', { cognome: 'Gialli', nome: 'Ada', mansioneId: m1 });
  await S('Dipendenti', { id: sara, mansioniAgg: [m1] });            // mansione aggiuntiva
  assert.deepEqual(await nomi(pr0), ['Blu Sara', 'Gialli Ada', 'Neri Paola', 'Verdi Luca']);
  assert.equal((await api(ts, 'elenco', { entita: 'Documenti' })).righe.length, 1);
  assert.equal((await F(ts, 'documenti.miei')).inVigore[0].presa.stato, 'Da firmare');
});

test('nuova revisione: la precedente diventa superata; presa visione solo per chi non ha letto', async () => {
  const d = await S('Documenti', { codice: 'IO-01', titolo: 'Istruzione imballo', redattoDa: mario, approvatoDa: mario, distTutti: 'SI', presaVisione: 'Nessuna', riesameMesi: 12 },
    { DocumentiCollegamenti: [{ tipo: 'Richiama', collegatoId: pr0 }] });
  io1 = d.riga.id;
  await firma(ta, 'Documenti', io1, 'Redatto da');
  await firma(ta, 'Documenti', io1, 'Approvato da');
  const io = await doc(ta, io1);
  assert.deepEqual([io.riga.stato, io.riga.letture, io.riga.prossimoRiesame], ['In vigore', '', addMesi(og, 12)]);
  assert.equal((await api(ts, 'elenco', { entita: 'Documenti' })).righe.length, 2);   // "tutti i dipendenti"

  await rifiuta(F(tp, 'documenti.nuovaRevisione', { id: pr0 }), 'PERMESSO');
  const n = await F(ta, 'documenti.nuovaRevisione', { id: pr0 });
  pr1 = n.riga.id;
  assert.deepEqual([n.riga.revisione, n.riga.stato, n.riga.link], ['1', 'Bozza', 'https://intranet.esempio.it/pr01']);
  await rifiuta(F(ta, 'documenti.nuovaRevisione', { id: pr0 }), 'VALIDAZIONE', /in lavorazione/);
  await S('Documenti', { id: pr1, presaVisione: 'Solo chi non ha letto le revisioni precedenti', modalitaRevisione: 'Revisione parziale' });
  await firma(ta, 'Documenti', pr1, 'Redatto da');
  await firma(tp, 'Documenti', pr1, 'Approvato da');
  assert.equal((await doc(ta, pr1)).riga.stato, 'In vigore');
  assert.deepEqual([(await doc(ta, pr0)).riga.stato, (await doc(ta, pr0)).riga.corrente], ['Superato', 'NO']);
  assert.deepEqual(await nomi(pr0), ['Neri Paola', 'Verdi Luca']);   // le prese non firmate della vecchia revisione sono annullate
  assert.deepEqual(await nomi(pr1), ['Blu Sara', 'Gialli Ada']);     // Paola e Luca avevano già letto la revisione 0

  // I collegamenti puntano sempre alla revisione corrente; "Citato in" e storico.
  assert.equal((await F(ta, 'documenti.dettaglio', { id: io1 })).collegamenti[0].revisione, '1');
  const det = await F(ta, 'documenti.dettaglio', { id: pr1 });
  assert.deepEqual(det.citatoIn.map(x => [x.codice, x.tipo]), [['IO-01', 'Richiama']]);
  assert.deepEqual(det.storico.map(x => [x.revisione, x.stato]).sort(), [['0', 'Superato'], ['1', 'In vigore']]);
  assert.equal(det.preseVisione.length, 2);
  assert.equal((await F(ts, 'documenti.dettaglio', { id: pr1 })).preseVisione, undefined);
});

test('annullamento dell\'approvazione: torna in approvazione e la revisione precedente torna in vigore', async () => {
  const st = (await doc(ta, pr1)).firme.find(f => f.ruolo === 'Approvato da');
  await rifiuta(api(tp, 'firma.annulla', { firmaId: st.firmaId }), 'PERMESSO');
  await api(ta, 'firma.annulla', { firmaId: st.firmaId, motivo: 'approvato per errore' });
  assert.deepEqual([(await doc(ta, pr1)).riga.stato, (await doc(ta, pr1)).riga.dataApprovazione], ['In approvazione', '']);
  assert.equal((await doc(ta, pr0)).riga.stato, 'In vigore');
  assert.equal((await prese(pr1)).length, 0);
  await firma(tp, 'Documenti', pr1, 'Approvato da');
  assert.equal((await doc(ta, pr1)).riga.stato, 'In vigore');
  assert.equal((await doc(ta, pr0)).riga.stato, 'Superato');
  assert.equal((await prese(pr1)).length, 2);
});

test('ritiro: il documento esce dalla circolazione e le prese visione non firmate sono annullate', async () => {
  await rifiuta(F(tp, 'documenti.ritira', { id: pr1 }), 'PERMESSO');
  await rifiuta(F(ta, 'documenti.ritira', { id: pr0 }), '', /solo un documento in vigore/);
  const r = await F(ta, 'documenti.ritira', { id: pr1 });
  assert.equal(r.riga.stato, 'Ritirato');
  assert.equal((await prese(pr1)).length, 0);
  assert.deepEqual((await F(ts, 'documenti.miei')).inVigore.map(x => x.codice), ['IO-01']);
  await rifiuta(doc(ts, pr1), '', /non esiste più/);
  await rifiuta(api(ta, 'salva', { entita: 'PreseVisione', dati: { documentoId: pr1, dipendenteId: sara } }), 'VALIDAZIONE', /solo ai documenti in vigore/);
  // "Distribuisci" a mano (serve per i documenti importati): non crea doppioni.
  await S('Documenti', { id: undefined, codice: 'MOD-01', titolo: 'Modulo', redattoDa: mario, approvatoDa: mario, distMansioni: [m2] });
  const mod = (await api(ta, 'elenco', { entita: 'Documenti', q: 'MOD-01' })).righe[0].id;
  await firma(ta, 'Documenti', mod, 'Redatto da');
  await firma(ta, 'Documenti', mod, 'Approvato da');
  assert.deepEqual(await nomi(mod), ['Blu Sara']);
  assert.deepEqual(await F(ta, 'documenti.distribuisci', { id: mod }), { create: 0 });
});

test('pacchetto spento: nessuna presa visione creata per i nuovi dipendenti', async () => {
  await sis.admin('aziende.aggiorna', { codice: A, pacchetti: [] });
  await S('Dipendenti', { cognome: 'Nuovo', nome: 'Senza Documenti', mansioneId: m2 });
  await sis.admin('aziende.aggiorna', { codice: A, pacchetti: ['documenti'] });
  const r = await api(ta, 'elenco', { entita: 'PreseVisione' });
  assert.ok(!Object.values(r.etichette).includes('Nuovo Senza Documenti'));
});
