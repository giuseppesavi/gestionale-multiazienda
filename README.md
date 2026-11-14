# Gestionale Sicurezza & Qualità – multi-azienda

Applicazione web per piccole e medie imprese: sicurezza sul lavoro (D.Lgs. 81/2008), qualità (ISO 9001), rischi e opportunità.
Un solo server ospita più aziende, ognuna con i propri dati, i propri pacchetti attivi e la propria classe di licenza.

## Cosa contiene

| Pacchetto | Contenuto |
|---|---|
| Base (sempre attivo) | Dipendenti, mansioni, sedi, clienti e fornitori, cruscotto, scadenzario, configurazione, registri |
| DPI | Tipi DPI, consegne con verbale firmato |
| Formazione | Tipologie di corso, corsi, scadenze degli aggiornamenti |
| Competenze | Competenze e valutazioni |
| Sorveglianza sanitaria | Visite mediche e registro (dati riservati) |
| Non conformità e azioni | NC, reclami, azioni di miglioramento, riepilogo |
| Attrezzature e manutenzioni | Piani, manutenzioni, manutenzione massiva per sede |
| Qualifica fornitori | Valutazioni ed elenco dei qualificati |
| Strumenti di misura | Strumenti, tarature, registro |
| Documentazione | Revisioni, approvazione, distribuzione, prese visione |
| Rischi e opportunità | Registri, metodi di valutazione, azioni, piano di gestione |

Classi di licenza per numero di addetti attivi: 0–9, 10–50, 51–100, 101–250, 251–1000.
Al raggiungimento del limite l'inserimento di nuovi addetti viene bloccato e parte la segnalazione di estensione della licenza.

## Indirizzi

- `https://<sito>/a/<codice-azienda>/` – il gestionale di un'azienda (accesso con codice via e-mail, senza password).
- `https://<sito>/admin` – pannello della piattaforma (serve la chiave `ADMIN_KEY`).

## Primo avvio dopo la pubblicazione

1. Apri `/admin` e inserisci la chiave di amministrazione (su Render: servizio → Environment → `ADMIN_KEY`).
2. Premi **＋ Azienda dimostrativa** per avere subito un'azienda con dati inventati in ogni scheda, oppure **＋ Nuova azienda** per un'azienda vera.
3. Se la posta non è ancora configurata, il codice di accesso si genera dal pannello: pulsante **Accessi** dell'azienda.

## Impostazioni (variabili d'ambiente)

| Variabile | A cosa serve |
|---|---|
| `DATABASE_URL` | Collegamento al database PostgreSQL (obbligatoria in produzione) |
| `ADMIN_KEY` | Chiave del pannello della piattaforma |
| `PIATTAFORMA_EMAIL` | Indirizzo del fornitore che riceve le segnalazioni di licenza |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Posta in uscita. Senza queste le e-mail non partono e restano visibili nel pannello |
| `URL_PUBBLICO` | Indirizzo del sito, usato nei link di firma e nei QR code (facoltativa) |
| `LIMITE_RICHIESTE` | Richieste ammesse ogni 5 minuti per connessione (predefinito 1500) |
| `TZ` | `Europe/Rome` |

## Per chi sviluppa

```bash
npm install
npm test
node test/demo.js
```

- `npm test` esegue tutti i test su un database in memoria.
- `node test/demo.js` avvia un server di prova su `http://localhost:3210` con un'azienda dimostrativa; i codici di accesso compaiono sul terminale.
- `app/` contiene schema dei dati, regole, stampe, import/export e le pagine; `server/` contiene server, database, posta; `test/` i test.
- Il punto della situazione e le questioni aperte sono in [STATO.md](STATO.md).

Ogni invio al ramo `main` su GitHub viene pubblicato automaticamente da Render.
