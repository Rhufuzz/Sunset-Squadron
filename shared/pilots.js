'use strict';
/*
 * Shared pilot roster, perks and power-up definitions.
 *
 * This file is CommonJS so the server can require() it directly. The server also
 * serves it to the browser as an ES module at GET /js/pilots-data.js so there is a
 * single source of truth for colours, perk multipliers and power-up durations.
 */

// Every perk is a small multiplier on one flight/game constant (1.0 = no change).
const PERKS = {
  turboHeart: { label: 'Turbo Heart', desc: 'Boost stamina recharges 30% faster.', stamRegen: 1.3 },
  longFuse: { label: 'Long Fuse', desc: 'Power-ups last 30% longer.', fxDuration: 1.3 },
  knifeEdge: { label: 'Knife Edge', desc: '15% tighter turning.', turn: 1.15 },
  quickLoad: { label: 'Quick Load', desc: 'Rockets reload 15% faster.', reload: 0.85 },
  magnetCore: { label: 'Magnet Core', desc: 'Pickup magnet radius +50%.', magnet: 1.5 },
  hotShot: { label: 'Hot Shot', desc: 'Rockets lock on from 25% further away.', homingRange: 1.25 },
  ironWings: { label: 'Iron Wings', desc: 'Recovers from hits twice as fast.', tumble: 0.5 },
  phantomRoll: { label: 'Phantom Roll', desc: 'Barrel rolls last 35% longer (bigger deflect window).', rollTime: 1.35 },
};

const PERK_DEFAULTS = { stamRegen: 1, fxDuration: 1, turn: 1, reload: 1, magnet: 1, homingRange: 1, tumble: 1, rollTime: 1 };

// Colours are plain hex numbers so both THREE.Color and CSS can use them.
const PILOTS = [
  {
    id: 'renji', callsign: 'RENJI', name: 'Renji Takahara',
    bio: 'Grew up launching paper planes off the caldera rim. Flies on instinct and never stops grinning.',
    colors: { body: 0xff5e5b, wing: 0xfff1d6, trail: 0xff9a3c, accent: 0xffd54a },
    perk: 'turboHeart',
    portrait: { skin: '#f1c3a0', helmet: 0, visor: '#3ad6ff', emblem: 'sun', mouth: 'grin', eyes: 'bright' },
  },
  {
    id: 'resa', callsign: 'RESA', name: 'Resa Okonkwo',
    bio: 'Patient and precise. She reads the wind like a book and saves every trick for the last lap.',
    colors: { body: 0x4ff0b0, wing: 0x1f6b57, trail: 0x7dffd0, accent: 0xffffff },
    perk: 'longFuse',
    portrait: { skin: '#8d5a3b', helmet: 1, visor: '#ffe27a', emblem: 'leaf', mouth: 'smile', eyes: 'calm' },
  },
  {
    id: 'kaya', callsign: 'KAYA', name: 'Kaya Lindqvist',
    bio: 'The youngest of the three summer racers. Cuts corners so tight the gulls complain.',
    colors: { body: 0x47c8ff, wing: 0xf4f1ea, trail: 0x9fe8ff, accent: 0xff6bd6 },
    perk: 'knifeEdge',
    portrait: { skin: '#f6d9c4', helmet: 2, visor: '#ff7ad9', emblem: 'bolt', mouth: 'smirk', eyes: 'bright' },
  },
  {
    id: 'viper', callsign: 'VIPER', name: 'Dmitri Volkov',
    bio: 'Ex-airshow mechanic with a rocket rack he tuned himself. Reloads before the smoke clears.',
    colors: { body: 0xb6ff3c, wing: 0x1c2430, trail: 0xd9ff7a, accent: 0xffe84a },
    perk: 'quickLoad',
    portrait: { skin: '#e8b48c', helmet: 1, visor: '#8bff5a', emblem: 'fang', mouth: 'flat', eyes: 'narrow' },
  },
  {
    id: 'nova', callsign: 'NOVA', name: 'Priya Raman',
    bio: 'Astrophysics student who treats every pickup like a comet to be caught. Nothing escapes her orbit.',
    colors: { body: 0x9b6bff, wing: 0xff6bd6, trail: 0xc9a6ff, accent: 0x4ff1ff },
    perk: 'magnetCore',
    portrait: { skin: '#c48a63', helmet: 3, visor: '#d8b4ff', emblem: 'star', mouth: 'smile', eyes: 'bright' },
  },
  {
    id: 'blaze', callsign: 'BLAZE', name: 'Marco Ferreira',
    bio: 'Loud jet, louder laugh. His fireworks find their target from halfway across the bay.',
    colors: { body: 0xff3d2e, wing: 0xffb347, trail: 0xff7a1a, accent: 0xfff1a8 },
    perk: 'hotShot',
    portrait: { skin: '#d9a07a', helmet: 0, visor: '#ffb347', emblem: 'flame', mouth: 'grin', eyes: 'bright' },
  },
  {
    id: 'comet', callsign: 'COMET', name: 'Yuki Sato',
    bio: 'Unflappable test pilot. Takes a hit, shrugs, and is back on your tail before you can blink.',
    colors: { body: 0xf4f1ea, wing: 0x47c8ff, trail: 0xe0ffff, accent: 0x4ff1ff },
    perk: 'ironWings',
    portrait: { skin: '#f3d6c0', helmet: 2, visor: '#4ff1ff', emblem: 'ring', mouth: 'flat', eyes: 'calm' },
  },
  {
    id: 'echo', callsign: 'ECHO', name: 'Zara Haddad',
    bio: 'Night-flight specialist. Rolls through rockets like they were party streamers.',
    colors: { body: 0x2e2a6e, wing: 0xff4fd8, trail: 0xff6bd6, accent: 0x9fe8ff },
    perk: 'phantomRoll',
    portrait: { skin: '#b57b55', helmet: 3, visor: '#ff4fd8', emblem: 'moon', mouth: 'smirk', eyes: 'narrow' },
  },
];

// Power-up catalogue. Durations are seconds (before the Long Fuse perk).
const POWERUPS = {
  turbo: { label: 'Turbo Booster', short: 'TURBO', desc: 'Infinite boost and extra speed.', duration: 6, color: 0xff9a3c },
  shield: { label: 'Shield Bubble', short: 'SHIELD', desc: 'Blocks one rocket hit.', duration: 25, color: 0x4ff1ff },
  rapid: { label: 'Rapid Fire', short: 'RAPID', desc: 'Rockets reload three times faster.', duration: 8, color: 0xff5e5b },
  magnet: { label: 'Magnet', short: 'MAGNET', desc: 'Huge pickup, balloon, crown and ribbon range.', duration: 10, color: 0xb6ff3c },
  ghost: { label: 'Ghost', short: 'GHOST', desc: 'Homing rockets cannot lock on to you.', duration: 8, color: 0xc9a6ff },
  x2: { label: 'Score x2', short: 'x2', desc: 'Every point counts double.', duration: 10, color: 0xffd54a },
};
const POWERUP_TYPES = Object.keys(POWERUPS);

const PILOT_IDS = PILOTS.map((p) => p.id);
function pilotById(id) {
  return PILOTS.find((p) => p.id === id) || PILOTS[0];
}
function perkMultipliers(pilotId) {
  const p = pilotById(pilotId);
  const perk = PERKS[p.perk] || {};
  const out = { ...PERK_DEFAULTS };
  for (const k of Object.keys(PERK_DEFAULTS)) if (typeof perk[k] === 'number') out[k] = perk[k];
  return out;
}
function hexCss(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0'); }

const api = { PILOTS, PERKS, PERK_DEFAULTS, POWERUPS, POWERUP_TYPES, PILOT_IDS, pilotById, perkMultipliers, hexCss };

/** Render this module as browser ES-module source. */
function toEsModuleSource() {
  return [
    '// Generated by the server from shared/pilots.js - single source of truth for pilots, perks and power-ups.',
    `export const PILOTS = ${JSON.stringify(PILOTS)};`,
    `export const PERKS = ${JSON.stringify(PERKS)};`,
    `export const PERK_DEFAULTS = ${JSON.stringify(PERK_DEFAULTS)};`,
    `export const POWERUPS = ${JSON.stringify(POWERUPS)};`,
    `export const POWERUP_TYPES = ${JSON.stringify(POWERUP_TYPES)};`,
    `export const PILOT_IDS = ${JSON.stringify(PILOT_IDS)};`,
    `export ${pilotById.toString()}`,
    `export ${perkMultipliers.toString()}`,
    `export ${hexCss.toString()}`,
  ].join('\n') + '\n';
}
api.toEsModuleSource = toEsModuleSource;

module.exports = api;
