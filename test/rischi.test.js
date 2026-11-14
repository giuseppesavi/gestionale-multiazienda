'use strict';
// Test del pacchetto "Rischi e opportunità": registri, metodi di valutazione, istantanea del metodo,
// proposte, chiusura, azioni con verifica dell'efficacia, piano di gestione.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');
const { oggi } = require('../app/engine');
const { addMesi, addGiorni } = require('../app/regole');

const A = 'rischi';
let sis, posta, ta, tp, ts, mario, paola, reg, metodi;
const api = (t, azione, par) => sis.api(A, [t, azione, par || {}], '5.5.5.5');
const F = (t, nome, par) => api(t, 'funzione', { nome, ...par });
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
const elenco = async (codice, par) => F(ta, 'rischi.elenco', { registroId: reg[codice], ...par });

test.before(async () => {
  posta = { inviate: [], registro: [], async invia(m) { this.inviate.push(m); return true; } };
  sis = creaSistema({ db: await apriDb({}), postino: posta, adminKey: 'k' });
  await sis.admin('aziende.crea', { codice: A, nome: 'Rischi Srl', classe: 2, pacchetti: ['rischi'], admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@rischi.it' } });
  await sis.admin('aziende.crea', { codice: 'senza', nome: 'Senza Srl', classe: 1, pacchetti: [], admin: { cognome: 'Bianchi', nome: 'Anna', email: 'anna@senza.it' } });
  ta = await accedi('mario@rischi.it', '1.0.0.1');
  mario = (await api(ta, 'avvio')).utente.id;
  const dip = async d => (await api(ta, 'salva', { entita: 'Dipendenti', dati: d })).riga.id;
  paola = await dip({ cognome: 'Neri', nome: 'Paola', email: 'paola@rischi.it', utente: 'SI', ruolo: 'Utente registrazioni' });
  await dip({ cognome: 'Blu', nome: 'Sara', email: 'sara@rischi.it', utente: 'SI', ruolo: 'Utente registrazioni' });
  tp = await accedi('paola@rischi.it', '1.0.0.2');
  ts = await accedi('sara@rischi.it', '1.0.0.3');
  const m = await F(ta, 'rischi.metodi');
  reg = Object.fromEntries(m.registri.map(r => [r.codice, r.id]));
  metodi = Object.fromEntries(m.metodi.map(x => [x.nome, x.id]));
});

test('valori iniziali: quattro metodi e quattro registri; il pacchetto spento blocca tutto', async () => {
  const m = await F(tp, 'rischi.metodi');
  assert.deepEqual(m.metodi.map(x => x.nome).sort(), ['Opportunità: Beneficio × Fattibilità 3×3', 'Probabilità × Gravità 3×3', 'Probabilità × Gravità 5×5', 'Probabilità × Gravità × Rilevabilità'].sort());
  assert.deepEqual(m.registri.map(r => [r.codice, r.prefisso, r.tipo]).sort(), [['AMBIENTE', 'RA', 'Rischi'], ['OPPORTUNITA', 'OP', 'Opportunità'], ['QUALITA', 'RQ', 'Rischi'], ['SICUREZZA', 'RS', 'Rischi']]);
  assert.deepEqual(Object.keys(m.preset), ['PG3', 'PG5', 'PGR', 'BF3']);
  const av = await api(ta, 'avvio');
  assert.ok(av.schema.Rischi && av.schema.Azioni && !av.schema.NC);              // le azioni ci sono anche senza il pacchetto NC
  assert.ok(!av.schema.Azioni.fields.some(f => f.name === 'ncId') && av.schema.Azioni.fields.some(f => f.name === 'rischioId'));
  await sis.api('senza', [null, 'otp.richiedi', { email: 'anna@senza.it' }], '1.0.0.9');
  const t = (await sis.api('senza', [null, 'otp.verifica', { email: 'anna@senza.it', codice: /è: (\d{6})/.exec(posta.inviate.filter(x => x.a === 'anna@senza.it').pop().testo)[1] }], '1.0.0.9')).token;
  await assert.rejects(sis.api('senza', [t, 'funzione', { nome: 'rischi.metodi' }], '1'), e => e.codice === 'PACCHETTO');
  await assert.rejects(sis.api('senza', [t, 'elenco', { entita: 'Azioni' }], '1'), e => e.codice === 'PACCHETTO');
});

test('valutazione: punteggio, classe, codice progressivo per registro, valutazione residua e riesame', async () => {
  await rifiuta(F(tp, 'rischi.salva', { registroId: reg.QUALITA, descrizione: 'Non autorizzata' }), 'PERMESSO');
  await rifiuta(F(ta, 'rischi.salva', { registroId: reg.QUALITA, descrizione: '' }), 'VALIDAZIONE');
  await rifiuta(F(ta, 'rischi.salva', { registroId: reg.QUALITA, descrizione: 'Valore fuori scala', valori: { P: 4, G: 1 } }), 'VALIDAZIONE', /Probabilità/);
  await rifiuta(api(ta, 'salva', { entita: 'Rischi', dati: { registroId: reg.QUALITA, descrizione: 'Dalla scheda generica' } }), '', /pagina "Rischi e opportunità"/);
  const r = await F(ta, 'rischi.salva', { registroId: reg.QUALITA, descrizione: 'Ritardo del fornitore critico', causa: 'Fornitore unico', effetto: 'Fermo produzione', responsabileId: paola, valori: { P: 2, G: 3 } });
  assert.deepEqual([r.codice, r.stato, r.valIniziale.punteggio, r.valIniziale.classe, r.valIniziale.colore, r.valIniziale.indicazione], ['RQ-001', 'Attivo', 6, 'Alto', '#9B2C2C', 'Azioni prioritarie']);
  assert.equal(r.prossimoRiesame, addMesi(og, 3));
  assert.equal(r.responsabile, 'Neri Paola');
  assert.equal((await F(ta, 'rischi.salva', { registroId: reg.QUALITA, descrizione: 'Seconda voce' })).codice, 'RQ-002');
  const s = await F(ta, 'rischi.salva', { registroId: reg.SICUREZZA, descrizione: 'Caduta dall\'alto', valori: { P: 2, G: 5 } });
  assert.deepEqual([s.codice, s.valIniziale.punteggio, s.valIniziale.classe], ['RS-001', 10, 'Alto']);
  const o = await F(ta, 'rischi.salva', { registroId: reg.OPPORTUNITA, descrizione: 'Nuovo mercato', valori: { B: 3, F: 3 } });
  assert.deepEqual([o.codice, o.valIniziale.classe], ['OP-001', 'Priorità alta']);

  // Dopo il trattamento: la valutazione residua guida il riesame; la data inserita a mano resta.
  const res = await F(ta, 'rischi.salva', { id: r.id, trattamento: 'Qualificare un secondo fornitore', valoriResidui: { P: 1, G: 3 } });
  assert.deepEqual([res.valResidua.punteggio, res.valResidua.classe, res.prossimoRiesame, res.valIniziale.punteggio], [3, 'Medio', addMesi(og, 6), 6]);
  const man = await F(ta, 'rischi.salva', { id: r.id, prossimoRiesame: '2030-01-15', note: '=formula' });
  assert.deepEqual([man.prossimoRiesame, man.note, man.descrizione], ['2030-01-15', "'=formula", 'Ritardo del fornitore critico']);
  assert.equal((await F(ta, 'rischi.salva', { id: r.id, valoriResidui: null })).valResidua, null);
  const gen = (await api(tp, 'elenco', { entita: 'Rischi', q: 'RQ-001' })).righe[0];
  assert.deepEqual([gen.valutazione, gen.valIniziale], ['6 – Alto', undefined]);
});

test('istantanea del metodo: cambiare metodo non altera le valutazioni già fatte', async () => {
  await api(ta, 'salva', { entita: 'RegistriRischio', dati: { id: reg.QUALITA, metodoId: metodi['Probabilità × Gravità 5×5'] } });
  let e = await elenco('QUALITA');
  assert.equal(e.metodo.nome, 'Probabilità × Gravità 5×5');
  const v = e.righe.find(r => r.codice === 'RQ-001').valIniziale;
  assert.deepEqual([v.metodoNome, v.punteggio, v.classe, v.metodo.fattori[0].livelli.length], ['Probabilità × Gravità 3×3', 6, 'Alto', 3]);
  // Solo rivalutando la voce si applica il nuovo metodo: 2 × 3 = 6, che nel 5×5 è "Medio".
  const r = await F(ta, 'rischi.salva', { id: e.righe[0].id, valori: { P: 2, G: 3 } });
  assert.deepEqual([r.valIniziale.metodoNome, r.valIniziale.classe], ['Probabilità × Gravità 5×5', 'Medio']);
  assert.equal((await F(ta, 'rischi.salva', { registroId: reg.QUALITA, descrizione: 'Con il nuovo metodo', valori: { P: 5, G: 4 } })).valIniziale.classe, 'Critico');
});

test('metodi personalizzati: controlli sulla definizione', async () => {
  const fattori = [{ codice: 'P', nome: 'Probabilità', livelli: [[1, 'Bassa'], [2, 'Alta']] }, { codice: 'D', nome: 'Danno', livelli: [[1, 'Lieve'], [3, 'Grave']] }];
  const salva = (definizione, extra) => F(ta, 'rischi.metodoSalva', { nomeMetodo: 'Metodo interno', definizione, ...extra });
  await rifiuta(salva({ fattori, classi: [{ nome: 'Basso', min: 1, max: 2 }] }), 'VALIDAZIONE', /non coperti da alcuna classe: 3, 6/);
  await rifiuta(salva({ fattori: [{ codice: 'pp', nome: 'x', livelli: [[1, 'a'], [2, 'b']] }], classi: [{ nome: 'A', min: 1, max: 2 }] }), 'VALIDAZIONE', /Codice del fattore/);
  await rifiuta(salva({ fattori: [], classi: [] }), 'VALIDAZIONE', /almeno un fattore/);
  await rifiuta(salva('{non json'), 'VALIDAZIONE');
  await rifiuta(F(tp, 'rischi.metodoSalva', { nomeMetodo: 'X', definizione: { fattori, classi: [{ nome: 'Tutto', min: 1, max: 6 }] } }), 'PERMESSO');
  const m = await salva(JSON.stringify({ fattori, classi: [{ nome: 'Accettabile', min: 1, max: 2, colore: '#2F855A', riesameMesi: 24 }, { nome: 'Da trattare', min: 3, max: 6 }] }));
  const mio = m.metodi.find(x => x.nome === 'Metodo interno');
  assert.deepEqual([mio.definizione.classi[1].riesameMesi, mio.definizione.classi[1].colore, m.metodi.length], [12, '#718096', 5]);
  await api(ta, 'salva', { entita: 'RegistriRischio', dati: { id: reg.AMBIENTE, metodoId: mio.id } });
  const r = await F(ta, 'rischi.salva', { registroId: reg.AMBIENTE, descrizione: 'Sversamento olio', valori: { P: 2, D: 3 } });
  assert.deepEqual([r.codice, r.valIniziale.punteggio, r.valIniziale.classe], ['RA-001', 6, 'Da trattare']);
  await rifiuta(F(ta, 'rischi.metodoSalva', { id: mio.id, nomeMetodo: 'Metodo interno', definizione: mio.definizione, attivo: false }), '', /usato da un registro attivo/);
  await rifiuta(api(ta, 'elimina', { entita: 'MetodiRischio', id: mio.id }), 'IN_USO');
  assert.match((await api(ta, 'elenco', { entita: 'MetodiRischio', q: 'Metodo interno' })).righe[0].riepilogo, /P \(2 livelli\) × D \(2 livelli\) – Accettabile, Da trattare/);
});

test('proposte e chiusura: una proposta si conferma solo se valutata; una voce attiva si chiude con il motivo', async () => {
  const p = await F(ta, 'rischi.salva', { registroId: reg.SICUREZZA, descrizione: 'Rumore in reparto', stato: 'Proposta' });
  assert.deepEqual([p.stato, p.valIniziale, p.prossimoRiesame], ['Proposta', null, '']);
  await rifiuta(F(ta, 'rischi.conferma', { ids: [p.id] }), '', /Valuta la voce RS-002/);
  await F(ta, 'rischi.salva', { id: p.id, valori: { P: 3, G: 2 } });
  assert.deepEqual(await F(ta, 'rischi.conferma', { ids: [p.id] }), { confermate: 1 });
  const scarto = await F(ta, 'rischi.salva', { registroId: reg.SICUREZZA, descrizione: 'Da scartare', stato: 'Proposta' });
  assert.deepEqual(await F(ta, 'rischi.elimina', { id: scarto.id }), { scartata: true });
  await rifiuta(F(ta, 'rischi.elimina', { id: p.id }), '', /motivo della chiusura/);
  await rifiuta(F(tp, 'rischi.elimina', { id: p.id, motivo: 'x' }), 'PERMESSO');
  await F(ta, 'rischi.elimina', { id: p.id, motivo: 'Reparto dismesso' });
  assert.deepEqual((await elenco('SICUREZZA')).righe.map(r => r.codice), ['RS-001']);
  const chiusa = (await elenco('SICUREZZA', { chiusi: true })).righe.find(r => r.codice === 'RS-002');
  assert.deepEqual([chiusa.stato, /Reparto dismesso/.test(chiusa.note)], ['Chiuso', true]);
});

test('azioni: assegnazione con avviso, completamento del responsabile, verifica dell\'efficacia', async () => {
  const r = (await elenco('QUALITA')).righe.find(x => x.codice === 'RQ-001');
  await rifiuta(api(ta, 'salva', { entita: 'Azioni', dati: { rischioId: r.id, descrizione: 'Senza responsabile' } }), 'VALIDAZIONE', /responsabile e la data prevista/);
  const a = await api(ta, 'salva', { entita: 'Azioni', dati: { rischioId: r.id, descrizione: 'Qualificare un secondo fornitore', responsabileId: paola, dataPrevChiusura: addGiorni(og, 30) } });
  const mail = posta.inviate.find(m => m.a === 'paola@rischi.it' && /Azione assegnata \(RQ-001\)/.test(m.oggetto));
  assert.match(mail.testo, /Qualificare un secondo fornitore/);
  assert.deepEqual((await F(tp, 'azioni.mie')).map(x => [x.numero, x.origine]), [[a.riga.numero, 'RQ-001']]);
  const riga = (await elenco('QUALITA')).righe.find(x => x.codice === 'RQ-001');
  assert.deepEqual([riga.azioni.length, riga.azioni[0].responsabile, riga.azioni[0].stato], [1, 'Neri Paola', 'Aperta']);
  assert.equal((await api(ta, 'elenco', { entita: 'Rischi', q: 'RQ-001' })).righe[0].nAzioni, '1 aperte su 1');

  await rifiuta(F(ts, 'azioni.completa', { id: a.riga.id, note: 'Non sono io' }), 'PERMESSO');
  await rifiuta(F(tp, 'azioni.completa', { id: a.riga.id, note: ' ' }), '', /cosa è stato fatto/);
  await rifiuta(F(ta, 'azioni.verifica', { id: a.riga.id, esito: 'Efficace', note: 'x' }), '', /solo un'azione completata/);
  const c = await F(tp, 'azioni.completa', { id: a.riga.id, note: 'Qualificato il fornitore Beta Srl' });
  assert.deepEqual([c.riga.stato, c.riga.dataChiusura, c.riga.noteEsecuzione], ['Chiusa', og, 'Qualificato il fornitore Beta Srl']);
  await rifiuta(F(tp, 'azioni.verifica', { id: a.riga.id, esito: 'Efficace', note: 'x' }), 'PERMESSO');
  await rifiuta(F(ta, 'azioni.verifica', { id: a.riga.id, esito: 'Efficace', note: '' }), '', /evidenze/);
  const no = await F(ta, 'azioni.verifica', { id: a.riga.id, esito: 'Non efficace', note: 'Il secondo fornitore non copre tutti i codici' });
  assert.deepEqual([no.riga.stato, no.riga.dataChiusura, no.riga.esitoEfficacia], ['Aperta', '', 'Non efficace']);   // riaperta
  await F(ta, 'azioni.completa', { id: a.riga.id, note: 'Esteso l\'accordo a tutti i codici' });                    // anche l'amministratore può completarla
  const si = await F(ta, 'azioni.verifica', { id: a.riga.id, esito: 'Efficace', note: 'Nessun ritardo in tre mesi' });
  assert.deepEqual([si.riga.stato, si.riga.esitoEfficacia, si.riga.effData, si.riga.effValutatoreId], ['Chiusa', 'Efficace', og, mario]);
  assert.equal((await F(tp, 'azioni.mie')).length, 0);
});

test('piano di gestione: stampa PDF e documento controllato (bozza, aggiornamento, nuova revisione)', async () => {
  const pdf = Buffer.from((await api(tp, 'stampa', { nome: 'pianoRischi', registroId: reg.QUALITA })).base64, 'base64');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await rifiuta(api(ta, 'stampa', { nome: 'pianoRischi', registroId: reg.OPPORTUNITA.replace(/./g, 'x') }), '', /Registro non valido/);
  await rifiuta(F(ta, 'rischi.piano', { registroId: reg.QUALITA }), 'PACCHETTO');
  await sis.admin('aziende.aggiorna', { codice: A, pacchetti: ['rischi', 'documenti'] });
  await rifiuta(F(tp, 'rischi.piano', { registroId: reg.QUALITA }), 'PERMESSO');
  const p = await F(ta, 'rischi.piano', { registroId: reg.QUALITA, approvatoDa: paola });
  assert.deepEqual([p.codice, p.revisione, p.stato], ['PIANO-RQ', '0', 'Bozza']);
  let doc = await api(ta, 'leggi', { entita: 'Documenti', id: p.documentoId });
  assert.match(doc.riga.file, /\|Piano di gestione Rischi per la qualità\.pdf$/);
  assert.equal((await sis.scaricaFile(A, ta, doc.riga.file.split('|')[0])).mime, 'application/pdf');
  const p2 = await F(ta, 'rischi.piano', { registroId: reg.QUALITA });                       // la bozza viene aggiornata, non duplicata
  assert.equal(p2.documentoId, p.documentoId);
  const firma = async (t, ruolo) => { const d = await api(t, 'leggi', { entita: 'Documenti', id: p.documentoId }); return api(t, 'firma', { entita: 'Documenti', id: p.documentoId, key: d.firme.find(f => f.ruolo === ruolo).key, metodo: 'credenziali' }); };
  await firma(ta, 'Redatto da');
  await rifiuta(F(ta, 'rischi.piano', { registroId: reg.QUALITA }), '', /in approvazione/);
  await firma(tp, 'Approvato da');
  const p3 = await F(ta, 'rischi.piano', { registroId: reg.QUALITA });                       // piano in vigore: nasce la revisione 1
  assert.deepEqual([p3.revisione, p3.stato, p3.documentoId !== p.documentoId], ['1', 'Bozza', true]);
  await rifiuta(F(ta, 'rischi.piano', { registroId: reg.OPPORTUNITA.slice(0, 5) }), '', /Registro non valido/);
});
