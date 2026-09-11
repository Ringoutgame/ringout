// Central local test runner for RingOut.
// Runs every offline suite as a child process, prints one compact line per
// suite, and dumps the full output only for suites that fail. Exit code is 1
// as soon as any suite fails, 0 when all pass.
//
// Deliberately NOT included: tools/rest_verify_v3.js writes to the LIVE
// database and must be run manually with --live. See docs/SYSTEM-ANALYSE.
//
// Usage: node tools/run_all_tests.js
const path = require('path'), { spawnSync } = require('child_process');

// name = display label, file = suite in tools/, expectPassed = erwartete Anzahl
// bestandener Assertions (aus dem letzten "N passed, M failed" der Suite geparst),
// null = Suite hat keinen Assertion-Zaehler (nur Exit-Code zaehlt, z.B. Syntax-Check).
const SUITES = [
  { name: 'Syntax',           file: 'test_syntax.js',         expectPassed: null },
  { name: 'Golden-Physik',    file: 'test_physics_golden.js', expectPassed: 13 },
  { name: 'Football-Shell',   file: 'test_football_shell.js', expectPassed: 954 },   // Arena-Finalisierung + Review-Fixes: Rounded Rectangle B, gerades Tor, M1, Ballradius 25
  { name: 'Football-Flow',    file: 'test_football_flow.js',  expectPassed: 155 },   // Arena-Finalisierung 2026-08-07: M1-Wirkungsmessung, Rechteckgrenze, Ballradius 25
  { name: 'Football-Arena',   file: 'test_football_arena.js', expectPassed: 80 },    // Classic auf der kanonischen Shouldered-Wide-Arena, buendiges Tor, M1, Ballradius 25
  { name: 'Football-Tactical', file: 'test_football_tactical.js', expectPassed: 300 },   // Tactical 1v1 (2 Figuren, 1 Zug je Team/Runde) + sichtbare Modusauswahl der drei Produktmodi
  { name: 'Football-Elim',    file: 'test_football_elimination4.js', expectPassed: 1530 },  // Dev-Einstieg auf vier Startspieler: ZWEI LEBEN + adaptive Arena 4 -> 3 -> 2 -> 1 + fairer Respawn
  { name: 'Football-Elim5',   file: 'test_football_elimination5.js', expectPassed: 320 },
  { name: 'Football-ArenaKanon', file: 'test_football_arena_canonical.js', expectPassed: 137 },  // KANONISCHE ARENA B: eine Wandbeschreibung (FB_TWO_GOAL_SHAPE) fuer alle Zwei-Tor-Modi und dasselbe Schulterverhaeltnis radial (FB_RADIAL_SHAPE) fuer 3/4/5 Tore; prueft zusaetzlich, dass vom A/B/C-Labor kein Rest uebrig ist
  { name: 'Football-LivesSim', file: 'test_football_lives_sim.js', expectPassed: 117 },  // LEBENSREGEL SIMULTAN: ein gemeinsames 6-Sekunden-Fenster fuer alle aktiven Spieler, gleichzeitiger Abschuss, Lebensbuchung 2->1->raus unveraendert, keine Phasenuhr
  { name: 'Football-Team2v2', file: 'test_football_team2v2.js', expectPassed: 127 },  // TRUE TEAM 2V2: vier Identitaeten mit eigenen Kugeln, ein gemeinsames Fenster, gleichzeitiger Abschuss, Teamwertung nach Torseite (Eigentor eingeschlossen), First to 3
  { name: 'Football-TimedFFA', file: 'test_football_timed_ffa.js', expectPassed: 242 },   // Elimination 2.0: Phasenuhr nur waehrend gespielter Zeit, Gegentore je Phase, Gleichstand ohne Los; Leben, Classic, Tactical und Online unberuehrt
  { name: 'Football-Zeit',    file: 'test_football_timed_classic.js', expectPassed: 257 },  // Classic 1v1 auf Zeit: 90 s BEDENKZEIT in festen Ticks, Golden Goal bei Gleichstand, Tactical und Elimination unberuehrt
  { name: 'Football-Action',  file: 'test_football_action_core.js', expectPassed: 59 },  // Action Core 04: der Stossimpuls kennt Massen — ein sauberer Volltreffer gibt dem Ball 96.7 % statt 71.4 %, Winkel und Staerke bleiben taktische Groessen, die Daempfung beider Kugelarten ist unangetastet
  { name: 'Football-Tormund', file: 'test_football_goal_mouth.js', expectPassed: 263 },  // sichtbar offen heisst physisch offen: im Torfenster keine Bande, der Sockel besitzt die Zurueckweisung, das Tor wird nie breiter als es aussieht
  { name: 'Football-FX',      file: 'test_football_fx.js',     expectPassed: 112 },    // Action-Feel 02: gedeckelte Effektliste, kurzlebige Formen, keine Spielzustandsberuehrung, RingOut unberuehrt  // Produktmodus Elimination: 5 -> 4 -> 3 -> 2 -> Sieger, dieselbe Architektur
  { name: 'Football-Musik',   file: 'test_football_music.js',  expectPassed: 376 },   // Menue-/Lobbymusik als Asset (Energiekurve leicht -> voll, Schleife nur ueber die volle Phase, Menuepegel 0,30, Matchblende, ein Kontext); das prozedurale Thema bleibt liegen, wird aber in jedem Bild auf 'off' gehalten
  { name: 'Fixed-Timestep',  file: 'test_fixed_timestep.js', expectPassed: 202 },  // Gameplay laeuft in festen 60-Hz-Schritten, unabhaengig von der Bildwiederholrate
  { name: 'r3d-Mapping',      file: 'test_r3d_mapping.js',    expectPassed: 52 },
  { name: 'Sanitize',         file: 'test_sanitize.js',       expectPassed: 24 },
  { name: 'Identity',         file: 'test_identity.js',       expectPassed: 45 },
  { name: 'ValidateRoom',     file: 'test_validateroom.js',   expectPassed: 47 },
  { name: 'Lockstep',         file: 'test_lockstep.js',       expectPassed: 24 },
  { name: 'FFA-Kern',         file: 'test_ffa.js',            expectPassed: 18 },
  { name: 'FFA-Online-Prep',  file: 'test_ffa_online.js',     expectPassed: 53 },
  { name: 'FFA-Online-Flow',  file: 'test_ffa_flow.js',       expectPassed: 153 },
  { name: 'FFA-Online-Race',  file: 'test_ffa_race.js',       expectPassed: 115 },
        { name: 'Reconnect-B2',     file: 'test_reconnect.js',      expectPassed: 213 },   // 53 Bestand (RC1-RC11) + 14 RC-ENV + 17 RC-UID/RC-UID2: Seat-Eigentum ueber auth.uid, Diebstahlversuch mit bekannter Spieler-ID, Zweittab, Mehrdeutigkeit und Legacy-Rueckfall
          { name: 'Protokoll',        file: 'test_online_protocol.js', expectPassed: 214 },
  { name: 'Online-PhaseA',   file: 'test_online_phase_a.js', expectPassed: 326 },   // PROTOKOLL v8 PHASE A: ein Modusregister mit Sollbesetzung, Freigabetor fuer noch nicht fertige Onlinemodi, modusbewusste Lobby mit Soll/Ist - und der Nachweis, dass der Zugpfad unveraendert der v7-Pfad ist (kein v9-Mechanismus)   // reine Schema-/Vertragsschicht: Version, Raumtyp, Sitz/Koerper, kanonische Zugereignisse
  { name: 'Raum-Protokollweiche', file: 'test_online_room_protocol_routing.js', expectPassed: 80 },   // STUFE 2A: die Protokollfassung gehoert dem RAUM, nicht dem Client. Ein NEUER Raum bekommt sie aus seiner Konfiguration - Football mit der Lebensregel und drei bis fuenf Sitzen wird v9, alles andere bleibt v8, und der Waehler zieht dieselben Grenzen wie die Rules. Bestehende Raeume behalten ihre Fassung; derselbe ausgelieferte Client betritt beide Familien und ist in einem v8-Raum ausdruecklich KEIN v9-Client. Der Zugslot t bleibt v8 vorbehalten, die v9-Knoten bleiben v9-Raeumen vorbehalten - kein Mischbetrieb.
  { name: 'Online-V9',      file: 'test_online_v9.js', expectPassed: 349 },
  { name: 'Online-V10',     file: 'test_online_v10.js', expectPassed: 84 },   // PROTOKOLL v10, NUR RULES: dynamische Besetzung - config.cap ist die Hoechstbesetzung (5), seats die eingefrorene Startbesetzung (2-5); die Protokoll-Sitzmengen zaehlen bis seats; v9 bleibt woertlich; v10 ist oeffentlich auffindbar.   // V9.1/V9.2 GRUNDLAGE, NUR RULES: autoritative Turn-Eroeffnung (d/<turn>/{n,o}) und Commit-Terminal (c/<turn>/<seat>) - der freigegebene Client steht weiterhin auf Protokoll 8 und kann keinen v9-Raum anlegen. dazu der Reveal-Anker (ro/<turn>) und das write-once Reveal-Ergebnis (r/<turn>/<seat>) hinter der vollstaendigen Commit-Barriere. Die Rules koennen SHA-256 NICHT rechnen - die Bindung Hash<->Reveal und jede Spielwirkung kommen erst mit V9.3.
  { name: 'Online-V9-Crypto', file: 'test_online_v9_crypto.js', expectPassed: 125 },   // V9.3A CODEC, RUHEND: die kanonische 60-Byte-Zugvorlage (gross-endian, feste Offsets), 128-Bit-Salz aus Web Crypto und SHA-256 - samt EINGEFRORENEM Pruefvektor, der unabhaengig gerechnet wurde und der Vertrag zwischen zwei Clients ist. Kein Netzpfad ruft ihn auf.
  { name: 'Online-V9-Client', file: 'test_online_v9_client.js', expectPassed: 158 },   // V9.3B1 PROTOKOLLMASCHINE, RUHEND: Commit bauen, das Geheimnis der Runde halten, beide Barrieren lesen, Enthuellungen pruefen (VALID / HASH_MISMATCH / MALFORMED / NO_REVEAL) und die anerkannte Zugmenge aufsteigend nach Sitz bilden - ohne Firebase, ohne Spielzustand, ohne applyLaunch. Der freigegebene v8-Weg ruft sie nicht auf.
  { name: 'Online-V9-Netz',  file: 'test_online_v9_network.js', expectPassed: 254 },   // V9.3B2A ADAPTER, RUHEND: die duenne Schicht zu Firebase - Turn eroeffnen, Commit und Reveal schreiben, vier Knoten belauschen. Geprueft gegen eine deterministische Attrappe, also OHNE Emulator, Netz oder npm-Firebase; der ergaenzende Beweis mit dem echten SDK liegt in test_online_v9_sdk.js und wird von Hand angestossen.
  { name: 'Online-V9-Ablauf', file: 'test_online_v9_coordinator.js', expectPassed: 194 },   // V9.3B2B ABLAUFSTEUERUNG, RUHEND: Runde eroeffnen, eigenes Terminal, Commit-Barriere, Reveal-Anker, eigenes Ergebnis, Ergebnisbarriere, geprüfte Zugmenge - ausdruecklich NUR der gute Fall. Keine Fristen, keine Sentinel-Schreiber, kein applyLaunch, keine Spielfolge.
  { name: 'Online-V9-Speicher', file: 'test_online_v9_secret_store.js', expectPassed: 132 },   // V9.3B2C3B GEHEIMNISSPEICHER, RUHEND: das Geheimnis einer Runde ueberlebt im sessionStorage das Neuladen DESSELBEN Tabs. Gelesen wird nur, was IN SICH stimmt - der Hash wird neu berechnet, nie geglaubt. Der Abgleich mit dem echten Commit in Firebase ist die zweite Ebene und gehoert zur Steuerung (B2C3C).
  { name: 'Online-V9-Fortsetzung', file: 'test_online_v9_secret_resume.js', expectPassed: 289 },   // V9.3B2C3C GEHEIMNIS UND FORTSETZUNG, RUHEND: gesichert wird VOR dem Senden - ein Absturz darf nie einen unveraenderlichen Commit ohne Salz hinterlassen. Nach dem Neuladen uebernimmt derselbe Lauf sein Terminal aus dem Raum und holt das Geheimnis zurueck, aber NUR wenn sein Hash der des echten Commits ist. Fehlt es, wird nichts erfunden: der Slot faellt nach der Frist an noreveal. Keine Spielfolge.
  { name: 'Online-V9-Bereitschaft', file: 'test_online_v9_ready_client.js', expectPassed: 143 },   // V9.4B2A BEREITSCHAFTSBAUSTEINE, RUHEND: Generationsstart s, Protokollabschluss z, eigene Bereitschaft q und dauerhafte Disqualifikation x - Pfade, Nutzlasten und die reinen Auswertungen. Diese Schicht liest KEINE Uhr: ob ein Fristschluss zulaessig war, entscheiden allein die Rules. Ein Fristschluss ohne x befreit den Sitz NICHT.
  { name: 'Online-V9-Bereitschaftssteuerung', file: 'test_online_v9_ready_coordinator.js', expectPassed: 140 },   // V9.4B2B BEREITSCHAFTSSTEUERUNG, RUHEND: die Barriere VOR dem Entscheidungsfenster. Der Anker kommt nie aus dem eigenen Schreibvorgang, sondern aus dem autoritativen Schnappschuss; bereit ist dieser Client erst, wenn er es ausdruecklich sagt. Nach der Frist wird geschlossen - erst Fristschluss, dann, wenn er autoritativ dasteht, die Disqualifikation. Eroeffnet keine Runde, schreibt kein remove, ruehrt kein Spiel an.
  { name: 'Online-V9-Spielanbindung', file: 'test_online_v9_lifecycle.js', expectPassed: 130 },   // V9.4C SPIELANBINDUNG, RUHEND: die duenne Schicht zwischen Spiel und den beiden V9-Steuerungen. Sie meldet Bereitschaft an genau zwei Stellen - Rundenbeginn und Settlement -, uebergibt nach geschlossener Barriere an die BESTEHENDE Ablaufsteuerung und schliesst Sitze mit e oder x sofort mit remove. Sie erhoeht keine Rundennummer, wendet keine Zugmenge an und zieht keine Spielfolge. Ruht, weil ein Client nur Raeume seiner eigenen Protokollfassung betritt.
  { name: 'Online-V9-Spielbruecke', file: 'test_online_v9_gameplay_bridge.js', expectPassed: 151 },   // V9.4D1 SPIELBRUECKE, RUHEND: der EINZIGE Weg vom Netz ins Spiel. Sie nimmt eine fertige, verifizierte Zugmenge - keine Schnappschuesse - und uebersetzt sie: VALID exakt, pass/late/skip/remove als Nullhandlung ohne Lebensabzug, NO_REVEAL/HASH_MISMATCH/MALFORMED als sofortiges Ausscheiden. Erst ausscheiden, dann starten; genau einmal je Runde; kein zweiter Abschussweg und kein zweiter Hash.
  { name: 'Online-V9-Eingabebruecke', file: 'test_online_v9_input_bridge.js', expectPassed: 89 },   // V9.5B EINGABEBRUECKE, RUHEND: der EINZIGE Weg vom Spieler ins Netz. Derselbe applyCommit, den Zeigerloslassen und Stand-Taste benutzen, waehlt die Strecke - v8 in den Zugslot t, v9 an die Ablaufsteuerung. Der Zug wird dabei NICHT neu gerechnet: was sanitizeMove einmal bereinigt hat, geht bitgenau in die Hashschicht. Auch der Nullzug geht als verborgener move, denn ein pass verriete waehrend des Commit-Fensters die Absicht. Ein v9-Raum faellt nie auf v8 zurueck, es entsteht kein zweites Salz, und die Eingabe startet weder Abschuss noch Enthuellung.
  { name: 'Online-V9-Rehydrierung', file: 'test_online_v9_rehydrate.js', expectPassed: 125 },   // V9.4D2 REHYDRIERUNG, RUHEND: es gibt KEINE Momentaufnahme der Welt. Der Zustand ist die Folge aus Anfangsaufstellung und Zughistorie, und die Simulation ist deterministisch - ein Rueckkehrer bekommt ihn, indem dieselbe Pipeline dieselben Zuege noch einmal rechnet. Historie ist eine Runde erst mit autoritativem Abschlussanker z, und nur lueckenlos ab Runde 0. Nachgespielt wird stumm: kein Schreibvorgang, kein Bereitschaftslauf, kein Klang.
  { name: 'Football-Online', file: 'test_football_online.js', expectPassed: 763 },   // fuenf getrennte Clients an einer Datenbank: Lobby, paralleler Commit, gleichzeitiger Abschuss, Tore/Leben, 5->4->3->2, Rehydrierung
        // 719 -> 713 mit Action Core 04: der Ball traegt mehr Energie, es fallen mehr
        // Streutore, und in der Sequenz [P1>P2>P3] steht der Sieger fest, BEVOR P3 an die
        // Reihe kommt. Die Schleife bricht dann ab (das ist ihr Vertrag) und drei
        // Zusicherungen je Ansicht laufen nicht mehr. Dieselben Pruefungen laufen fuer die
        // ersten beiden Ausfaelle weiter; verloren geht nur die Zwei-Ueberlebenden-Stufe
        // in genau dieser Sequenz, die offline von der Elimination-Suite gedeckt ist.
  { name: 'Rules',            file: 'test_rules.js',          expectPassed: 592 },   // v4: Seat-Ownership, Football-Raumtyp, typisierte Zuege (move/skip/remove) und die Eviction
  { name: 'Public-Lobby',     file: 'test_public_lobby.js',   expectPassed: 62 },
  { name: 'Team-Duel',        file: 'test_team_duel.js',      expectPassed: 36 },
];

const lastLine = (s) => {
  const lines = String(s).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '(keine Ausgabe)';
};
// Parst "N passed, M failed" aus der Suite-Ausgabe — alle Suiten enden mit dieser
// Zeile (bzw. lassen expectPassed=null, wenn sie keinen Zaehler ausgeben).
const parsePassed = (s) => {
  const m = String(s).match(/(\d+)\s+passed/);
  return m ? parseInt(m[1], 10) : null;
};

let failed = 0;
const failures = [];
console.log('RingOut Test-Runner — ' + SUITES.length + ' Suiten\n');

for (const s of SUITES) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, s.file)], { encoding: 'utf8' });
  const ms = Date.now() - started;
  const out = (r.stdout || '') + (r.stderr || '');
  const exitOk = r.status === 0;
  const actualPassed = parsePassed(r.stdout);
  // Weniger ODER mehr bestandene Assertions als erwartet gilt als Fehlschlag —
  // eine veraltete/gesunkene Testabdeckung faellt so sofort auf, nicht erst wenn
  // jemand zufaellig die letzte Zeile manuell liest.
  const countOk = s.expectPassed == null || actualPassed === s.expectPassed;
  const ok = exitOk && countOk;
  const tag = ok ? 'OK  ' : 'FAIL';
  let summary;
  if (!exitOk) summary = 'exit ' + r.status;
  else if (!countOk) summary = 'Assertion-Zahl weicht ab: erwartet ' + s.expectPassed + ', erhalten ' + actualPassed;
  else summary = lastLine(r.stdout);
  console.log(
    '[' + tag + '] ' + s.name.padEnd(16) + ' ' + summary.padEnd(40) + ' (' + ms + ' ms)'
  );
  if (!ok) { failed++; failures.push({ name: s.name, out }); }
}

if (failures.length) {
  for (const f of failures) {
    console.log('\n=== Volle Ausgabe: ' + f.name + ' ===');
    console.log(f.out.trimEnd());
  }
}

console.log(
  '\nGesamt: ' + (SUITES.length - failed) + '/' + SUITES.length + ' Suiten bestanden' +
  (failed ? ' — ' + failed + ' fehlgeschlagen' : ' — alles grün')
);
process.exit(failed ? 1 : 0);
