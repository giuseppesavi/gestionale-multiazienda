# Stato del progetto

Aggiornato al 13/11/2026.

## Fatto e provato (`npm test`: 12 test superati)

- **Fase 0 – Struttura**: `app/` (schema, motore, regole, licenze), `server/` (database, archivio, accesso, posta, API), `test/`.
- **Fase 1 – Dati e motore**: schema completo (43 entità), elenco, lettura, salvataggio di scheda e righe figlie in un'unica transazione, validazioni, campi univoci, protezione dalle formule, numerazione automatica, eliminazione bloccata se la scheda è usata altrove, registro delle operazioni.
- **Multi-azienda**: dati separati per azienda, creazione, sospensione ed eliminazione dalla piattaforma.
- **Pacchetti attivabili**: Base (sempre), DPI, Formazione, Competenze, Sorveglianza sanitaria, NC e azioni, Attrezzature, Fornitori, Strumenti, Documentazione. Un pacchetto spento nasconde schede e campi collegati e blocca le chiamate; i dati restano.
- **Classi di dipendenti**: 0–9, 10–50, 51–100, 101–250, 251–1000. Al limite l'inserimento di nuovi addetti è bloccato e parte la segnalazione (a schermo, nel registro e via e-mail agli amministratori dell'azienda e al fornitore, una volta al giorno).
- **Fase 2 – Accesso e permessi**: codice monouso via e-mail, sessione con solo l'hash del token nel database, limiti sui tentativi, ruoli Amministratore / Utente registrazioni.

- **Fase 3 – Firme**: credenziali, PIN, firma su schermo, link via e-mail, scansione cartacea, attestato (corsi). Scheda in sola lettura dopo la prima firma, annullamento solo da amministratore. PIN con hash lento e blocchi. Allegati (15 MB, tipi ammessi) scaricabili solo da chi vede la scheda.

I test sono ora 18 (`test/base.test.js`, `test/firme.test.js`).

## Da fare

- Fase 4: regole dei singoli moduli (formazione, manutenzioni, tarature, documenti, sorveglianza…).
- Fase 5: stampe PDF. Fase 6: import/export Excel ed **esportazione dei dati aziendali**.
- Fase 7: scadenzario e cruscotto. Fase 8: pannello `/admin` (oggi esiste solo l'API).
- Interfaccia nel browser (oggi c'è solo una pagina segnaposto).
- Fase 9: limiti di frequenza, upload, riserva SMTP. Fase 10: test nel browser.
- Pubblicazione: archivio GitHub e `render.yaml` (da creare dopo conferma dei piani e dei costi Render).

## Questioni aperte

- Variabile `PIATTAFORMA_EMAIL`: indirizzo del fornitore che riceve le segnalazioni di licenza.
- Il conteggio della licenza considera gli addetti attivi (non cessati), interinali compresi.
