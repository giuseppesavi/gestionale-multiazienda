'use strict';
// Test delle fasi 0-2: aziende, classi e pacchetti, motore delle schede, accesso con codice, permessi.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');

function postinoFinto() {
  const inviate = [];
  return { inviate, registro: [], configurata: true, async invia(m) { inviate.push(m); return true; } };
}
const codiceDa = m => /codice di accesso è: (\d{6})/.exec(m.testo)[1];

let db, posta, sis;
const nuovoSistema = () => creaSistema({ db, postino: posta, adminKey: 'chiave-di-prova', emailPiattaforma: 'fornitore@esempio.it' });

async function accedi(azienda, email, ip = '1.1.1.1') {
  await sis.api(azienda, [null, 'otp.richiedi', { email }], ip);
  const m = posta.inviate.filter(x => x.a === email && x.segreto).pop();
  const r = await sis.api(azienda, [null, 'otp.verifica', { email, codice: codiceDa(m) }], ip);
  return r.token;
}
const rifiuta = (p, codice) => assert.rejects(p, e => { assert.ok(e.utente, 'atteso un errore per l\'utente: ' + e.stack); if (codice) assert.equal(e.codice, codice); return true; });

test.before(async () => {
  db = await apriDb({});
  posta = postinoFinto();
  sis = nuovoSistema();
  await sis.admin('aziende.crea', { codice: 'rossi', nome: 'Rossi Impianti Srl', classe: 1, pacchetti: ['nc'],
    admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@rossi.it' } });
  await sis.admin('aziende.crea', { codice: 'bianchi', nome: 'Bianchi Spa', classe: 2, pacchetti: [],
    admin: { cognome: 'Bianchi', nome: 'Anna', email: 'anna@bianchi.it' } });
});

test('schema: 43 entità, tutte assegnate a un pacchetto valido', () => {
  const { PACCHETTI } = require('../app/licenza');
  const ids = new Set(PACCHETTI.map(p => p.id));
  assert.equal(Object.keys(sis.SCHEMA).length, 43);
  for (const E of Object.values(sis.SCHEMA)) assert.ok(ids.has(E.pack), E.name);
});

test('creazione azienda: codice doppio e dati mancanti rifiutati', async () => {
  await rifiuta(sis.admin('aziende.crea', { codice: 'rossi', nome: 'X', classe: 1, admin: { cognome: 'A', nome: 'B', email: 'a@b.it' } }));
  await rifiuta(sis.admin('aziende.crea', { codice: 'Nuova Azienda!', nome: 'X', classe: 1, admin: { cognome: 'A', nome: 'B', email: 'a@b.it' } }));
  await rifiuta(sis.admin('aziende.crea', { codice: 'nuova', nome: 'X', classe: 9, admin: { cognome: 'A', nome: 'B', email: 'a@b.it' } }));
  await rifiuta(sis.admin('aziende.crea', { codice: 'nuova', nome: 'X', classe: 1, pacchetti: ['inesistente'], admin: { cognome: 'A', nome: 'B', email: 'a@b.it' } }));
});

test('accesso con codice: risposta uguale per tutti, codice monouso, sessione valida', async () => {
  const a = await sis.api('rossi', [null, 'otp.richiedi', { email: 'sconosciuto@x.it' }], '2.2.2.2');
  const b = await sis.api('rossi', [null, 'otp.richiedi', { email: 'mario@rossi.it' }], '2.2.2.2');
  assert.deepEqual(a, b);
  assert.equal(posta.inviate.filter(m => m.a === 'sconosciuto@x.it').length, 0);
  const codice = codiceDa(posta.inviate.filter(m => m.a === 'mario@rossi.it').pop());
  const sbagliato = codice === '000000' ? '111111' : '000000';
  await rifiuta(sis.api('rossi', [null, 'otp.verifica', { email: 'mario@rossi.it', codice: sbagliato }], '2.2.2.2'));
  const r = await sis.api('rossi', [null, 'otp.verifica', { email: 'mario@rossi.it', codice }], '2.2.2.2');
  assert.equal(r.utente.admin, true);
  await rifiuta(sis.api('rossi', [null, 'otp.verifica', { email: 'mario@rossi.it', codice }], '2.2.2.2')); // già usato
  const av = await sis.api('rossi', [r.token, 'avvio', {}], '2.2.2.2');
  assert.equal(av.azienda.nome, 'Rossi Impianti Srl');
  await sis.api('rossi', [r.token, 'esci', {}], '2.2.2.2');
  await rifiuta(sis.api('rossi', [r.token, 'avvio', {}], '2.2.2.2'), 'SESSIONE');
});

test('accesso: dopo 5 codici errati serve un nuovo codice', async () => {
  await sis.api('bianchi', [null, 'otp.richiedi', { email: 'anna@bianchi.it' }], '3.3.3.3');
  const codice = codiceDa(posta.inviate.filter(m => m.a === 'anna@bianchi.it').pop());
  const sbagliato = codice === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await rifiuta(sis.api('bianchi', [null, 'otp.verifica', { email: 'anna@bianchi.it', codice: sbagliato }], '3.3.3.3'));
  await rifiuta(sis.api('bianchi', [null, 'otp.verifica', { email: 'anna@bianchi.it', codice }], '3.3.3.3'));
});

test('pacchetti: menu, schema e salvataggi seguono i pacchetti attivi', async () => {
  const t = await accedi('rossi', 'mario@rossi.it');
  let av = await sis.api('rossi', [t, 'avvio', {}]);
  assert.deepEqual(av.pacchetti.map(p => p.id), ['base', 'nc']);
  assert.ok(av.schema.NC && av.schema.Dipendenti);
  assert.ok(!av.schema.Consegne && !av.schema.TipiDpi);
  assert.ok(!av.schema.Mansioni.children.some(c => c.e === 'MansioniDpi'));
  assert.ok(!av.schema.Mansioni.fields.some(f => f.name === 'fattoriRischio')); // sanitaria non attiva
  assert.ok(!av.schema.Dipendenti.fields.some(f => f.name === 'pinHash'));
  await rifiuta(sis.api('rossi', [t, 'salva', { entita: 'TipiDpi', dati: { codice: 'D1', descrizione: 'Guanti' } }]), 'PACCHETTO');
  await rifiuta(sis.api('rossi', [t, 'elenco', { entita: 'Consegne' }]), 'PACCHETTO');

  await sis.admin('aziende.aggiorna', { codice: 'rossi', pacchetti: ['nc', 'dpi'] });
  av = await sis.api('rossi', [t, 'avvio', {}]);
  assert.ok(av.schema.Consegne);
  const dpi = await sis.api('rossi', [t, 'salva', { entita: 'TipiDpi', dati: { codice: 'D1', descrizione: 'Guanti' } }]);
  const io = av.utente.id;
  const c = await sis.api('rossi', [t, 'salva', { entita: 'Consegne', dati: { dipendenteId: io },
    figli: { ConsegneRighe: [{ dpiId: dpi.riga.id, quantita: 2, taglia: 'L' }, { dpiId: dpi.riga.id }] } }]);
  assert.equal(c.riga.data, av.oggi);
  assert.equal(c.riga.consegnatoDa, io);
  assert.equal(c.figli.ConsegneRighe.length, 2);
  assert.equal(c.figli.ConsegneRighe[1].quantita, 1);
  assert.equal(c.etichette[dpi.riga.id], 'D1 Guanti');

  // Disattivando il pacchetto i dati restano e tornano visibili alla riattivazione.
  await sis.admin('aziende.aggiorna', { codice: 'rossi', pacchetti: ['nc'] });
  await rifiuta(sis.api('rossi', [t, 'leggi', { entita: 'Consegne', id: c.riga.id }]), 'PACCHETTO');
  await sis.admin('aziende.aggiorna', { codice: 'rossi', pacchetti: ['nc', 'dpi'] });
  const di_nuovo = await sis.api('rossi', [t, 'leggi', { entita: 'Consegne', id: c.riga.id }]);
  assert.equal(di_nuovo.figli.ConsegneRighe.length, 2);
});

test('motore: validazioni, univocità, formule, numerazione, eliminazione protetta', async () => {
  const t = await accedi('rossi', 'mario@rossi.it');
  await rifiuta(sis.api('rossi', [t, 'salva', { entita: 'Mansioni', dati: { codice: 'OP' } }]), 'VALIDAZIONE');
  const m = await sis.api('rossi', [t, 'salva', { entita: 'Mansioni', dati: { codice: 'OP', descrizione: '=CMD()' } }]);
  assert.equal(m.riga.descrizione, "'=CMD()");
  await rifiuta(sis.api('rossi', [t, 'salva', { entita: 'Mansioni', dati: { codice: 'op', descrizione: 'Doppione' } }]), 'VALIDAZIONE');
  await rifiuta(sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Verdi', nome: 'Luca', cf: 'ABC' } }]), 'VALIDAZIONE');
  await rifiuta(sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Verdi', nome: 'Luca', dataAssunzione: '2026-02-31' } }]), 'VALIDAZIONE');
  const d = await sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Verdi', nome: 'Luca', cf: 'vrdlcu80a01h501x', mansioneId: m.riga.id } }]);
  assert.equal(d.riga.cf, 'VRDLCU80A01H501X');
  assert.equal(d.riga.stato, 'Attivo');
  assert.equal(d.etichette[m.riga.id], "OP '=CMD()");

  await rifiuta(sis.api('rossi', [t, 'elimina', { entita: 'Mansioni', id: m.riga.id }]), 'IN_USO');
  const nc1 = await sis.api('rossi', [t, 'salva', { entita: 'NC', dati: { descrizione: 'Pezzo difettoso', numero: 'FALSO' },
    figli: { NcCosti: [{ descrizione: 'Rilavorazione', quantita: '2', costo: '12,5' }] } }]);
  const nc2 = await sis.api('rossi', [t, 'salva', { entita: 'NC', dati: { descrizione: 'Seconda' } }]);
  const anno = new Date().getFullYear();
  assert.equal(nc1.riga.numero, 'NC-' + anno + '-001');
  assert.equal(nc2.riga.numero, 'NC-' + anno + '-002');
  assert.equal(nc1.figli.NcCosti[0].costo, 12.5);
  // modifica: i figli non inviati restano, quelli inviati vengono sostituiti
  const mod = await sis.api('rossi', [t, 'salva', { entita: 'NC', dati: { id: nc1.riga.id, stato: 'Chiusa' } }]);
  assert.equal(mod.riga.stato, 'Chiusa');
  assert.equal(mod.riga.numero, nc1.riga.numero);
  assert.equal(mod.figli.NcCosti.length, 1);
  const vuota = await sis.api('rossi', [t, 'salva', { entita: 'NC', dati: { id: nc1.riga.id }, figli: { NcCosti: [] } }]);
  assert.equal(vuota.figli.NcCosti.length, 0);

  const el = await sis.api('rossi', [t, 'elenco', { entita: 'NC', q: 'difettoso' }]);
  assert.equal(el.righe.length, 1);
  await sis.api('rossi', [t, 'elimina', { entita: 'NC', id: nc2.riga.id }]);
  const log = await sis.api('rossi', [t, 'elenco', { entita: 'Log' }]);
  assert.ok(log.righe.some(r => r.evento === 'Eliminazione'));
  assert.ok(log.righe.some(r => r.evento === 'Accesso'));
});

test('permessi: l\'utente registrazioni registra ma non modifica anagrafiche né elimina', async () => {
  const ta = await accedi('rossi', 'mario@rossi.it');
  await sis.api('rossi', [ta, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Neri', nome: 'Paola', email: 'paola@rossi.it', utente: 'SI', ruolo: 'Utente registrazioni' } }]);
  await rifiuta(sis.api('rossi', [ta, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Senza', nome: 'Email', utente: 'SI' } }]), 'VALIDAZIONE');
  const tu = await accedi('rossi', 'paola@rossi.it');
  const nc = await sis.api('rossi', [tu, 'salva', { entita: 'NC', dati: { descrizione: 'Segnalazione di Paola' } }]);
  assert.ok(nc.riga.id);
  await rifiuta(sis.api('rossi', [tu, 'salva', { entita: 'Mansioni', dati: { codice: 'X', descrizione: 'Y' } }]), 'PERMESSO');
  await rifiuta(sis.api('rossi', [tu, 'elimina', { entita: 'NC', id: nc.riga.id }]), 'PERMESSO');
  await rifiuta(sis.api('rossi', [tu, 'elenco', { entita: 'Log' }]), 'PERMESSO');
  await rifiuta(sis.api('rossi', [tu, 'elenco', { entita: 'NcCosti' }]));
  const mans = await sis.api('rossi', [tu, 'elenco', { entita: 'Mansioni' }]);
  assert.equal(mans.puoScrivere, false);
});

test('licenza: al limite della classe i nuovi addetti sono bloccati e parte la segnalazione', async () => {
  const t = await accedi('rossi', 'mario@rossi.it');
  let av = await sis.api('rossi', [t, 'avvio', {}]);
  assert.equal(av.licenza.max, 9);
  for (let i = av.licenza.attivi; i < 9; i++) {
    await sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Addetto', nome: 'N' + i } }]);
  }
  av = await sis.api('rossi', [t, 'avvio', {}]);
  assert.equal(av.licenza.attivi, 9);
  assert.ok(av.licenza.pieno && av.licenza.avviso);

  const prima = posta.inviate.length;
  await assert.rejects(sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Decimo', nome: 'Addetto' } }]),
    e => e.codice === 'LICENZA' && /estendere la licenza/.test(e.message));
  await rifiuta(sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Undicesimo', nome: 'Addetto' } }]), 'LICENZA');
  const avvisi = posta.inviate.slice(prima).filter(m => /Licenza da estendere/.test(m.oggetto));
  assert.deepEqual(avvisi.map(m => m.a).sort(), ['fornitore@esempio.it', 'mario@rossi.it']); // una sola volta al giorno
  const log = await sis.api('rossi', [t, 'elenco', { entita: 'Log', q: 'Inserimento bloccato' }]);
  assert.equal(log.righe.length, 2);

  // Un addetto già cessato non occupa posti; modificare un addetto esistente resta possibile.
  const ex = await sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Ex', nome: 'Addetto', dataLicenziamento: '2020-01-31' } }]);
  assert.equal(ex.riga.stato, 'Cessato');
  await rifiuta(sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { id: ex.riga.id, dataLicenziamento: '' } }]), 'LICENZA');
  await sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { id: av.utente.id, nome: 'Mario Luigi' } }]);

  // Estensione della licenza dalla piattaforma: l'inserimento torna possibile.
  await sis.admin('aziende.aggiorna', { codice: 'rossi', classe: 2 });
  await sis.api('rossi', [t, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Decimo', nome: 'Addetto' } }]);
  av = await sis.api('rossi', [t, 'avvio', {}]);
  assert.equal(av.licenza.attivi, 10);
  assert.equal(av.licenza.max, 50);
  await rifiuta(sis.admin('aziende.aggiorna', { codice: 'rossi', classe: 1 })); // 10 addetti non stanno nella classe 0-9
  const elenco = await sis.admin('aziende.elenco');
  assert.equal(elenco.find(a => a.codice === 'rossi').licenza.etichetta, '10–50 dipendenti');
});

test('aziende separate: dati e sessioni non passano da un\'azienda all\'altra', async () => {
  const tr = await accedi('rossi', 'mario@rossi.it');
  const tb = await accedi('bianchi', 'anna@bianchi.it', '4.4.4.4');
  await rifiuta(sis.api('bianchi', [tr, 'avvio', {}]), 'SESSIONE');
  const dip = await sis.api('bianchi', [tb, 'elenco', { entita: 'Dipendenti' }]);
  assert.equal(dip.righe.length, 1);
  await rifiuta(sis.api('bianchi', [tb, 'elenco', { entita: 'NC' }]), 'PACCHETTO');
  await rifiuta(sis.api('inesistente', [tb, 'avvio', {}]), 'AZIENDA');
  await sis.admin('aziende.aggiorna', { codice: 'bianchi', attiva: false });
  await rifiuta(sis.api('bianchi', [tb, 'avvio', {}]), 'AZIENDA');
  await sis.admin('aziende.aggiorna', { codice: 'bianchi', attiva: true });
});

test('riavvio del server: dati e sessioni restano; nel database non c\'è il token in chiaro', async () => {
  // dalla connessione 1.1.1.1 sono già stati chiesti 5 codici: il sesto viene ignorato in silenzio
  await sis.api('rossi', [null, 'otp.richiedi', { email: 'mario@rossi.it' }], '1.1.1.1');
  const ultimo = posta.inviate.filter(x => x.a === 'mario@rossi.it' && x.segreto).length;
  await sis.api('rossi', [null, 'otp.richiedi', { email: 'mario@rossi.it' }], '1.1.1.1');
  assert.equal(posta.inviate.filter(x => x.a === 'mario@rossi.it' && x.segreto).length, ultimo);
  const t = await accedi('rossi', 'mario@rossi.it', '5.5.5.5');
  const prima = await sis.api('rossi', [t, 'elenco', { entita: 'Dipendenti' }]);
  sis = nuovoSistema();
  const dopo = await sis.api('rossi', [t, 'elenco', { entita: 'Dipendenti' }]);
  assert.equal(dopo.righe.length, prima.righe.length);
  const p = await db.query("select key, value from props where tenant = 'rossi'");
  assert.ok(p.rows.some(r => r.key.startsWith('sess:')));
  assert.ok(!JSON.stringify(p.rows).includes(t));
  const el = await sis.api('rossi', [t, 'elenco', { entita: 'Elenchi' }]);
  assert.ok(el.righe.length > 50); // valori iniziali creati una sola volta
  assert.equal(el.righe.filter(r => r.valore === 'Idoneo').length, 1);
});

test('web: intestazioni di sicurezza, formato delle risposte, chiave di amministrazione', async () => {
  const server = sis.app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, corpo, intest = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...intest }, body: JSON.stringify(corpo) });
  try {
    let r = await post('/a/rossi/run', { fn: 'api', args: [null, 'avvio', {}] });
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-powered-by'), null);
    let j = await r.json();
    assert.equal(j.ok, false);
    assert.equal(j.code, 'SESSIONE');
    r = await post('/a/rossi/run', { fn: 'api', args: [null, 'otp.richiedi', { email: 'x@y.it' }] });
    j = await r.json();
    assert.equal(j.ok, true);
    r = await post('/admin/api', { azione: 'aziende.elenco' }, { 'X-Admin-Key': 'sbagliata' });
    assert.equal(r.status, 401);
    r = await post('/admin/api', { azione: 'aziende.elenco' }, { 'X-Admin-Key': 'chiave-di-prova' });
    j = await r.json();
    assert.equal(j.data.length, 2);
    r = await fetch(base + '/a/rossi/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{rotto' });
    assert.equal((await r.json()).ok, false);
  } finally { server.close(); }
});

test('eliminazione azienda: serve riscrivere il codice, poi spariscono tutti i dati', async () => {
  await rifiuta(sis.admin('aziende.elimina', { codice: 'bianchi', conferma: 'sbagliato' }));
  await sis.admin('aziende.elimina', { codice: 'bianchi', conferma: 'bianchi' });
  const r = await db.query("select count(*)::int as n from rows where tenant = 'bianchi'");
  assert.equal(r.rows[0].n, 0);
  assert.equal((await sis.admin('aziende.elenco')).length, 1);
});
