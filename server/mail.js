'use strict';
// Posta: SMTP con nodemailer. Senza SMTP configurato le e-mail non partono ma restano nel registro,
// visibile dal pannello di amministrazione. I codici di accesso sono nascosti se l'e-mail è stata consegnata.

function creaPostino(env = process.env) {
  const registro = [];
  let trasporto = null;
  if (env.SMTP_HOST) {
    const nodemailer = require('nodemailer');
    const porta = Number(env.SMTP_PORT || 465);
    trasporto = nodemailer.createTransport({
      host: env.SMTP_HOST, port: porta, secure: porta === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000,
    });
  }
  function annota(m, esito, consegnata) {
    registro.unshift({
      data: new Date().toISOString(), a: m.a, oggetto: m.oggetto, esito,
      testo: m.segreto && consegnata ? '(contenuto riservato)' : m.testo,
    });
    if (registro.length > 50) registro.length = 50;
  }
  async function invia(m) {
    if (!trasporto) { annota(m, 'Non inviata: posta non configurata', false); return false; }
    try {
      await trasporto.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to: m.a, subject: m.oggetto, text: m.testo });
      annota(m, 'Inviata', true);
      return true;
    } catch (e) {
      annota(m, 'Errore: ' + e.message, false);
      return false;
    }
  }
  return { invia, registro, configurata: !!trasporto };
}

module.exports = { creaPostino };
