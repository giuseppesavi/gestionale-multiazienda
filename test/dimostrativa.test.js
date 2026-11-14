'use strict';
// Test dell'azienda dimostrativa: dati inventati in tutte le schede, tutte le stampe, scadenzario pieno.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');
const { STAMPE } = require('../app/stampe');

let sis, posta, t;
const api = (azione, par) => sis.api('demo', [t, azione, par || {}], '3.3.3.3');

test.before(async () => {
  posta = { inviate: [], registro: [], configurata: true, async invia(m) { this.inviate.push(m); return true; } };
  sis = creaSistema({ db: await apriDb({}), postino: posta, adminKey: 'k' });
  await sis.admin('aziende.demo', { codice: 'demo', admin: { cognome: 'Prova', nome: 'Amministratore', email: 'admin@demo.it' }, emailUtente: 'utente@demo.it' });
  assert.equal(posta.inviate.length, 0);                              // durante la creazione non parte nessuna e-mail
  const c = await sis.admin('accesso.codice', { codice: 'demo', email: 'admin@demo.it' });
  t = (await sis.api('demo', [null, 'otp.verifica', { email: 'admin@demo.it', codice: c.codice }], '3.3.3.3')).token;
});

test('ogni scheda del gestionale contiene dati inventati', async () => {
  const av = await api('avvio');
  assert.equal(av.pacchetti.length, 11);
  const vuote = [];
  for (const [e, E] of Object.entries(av.schema)) {
    if (E.child) continue;
    const n = (await api('elenco', { entita: e })).righe.length;
    if (!n) vuote.push(e);
  }
  assert.deepEqual(vuote, []);
  // anche ogni griglia interna ha almeno una riga in qualche scheda
  const senzaRighe = [];
  for (const [e, E] of Object.entries(av.schema)) {
    if (E.child || !E.children.length) continue;
    const piene = new Set();
    for (const r of (await api('elenco', { entita: e })).righe) { const d = await api('leggi', { entita: e, id: r.id }); for (const [k, v] of Object.entries(d.figli)) if (v.length) piene.add(k); }
    for (const c of E.children) if (!piene.has(c.e)) senzaRighe.push(e + ' › ' + c.e);
  }
  assert.deepEqual(senzaRighe, []);
  const az = (await sis.admin('aziende.elenco')).find(a => a.codice === 'demo');
  assert.deepEqual([az.licenza.attivi, az.licenza.classe], [5, 2]);        // quattro addetti attivi più l'amministratore; il cessato non conta
});

test('scadenzario, cruscotto e pagine speciali mostrano qualcosa in ogni sezione', async () => {
  const s = await api('scadenzario', { giorni: 60 });
  assert.deepEqual(s.sezioni.map(x => x.id), ['manutenzioni', 'formazione', 'azioni', 'rischi', 'dpi', 'strumenti', 'missioni', 'visite', 'prese', 'riesami']);
  const vuote = s.sezioni.filter(x => !x.righe.length && x.id !== 'riesami').map(x => x.id);
  assert.deepEqual(vuote, []);
  const c = await api('cruscotto');
  assert.ok(c.contatori.ncAperte >= 1 && c.contatori.azioniScadute >= 1 && c.rischi.attivi >= 6 && c.rischi.proposte === 1);
  for (const nome of ['nc.riepilogo', 'fornitori.qualificati', 'strumenti.registro', 'sanitaria.registro', 'documenti.miei', 'rischi.metodi', 'manutenzioni.inScadenza']) {
    const r = await api('funzione', { nome });
    assert.ok(JSON.stringify(r).length > 60, nome);
  }
  const luca = (await api('elenco', { entita: 'Dipendenti', q: 'Verdi' })).righe[0].id;
  const scheda = await api('scheda.dipendente', { id: luca });
  for (const k of ['dpi', 'formazione', 'valutazioni', 'documenti']) assert.ok(scheda[k].length, k);
  assert.equal(scheda.sanitaria.giudizio, 'Idoneo con prescrizioni');
});

test('tutte le stampe funzionano sui dati dimostrativi', async () => {
  const primo = async (e, q) => (await api('elenco', { entita: e, q })).righe[0].id;
  const id = { verbaleConsegna: await primo('Consegne'), registroCorso: await primo('Corsi'), moduloNc: await primo('NC'), valutazione: await primo('ValutazioniCompetenze'), rapportoManutenzione: await primo('Manutenzioni'),
    schedaAttrezzatura: await primo('Attrezzature'), storicoAttrezzatura: await primo('Attrezzature'), schedaDpi: await primo('TipiDpi'), schedaMansione: await primo('Mansioni', 'OP'), moduloQualifica: await primo('QualificheFornitori'),
    rapportoTaratura: await primo('Tarature'), schedaStrumento: await primo('Strumenti', 'CAL-01'), schedaDocumento: await primo('Documenti', 'PR-01'), storicoDipendente: await primo('Dipendenti', 'Verdi'),
    pianoRischi: (await api('funzione', { nome: 'rischi.metodi' })).registri.find(r => r.codice === 'QUALITA').id };
  for (const nome of Object.keys(STAMPE)) {
    const f = await api('stampa', { nome, id: id[nome] });
    assert.equal(Buffer.from(f.base64, 'base64').subarray(0, 5).toString(), '%PDF-', nome);
  }
});

test('la creazione non riuscita non lascia aziende a metà', async () => {
  await assert.rejects(sis.admin('aziende.demo', { codice: 'demo', admin: { cognome: 'A', nome: 'B', email: 'a@b.it' } }), /Esiste già/);
  await assert.rejects(sis.admin('aziende.demo', { codice: 'demo2', admin: { cognome: 'A', nome: 'B', email: 'non-valida' } }), e => e.utente);
  assert.deepEqual((await sis.admin('aziende.elenco')).map(a => a.codice), ['demo']);
});
