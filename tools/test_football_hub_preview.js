// ARENA FOOTBALL - MODUSMENUE + RAUMVORSCHAU (UX-Fix, 2026-09-22).
//
// Drei Dinge werden festgehalten:
//   1. Das Arena-Football-Menue hat VIER Karten (FFA, 1 VS 1, TEAM 2V2, TRAINING); 1 VS 1
//      oeffnet eine kleine Unterauswahl mit genau TACTICAL 1V1 und TACTICAL 4-BALL 1V1. Die
//      internen Schluessel (tactical / tactical4) bleiben getrennt, jede Wahl nimmt denselben
//      Onlineweg wie eine Karte (fbHubOeffnen). Zurueck setzt nichts und laesst nichts stehen.
//   2. Die Kartenbilder sind Aufnahmen des echten 3D-Renderers (assets/hub/modes/*.webp,
//      700x438): 1 VS 1 und die Option TACTICAL 1V1 tragen football_tactical, die Option
//      TACTICAL 4-BALL 1V1 football_tactical4 (4 Blau + 4 Rot + Ball). Ring Out unveraendert.
//   4. ARENA FOOTBALL ist das Hauptspiel: im Spielumschalter steht es zuerst/links, Ring Out
//      zweiter/rechts, und ein frischer Start waehlt Arena Football (menuSel). Ring Out bleibt
//      vollstaendig erreichbar; der Wechsel in beide Richtungen raeumt Kontext, Markierung,
//      Modusleiste und Hero sauber um. Ein Wiedereintritt bringt seinen Spielzustand selbst mit.
//   3. Die Football-Buehne (fbBuehne: mode==='football') steht im Match, im Arena-Fenster des
//      Onlinebildschirms (Koerper des Raummodus, fbOnlineEnter) und auf der Startseite mit
//      gewaehlter Arena-Football-Karte (Koerper der Karte: fbHubVariante / updateMenuPreview);
//      Ring Out behaelt seine Ringplattform; der Wiedereintritt baut Variante und Koerper aus
//      dem Raum.
//
// Geprueft werden ECHTE Funktionen aus index.html in Sandkaesten plus Vertraege im Quelltext.
//
//   node tools/test_football_hub_preview.js
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 300) : '')); }
};
const abschnitt = (s) => console.log('\n== ' + s + ' ==');
const g = (re, name) => grab(HTML, re, name);
const fn = (name) => grabFunction(HTML, name);
const nahe = (a, b) => Math.abs(a - b) < 1e-6;

function sprache(code) {
  const start = HTML.indexOf(code + ':{tagline:');
  if (start < 0) { console.error('FAIL: Sprachtabelle ' + code + ' fehlt'); process.exit(1); }
  const ende = HTML.indexOf('\n};', start);
  const block = HTML.slice(start, ende < 0 ? HTML.length : ende);
  const tab = {}; const re = /([A-Za-z0-9_]+):'((?:[^'\\]|\\.)*)'/g; let m;
  while ((m = re.exec(block))) if (tab[m[1]] === undefined) tab[m[1]] = m[2];
  return tab;
}
const I18N = { en: sprache('en'), de: sprache('de'), tr: sprache('tr') };

// ══ 1. KARTENLEISTE UND HIERARCHIE ═══════════════════════════════════════════════════
abschnitt('1. Vier Karten, 1 VS 1 mit Unterauswahl');
{
  const reg = g(/const FB_HUB_MODES=\[[\s\S]*?\];/, 'FB_HUB_MODES');
  const keys = [...reg.matchAll(/\{key:'(\w+)'/g)].map(m => m[1]);
  t('vier Karten in dieser Reihenfolge: ffa, duel, team2v2, training', keys.join(',') === 'ffa,duel,team2v2,training', keys);
  t('1 VS 1 ist die Karte cardFb1v1 und fuehrt direkt weiter - in die Unterauswahl', /\{key:'duel',\s+card:'cardFb1v1'[^}]*direkt:true\}/.test(reg));
  t('keine Karte traegt einen Tactical-Schluessel mehr', !/key:'tactical/.test(reg));
  const duel = g(/const FB_HUB_DUEL=\[[\s\S]*?\];/, 'FB_HUB_DUEL');
  const dk = [...duel.matchAll(/\{key:'(\w+)',\s+btn:'(\w+)',\s+titel:'(\w+)',\s+info:'(\w+)'\}/g)].map(m => ({ key: m[1], btn: m[2], titel: m[3], info: m[4] }));
  t('die Unterauswahl kennt genau tactical und tactical4 - getrennte interne Schluessel', dk.map(d => d.key).join(',') === 'tactical,tactical4', dk);
  const registerKey = (k) => (HTML.match(new RegExp(k + ":\\{caps:\\[2\\],\\s+released:true,\\s+key:'(\\w+)'\\}")) || [])[1];
  t('Titel und Unterzeile der Optionen sind die Registerschluessel des Onlinemodus (wie der Lobbykopf)',
    dk.length === 2 && dk.every(d => d.titel === registerKey(d.key) && d.info === registerKey(d.key) + 'S'), dk.map(d => [d.titel, registerKey(d.key)]));
  t('jede Option hat Knopf, Titel- und Unterzeilen-Id im Markup', dk.every(d => new RegExp('id="' + d.btn + '"').test(HTML)
    && new RegExp('id="' + d.btn.replace(/Btn$/, 'T') + '"').test(HTML) && new RegExp('id="' + d.btn.replace(/Btn$/, 'S') + '"').test(HTML)));
  const ov = g(/<div class="ov" id="fbDuelOv">[\s\S]*?\n<\/div>\n/, 'fbDuelOv');
  t('das Overlay traegt genau zwei Optionen und einen Zurueck-Knopf', (ov.match(/class="vopt"/g) || []).length === 2 && /id="fbDuelBack"/.test(ov));
  t('die Optionen heissen TACTICAL 1V1 (2 Figuren) und TACTICAL 4-BALL 1V1 (4 Figuren)',
    /id="fbDuelTacT">TACTICAL 1V1</.test(ov) && /id="fbDuelTacS">2 FIGURES EACH · ALTERNATING TURNS</.test(ov)
    && /id="fbDuelTac4T">TACTICAL 4-BALL 1V1</.test(ov) && /id="fbDuelTac4S">4 FIGURES EACH · ALTERNATING TURNS</.test(ov));
  t('das Overlay ist dieselbe Bauweise wie der Bot-Dialog (ov / wb vswb / vopt / wbtn) - keine eigene Seite', /<div class="wb vswb">/.test(ov) && /class="wbtn" id="fbDuelBack"/.test(ov));
  t('jede Option traegt ihre Aufnahme in der Bildflaeche (vopt-art, Buehnenklasse mshot)', (ov.match(/class="vopt-art"/g) || []).length === 2 && /\.vopt-art\{position:relative/.test(HTML)
    && /id="fbDuelTacBtn">\s*<span class="vopt-art"><img class="mshot" src="assets\/hub\/modes\/football_tactical\.webp"/.test(ov)
    && /id="fbDuelTac4Btn">\s*<span class="vopt-art"><img class="mshot" src="assets\/hub\/modes\/football_tactical4\.webp"/.test(ov));
  const hub = g(/<div class="mcards" id="fbCards"[\s\S]*?\n    <\/div>/, 'Kartenleiste');
  const titel = (hub.match(/class="mt" id="\w+">([^<]*)</g) || []).map(x => x.replace(/.*>/, '').replace(/<$/, ''));
  t('die Leiste zeigt FFA | 1 VS 1 | TEAM 2V2 | TRAINING', titel.join('|') === 'FFA|1 VS 1|TEAM 2V2|TRAINING', titel);
  t('die Karte cardFb4b gibt es nicht mehr', HTML.indexOf('cardFb4b') < 0);
  const bildVon = (id) => ((hub.match(new RegExp('id="' + id + '">\\s*(?:<span class="chip">ACTIVE</span>\\s*)?<span class="mstage"><img class="mshot" src="assets/hub/modes/(\\w+)\\.webp" alt="" width="700" height="438" decoding="async"></span>')) || [])[1]);
  t('jede Arena-Karte traegt eine Renderer-Aufnahme: FFA elimination, 1 VS 1 tactical, TEAM 2V2 team2v2, TRAINING classic',
    bildVon('cardFbFfa') === 'football_elimination' && bildVon('cardFb1v1') === 'football_tactical' && bildVon('cardFb2v2') === 'football_team2v2' && bildVon('cardFbBot') === 'football_classic',
    ['cardFbFfa', 'cardFb1v1', 'cardFb2v2', 'cardFbBot'].map(bildVon));
  t('Ring Out behaelt seine fuenf Bildkarten', (HTML.match(/assets\/hub\/modes\/ringout_\w+\.webp/g) || []).length === 5);
  t('kein SVG-Generator mehr im Produkt', ['fbModusBild', 'fbKartenBilderSetzen', 'fbBildAufstellung', 'FB_BILDER', 'fbBildEinsetzen'].every(k => HTML.indexOf(k) < 0));
  for (const l of ['en', 'de', 'tr'])
    t(l + ': catFb1v1 / mcFb1v1 / ctaFb1v1 / fbDuelT sind uebersetzt, catFb4b/mcFb4b/ctaFb4b sind fort',
      ['catFb1v1', 'mcFb1v1', 'ctaFb1v1', 'fbDuelT'].every(k => typeof I18N[l][k] === 'string' && I18N[l][k].length > 0)
      && ['catFb4b', 'mcFb4b', 'ctaFb4b'].every(k => I18N[l][k] === undefined));
  t('die deutsche Karte heisst 1 GEGEN 1', I18N.de.catFb1v1 === '1 GEGEN 1' && I18N.en.catFb1v1 === '1 VS 1');
  t('applyLang beschriftet Titel, Zurueck und beide Optionen aus dem Register', /\$\('fbDuelTitle'\)\.textContent=T\('fbDuelT'\);\$\('fbDuelBack'\)\.textContent=T\('back'\);/.test(HTML)
    && /for\(const d of FB_HUB_DUEL\)\{\n    const t=\$\(d\.btn\.replace\(\/Btn\$\/,'T'\)\), u=\$\(d\.btn\.replace\(\/Btn\$\/,'S'\)\);/.test(HTML));
}

// ══ 2. DIE WEGE ═══════════════════════════════════════════════════════════════════════
abschnitt('2. 1 VS 1 -> Unterauswahl -> derselbe Onlineweg; Zurueck setzt nichts');
{
  const weg = fn('fbHubOeffnen');
  t('fbHubOeffnen: duel und training -> ihre Unterauswahl, tactical / tactical4 / team2v2 -> ihre Onlineeinstiege, sonst FFA',
    /if\(key==='duel'\)fbDuelOeffnen\(\);\n  else if\(key==='training'\)fbTrainOeffnen\(\);\n  else if\(key==='tactical'\)fbTacticalOnlineOeffnen\(\);\n  else if\(key==='tactical4'\)fbTactical4OnlineOeffnen\(\);\n  else if\(key==='team2v2'\)fbTeam2OnlineOeffnen\(\);\n  else fbFfaOnlineOeffnen\(\);/.test(weg));
  const verdrahtung = g(/FB_HUB_DUEL\.forEach\(\(d\)=>\{[^\n]*\n\$\('fbDuelBack'\)\.onclick=fbDuelSchliessen;/, 'Verdrahtung');
  t('die Optionen schliessen die Ebene und gehen denselben Weg wie eine Karte', /if\(el\)el\.onclick=\(\)=>\{fbDuelSchliessen\(\);vibrateMs\(VIBE_CONFIRM_MS\);fbHubOeffnen\(d\.key\);\};/.test(verdrahtung));
  const oeffnen = fn('fbDuelOeffnen'), schliessen = fn('fbDuelSchliessen');
  t('Oeffnen und Schliessen setzen keinen Spielzustand (kein mode/fmt/fbVariant/fbOnlineMode/fbOnlineCap)', !/(mode|fmt|fbVariant|fbOnlineMode|fbOnlineCap)\s*=/.test(oeffnen + schliessen));
  const karte = fn('fbHubKarte');
  t('der Kartenklick bleibt der eine Weg (direkt -> fbHubOeffnen)', /if\(d&&d\.direkt\)\{ vibrateMs\(VIBE_CONFIRM_MS\); fbHubOeffnen\(d\.key\); \}/.test(karte));
  const M = new Function([
    g(/const FB_HUB_MODES=\[[\s\S]*?\];/, 'FB_HUB_MODES'), g(/const FB_HUB_DUEL=\[[\s\S]*?\];/, 'FB_HUB_DUEL'),
    'const spur=[]; const ov={show:false}; const knoepfe={};',
    "function $(id){ if(id==='fbDuelOv')return {classList:{add:()=>{ov.show=true;},remove:()=>{ov.show=false;}}}; return knoepfe[id]||(knoepfe[id]={}); }",
    'function vibrateMs(){} const VIBE_CONFIRM_MS=25;',
    "function fbTacticalOnlineOeffnen(){spur.push('tactical');} function fbTactical4OnlineOeffnen(){spur.push('tactical4');}",
    "function fbTeam2OnlineOeffnen(){spur.push('team2v2');} function fbFfaOnlineOeffnen(){spur.push('ffa');}",
    weg, oeffnen, schliessen, verdrahtung,
    'return {spur, ov, knoepfe, oeffnen:(k)=>fbHubOeffnen(k)};'].join('\n'))();
  M.oeffnen('duel'); t('duel oeffnet die Ebene und ruft keinen Onlineweg', M.ov.show === true && M.spur.length === 0);
  M.knoepfe.fbDuelBack.onclick(); t('Zurueck schliesst die Ebene ohne Onlineweg', M.ov.show === false && M.spur.length === 0);
  M.oeffnen('duel'); M.knoepfe.fbDuelTacBtn.onclick(); t('TACTICAL 1V1 schliesst die Ebene und nimmt den Tactical-Weg', M.ov.show === false && M.spur.join(',') === 'tactical');
  M.oeffnen('duel'); M.knoepfe.fbDuelTac4Btn.onclick(); t('TACTICAL 4-BALL 1V1 nimmt den Tactical-4-Ball-Weg', M.ov.show === false && M.spur.join(',') === 'tactical,tactical4');
  M.oeffnen('team2v2'); M.oeffnen('ffa'); t('Team 2v2 und FFA fuehren unveraendert direkt', M.spur.join(',') === 'tactical,tactical4,team2v2,ffa');
}

// ══ 3. VORSCHAU: BUEHNE UND KOERPER ═══════════════════════════════════════════════════
// Der Sandkasten traegt die echten Arenen, Aufstellungen, Praedikate, den Spawner, den
// Vorspielweg, den Onlineeinstieg und die Buehnenfrage - der Renderer bleibt draussen.
function bauen() {
  const src = [
    'let mode="bot", fmt="single", ffaN=3, gameStarted=false, balls=[], R=1000, outBall=-1, menuVisible=true, online=false;',
    'let menuSel="football", menuMode="bot", fmtMenu="single"; let coverShown=false; const spur=[];',
    g(/const FB_HUB_MODES=\[[\s\S]*?\];/, 'FB_HUB_MODES'), 'let fbHubSel=0;', fn('fbHubVariante'),
    'const R0=1000, cx=0, cy=0, BR=32;',
    // Gestellte Oberflaeche: nur so viel DOM, wie die echten Funktionen anfassen.
    "const __el=(id)=>({id:id,_t:'',dataset:{},style:{},children:[],type:'',className:'',onclick:null," +
    "get textContent(){return this._t;}, set textContent(v){this._t=v; if(v==='')this.children.length=0;}," +
    "classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);}," +
    "toggle(c,v){if(v===undefined)v=!this._s.has(c);if(v)this._s.add(c);else this._s.delete(c);}," +
    "contains(c){return this._s.has(c);}}," +
    "appendChild(e){this.children.push(e);},setAttribute(){},getBoundingClientRect(){return {left:0,top:0,width:10,height:10};}});",
    "const __reg={}; const __holen=(id)=>__reg[id]||(__reg[id]=__el(id));",
    "const __online={classList:{contains:(c)=>c==='show'&&coverShown}};",
    "function $(id){ return id==='online'?__online:__holen(id); }",
    "const document={getElementById:(id)=>id==='online'?__online:__holen(id), createElement:()=>__el('neu'), body:{classList:{_s:new Set(),toggle(c,v){if(v)this._s.add(c);else this._s.delete(c);},contains(c){return this._s.has(c);}}}};",
    "function T(k){return k;} function vibrateMs(){} const VIBE_CONFIRM_MS=25;",
    "let hubGame='ro', roSel='ffa', ffaNMenu=3;",
    g(/const MENU_SEL=\{[\s\S]*?\n\};/, 'MENU_SEL'), g(/const HUB_RO_ORDER=\[[^\n]*\];/, 'HUB_RO_ORDER'),
    fn('applyHubContext'), fn('applyFbMode'), fn('updateModeDots'), fn('selectMenuMode'),
    fn('mkBall'),
    g(/const PCOLS=\[[^\n]*\];/, 'PCOLS'), g(/const FB_COL_P5=[^\n]*;/, 'FB_COL_P5'), g(/const FB_PCOLS=[^\n]*;/, 'FB_PCOLS'),
    fn('pcol'), fn('teamOf'), fn('colorSlot'),
    g(/const FB_GOAL_HALF_DEPTH=[^\n]*/, 'FB_GOAL_HALF_DEPTH'), g(/const FB_GOAL_ASSET_INNER=[^\n]*/, 'FB_GOAL_ASSET_INNER'),
    g(/const FOOTBALL_ELIM_MAX_PLAYERS=5;[\s\S]*?\[-FB_P5_C1,FB_P5_S1\],\[-FB_P5_C2,-FB_P5_S2\]\];/, 'Richtungen'),
    g(/const FOOTBALL_NEUTRAL_OWNER=\d+;/, 'FOOTBALL_NEUTRAL_OWNER'),
    g(/\/\/ Konvexes Kernpolygon[\s\S]*?function fbElimArena\(\)\{.*\}/, 'Formblock'),
    fn('fbArena'), fn('fbElimDirs'),
    g(/const FOOTBALL_BALL_RADIUS=\d+;/, 'FOOTBALL_BALL_RADIUS'),
    g(/const FOOTBALL_VARIANT_TACTICAL='[^']*';/, 'V_TACTICAL'), g(/const FOOTBALL_VARIANT_TACTICAL4='[^']*';/, 'V_TACTICAL4'),
    g(/const FOOTBALL_VARIANT_TEAM2='[^']*';/, 'V_TEAM2'), g(/const FOOTBALL_VARIANT_ELIM='[^']*';/, 'V_ELIM'), g(/const FOOTBALL_VARIANT_ELIM4='[^']*';/, 'V_ELIM4'),
    "let fbVariant='classic';",
    fn('fbTactical'), fn('fbTac4'), fn('fbTeam2'), fn('fbTeam2Side'), fn('fbElim4'),
    g(/const FB_TAC_FIGUREN=\d+, FB_TAC4_FIGUREN=\d+;/, 'FB_TAC_FIGUREN'), fn('fbTacFiguren'),
    'let fbElimStartN=0; let fbElimPhaseN=5;', fn('fbElimPlayers'),
    'function fbElimSlotOwner(sl){return sl<fbElimPlayers()?sl:-1;}', fn('fbElimSpawnX'), fn('fbElimSpawnY'),
    g(/const FOOTBALL_TACTICAL_SPAWN=\{[^\n]*\};/, 'FOOTBALL_TACTICAL_SPAWN'), g(/const FOOTBALL_TACTICAL_1V1_SPAWN=\{[^\n]*\};/, 'FOOTBALL_TACTICAL_1V1_SPAWN'),
    g(/const FOOTBALL_TACTICAL4_SPAWN=\[[^\n]*\];/, 'FOOTBALL_TACTICAL4_SPAWN'),
    fn('placeBalls'), fn('fbVorspielKoerperOk'), fn('setzeVorspiel'), fn('updateMenuPreview'),
    g(/const FOOTBALL_FMTS=\[[^\n]*\];/, 'FOOTBALL_FMTS'), g(/const FB_ONLINE_FMT=[^\n]*;/, 'FB_ONLINE_FMT'),
    g(/const FB_ONLINE_MODE_CLASSIC='classic'[\s\S]*?;/, 'FB_ONLINE_MODE_*'),
    g(/const FOOTBALL_ELIM_RULES_LIVES='[^']*';/, 'RULES_LIVES'), g(/const FOOTBALL_ELIM_RULES_TIMED='[^']*';/, 'RULES_TIMED'),
    "let fbOnlineMode='lives', fbOnlineCap=5, fbElimRules='lives';",
    fn('fbVarianteFuerModus'), "function openOnline(){spur.push('open');}", fn('fbOnlineEnter'),
    fn('fbOnlineVorschau'), fn('fbBuehne'), fn('fbFrameKey'),
    'return {',
    '  enter:(m)=>{fbOnlineMode=m;fbOnlineEnter();},',
    '  koerper:()=>balls.map(b=>({o:b.owner,slot:colorSlot(b.owner),x:(b.x-cx)/BR,y:(b.y-cy)/BR})),',
    '  cover:(v)=>{coverShown=v;}, menu:(v)=>{menuVisible=v;}, setMode:(m)=>{mode=m;}, setFmt:(f)=>{fmt=f;}, variante:(v)=>{if(v!==undefined)fbVariant=v;return fbVariant;},',
    '  stand:()=>({mode,fmt,fbVariant,fbOnlineMode,koerper:balls.length,buehne:fbBuehne(),key:fbFrameKey(),vorschau:fbOnlineVorschau()}),',
    '  zurueck:()=>{updateMenuPreview();}, karte:(i)=>{fbHubSel=i;}, spur, mapping:(m)=>fbVarianteFuerModus(m),',
    '  waehle:(m)=>selectMenuMode(m), menuSel:()=>menuSel, roSel:()=>roSel, hubGame:()=>hubGame, hubSel:()=>fbHubSel,',
    '  an:(id)=>$(id).classList.contains("on"), fbctx:()=>document.body.classList.contains("fbctx"),',
    '  leiste:()=>({ro:$("roCards").style.display,fb:$("fbCards").style.display,punkte:$("modeDots").children.length,cta:$("ctaBtnT").textContent}),',
    '  stell:(v)=>{mode="football";fbVariant=v;placeBalls();return balls.map(b=>({o:b.owner,slot:colorSlot(b.owner),x:(b.x-cx)/BR,y:(b.y-cy)/BR}));},',
    '  BR, BALL:FOOTBALL_BALL_RADIUS, NEUTRAL:FOOTBALL_NEUTRAL_OWNER',
    '};'
  ].join('\n');
  return new Function(src)();
}

abschnitt('3. Onlinebildschirm: Football-Arena im Bild, Koerper des Modus, Ring Out unberuehrt');
{
  const S = bauen();
  S.cover(true);   // der Onlinebildschirm ist offen
  const faelle = [['tactical', 'tactical', 5, '0,0,1,1,5', 't'], ['tactical4', 'tactical4', 9, '0,0,0,0,1,1,1,1,5', 't'],
                  ['team2v2', 'team2v2', 5, '0,0,1,1,5', 't'], ['lives', 'elimination', 6, '0,1,2,3,4,5', 'e5']];
  for (const [m, variante, n, slots, key] of faelle) {
    S.enter(m);
    const st = S.stand(), K = S.koerper();
    t(m + ': der Onlineeinstieg setzt Variante ' + variante + ' und stellt ' + n + ' Koerper', st.fbVariant === variante && st.koerper === n && st.mode === 'football', st);
    t(m + ': Farbslots ' + slots + ' - genau ein neutraler Ball', K.map(b => b.slot).sort().join(',') === slots && K.filter(b => b.o === S.NEUTRAL).length === 1, K.map(b => b.slot));
    t(m + ': die Football-Arena steht im Bild (fbBuehne) mit Rahmung ' + key, st.buehne === true && st.vorschau === true && st.key === key, st);
    t(m + ': der Onlinebildschirm wird geoeffnet', S.spur[S.spur.length - 1] === 'open');
  }
  t('fbOnlineEnter stellt die Koerper VOR openOnline und laesst den gepinnten Kontext unveraendert',
    /mode='football'; fbVariant=fbVarianteFuerModus\(fbOnlineMode\); fmt=FB_ONLINE_FMT; fbElimStartN=0;[\s\S]{0,400}setzeVorspiel\(mode,fmt\);[^\n]*\n  openOnline\(\);\n\}/.test(HTML));
  // Ring Out: derselbe Bildschirm, aber nicht die Football-Buehne.
  S.setMode('ffa'); S.setFmt('ffa');
  t('Ring Out (FFA) auf demselben Onlinebildschirm: keine Football-Buehne, keine Rahmung', S.stand().buehne === false && S.stand().key === '' && S.stand().vorschau === false);
  S.setMode('online'); S.setFmt('double');
  t('Ring Out (Versus 2v2) ebenso', S.stand().buehne === false && S.stand().key === '');
  // Startseite (Menue, Football-Karte gewaehlt): Ringplattform mit der Standardvorschau.
  // Startseite (Menue, Arena-Football-Karte gewaehlt): der Hero zeigt die Football-Arena der Karte.
  S.cover(false); S.enter('tactical4'); S.karte(0); S.zurueck();
  const zs = S.stand();
  t('Zurueck (updateMenuPreview) mit Karte FFA: Variante elimination, Format single, 6 Koerper, Buehne an, Rahmung e5 (Fuenf-Tore-Arena)', zs.fbVariant === 'elimination' && zs.fmt === 'single' && zs.koerper === 6 && zs.buehne === true && zs.key === 'e5' && zs.vorschau === false, zs);
  S.karte(1); S.zurueck();
  t('Karte 1 VS 1: Variante tactical, 5 Koerper (2+2+Ball), Rahmung t', S.stand().fbVariant === 'tactical' && S.stand().koerper === 5 && S.stand().key === 't' && S.koerper().map(b => b.slot).sort().join(',') === '0,0,1,1,5', S.stand());
  S.karte(2); S.zurueck();
  t('Karte TEAM 2V2: Variante team2v2, 5 Koerper (Blau/Blau/Rot/Rot/Ball), Rahmung t', S.stand().fbVariant === 'team2v2' && S.stand().koerper === 5 && S.stand().key === 't' && S.koerper().map(b => b.slot).sort().join(',') === '0,0,1,1,5', S.stand());
  S.karte(3); S.zurueck();
  t('Karte TRAINING: Variante classic, 3 Koerper, Rahmung c', S.stand().fbVariant === 'classic' && S.stand().koerper === 3 && S.stand().key === 'c', S.stand());
  S.karte(0); S.zurueck();
  S.cover(true);
  t('mit offenem Cover im Startseitenformat bleibt es die Startseiten-Buehne, nicht das Arena-Fenster (Format entscheidet)', S.stand().buehne === true && S.stand().vorschau === false);
  S.cover(false);
  // Im Match: wie bisher.
  S.enter('tactical'); S.menu(false);
  t('im Match (menuVisible=false) steht die Buehne unabhaengig vom Cover', S.stand().buehne === true && S.stand().key === 't' && S.stand().vorschau === false);
  S.menu(true);
  // Zurueck-Weg im Quelltext.
  const back = g(/const onlineBack=\(\)=>\{[\s\S]*?updScrollHint\(\);\};/, 'onlineBack');
  t('onlineBack: verlassen, Menuemodus, dann updateMenuPreview (setzt Variante, Format, Koerper gemeinsam)', /leaveOnline\(\);mode=menuMode;/.test(back) && /updateMenuPreview\(\);/.test(back));
  t('updateMenuPreview: der Startseiten-Hero zeigt die Variante der gewaehlten Karte, der Kartenwechsel stellt ihn neu', /fbVariant=fbHubVariante\(\);menuMode='football';fmtMenu='single';setzeVorspiel\('football','single'\);/.test(HTML)
    && /function fbHubVariante\(\)\{/.test(HTML) && /updateModeDots\('football'\);\n  updateMenuPreview\(\);/.test(HTML));
  // Wiedereintritt: Variante und Koerper aus dem Raum.
  const rejoin = g(/async function attemptRejoin\(code\)\{[\s\S]*?\n\}/, 'attemptRejoin');
  t('attemptRejoin baut die Variante aus dem Raummodus und stellt die Koerper', /if\(rjFb\)fbVariant=fbVarianteFuerModus\(v\.mode\);/.test(rejoin) && /setzeVorspiel\(mode,fmt\);/.test(rejoin));
  t('fbVarianteFuerModus: tactical / tactical4 / team2v2 / lives -> tactical / tactical4 / team2v2 / elimination',
    S.mapping('tactical') === 'tactical' && S.mapping('tactical4') === 'tactical4' && S.mapping('team2v2') === 'team2v2' && S.mapping('lives') === 'elimination');
  t('der Beitritt (joinFertig) stellt Variante und Koerper ebenso', /if\(joinFb\)\{ mode='football'; fbVariant=fbVarianteFuerModus\(v\.mode\); \}/.test(HTML));
}

// ══ 4. RENDERER-TORE ══════════════════════════════════════════════════════════════════
abschnitt('4. Der Renderer haengt Arena, Tore und Rahmung an die Buehne');
{
  t('fbBuehne: Arena Football ist der aktive Kontext - Match, Arena-Fenster und Startseite', /function fbBuehne\(\)\{ return mode==='football'; \}/.test(HTML));
  t('das Arena-Fenster rahmt nur bei offenem Football-Onlinebildschirm (fbOnlineVorschau), nicht auf der Startseite', /if\(menuVisible&&fbOnlineVorschau\(\)\)\{[\s\S]{0,700}?const h=fbHeroRect\(vh\);/.test(HTML));
  t('fbOnlineVorschau: Menue offen, Football, Raumformat, Onlinebildschirm sichtbar', /function fbOnlineVorschau\(\)\{\n  if\(!menuVisible\|\|mode!=='football'\|\|fmt!==FB_ONLINE_FMT\)return false;/.test(HTML)
    && /return !!el&&el\.classList\.contains\('show'\);\n\}/.test(HTML));
  t('fbFrameKey rahmt nach der Buehne', /function fbFrameKey\(\)\{\n  if\(!fbBuehne\(\)\)return '';/.test(HTML));
  t('Arena-Aufbau, Tore und Plattformwechsel haengen an footballView=fbBuehne()', /const footballView=fbBuehne\(\);/.test(HTML)
    && /if\(fbShapeGroup\)fbShapeGroup\.visible=footballView/.test(HTML) && /goalGroup\.visible=footballView/.test(HTML) && /const rectReady=footballView&&!!fbShapeGroup;/.test(HTML));
  t('die Rahmung nimmt die Football-Masse ueber fbFrame=fbBuehne()', /const fbFrame=fbBuehne\(\);/.test(HTML));
  t('im Arena-Fenster rahmt der Renderer auf das Fenster (Hoehe und Mitte der .ohero)', /if\(menuVisible&&fbOnlineVorschau\(\)\)\{[\s\S]{0,700}?const h=fbHeroRect\(vh\);[\s\S]{0,300}?shy:h\.cy-vh\/2\}/.test(HTML)
    && /function fbHeroRect\(vh\)\{[\s\S]*?document\.querySelector\('#online \.ohero'\)/.test(HTML));
  t('das Menue-Framing von Ring Out bleibt Zeichen fuer Zeichen', /\}else if\(menuVisible\)\{[\s\S]{0,400}?geo=\{vw,vh,baseDist:baseDist\*0\.87,ox:0,oy:0,os:vw,shx:0,shy:-vh\*0\.13\};\n        fbVorschauNebel\(false\);/.test(HTML));
  t('der Startseiten-Hero hat einen eigenen Zweig: Band bei 37 % mit FB_HERO_BAND Ueberhang, Zoom der Vorschau, Nebel hinter der Arena', /\}else if\(menuVisible&&fbFrame\)\{[\s\S]{0,900}?const band=\{h:vh\*0\.37,cy:vh\*0\.37\};\n        geo=\{vw,vh,baseDist:Math\.max\(needX\/\(tanV\*aspect\),needZ\*\(vh\/\(band\.h\*FB_HERO_BAND\)\)\/tanV\)\*1\.10\*FB_VORSCHAU_ZOOM,ox:0,oy:0,os:vw,shx:0,shy:band\.cy-vh\/2\};\n        fbVorschauNebel\(true,geo\.baseDist\);/.test(HTML)
    && /const FB_HERO_BAND=1\.3;/.test(HTML));
  t('das HUD bleibt dem Match vorbehalten', /function fbHudOn\(\)\{return mode==='football'&&!menuVisible;\}/.test(HTML));
}

// ══ 5. KARTENBILDER ═══════════════════════════════════════════════════════════════════
abschnitt('5. Kartenbilder: Renderer-Aufnahmen in einer Bildfamilie (700x438 WebP)');
{
  const fsx = require('fs'), pathx = require('path');
  const masse = (f) => {
    const b = fsx.readFileSync(pathx.join(__dirname, '..', 'assets', 'hub', 'modes', f + '.webp'));
    const tag = b.toString('latin1', 12, 16); let w = 0, h = 0;
    if (tag === 'VP8X') { w = 1 + (b[24] | b[25] << 8 | b[26] << 16); h = 1 + (b[27] | b[28] << 8 | b[29] << 16); }
    else if (tag === 'VP8 ') { w = b.readUInt16LE(26) & 0x3fff; h = b.readUInt16LE(28) & 0x3fff; }
    else if (tag === 'VP8L') { const x = b.readUInt32LE(21); w = (x & 0x3fff) + 1; h = ((x >> 14) & 0x3fff) + 1; }
    return { riff: b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP', w, h, kb: Math.round(b.length / 1024) };
  };
  for (const f of ['football_elimination', 'football_tactical', 'football_tactical4', 'football_team2v2', 'football_classic']) {
    const m = masse(f);
    t(f + '.webp ist eine WebP-Aufnahme im Kartenmass 700x438 (' + m.kb + ' KB)', m.riff && m.w === 700 && m.h === 438 && m.kb >= 12 && m.kb <= 400, m);
  }
  t('die Hosting-Asset-Liste kennt das Tactical-4-Ball-Bild', /'assets\/hub\/modes\/football_tactical4\.webp'/.test(fsx.readFileSync(pathx.join(__dirname, 'build_hosting.js'), 'utf8')));
  t('die Aufnahmestrecke der Tactical-Karten liegt bei den QA-Werkzeugen (nicht im Produkt)', fsx.existsSync(pathx.join(__dirname, '..', 'artifacts', 'fb-menu-preview-01', 'kartenbilder_tactical.js')) && HTML.indexOf('kartenbilder_tactical') > 0);
  // Der Spawner bleibt die einzige Aufstellung des Spiels: seine Konstantenzeilen stehen genau einmal.
  t('placeBalls liest die Aufstellungen unveraendert (je genau einmal)', (HTML.match(/const S=FOOTBALL_TACTICAL_1V1_SPAWN;/g) || []).length === 1
    && (HTML.match(/const S=FOOTBALL_TACTICAL_SPAWN;/g) || []).length === 1 && (HTML.match(/for\(const p of FOOTBALL_TACTICAL4_SPAWN\)/g) || []).length === 1);
}

// ══ 6. ARENA FOOTBALL IST DAS HAUPTSPIEL ══════════════════════════════════════════════
abschnitt('6. Spielumschalter: Arena Football zuerst und voreingestellt, Ring Out vollstaendig');
{
  const hub = g(/   <div class="mhub">[\s\S]*?\n   <\/div>/, 'Spielumschalter');
  t('im Umschalter steht Arena Football VOR Ring Out', hub.indexOf('id="cardFootball"') >= 0 && hub.indexOf('id="cardRingout"') >= 0
    && hub.indexOf('id="cardFootball"') < hub.indexOf('id="cardRingout"'));
  t('die Football-Karte traegt die Auswahlmarkierung, die Ring-Out-Karte nicht', /<button class="gcard gfb on" id="cardFootball" type="button">/.test(hub)
    && /<button class="gcard" id="cardRingout" type="button">/.test(hub));
  t('beide Karten behalten Bauweise und Bild (gcard, eigener Hero, gveil, gcap)', (hub.match(/class="gcard/g) || []).length === 2
    && /assets\/hub\/hero_football\.webp/.test(hub) && /assets\/hub\/hero_ringout\.webp/.test(hub)
    && (hub.match(/class="gveil"/g) || []).length === 2 && (hub.match(/class="gcap"/g) || []).length === 2);
  t('das Raster des Umschalters ist unveraendert (zwei gleiche Spalten)', /\.mhub\{display:grid;grid-template-columns:1fr 1fr;/.test(HTML));
  t('ein frischer Start waehlt Arena Football', /\nlet menuSel='football';/.test(HTML) && !/let menuSel='ffa';/.test(HTML));
  t('der Boot wendet genau diese Auswahl an (applyLang -> selectMenuMode(menuSel))', /\n  selectMenuMode\(menuSel\);/.test(HTML));
  t('Ring Out bleibt ein Klick entfernt und behaelt seinen zuletzt gewaehlten Modus', /\$\('cardRingout'\)\.onclick=\(\)=>selectMenuMode\(roSel\);/.test(HTML)
    && /let hubGame='ro', fbHubSel=0, roSel='ffa';/.test(HTML));
  t('die Ring-Out-Modusleiste ist unveraendert', /const HUB_RO_ORDER=\['ffa','triple','team','vs','bot'\];/.test(HTML));
  t('showMenu raeumt VOR der Hero-Vorschau auf (Variante und Elimination-Phase erst zurueck, dann stellen)', (() => {
    const sm = g(/function showMenu\(\)\{[\s\S]*?updScrollHint\(\);\}/, 'showMenu');
    return sm.indexOf("fbVariant='classic';") < sm.indexOf('updateMenuPreview();')
      && sm.indexOf('footballResetMatchState();') < sm.indexOf('updateMenuPreview();');
  })());
  // Der echte Wechsel, mit den echten Funktionen.
  const S = bauen();
  S.waehle(S.menuSel());   // Boot
  const boot = S.stand();
  t('Boot: Arena-Football-Kontext, Football-Karte markiert, Ring-Out-Karte nicht', S.hubGame() === 'fb' && S.fbctx() === true && S.an('cardFootball') === true && S.an('cardRingout') === false);
  t('Boot: die Arena-Modusleiste ist sichtbar, die Ring-Out-Leiste nicht', S.leiste().fb === '' && S.leiste().ro === 'none' && S.leiste().punkte === 4);
  t('Boot: der Hero zeigt die Football-Arena der ersten Karte (FFA: elimination, 6 Koerper, e5)', boot.mode === 'football' && boot.fbVariant === 'elimination' && boot.koerper === 6 && boot.buehne === true && boot.key === 'e5', boot);
  t('Boot: die Modusleiste steht auf der ersten direkten Karte - kein Modus wird automatisch betreten', S.hubSel() === 0 && S.spur.length === 0 && boot.fmt === 'single');
  // Karte wechseln, dann zu Ring Out und zurueck.
  S.waehle('football'); S.karte(1); S.zurueck();
  t('innerhalb von Arena Football folgt der Hero der Karte (1 VS 1: tactical, 5 Koerper, t)', S.stand().fbVariant === 'tactical' && S.stand().koerper === 5 && S.stand().key === 't');
  S.waehle(S.roSel());
  const ro = S.stand();
  t('Wechsel zu Ring Out: Kontext, Markierung und Leisten kippen um', S.hubGame() === 'ro' && S.fbctx() === false && S.an('cardRingout') === true && S.an('cardFootball') === false
    && S.leiste().ro === '' && S.leiste().fb === 'none' && S.leiste().punkte === 5);
  t('Wechsel zu Ring Out: die Ringplattform steht im Hero (keine Football-Buehne, kein Football-Modus)', ro.mode === 'ffa' && ro.buehne === false && ro.key === '' && ro.koerper === 5, ro);
  S.waehle('football');
  const zurueck = S.stand();
  t('Wechsel zurueck: Arena Football mit der ersten direkten Karte, kein Rest der Ring-Out-Auswahl', S.hubGame() === 'fb' && S.hubSel() === 0 && S.an('cardFootball') === true && S.an('cardRingout') === false);
  t('Wechsel zurueck: der Football-Hero steht wieder (elimination, 6 Koerper, e5)', zurueck.mode === 'football' && zurueck.fbVariant === 'elimination' && zurueck.koerper === 6 && zurueck.buehne === true && zurueck.key === 'e5', zurueck);
  t('kein Onlineweg ist dabei ausgeloest worden', S.spur.length === 0, S.spur);
  // Der Wiedereintritt bleibt die Autoritaet - er fragt weder die Spielwahl noch den Hub.
  const rejoin = g(/async function attemptRejoin\(code\)\{[\s\S]*?\n\}/, 'attemptRejoin');
  t('der Wiedereintritt baut den Modus aus dem Raum, nicht aus der Spielwahl', /mode=rjFb\?'football':ffa\?'ffa':'online';/.test(rejoin)
    && rejoin.indexOf('menuSel') < 0 && rejoin.indexOf('hubGame') < 0 && rejoin.indexOf('fbHubVariante') < 0);
  t('auch der Beitritt entscheidet aus der Raumkonfiguration', /if\(joinFb\)\{ mode='football'; fbVariant=fbVarianteFuerModus\(v\.mode\); \} else mode='ffa';/.test(HTML));
}

// ══ 3. TRAINING wartet auf die Szene ═══════════════════════════════════════════════════
// Die Karte TRAINING fuehrt am CTA vorbei direkt zu VS BOTS. Oeffnete die Ebene vor der
// Szene, startete das Match auf der alten 2D-Arena (Spieltest 2026-09-24).
abschnitt('3. TRAINING oeffnet VS BOTS erst mit stehender 3D-Szene');
(async () => {
  const quelle = g(/async function fbTrainOeffnen\(\)\{[\s\S]*?\n\}/, 'fbTrainOeffnen');
  const lauf = (ergebnis) => {
    const s = { offen: false, toast: '', los: null };
    const oeffnen = new Function('r3dSichern', '$', 'toast', 'T', quelle + '\nreturn fbTrainOeffnen;')(
      (pflicht) => { s.pflicht = pflicht; return new Promise(r => { s.los = () => r(ergebnis); }); },
      () => ({ classList: { add: () => { s.offen = true; } } }),
      (m) => { s.toast = m; }, (k) => k);
    return { s, p: oeffnen() };
  };
  const a = lauf(true);
  t('die Szene wird als Pflicht angefordert', a.s.pflicht === true);
  t('solange sie laedt, bleibt die Ebene zu', a.s.offen === false);
  a.s.los(); await a.p;
  t('steht sie, oeffnet VS BOTS', a.s.offen === true);
  const b = lauf(false); b.s.los(); await b.p;
  t('scheitert sie, bleibt die Ebene zu und der Fehler wird gemeldet', b.s.offen === false && b.s.toast === 'fbNo3d');
  console.log(`\nFootball-Hub-Vorschau: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
