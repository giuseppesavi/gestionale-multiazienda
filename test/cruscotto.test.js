'use strict';
// Test di scadenzario, cruscotto, configurazione dell'azienda, pannello della piattaforma e pagine web.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');
const { oggi } = require('../app/engine');
const { addGiorni } = require('../app/regole');

const A = 'crus';
let db, sis, posta, ta, tu, mario, luca;
const api = (t, azione, par) => sis.api(A, [t, azione, par || {}], '4.4.4.4');
const S = async (entita, dati, figli) => (await api(ta, 'salva', { entita, dati, figli })).riga.id;
const rifiuta = (p, codice, testo) => assert.rejects(p, e => { assert.ok(e.utente, e.stack); if (codice) assert.equal(e.codice, codice); if (testo) assert.match(e.message, testo); return true; });
const og = oggi();
const sezione = (s, id) => s.sezioni.find(x => x.id === id);

test.before(async () => {
  db = await apriDb({});
  posta = { inviate: [], registro: [], configurata: true, async invia(m) { this.inviate.push(m); return true; } };
  sis = creaSistema({ db, postino: posta, adminKey: 'k' });
  await sis.admin('aziende.crea', { codice: A, nome: 'Cruscotto Srl', classe: 2, pacchetti: ['dpi', 'formazione', 'nc', 'rischi', 'strumenti'], admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@crus.it' } });
  const c = await sis.admin('accesso.codice', { codice: A, email: 'mario@crus.it' });   // codice generato dalla piattaforma
  assert.match(c.codice, /^\d{6}$/);
  ta = (await sis.api(A, [null, 'otp.verifica', { email: 'mario@crus.it', codice: c.codice }], '1.0.0.1')).token;
  mario = (await api(ta, 'avvio')).utente.id;
  const corso = await S('TipiCorso', { tipo: 'Antincendio', area: 'Sicurezza', aggiornamento: 'SI', frequenzaMesi: 12, durataAggOre: 4 });
  const guanti = await S('TipiDpi', { codice: 'G', descrizione: 'Guanti', scadenzaMesi: 6 });
  const op = await S('Mansioni', { codice: 'OP', descrizione: 'Operaio' }, { MansioniCorsi: [{ tipoCorsoId: corso }] });
  luca = await S('Dipendenti', { cognome: 'Verdi', nome: 'Luca', mansioneId: op });
  const paola = await S('Dipendenti', { cognome: 'Neri', nome: 'Paola', email: 'paola@crus.it', utente: 'SI', ruolo: 'Utente registrazioni', mansioneId: op });
  await S('Dipendenti', { cognome: 'Blu', nome: 'Ugo', tipoRapporto: 'Interinale (somministrazione)', inizioMissione: addGiorni(og, -30), fineMissione: addGiorni(og, 10) });
  await S('Corsi', { titolo: 'Antincendio', tipoCorsoId: corso, dataInizio: addGiorni(og, -400), dataFine: addGiorni(og, -400) }, { CorsiPartecipanti: [{ dipendenteId: paola, ore: 8 }] });
  await S('Consegne', { dipendenteId: luca, data: addGiorni(og, -170) }, { ConsegneRighe: [{ dpiId: guanti }] });
  await S('Azioni', { descrizione: 'Azione in ritardo', responsabileId: mario, dataPrevChiusura: addGiorni(og, -5) });
  await S('Azioni', { descrizione: 'Azione lontana', dataPrevChiusura: addGiorni(og, 300) });
  await S('NC', { descrizione: 'NC aperta' });
  await S('Strumenti', { codice: 'S1', descrizione: 'Calibro', ema: 0.05, frequenzaMesi: 12 });
  const reg = (await api(ta, 'funzione', { nome: 'rischi.metodi' })).registri.find(r => r.codice === 'QUALITA').id;
  await api(ta, 'funzione', { nome: 'rischi.salva', registroId: reg, descrizione: 'Rischio da riesaminare', valori: { P: 3, G: 3 }, prossimoRiesame: addGiorni(og, 12) });
  const cu = await sis.admin('accesso.codice', { codice: A, email: 'paola@crus.it' });
  tu = (await sis.api(A, [null, 'otp.verifica', { email: 'paola@crus.it', codice: cu.codice }], '1.0.0.2')).token;
});

test('scadenzario: ogni sezione mostra le sue scadenze, anche la formazione mai svolta', async () => {
  const s = await api(tu, 'scadenzario', { giorni: 60 });
  assert.deepEqual(s.sezioni.map(x => x.id), ['formazione', 'azioni', 'rischi', 'dpi', 'strumenti', 'missioni']);
  assert.deepEqual(sezione(s, 'formazione').righe.map(r => [r.stato, r.testo]).sort(), [['Mai svolta', 'Rossi Mario – Antincendio'].slice(0, 0), ['Mai svolta', 'Verdi Luca – Antincendio'], ['Scaduta', 'Neri Paola – Antincendio']].filter(x => x.length).sort());
  assert.deepEqual(sezione(s, 'azioni').righe.map(r => [r.stato, /Azione in ritardo/.test(r.testo), r.entita]), [['Scaduta', true, 'Azioni']]);
  assert.deepEqual(sezione(s, 'rischi').righe.map(r => [r.stato, r.data]), [['In scadenza', addGiorni(og, 12)]]);
  assert.deepEqual(sezione(s, 'dpi').righe.map(r => [r.stato, /Verdi Luca – G Guanti \(indicativa\)/.test(r.testo)]), [['In scadenza', true]]);
  assert.deepEqual(sezione(s, 'strumenti').righe.map(r => r.stato), ['Mai tarato']);
  assert.deepEqual(sezione(s, 'missioni').righe.map(r => r.data), [addGiorni(og, 10)]);
  assert.equal(sezione(await api(tu, 'scadenzario', { giorni: 5 }), 'rischi').righe.length, 0);     // finestra regolabile
  await sis.admin('aziende.aggiorna', { codice: A, pacchetti: ['dpi', 'formazione', 'nc', 'strumenti'] });
  const senza = await api(tu, 'scadenzario', {});
  assert.ok(!sezione(senza, 'rischi') && sezione(senza, 'azioni'));                                   // le azioni restano con il pacchetto NC
  await sis.admin('aziende.aggiorna', { codice: A, pacchetti: ['dpi', 'formazione', 'nc', 'rischi', 'strumenti'] });
});

test('cruscotto: contatori, scadenze a 30 giorni e licenza', async () => {
  const c = await api(ta, 'cruscotto');
  assert.deepEqual(c.contatori, { dipendentiAttivi: 4, consegne30: 0, ncAperte: 1, azioniAperte: 2, azioniScadute: 1 });
  assert.deepEqual([c.mieAzioni, c.rischi.attivi, c.rischi.perClasse.Alto, c.licenza.max], [1, 1, 1, 50]);
  assert.deepEqual(c.scadenze.formazione, { scadute: 2, inScadenza: 0 });
  assert.deepEqual(c.scadenze.rischi, { scadute: 0, inScadenza: 1 });
  assert.equal(c.firmeInAttesa, 3);                                                                   // corso, consegna, NC
  assert.equal(c.scadenze.visite, undefined);                                                          // pacchetto non attivo
});

test('configurazione: controlli sui valori, solo amministratori, effetto sull\'avvio; preferenze del menu', async () => {
  await rifiuta(api(tu, 'config.leggi'), 'PERMESSO');
  await rifiuta(api(tu, 'config.salva', { colore: '#000000' }), 'PERMESSO');
  await rifiuta(api(ta, 'config.salva', { otpMinuti: 60, colore: 'rosso', emailDpi: 'non-una-mail', accessoSanitaria: 'Tutti' }), 'VALIDAZIONE', /E-mail per i verbali[\s\S]*Validità del codice[\s\S]*Colore[\s\S]*sorveglianza sanitaria/);
  const c = await api(ta, 'config.salva', { ragioneSociale: 'Cruscotto Srl Unipersonale', colore: '#0A6640', otpMinuti: 5, sogliaQualifica: 7, emailDpi: 'RSPP@crus.it' });
  assert.deepEqual([c.colore, c.otpMinuti, c.sogliaQualifica, c.emailDpi, c.sessioneOre], ['#0A6640', 5, 7, 'rspp@crus.it', 6]);
  const av = await api(tu, 'avvio');
  assert.deepEqual(av.config, { ragioneSociale: 'Cruscotto Srl Unipersonale', colore: '#0A6640', logo: '' });
  assert.ok(av.elenchi['Tipologia NC'].includes('Prodotto'));
  await rifiuta(api(ta, 'config.salva', { logo: 'inesistente00|x.png' }), 'VALIDAZIONE', /Logo/);
  await api(tu, 'pref.salva', { menu: { Anagrafiche: true, Fornitori: 0 } });
  assert.deepEqual((await api(tu, 'avvio')).pref, { menu: { Anagrafiche: true, Fornitori: false } });
  assert.deepEqual((await api(ta, 'avvio')).pref, {});
});

test('piattaforma: elenco con spazio usato, stato, posta di prova, codici e sblocco', async () => {
  const az = (await sis.admin('aziende.elenco')).find(a => a.codice === A);
  assert.ok(az.righe > 80 && az.spazio > 1000 && az.file === 0);
  assert.deepEqual(await sis.admin('stato'), { posta: true, database: 'In memoria (prova)' });
  await rifiuta(sis.admin('posta.prova', { a: 'sbagliato' }));
  assert.deepEqual(await sis.admin('posta.prova', { a: 'prova@esempio.it' }), { inviata: true });
  await rifiuta(sis.admin('accesso.codice', { codice: A, email: 'ignoto@crus.it' }), '', /non corrisponde a un utente/);
  await rifiuta(sis.admin('accesso.codice', { codice: 'inesistente', email: 'mario@crus.it' }), '', /Azienda non trovata/);
  assert.deepEqual(await sis.admin('accesso.sblocca', { codice: A, email: 'paola@crus.it' }), { sbloccato: true });
  const log = (await api(ta, 'elenco', { entita: 'Log', q: 'piattaforma' })).righe;
  assert.ok(log.some(r => /Codice di accesso generato dalla piattaforma per paola@crus.it/.test(r.dettaglio)));
  assert.ok(!JSON.stringify(log).match(/\b\d{6}\b/));                                                 // il codice non finisce nel registro
});

test('web: pagine dell\'interfaccia, risorse statiche e limite di frequenza', async () => {
  const vecchio = process.env.LIMITE_RICHIESTE;
  process.env.LIMITE_RICHIESTE = '8';
  const altro = creaSistema({ db, postino: posta, adminKey: 'k' });
  process.env.LIMITE_RICHIESTE = vecchio || '';
  const server = altro.app.listen(0), base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [url, atteso] of [['/a/' + A + '/', /src="\/app\.js"/], ['/a/' + A, /id="app"/], ['/admin', /src="\/admin\.js"/], ['/', /codice azienda/], ['/app.js', /otp\.richiedi/], ['/pagine.js', /G\.PAGINE\.rischi/], ['/app.css', /\.matrice/]]) {
      const r = await fetch(base + url);
      assert.equal(r.status, 200, url);
      assert.match(await r.text(), atteso, url);
      assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    }
    assert.equal((await fetch(base + '/health')).status, 200);
    const r = await fetch(base + '/health');                                                          // nona richiesta in 5 minuti
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /Troppe richieste/);
  } finally { server.close(); }
});
