'use strict';
// Avvio del server. Variabili: DATABASE_URL, ADMIN_KEY, PIATTAFORMA_EMAIL, SMTP_*, PORT, TZ=Europe/Rome.

const { apriDb } = require('./db');
const { creaPostino } = require('./mail');
const { creaSistema } = require('./sistema');

async function avvia() {
  if (!process.env.DATABASE_URL) console.warn('DATABASE_URL non impostata: uso un database temporaneo in memoria (i dati si perdono al riavvio).');
  if (!process.env.ADMIN_KEY) console.warn('ADMIN_KEY non impostata: il pannello di amministrazione è disattivato.');
  const db = await apriDb({ url: process.env.DATABASE_URL });
  const sistema = creaSistema({
    db, postino: creaPostino(process.env),
    adminKey: process.env.ADMIN_KEY, emailPiattaforma: process.env.PIATTAFORMA_EMAIL,
  });
  const porta = Number(process.env.PORT || 3000);
  sistema.app.listen(porta, () => console.log('Gestionale in ascolto sulla porta ' + porta));
}

avvia().catch(e => { console.error('Avvio non riuscito:', e.message); process.exit(1); });
