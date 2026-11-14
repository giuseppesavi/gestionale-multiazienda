'use strict';
// Server dimostrativo per provare l'interfaccia in locale:  node test/demo.js
// Usa un database in memoria (i dati si perdono alla chiusura) e NON invia posta:
// i codici di accesso vengono scritti sul terminale. Da non usare in produzione.
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');

(async () => {
  const registro = [];
  const postino = { registro, configurata: false, async invia(m) {
    registro.unshift({ data: new Date().toISOString(), a: m.a, oggetto: m.oggetto, esito: 'Non inviata: server dimostrativo', testo: m.testo });
    const c = /è: (\d{6})/.exec(m.testo);
    console.log(c ? '[DEMO] codice per ' + m.a + ': ' + c[1] : '[DEMO] e-mail a ' + m.a + ': ' + m.oggetto);
    return true;
  } };
  const sis = creaSistema({ db: await apriDb({}), postino, adminKey: process.env.ADMIN_KEY || 'demo', emailPiattaforma: 'fornitore@esempio.it' });
  await sis.admin('aziende.demo', { codice: 'rossi', nome: 'Rossi Impianti Srl', admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@rossi.it' }, emailUtente: 'paola@rossi.it' });
  const porta = Number(process.env.PORT) || 3210;
  sis.app.listen(porta, () => console.log('[DEMO] Gestionale: http://localhost:' + porta + '/a/rossi/  (utenti: mario@rossi.it amministratore, paola@rossi.it)\n[DEMO] Piattaforma: http://localhost:' + porta + '/admin  (chiave: ' + (process.env.ADMIN_KEY || 'demo') + ')'));
})().catch(e => { console.error(e); process.exit(1); });
