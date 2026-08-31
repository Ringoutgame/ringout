// Baut das Verzeichnis, das Firebase Hosting veroeffentlicht.
//
// WARUM ein eigenes Verzeichnis und kein Deploy aus dem Repo-Wurzelverzeichnis:
// Hosting kennt nur eine AUSSCHLUSSliste (`ignore`). Aus der Wurzel zu deployen hiesse,
// jede Datei einzeln auszuschliessen - und jede kuenftige Datei waere standardmaessig
// oeffentlich. Hier gilt das Gegenteil: veroeffentlicht wird ausschliesslich, was unten
// ausdruecklich aufgezaehlt ist. Alles andere - Tests, Werkzeuge, Dokumentation,
// Prototypen, Git, lizenzierte Rohdateien - kann gar nicht erst hineingeraten.
//
// Die Liste ist die Laufzeitabhaengigkeit von index.html, nachgelesen im Quelltext:
// die drei geladenen GLBs, die drei HDRIs der Umgebungsprofile samt Fallbackkette,
// beide Torton-Formate, die zwei Transitionsklaenge und die eine vorhandene Rollklang-
// Fassung. three.js und Firebase kommen zur Laufzeit vom CDN und liegen nicht lokal.
//
//   node tools/build_hosting.js
//
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public');

// Genau diese Dateien werden veroeffentlicht - nichts sonst.
const DATEIEN = [
  'index.html',
  // 3D-Geometrie
  'assets/arena_platform.glb',
  'assets/arena_football_goal.glb',
  'assets/arena_football_band.glb',
  // Umgebungslicht: Profil "dawn", Profil "day" und die gemeinsame Fallbackkette
  'assets/hdri/qwantani_sunset_puresky_2k.hdr',
  'assets/hdri/qwantani_puresky_2k.hdr',
  'assets/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
  // Klang: Torton (zwei Formate wegen Safari/iOS), Arenaumbau, Rollgeraeusch
  'assets/audio/arena_football_goal.ogg',
  'assets/audio/arena_football_goal.mp3',
  'assets/audio/arena_football_transition_reconfigure.wav',
  'assets/audio/arena_football_transition_lock.wav',
  'assets/sfx/marble_roll_loop.m4a'
];

// Sicherheitsnetz gegen ein versehentlich erweitertes DATEIEN-Array: nichts aus diesen
// Bereichen darf jemals im Hosting landen.
const VERBOTEN = [/^\.git/, /^tools\//, /^artifacts\//, /^docs\//, /^src\//, /^node_modules\//,
                  /^\.github\//, /\.md$/i, /^firebase\.rules\.json$/, /^firebase\.json$/,
                  /^package(-lock)?\.json$/, /^assets\/textures\//, /\.blend[0-9]?$/i,
                  /^assets\/audio\/Goal sound Arena Football\.mp3$/];

function pruefe(rel) {
  for (const muster of VERBOTEN) {
    if (muster.test(rel)) throw new Error('Diese Datei gehoert nicht ins Hosting: ' + rel);
  }
  if (!fs.existsSync(path.join(ROOT, rel))) throw new Error('Fehlt im Repo: ' + rel);
}

function leere(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const kb = (n) => (n / 1024).toFixed(1).padStart(9) + ' KB';

for (const rel of DATEIEN) pruefe(rel);
leere(OUT);

let gesamt = 0;
for (const rel of DATEIEN) {
  const von = path.join(ROOT, rel), nach = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(nach), { recursive: true });
  fs.copyFileSync(von, nach);
  const groesse = fs.statSync(nach).size;
  gesamt += groesse;
  console.log(kb(groesse) + '  ' + rel);
}
console.log('-'.repeat(46));
console.log(kb(gesamt) + '  ' + DATEIEN.length + ' Dateien in public/');
console.log('');
console.log('Deploy:  firebase.cmd deploy --only hosting');
