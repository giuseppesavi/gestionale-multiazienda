'use strict';
// Regole di dominio: ganci before/after del salvataggio e campi calcolati.
// (In questa fase: dipendenti e licenza. Gli altri moduli arrivano con i rispettivi pacchetti.)

const { classe, cessato, contaAttivi, messaggioLimite } = require('./licenza');

function eng() { return require('./engine'); }

const HOOKS = {
  Dipendenti: {
    before(ctx, { riga, vecchia }) {
      const { ErroreUtente, oggi } = eng();
      const og = oggi();
      if (riga.cf) {
        riga.cf = String(riga.cf).toUpperCase().replace(/\s/g, '');
        if (!/^[A-Z0-9]{16}$/.test(riga.cf) && !/^\d{11}$/.test(riga.cf)) {
          throw new ErroreUtente('Controlla i dati inseriti:\n• «Codice fiscale»: deve avere 16 caratteri (lettere e numeri) oppure 11 cifre', 'VALIDAZIONE');
        }
      }
      if (riga.utente === 'SI' && !riga.email) {
        throw new ErroreUtente('Controlla i dati inseriti:\n• «E-mail»: obbligatoria per gli utenti del sistema (serve per ricevere il codice di accesso)', 'VALIDAZIONE');
      }
      // Licenza: un nuovo addetto attivo (o un cessato che torna attivo) non può superare il limite della classe.
      const eraAttivo = !!vecchia && !cessato(vecchia, og);
      if (!cessato(riga, og) && !eraAttivo) {
        const c = classe(ctx.azienda.classe);
        if (contaAttivi(ctx.st, og) >= c.max) throw new ErroreUtente(messaggioLimite(c), 'LICENZA');
      }
    },
  },
};

const CALC = {
  Dipendenti: {
    stato: (ctx, r) => (cessato(r, eng().oggi()) ? 'Cessato' : 'Attivo'),
    inAziendaDal: (ctx, r) => eng().dataIt(r.inizioMissione && (!r.dataAssunzione || r.inizioMissione < r.dataAssunzione) ? r.inizioMissione : r.dataAssunzione),
    pinImpostato: (ctx, r) => (r.pinHash ? 'SI' : 'NO'),
  },
};

module.exports = { HOOKS, CALC };
