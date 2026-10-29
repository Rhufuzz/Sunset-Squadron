// portraits.js - procedural pilot portraits drawn with the 2D canvas API.
// Helmet, visor, face, emblem and a glowing backdrop; no image files anywhere.
import { hexCss } from './pilots-data.js';

const cache = new Map(); // `${pilotId}@${size}` -> canvas

function shade(hex, k) {
  // Darken (k < 1) or brighten (k > 1) a hex colour, returns CSS string
  const r = Math.min(255, ((hex >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * k) | 0;
  const b = Math.min(255, (hex & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Emblem glyphs: small symbols painted on the side of the helmet. */
function drawEmblem(ctx, kind, cx, cy, s, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'sun':
      ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6); ctx.lineTo(Math.cos(a) * s * 0.95, Math.sin(a) * s * 0.95); ctx.stroke();
      }
      break;
    case 'leaf':
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s, -s * 0.2, 0, s); ctx.quadraticCurveTo(-s, -s * 0.2, 0, -s); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.moveTo(0, -s * 0.7); ctx.lineTo(0, s * 0.8); ctx.stroke();
      break;
    case 'bolt':
      ctx.beginPath(); ctx.moveTo(s * 0.15, -s); ctx.lineTo(-s * 0.55, s * 0.1); ctx.lineTo(0, s * 0.1); ctx.lineTo(-s * 0.15, s); ctx.lineTo(s * 0.55, -s * 0.15); ctx.lineTo(0, -s * 0.15); ctx.closePath(); ctx.fill();
      break;
    case 'fang':
      ctx.beginPath(); ctx.moveTo(-s, -s * 0.8); ctx.lineTo(-s * 0.35, s); ctx.lineTo(0, -s * 0.1); ctx.lineTo(s * 0.35, s); ctx.lineTo(s, -s * 0.8); ctx.lineTo(0, -s * 0.5); ctx.closePath(); ctx.fill();
      break;
    case 'star':
      star(ctx, 0, 0, s, s * 0.45, 5); ctx.fill();
      break;
    case 'flame':
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.9, -s * 0.2, s * 0.8, s * 0.6, 0, s); ctx.bezierCurveTo(-s * 0.8, s * 0.6, -s * 0.5, 0, -s * 0.1, -s * 0.3); ctx.bezierCurveTo(-s * 0.2, 0, 0.1, -s * 0.2, 0, -s); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(s * 0.05, s * 0.45, s * 0.25, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'ring':
      ctx.lineWidth = s * 0.32; ctx.beginPath(); ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2); ctx.fill();
      break;
    case 'moon':
      ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(s * 0.45, -s * 0.25, s * 0.82, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
    default:
      ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw a pilot portrait into a canvas (creates one if not given). Returns the canvas.
 * The composition is square: glowing backdrop, shoulders, helmet with visor and emblem.
 */
export function drawPortrait(pilot, size = 128, canvas = null) {
  const c = canvas || document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const P = pilot.portrait;
  const body = pilot.colors.body, wing = pilot.colors.wing, accent = pilot.colors.accent, trail = pilot.colors.trail;
  const u = size / 128; // unit scale
  ctx.clearRect(0, 0, size, size);

  // Backdrop: radial glow in the pilot's trail colour over a plum sky
  const bg = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
  bg.addColorStop(0, hexCss(trail));
  bg.addColorStop(0.55, shade(body, 0.45));
  bg.addColorStop(1, '#1a1030');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, size, size, size * 0.18);
  ctx.fill();
  // Subtle sun stripes
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#fff6e8';
  ctx.lineWidth = 2 * u;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.95, size * (0.35 + i * 0.09), Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Shoulders / flight suit
  ctx.fillStyle = shade(wing, 0.9);
  ctx.beginPath();
  ctx.moveTo(size * 0.12, size * 1.0);
  ctx.quadraticCurveTo(size * 0.14, size * 0.72, size * 0.5, size * 0.70);
  ctx.quadraticCurveTo(size * 0.86, size * 0.72, size * 0.88, size * 1.0);
  ctx.closePath();
  ctx.fill();
  // Collar stripe in accent colour
  ctx.strokeStyle = hexCss(accent);
  ctx.lineWidth = 4 * u;
  ctx.beginPath();
  ctx.moveTo(size * 0.33, size * 0.98);
  ctx.quadraticCurveTo(size * 0.5, size * 0.78, size * 0.67, size * 0.98);
  ctx.stroke();

  // Neck + face
  ctx.fillStyle = P.skin;
  ctx.fillRect(size * 0.42, size * 0.6, size * 0.16, size * 0.16);
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.5, size * 0.21, size * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  ctx.strokeStyle = 'rgba(70,30,40,0.85)';
  ctx.lineWidth = 2.6 * u;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const my = size * 0.655;
  if (P.mouth === 'grin') { ctx.arc(size * 0.5, my - size * 0.02, size * 0.06, 0.15 * Math.PI, 0.85 * Math.PI); }
  else if (P.mouth === 'smile') { ctx.moveTo(size * 0.45, my); ctx.quadraticCurveTo(size * 0.5, my + size * 0.035, size * 0.55, my); }
  else if (P.mouth === 'smirk') { ctx.moveTo(size * 0.45, my + size * 0.01); ctx.quadraticCurveTo(size * 0.52, my + size * 0.02, size * 0.56, my - size * 0.015); }
  else { ctx.moveTo(size * 0.455, my); ctx.lineTo(size * 0.545, my); }
  ctx.stroke();
  if (P.mouth === 'grin') { ctx.fillStyle = '#fff'; ctx.fillRect(size * 0.455, my - size * 0.005, size * 0.09, size * 0.02); }

  // Helmet shell
  const helmetTop = size * 0.2, helmetBottom = size * 0.56;
  const shell = ctx.createLinearGradient(0, helmetTop, 0, helmetBottom);
  shell.addColorStop(0, shade(body, 1.25));
  shell.addColorStop(0.6, hexCss(body));
  shell.addColorStop(1, shade(body, 0.6));
  ctx.fillStyle = shell;
  ctx.beginPath();
  if (P.helmet === 1) {
    // Angular helmet
    ctx.moveTo(size * 0.24, size * 0.56);
    ctx.lineTo(size * 0.22, size * 0.34);
    ctx.lineTo(size * 0.34, size * 0.19);
    ctx.lineTo(size * 0.66, size * 0.19);
    ctx.lineTo(size * 0.78, size * 0.34);
    ctx.lineTo(size * 0.76, size * 0.56);
    ctx.closePath();
  } else {
    ctx.ellipse(size * 0.5, size * 0.42, size * 0.28, size * 0.26, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(size * 0.78, size * 0.56);
    ctx.lineTo(size * 0.22, size * 0.56);
    ctx.closePath();
  }
  ctx.fill();
  // Helmet trims per style
  if (P.helmet === 2) {
    // Fin crest
    ctx.fillStyle = hexCss(accent);
    ctx.beginPath(); ctx.moveTo(size * 0.46, size * 0.19); ctx.lineTo(size * 0.5, size * 0.07); ctx.lineTo(size * 0.54, size * 0.19); ctx.closePath(); ctx.fill();
  } else if (P.helmet === 3) {
    // Racing stripes
    ctx.fillStyle = hexCss(accent);
    ctx.fillRect(size * 0.47, size * 0.17, size * 0.06, size * 0.14);
    ctx.fillStyle = shade(accent, 0.75);
    ctx.fillRect(size * 0.4, size * 0.2, size * 0.04, size * 0.1);
    ctx.fillRect(size * 0.56, size * 0.2, size * 0.04, size * 0.1);
  } else if (P.helmet === 0) {
    // Soft highlight band
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.ellipse(size * 0.42, size * 0.27, size * 0.1, size * 0.045, -0.5, 0, Math.PI * 2); ctx.fill();
  }
  // Chin strap / jaw guard
  ctx.fillStyle = shade(body, 0.5);
  roundRect(ctx, size * 0.22, size * 0.53, size * 0.56, size * 0.07, size * 0.03);
  ctx.fill();

  // Visor
  const visor = ctx.createLinearGradient(size * 0.3, size * 0.33, size * 0.7, size * 0.5);
  visor.addColorStop(0, '#1a1030');
  visor.addColorStop(0.45, P.visor);
  visor.addColorStop(1, '#0d0a1c');
  ctx.fillStyle = visor;
  roundRect(ctx, size * 0.27, size * 0.33, size * 0.46, size * 0.17, size * 0.07);
  ctx.fill();
  // Visor reflection streak
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(size * 0.31, size * 0.36); ctx.lineTo(size * 0.5, size * 0.36); ctx.lineTo(size * 0.42, size * 0.47); ctx.lineTo(size * 0.31, size * 0.47); ctx.closePath();
  ctx.fill();
  // Eyes glinting through the visor
  ctx.fillStyle = P.eyes === 'bright' ? '#ffffff' : P.eyes === 'calm' ? '#e8f6ff' : '#ffd8f0';
  const eyeH = P.eyes === 'narrow' ? size * 0.012 : size * 0.02;
  ctx.beginPath(); ctx.ellipse(size * 0.42, size * 0.42, size * 0.025, eyeH, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(size * 0.58, size * 0.42, size * 0.025, eyeH, 0, 0, Math.PI * 2); ctx.fill();

  // Emblem on the left temple
  drawEmblem(ctx, P.emblem, size * 0.73, size * 0.3, size * 0.055, hexCss(accent));
  // Outline
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2 * u;
  roundRect(ctx, 1, 1, size - 2, size - 2, size * 0.18);
  ctx.stroke();
  return c;
}

/** Cached portrait canvas for UI use (never mutate the returned canvas). */
export function portraitCanvas(pilot, size = 128) {
  const key = `${pilot.id}@${size}`;
  if (!cache.has(key)) cache.set(key, drawPortrait(pilot, size));
  return cache.get(key);
}

/** Fresh <canvas> element sized for the DOM (uses devicePixelRatio for crispness). */
export function portraitElement(pilot, cssSize = 96) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = drawPortrait(pilot, Math.round(cssSize * dpr));
  c.style.width = `${cssSize}px`;
  c.style.height = `${cssSize}px`;
  c.className = 'portrait';
  c.setAttribute('aria-label', `${pilot.callsign} portrait`);
  return c;
}
