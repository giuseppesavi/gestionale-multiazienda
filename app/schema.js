'use strict';
// SCHEMA dichiarativo: da qui si generano elenchi, maschere, validazioni e permessi.
//
// Intestazione entità:  # Nome | Etichetta | Gruppo menu | permesso | pacchetto | [FIRME] [CHILD] [figli:A(fk),B(fk)] [titolo:a+b] [auto:PREFISSO]
// Campo:                nome[*][!]:tipo[>Entità | [Elenco] | {a/b}][(ro)][(calc)][=predefinito][?{showIf}] "Etichetta"
//   * obbligatorio, ! univoco, (ro) sola lettura, (calc) calcolato e non salvato.

const TESTO = `
# Consegne | Consegne DPI | Registrazioni | reg | dpi | FIRME | figli:ConsegneRighe(consegnaId) | titolo:data
  data*:date=today "Data consegna"
  dipendenteId*:ref>Dipendenti "Dipendente"
  consegnatoDa:ref>Dipendenti=me "Consegnato da"
  emailInviata:text(ro) "E-mail inviata"
  note:textarea "Note"

# ConsegneRighe | DPI consegnati | - | reg | dpi | CHILD | titolo:dpiId
  consegnaId:fk
  dpiId*:ref>TipiDpi "DPI"
  quantita:number=1 "Q.tà"
  taglia:text "Taglia"
  note:text "Note"

# Corsi | Corsi di formazione | Registrazioni | reg | formazione | FIRME | figli:CorsiDocenti(corsoId),CorsiPartecipanti(corsoId) | titolo:titolo
  titolo*:text "Titolo del corso"
  tipoCorsoId*:ref>TipiCorso "Tipologia corso"
  modalita*:select{Formazione iniziale/Aggiornamento}=Formazione iniziale "Formazione iniziale o aggiornamento"
  luogo:text "Luogo"
  enteFormatore:text "Ente formatore / docente (testo)"
  importato:bool(ro) "Importato da archivio storico"
  dataInizio*:date=today "Data inizio"
  dataFine*:date=today "Data fine"
  durataOre:number "Durata (ore)"
  nPartecipanti:text(calc) "Partecipanti"
  programma:textarea "Programma / contenuti"
  effDescrizione:textarea "Descrizione"
  effModalita:list[Modalità valutazione efficacia] "Modalità di valutazione"
  effData:date "Data valutazione"
  effValutatoreId:ref>Dipendenti "Valutata da"

# CorsiDocenti | Docenti | - | reg | formazione | CHILD | titolo:nominativo
  corsoId:fk
  tipo*:select{Dipendente/Esterno}=Dipendente "Tipo docente"
  dipendenteId:ref>Dipendenti?{"tipo":"Dipendente"} "Dipendente"
  soggettoId:ref>Soggetti?{"tipo":"Esterno"} "Cliente / Fornitore"
  nominativo:text?{"tipo":"Esterno"} "Nominativo docente"
  email:email?{"tipo":"Esterno"} "E-mail docente"

# CorsiPartecipanti | Partecipanti | - | reg | formazione | CHILD | titolo:dipendenteId
  corsoId:fk
  dipendenteId*:ref>Dipendenti "Partecipante"
  ore:number "Ore frequenza"
  attestato:file "Attestato"
  scadenza:date(calc) "Scadenza aggiornamento"

# ValutazioniCompetenze | Valutazioni competenze | Registrazioni | reg | competenze | FIRME | figli:ValutazioniRighe(valutazioneId) | titolo:data
  dipendenteId*:ref>Dipendenti "Dipendente"
  mansioneId*:multiref>Mansioni "Mansioni valutate"
  data*:date=today "Data valutazione"
  valutatoreId:ref>Dipendenti=me "Valutatore"
  copertura:text(calc) "Copertura competenze"
  note:textarea "Note"

# ValutazioniRighe | Competenze valutate | - | reg | competenze | CHILD | titolo:competenzaId
  valutazioneId:fk
  competenzaId*:ref>Competenze "Competenza"
  mansioniRif:multiref>Mansioni(ro) "Richiesta da"
  valoreAtteso:select{1/2/3/4/5} "Valore atteso"
  valoreReale:select{1/2/3/4/5} "Valore reale"
  note:text "Note"

# SorveglianzaSanitaria | Sorveglianza sanitaria | Sorveglianza sanitaria | san | sanitaria | titolo:dataVisita
  dipendenteId*:ref>Dipendenti "Lavoratore"
  mansioniIds:multiref>Mansioni "Mansione specifica"
  sedeId:ref>Sedi "Sede di lavoro"
  medicoCompetente:text "Medico competente"
  strutturaId:ref>Soggetti "Struttura sanitaria / poliambulatorio"
  tipologia*:list[Tipologia visita medica] "Tipologia visita"
  dataVisita*:date=today "Data visita"
  fattoriRischio:multiref>FattoriRischio "Fattori di rischio"
  accertamenti:textarea "Accertamenti integrativi eseguiti"
  giudizio*:list[Giudizio di idoneità] "Giudizio di idoneità"
  inidoneitaFino:date?{"giudizio":"Temporaneamente non idoneo"} "Non idoneo temporaneamente fino al"
  prescrizioni:textarea "Prescrizioni / limitazioni"
  dataGiudizio:date "Data giudizio"
  periodicita*:select{Semestrale/Annuale/Biennale/Triennale/Quinquennale/Altra (indicare i mesi)}=Annuale "Periodicità visita"
  periodicitaMesi:number?{"periodicita":"Altra (indicare i mesi)"} "Periodicità (mesi)"
  prossimaVisita:date "Da sottoporre a nuova visita entro il"
  statoVisita:text(calc) "Stato"
  fineRapporto:bool "Prevista visita di fine rapporto (agenti cancerogeni / chimici)"
  trasmLavoratore:date "Trasmissione al lavoratore"
  trasmDatore:date "Trasmissione al datore di lavoro"
  modalitaTrasm:text "Modalità di trasmissione"
  allegato:file "Giudizio di idoneità firmato (PDF)"
  note:textarea "Note"

# NC | Non conformità e reclami | Registrazioni | reg | nc | FIRME | figli:NcCosti(ncId) | titolo:numero | auto:NC
  numero:auto "Numero"
  data*:date=today "Data"
  riferimento:text "Riferimento"
  stato:select{Aperta/In gestione/Chiusa}=Aperta "Stato"
  reclamo:bool "Reclamo"
  isNc:bool=SI "Non conformità"
  tipologia:list[Tipologia NC] "Tipologia NC"
  redattoDa:ref>Dipendenti=me "Redatto da"
  descrizione*:textarea "Descrizione NC"
  rilevatoreTipo:select{Interno/Fornitore/Altro}=Interno "Rilevato da"
  rilevatoreDipId:ref>Dipendenti?{"rilevatoreTipo":"Interno"} "Dipendente rilevatore"
  rilevatoreSoggId:ref>Soggetti?{"rilevatoreTipo":"Fornitore"} "Fornitore"
  rilevatoreTesto:text?{"rilevatoreTipo":"Altro"} "Rilevatore (testo libero)"
  gestione:textarea "Gestione / trattamento"
  analisiCause:textarea "Analisi delle cause"
  costoTotale:text(calc) "Costo totale €"
  serveAzione:bool "Serve un'azione di miglioramento"
  importata:bool(ro) "Importata da archivio storico"

# NcCosti | Costi | - | reg | nc | CHILD | titolo:descrizione
  ncId:fk
  descrizione*:text "Descrizione"
  quantita:number=1 "Quantità"
  costo:number "Costo unitario €"
  totale:text(calc) "Totale €"

# Azioni | Azioni di miglioramento | Registrazioni | reg | nc+rischi | titolo:numero | auto:AZ
  numero:auto "Numero"
  ncId:ref>NC "NC di riferimento"
  rischioId:ref>Rischi "Rischio / opportunità di riferimento"
  data*:date=today "Data"
  stato:select{Aperta/In corso/Chiusa}=Aperta "Stato"
  descrizione*:textarea "Descrizione"
  responsabileId:ref>Dipendenti "Responsabile"
  dataPrevChiusura:date "Data prevista chiusura"
  dataChiusura:date "Data chiusura effettiva"
  noteEsecuzione:textarea "Cosa è stato fatto"
  esitoEfficacia:select{Efficace/Non efficace} "Esito della verifica di efficacia"
  effValutazione:textarea "Valutazione efficacia"
  effData:date "Data valutazione"
  effValutatoreId:ref>Dipendenti "Dipendente valutatore"

# Processi | Processi | Rischi e opportunità | admin | rischi | titolo:codice+descrizione
  codice*!:text "Codice processo"
  descrizione*:text "Processo"
  responsabileId:ref>Dipendenti "Responsabile del processo"

# MetodiRischio | Metodi di valutazione | Rischi e opportunità | admin | rischi | titolo:nome
  nome*:text "Nome del metodo"
  riepilogo:text(calc) "Fattori e classi"
  attivo:bool=SI "Attivo"
  definizione:hidden

# RegistriRischio | Registri dei rischi | Rischi e opportunità | admin | rischi | titolo:nome
  codice*!:text "Codice registro"
  nome*:text "Nome del registro"
  prefisso*!:text "Prefisso dei codici"
  tipo*:select{Rischi/Opportunità}=Rischi "Tipo"
  metodoId*:ref>MetodiRischio "Metodo di valutazione"
  attivo:bool=SI "Attivo"

# Rischi | Rischi e opportunità | Rischi e opportunità | admin | rischi | titolo:codice+descrizione
  codice:text(ro) "Codice"
  registroId*:ref>RegistriRischio "Registro"
  stato:select{Proposta/Attivo/Chiuso}=Attivo "Stato"
  valutazione:text(calc) "Valutazione iniziale"
  residua:text(calc) "Valutazione residua"
  prossimoRiesame:date "Prossimo riesame"
  processoId:ref>Processi "Processo"
  descrizione*:textarea "Descrizione"
  causa:textarea "Causa"
  effetto:textarea "Effetto"
  fonte:text "Fonte"
  trattamento:textarea "Trattamento"
  responsabileId:ref>Dipendenti "Responsabile"
  nAzioni:text(calc) "Azioni"
  efficacia:textarea "Valutazione dell'efficacia"
  note:textarea "Note"
  valIniziale:hidden
  valResidua:hidden

# Manutenzioni | Manutenzioni | Registrazioni | reg | attrezzature | FIRME | figli:ManutenzioniRighe(manutenzioneId) | titolo:data
  data*:date=today "Data"
  attrezzaturaId*:ref>Attrezzature "Attrezzatura"
  tipo*:select{Ordinaria/Straordinaria}=Ordinaria "Tipo manutenzione"
  esito:select{Conforme/Non conforme/Da ricontrollare}=Conforme "Esito"
  descrizione:textarea "Attività realizzate / descrizione"
  esecutoreTipo:select{Interno/Esterno}=Interno "Eseguita da"
  esecutoreDipId:ref>Dipendenti?{"esecutoreTipo":"Interno"} "Dipendente esecutore"
  esecutoreSoggId:ref>Soggetti?{"esecutoreTipo":"Esterno"} "Ditta esterna"
  esecutoreNome:text?{"esecutoreTipo":"Esterno"} "Tecnico esterno"
  responsabileId:ref>Dipendenti "Responsabile"
  costo:number "Costo €"
  allegato:file "Allegato (rapportino, foto…)"
  note:textarea "Note"

# ManutenzioniRighe | Attività eseguite | - | reg | attrezzature | CHILD | titolo:attivitaId
  manutenzioneId:fk
  attivitaId*:ref>AttrezzatureAttivita "Attività del piano"
  eseguita:bool=SI "Eseguita"
  note:text "Note / esito"

# Dipendenti | Dipendenti | Anagrafiche | admin | base | figli:RapportiLavoro(dipendenteId) | titolo:cognome+nome
  cognome*:text "Cognome"
  nome*:text "Nome"
  cf!:text "Codice fiscale"
  email:email "E-mail"
  mansioneId:ref>Mansioni "Mansione"
  mansioniAgg:multiref>Mansioni "Mansioni aggiuntive"
  sedeId:ref>Sedi "Sede"
  tipoRapporto:select{Dipendente diretto/Interinale (somministrazione)}=Dipendente diretto "Tipo rapporto"
  agenziaId:ref>Soggetti?{"tipoRapporto":"Interinale (somministrazione)"} "Agenzia per il lavoro"
  inizioMissione:date?{"tipoRapporto":"Interinale (somministrazione)"} "Inizio missione"
  fineMissione:date?{"tipoRapporto":"Interinale (somministrazione)"} "Fine missione prevista"
  rifContratto:text?{"tipoRapporto":"Interinale (somministrazione)"} "Riferimento contratto / ordine di somministrazione"
  formGenAgenzia:bool?{"tipoRapporto":"Interinale (somministrazione)"} "Formazione generale a carico dell'agenzia"
  contratto:list[Tipo contratto] "Tipo contratto"
  dataAssunzione:date "Data assunzione"
  dataLicenziamento:date "Data licenziamento / cessazione"
  inAziendaDal:text(calc) "In azienda dal"
  stato:text(calc) "Stato"
  utente:bool "Utente del sistema"
  ruolo:select{Amministratore/Utente registrazioni}=Utente registrazioni?{"utente":"SI"} "Ruolo di gestione"
  pinImpostato:text(calc) "PIN di firma impostato"
  pinHash:hidden
  pinSalt:hidden

# RapportiLavoro | Storico rapporti di lavoro | - | admin | base | CHILD | titolo:dal
  dipendenteId:fk
  tipo*:select{Dipendente diretto/Interinale (somministrazione)} "Tipo"
  agenziaId:ref>Soggetti "Agenzia"
  dal*:date "Dal"
  al:date "Al"
  contratto:list[Tipo contratto] "Contratto"
  rifContratto:text "Riferimento"
  note:text "Note"

# Mansioni | Mansioni | Anagrafiche | admin | base | figli:MansioniCompetenze(mansioneId),MansioniDpi(mansioneId),MansioniCorsi(mansioneId) | titolo:codice+descrizione
  ordine:number "Ordine nel mansionario"
  codice*!:text "Codice mansione"
  descrizione*:text "Titolo della mansione"
  descrizioneMansione:textarea "Descrizione della mansione"
  riportaA:ref>Mansioni "Mansione a cui riporta"
  sorveglianza:bool "Soggetta a sorveglianza sanitaria"
  fattoriRischio:multiref>FattoriRischio?{"sorveglianza":"SI"} "Fattori di rischio (protocollo sanitario)"

# MansioniCorsi | Corsi richiesti | - | admin | formazione | CHILD | titolo:tipoCorsoId
  mansioneId:fk
  tipoCorsoId*:ref>TipiCorso "Tipologia corso"
  note:text "Note"

# MansioniCompetenze | Competenze richieste | - | admin | competenze | CHILD | titolo:competenzaId
  mansioneId:fk
  competenzaId*:ref>Competenze "Competenza"
  valoreAtteso*:select{1/2/3/4/5}=3 "Valore previsto"

# MansioniDpi | DPI previsti | - | admin | dpi | CHILD | titolo:dpiId
  mansioneId:fk
  dpiId*:ref>TipiDpi "DPI"
  quantita:number=1 "Quantità"

# Competenze | Competenze | Anagrafiche | admin | competenze | titolo:descrizione
  area*:list[Area competenze] "Area competenze"
  descrizione*:textarea "Descrizione della competenza"

# FattoriRischio | Fattori di rischio | Anagrafiche | admin | sanitaria | titolo:descrizione
  descrizione*!:text "Fattore di rischio"
  riferimento:text "Riferimento normativo"
  attivo:bool=SI "Attivo (proposto nelle visite)"

# TipiDpi | Tipi DPI | Anagrafiche | admin | dpi | titolo:codice+descrizione
  codice*!:text "Codice DPI"
  descrizione*:text "Descrizione"
  normativa:text "Normativa di riferimento"
  utilizzo:textarea "Descrizione utilizzo"
  manutenzione:textarea "Manutenzione"
  scadenzaMesi:number "Scadenza indicativa (mesi – non vincolante)"
  note:textarea "Note"

# TipiCorso | Tipologie corso | Anagrafiche | admin | formazione | titolo:tipo
  tipo*!:text "Tipo corso"
  area*:list[Area corso] "Area"
  durataOre:number "Durata formazione iniziale (ore)"
  note:textarea "Programma formazione iniziale (proposto in automatico nei corsi)"
  aggiornamento:bool "Previsto aggiornamento"
  frequenzaMesi:number?{"aggiornamento":"SI"} "Frequenza aggiornamento (mesi)"
  durataAggOre:number?{"aggiornamento":"SI"} "Ore di aggiornamento richieste nel periodo"
  decorrenza:select{Dalla scadenza precedente/Dalla data di completamento}=Dalla scadenza precedente?{"aggiornamento":"SI"} "Decorrenza del nuovo periodo"
  programmaAgg:textarea?{"aggiornamento":"SI"} "Programma aggiornamento (proposto in automatico nei corsi di aggiornamento)"

# Soggetti | Clienti e Fornitori | Anagrafiche | admin | base | titolo:ragioneSociale
  ragioneSociale*:text "Ragione sociale"
  indirizzo:text "Indirizzo"
  comune:text "Comune"
  piva:text "Partita IVA"
  cf:text "Codice fiscale"
  email:email "E-mail"
  cliente:bool "Cliente"
  fornitore:bool "Fornitore"
  descrizioneFornitura:textarea?{"fornitore":"SI"} "Descrizione fornitura"
  qualifica:text(calc)?{"fornitore":"SI"} "Stato qualifica"
  mediaQualifica:text(calc)?{"fornitore":"SI"} "Media ultima valutazione"
  dataQualifica:date(calc)?{"fornitore":"SI"} "Data ultima valutazione"

# QualificheFornitori | Qualifiche fornitori | Fornitori | reg | fornitori | FIRME | figli:QualificheRighe(qualificaId) | titolo:soggettoId+data
  soggettoId*:ref>Soggetti "Fornitore"
  data*:date=today "Data valutazione"
  valutatoreId:ref>Dipendenti=me "Valutatore"
  media:text(calc) "Media voti applicabili"
  esito:text(calc) "Esito"
  note:textarea "Note / motivazioni"
  importata:bool(ro) "Importata da archivio storico"
  mediaImportata:number?{"importata":"SI"} "Punteggio medio importato (1-10)"
  esitoImportato:select{Qualificato/Non qualificato}?{"importata":"SI"} "Esito importato"
  valutatoreTesto:text?{"importata":"SI"} "Valutatore (da archivio)"

# QualificheRighe | Domande | - | reg | fornitori | CHILD | titolo:domandaId
  qualificaId:fk
  domandaId*:ref>DomandeQualifica "Domanda"
  voto:select{1/2/3/4/5/6/7/8/9/10/N.A.} "Voto (1-10 / N.A.)"
  note:text "Note"

# DomandeQualifica | Domande qualifica fornitori | Fornitori | admin | fornitori | titolo:domanda
  ordine:number "Ordine"
  domanda*:text "Domanda"
  attiva:bool=SI "Inclusa nel set standard (importata in ogni nuova qualifica)"

# Strumenti | Strumenti di misura | Strumenti di misura | admin | strumenti | titolo:codice+descrizione
  codice*!:text "Codice strumento"
  descrizione*:text "Descrizione"
  tipologia:list[Tipologia strumento] "Tipologia"
  campione:bool "Campione di riferimento"
  marca:text "Marca"
  modello:text "Modello"
  matricola:text "Matricola / n. serie"
  stato:select{In uso/In taratura/Fuori servizio/Dismesso}=In uso "Stato"
  campoMisura:text "Campo di misura"
  risoluzione:text "Risoluzione"
  unita:text "Unità di misura"
  ema*:number "Errore massimo ammesso (±)"
  frequenzaMesi*:number "Frequenza di taratura (mesi)"
  sedeId:ref>Sedi "Sede"
  ubicazione:text "Ubicazione / reparto"
  assegnatarioId:ref>Dipendenti "Responsabile / assegnatario"
  dataAcquisto:date "Data acquisto"
  fornitoreId:ref>Soggetti "Fornitore"
  ultimaTaratura:date(calc) "Ultima taratura"
  esitoTaratura:text(calc) "Esito ultima taratura"
  scadenza:date(calc) "Scadenza taratura"
  statoTaratura:text(calc) "Stato taratura"
  note:textarea "Note"

# Tarature | Tarature | Strumenti di misura | reg | strumenti | FIRME | figli:TaratureRighe(taraturaId) | titolo:strumentoId+data
  strumentoId*:ref>Strumenti "Strumento tarato"
  data*:date=today "Data taratura"
  tipo*:select{Interna/Esterna}=Interna "Tipo taratura"
  scadenza:date(calc) "Scadenza (data + mesi di taratura)"
  esito:text(calc) "Esito"
  eseguitaDaId:ref>Dipendenti=me?{"tipo":"Interna"} "Eseguita da"
  laboratorioId:ref>Soggetti?{"tipo":"Esterna"} "Laboratorio / centro di taratura"
  numCertificato:text "N. certificato / rapporto"
  certificato:file "Certificato (allegato)"
  campioneId*:ref>Strumenti?{"tipo":"Interna"} "Campione utilizzato"
  campioneInfo:text(calc)?{"tipo":"Interna"} "Stato del campione alla data di taratura"
  condizioni:text "Condizioni ambientali (temperatura, umidità…)"
  esitoDichiarato:select{Conforme/Conforme con avviso/Non conforme} "Esito dichiarato (solo se non si inseriscono punti di misura)"
  verificatoDaId:ref>Dipendenti=me "Verificato da (responsabile)"
  note:textarea "Note"

# TaratureRighe | Punti di misura | - | reg | strumenti | CHILD | titolo:punto
  taraturaId:fk
  punto:text "Punto / descrizione"
  valoreCampione*:number "Valore campione"
  valoreStrumento*:number "Valore strumento"
  ema:number "Toll. ± (se diversa)"
  scarto:text(calc) "Scarto"
  esitoPunto:text(calc) "Esito punto"

# Sedi | Sedi | Anagrafiche | admin | base | titolo:denominazione
  codice*!:text "Codice sede"
  denominazione*:text "Denominazione"
  indirizzo:text "Indirizzo"
  comune:text "Comune"
  responsabileId*:ref>Dipendenti "Responsabile manutenzione"
  attiva:bool=SI "Attiva"

# PianiManutenzione | Piani di manutenzione | Attrezzature | admin | attrezzature | figli:PianiAttivita(pianoId) | titolo:codice+descrizione
  codice*!:text "Codice piano"
  descrizione*:text "Descrizione"
  note:textarea "Note"

# PianiAttivita | Attività del piano | - | admin | attrezzature | CHILD | titolo:attivita
  pianoId:fk
  attivita*:text "Attività"
  frequenza*:number=1 "Ogni"
  unita*:select{Giorni/Settimane/Mesi/Anni}=Mesi "Unità"
  istruzioni:text "Istruzioni"

# TipiAttrezzatura | Tipologie attrezzatura | Attrezzature | admin | attrezzature | titolo:codice+descrizione
  codice*!:text "Codice tipologia"
  descrizione*:text "Descrizione"
  pianoId:ref>PianiManutenzione "Piano di manutenzione standard"

# Attrezzature | Attrezzature | Attrezzature | admin | attrezzature | figli:AttrezzatureAttivita(attrezzaturaId) | titolo:codice+descrizione
  codice*!:text "Codice attrezzatura"
  descrizione*:text "Descrizione"
  tipoId*:ref>TipiAttrezzatura "Tipologia"
  sedeId*:ref>Sedi "Sede"
  marca:text "Marca"
  modello:text "Modello"
  matricola:text "Matricola / n. serie"
  dataAcquisto:date "Data acquisto"
  fornitoreId:ref>Soggetti "Fornitore"
  stato:select{In uso/Fuori servizio/Dismessa}=In uso "Stato"
  pianoId:ref>PianiManutenzione "Piano di manutenzione"
  responsabile:text(calc) "Responsabile manutenzione (dalla sede)"
  prossimaScadenza:text(calc) "Prossima manutenzione"
  note:textarea "Note"

# AttrezzatureAttivita | Attività di manutenzione | - | admin | attrezzature | CHILD | titolo:attivita
  attrezzaturaId:fk
  attivita*:text "Attività"
  frequenza*:number=1 "Ogni"
  unita*:select{Giorni/Settimane/Mesi/Anni}=Mesi "Unità"
  attiva:bool=SI "Attiva"
  ultimaEsecuzione:date(ro) "Ultima esecuzione"
  prossima:date(calc) "Prossima"

# Documenti | Documenti | Documentazione | doc | documenti | FIRME | figli:DocumentiCollegamenti(documentoId) | titolo:codice+titolo
  codice*:text "Codice documento"
  titolo*:text "Titolo"
  tipologia:list[Tipologia documento] "Tipologia"
  revisione*:text=0 "Revisione"
  dataRevisione*:date=today "Data revisione"
  stato:select{Bozza/In approvazione/In vigore/Superato/Ritirato}(ro)=Bozza "Stato"
  corrente:bool(calc) "Revisione corrente"
  modalitaRevisione:list[Modalità revisione documento] "Modalità di revisione"
  descrizioneModifica:textarea "Descrizione della modifica"
  redattoDa*:ref>Dipendenti=me "Redatto da"
  verificatoDa:ref>Dipendenti "Verificato da (facoltativo)"
  approvatoDa*:ref>Dipendenti "Approvato da"
  dataApprovazione:date(ro) "Data approvazione"
  link:text "Link al documento"
  file:file "File del documento"
  distTutti:bool "Tutti i dipendenti"
  distMansioni:multiref>Mansioni "Mansioni destinatarie"
  distSedi:multiref>Sedi "Sedi destinatarie (tutti i dipendenti della sede)"
  distDipendenti:multiref>Dipendenti "Altri destinatari singoli"
  presaVisione:select{Tutti i destinatari/Solo chi non ha letto le revisioni precedenti/Nessuna}=Tutti i destinatari "Presa visione firmata per questa revisione"
  giorniPresa:number=15 "Giorni per la presa visione"
  avvisoEmail:bool=SI "Avvisa via e-mail gli utenti del sistema"
  letture:text(calc) "Prese visione firmate"
  riesameMesi:number "Riesame ogni (mesi)"
  prossimoRiesame:date(calc) "Prossimo riesame"
  note:textarea "Note"
  importato:bool(ro) "Importato da elenco esistente"
  sostituisceId:hidden
  distribuitoIl:hidden

# DocumentiCollegamenti | Collegamenti | - | doc | documenti | CHILD | titolo:collegatoId
  documentoId:fk
  tipo*:select{Richiama/Modulo da usare/Istruzione di dettaglio/Sostituisce/Altro}=Richiama "Tipo di collegamento"
  collegatoId*:ref>Documenti "Documento collegato"
  note:text "Note"

# PreseVisione | Prese visione | Documentazione | reg | documenti | FIRME | titolo:documentoId+dipendenteId
  documentoId*:ref>Documenti "Documento"
  dipendenteId*:ref>Dipendenti "Dipendente"
  assegnataIl:date=today "Assegnata il"
  entroIl:date "Da firmare entro il"
  stato:text(calc) "Stato"
  dataLettura:date(calc) "Firmata il"
  note:text "Note"

# Elenchi | Elenchi personalizzabili | Configurazione | admin | base | titolo:valore
  categoria*:select{Area competenze/Tipo contratto/Modalità valutazione efficacia/Tipologia NC/Area corso/Tipologia strumento/Tipologia visita medica/Giudizio di idoneità/Tipologia documento/Modalità revisione documento} "Elenco"
  valore*:text "Valore"
  ordine:number "Ordine"

# Firme | Registro firme | Configurazione | ro | base | titolo:signerNome
  rifEntity:text "Documento"
  rifId:text "ID documento"
  ruolo:text "Ruolo"
  signerKey:hidden
  signerNome:text "Firmatario"
  signerEmail:text "E-mail"
  metodo:text "Metodo"
  stato:text "Stato"
  dataFirma:datetime "Data firma"
  fileId:file "File firma / scansione"
  note:text "Note"
  token:hidden
  tokenScad:hidden

# Log | Registro accessi | Configurazione | ro | base | titolo:data
  data:datetime "Data e ora"
  email:text "Utente"
  evento:text "Evento"
  dettaglio:text "Dettaglio"

# FileReg | File caricati | - | sys | base | titolo:nome
  nome:text "Nome"
  mime:text "Tipo"
  tipo:text "Categoria"
`;

const RE_CAMPO = /^(\w+)(\*)?(!)?:(\w+)(?:>(\w+)|\[([^\]]+)\]|\{([^}]*)\})?((?:\((?:ro|calc)\))*)(?:=(.*?))?(?:\?(\{.*\}))?(?:\s+"(.*)")?$/;

function analizza(testo) {
  const schema = {};
  let ent = null;
  for (const grezza of testo.split('\n')) {
    const riga = grezza.trim();
    if (!riga) continue;
    if (riga.startsWith('#')) {
      const p = riga.slice(1).split('|').map(s => s.trim());
      ent = { name: p[0], label: p[1], group: p[2] === '-' ? '' : p[2], perm: p[3], packs: p[4].split('+'), pack: p[4].split('+')[0],
        signers: false, child: false, children: [], title: [], auto: '', fields: [] };
      for (const x of p.slice(5)) {
        if (x === 'FIRME') ent.signers = true;
        else if (x === 'CHILD') ent.child = true;
        else if (x.startsWith('figli:')) ent.children = x.slice(6).split(',').map(s => {
          const m = /^(\w+)\((\w+)\)$/.exec(s.trim());
          return { e: m[1], fk: m[2] };
        });
        else if (x.startsWith('titolo:')) ent.title = x.slice(7).split('+');
        else if (x.startsWith('auto:')) ent.auto = x.slice(5);
        else throw new Error('Schema: intestazione non riconosciuta: ' + riga);
      }
      schema[ent.name] = ent;
      continue;
    }
    const m = RE_CAMPO.exec(riga);
    if (!m) throw new Error('Schema: campo non riconosciuto: ' + riga);
    const f = { name: m[1], type: m[4], label: m[11] || m[1] };
    if (m[2]) f.req = true;
    if (m[3]) f.uniq = true;
    if (m[5]) f.ref = m[5];
    if (m[6]) f.list = m[6];
    if (m[7] !== undefined) f.options = m[7].split('/');
    if (m[8] && m[8].includes('(ro)')) f.ro = true;
    if (m[8] && m[8].includes('(calc)')) f.virtual = true;
    if (m[9] !== undefined) f.def = m[9];
    if (m[10]) f.showIf = JSON.parse(m[10]);
    if (f.type === 'textarea') f.w = 'full';
    ent.fields.push(f);
  }
  // Controlli di coerenza e colonne predefinite in elenco.
  for (const e of Object.values(schema)) {
    let n = 0;
    for (const f of e.fields) {
      if (f.ref && !schema[f.ref]) throw new Error('Schema: ' + e.name + '.' + f.name + ' punta a un\'entità inesistente');
      if (!['fk', 'hidden', 'textarea', 'file'].includes(f.type) && !f.showIf && n < 6) { f.inList = true; n++; }
      if (['select', 'list', 'bool'].includes(f.type) && f.inList) f.filter = true;
    }
    for (const c of e.children) {
      if (!schema[c.e] || !schema[c.e].child) throw new Error('Schema: figlio non valido ' + c.e);
      schema[c.e].parent = e.name;
      c.l = schema[c.e].label;
    }
  }
  return schema;
}

const SCHEMA = analizza(TESTO);

// Valori iniziali degli elenchi personalizzabili (modificabili dall'amministratore).
const ELENCHI = {
  'Area competenze': ['Tecniche', 'Sicurezza', 'Qualità', 'Ambiente', 'Trasversali'],
  'Tipo contratto': ['Tempo indeterminato', 'Tempo determinato', 'Apprendistato', 'Somministrazione', 'Stage / Tirocinio'],
  'Modalità valutazione efficacia': ['Colloquio', 'Attestato', 'Test scritto', 'Osservazione sul campo', 'Riesame della direzione'],
  'Tipologia NC': ['Prodotto', 'Processo', 'Fornitore', 'Sicurezza', 'Ambiente', 'Documentale'],
  'Area corso': ['Sicurezza', 'Qualità', 'Ambiente', 'Tecnica', 'Gestionale'],
  'Tipologia strumento': ['Calibro', 'Micrometro', 'Comparatore', 'Manometro', 'Termometro', 'Bilancia', 'Multimetro', 'Dinamometro', 'Chiave dinamometrica'],
  'Tipologia visita medica': ['Preventiva', 'Preventiva in fase preassuntiva', 'Periodica', 'Valutazione idoneità alla mansione', 'Su richiesta del lavoratore', 'Cambio mansione', 'Rientro dopo assenza oltre 60 giorni', 'Cessazione del rapporto di lavoro'],
  'Giudizio di idoneità': ['Idoneo', 'Idoneo con prescrizioni', 'Idoneo con limitazioni', 'Idoneo con prescrizioni e limitazioni', 'Temporaneamente non idoneo', 'Non idoneo permanentemente'],
  'Tipologia documento': ['Manuale', 'Politica', 'Procedura', 'Istruzione operativa', 'Modulo', 'Piano', 'Registro', 'Documento esterno'],
  'Modalità revisione documento': ['Prima emissione', 'Revisione parziale', 'Revisione totale', 'Aggiornamento normativo', 'Correzione formale'],
};

const FATTORI_RISCHIO = [
  ['Movimentazione manuale dei carichi', 'D.Lgs. 81/08 Titolo VI'],
  ['Videoterminali', 'D.Lgs. 81/08 Titolo VII'],
  ['Rumore', 'D.Lgs. 81/08 Titolo VIII Capo II'],
  ['Vibrazioni', 'D.Lgs. 81/08 Titolo VIII Capo III'],
  ['Agenti chimici', 'D.Lgs. 81/08 Titolo IX Capo I'],
  ['Agenti cancerogeni e mutageni', 'D.Lgs. 81/08 Titolo IX Capo II'],
  ['Agenti biologici', 'D.Lgs. 81/08 Titolo X'],
  ['Lavoro notturno', 'D.Lgs. 66/2003'],
  ['Lavori in quota', 'D.Lgs. 81/08 Titolo IV'],
];

const DOMANDE_QUALIFICA = [
  'Qualità del prodotto / servizio fornito',
  'Rispetto dei tempi di consegna',
  'Conformità e completezza della documentazione',
  'Competitività del prezzo',
  'Assistenza e disponibilità',
  'Gestione di reclami e non conformità',
];

const CONFIG_PREDEFINITA = {
  ragioneSociale: '', indirizzo: '', comune: '', piva: '', cf: '', email: '', telefono: '',
  colore: '#1F4E79', otpMinuti: 10, sessioneOre: 6, linkFirmaGiorni: 7,
  emailDpi: '', oggettoDpi: 'CONSEGNA DPI {NOME} E {DATA}',
  dichiarazioneDpi: 'Il lavoratore dichiara di aver ricevuto i dispositivi di protezione individuale elencati, di essere stato informato sul loro corretto utilizzo e si impegna a usarli e conservarli con cura.',
  sogliaQualifica: 6, accessoSanitaria: 'Solo amministratori',
};

module.exports = { SCHEMA, ELENCHI, FATTORI_RISCHIO, DOMANDE_QUALIFICA, CONFIG_PREDEFINITA, analizza };
