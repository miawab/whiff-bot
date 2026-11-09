// Generated artwork: panel banners, welcome cards, rank cards, server icon, custom emojis.
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const FONTS = path.join(__dirname, '..', 'node_modules', '@fontsource');
GlobalFonts.registerFromPath(path.join(FONTS, 'bebas-neue/files/bebas-neue-latin-400-normal.woff2'), 'Bebas');
GlobalFonts.registerFromPath(path.join(FONTS, 'inter/files/inter-latin-400-normal.woff2'), 'Inter');
GlobalFonts.registerFromPath(path.join(FONTS, 'inter/files/inter-latin-700-normal.woff2'), 'Inter Bold');
GlobalFonts.registerFromPath(path.join(FONTS, 'inter/files/inter-latin-800-normal.woff2'), 'Inter Black');

const C = { bg: '#0d0d10', panel: '#16161c', red: '#e63946', redDark: '#9d0208', white: '#f5f5f7', gray: '#9a9aa5', line: '#26262e', gold: '#f4a261' };

// Dark background with a diagonal red slash and faint grid.
function backdrop(ctx, w, h, accent = C.red) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const g = ctx.createLinearGradient(w * 0.55, 0, w, h);
  g.addColorStop(0, accent);
  g.addColorStop(1, C.redDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(w * 0.72, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(w * 0.58, h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(w * 0.80, 0); ctx.lineTo(w * 0.83, 0); ctx.lineTo(w * 0.69, h); ctx.lineTo(w * 0.66, h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(0, h - 6, w * 0.6, 6);
}

function fitText(ctx, text, maxWidth, size, family) {
  let s = size;
  do { ctx.font = `${s}px "${family}"`; s -= 4; } while (ctx.measureText(text).width > maxWidth && s > 16);
}

/** Wide panel banner (1200x360). */
function banner(title, subtitle = '', { accent = C.red, tag = "THEWHIFFLORD'S DOJO" } = {}) {
  const w = 1200, h = 360;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, w, h, accent);
  ctx.fillStyle = accent;
  ctx.fillRect(70, 92, 46, 6);
  ctx.fillStyle = C.gray;
  ctx.font = '22px "Inter Bold"';
  ctx.fillText(tag, 130, 102);
  ctx.fillStyle = C.white;
  fitText(ctx, title.toUpperCase(), 760, 150, 'Bebas');
  ctx.fillText(title.toUpperCase(), 66, 236);
  if (subtitle) {
    ctx.fillStyle = C.gray;
    fitText(ctx, subtitle, 720, 30, 'Inter');
    ctx.fillText(subtitle, 70, 290);
  }
  return canvas.toBuffer('image/png');
}

async function avatarCircle(ctx, url, x, y, r, ring = C.red) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  try { ctx.drawImage(await loadImage(url), x - r, y - r, r * 2, r * 2); } catch { ctx.fillStyle = C.panel; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  ctx.restore();
}

/** Welcome card (1200x400). */
async function welcomeCard({ avatarURL, name, count }) {
  const w = 1200, h = 400;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, w, h);
  await avatarCircle(ctx, avatarURL, 190, 200, 115);
  ctx.fillStyle = C.gray;
  ctx.font = '24px "Inter Bold"';
  ctx.fillText('A NEW CHALLENGER APPROACHES', 360, 130);
  ctx.fillStyle = C.white;
  fitText(ctx, name.toUpperCase(), 520, 120, 'Bebas');
  ctx.fillText(name.toUpperCase(), 356, 240);
  ctx.fillStyle = C.red;
  ctx.font = '30px "Inter Black"';
  ctx.fillText(`FIGHTER #${count}`, 360, 300);
  return canvas.toBuffer('image/png');
}

/** Rank card (1000x300). */
async function rankCard({ avatarURL, name, level, into, next, position, totalXp, title, color = C.red, ladder }) {
  const w = 1000, h = 300;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, w, h, color);
  await avatarCircle(ctx, avatarURL, 140, 150, 90, color);

  ctx.fillStyle = C.white;
  fitText(ctx, name.toUpperCase(), 430, 64, 'Bebas');
  ctx.fillText(name.toUpperCase(), 262, 112);
  ctx.fillStyle = C.gray;
  ctx.font = '20px "Inter Bold"';
  ctx.fillText((title ?? 'FIGHTER').toUpperCase(), 264, 144);

  ctx.textAlign = 'right';
  ctx.fillStyle = C.white;
  ctx.font = '78px "Bebas"';
  ctx.fillText(`LV ${level}`, 940, 112);
  ctx.fillStyle = C.gray;
  ctx.font = '20px "Inter Bold"';
  ctx.fillText(`RANK #${position}`, 940, 144);
  ctx.textAlign = 'left';

  // Progress bar
  const bx = 264, by = 186, bw = 676, bh = 30;
  ctx.fillStyle = C.line;
  roundRect(ctx, bx, by, bw, bh, 15); ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, bx, by, Math.max(bh, bw * Math.min(1, into / next)), bh, 15); ctx.fill();
  ctx.fillStyle = C.gray;
  ctx.font = '18px "Inter Bold"';
  ctx.fillText(`${into.toLocaleString()} / ${next.toLocaleString()} XP`, bx, by + 60);
  ctx.textAlign = 'right';
  ctx.fillText(ladder ?? `${totalXp.toLocaleString()} TOTAL XP`, bx + bw, by + 60);
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Square server icon / bot avatar (512x512). */
function icon(letters = 'WD') {
  const s = 512;
  const canvas = createCanvas(s, s);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, s, s);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, C.red); g.addColorStop(1, C.redDark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(s * 0.62, 0); ctx.lineTo(s, 0); ctx.lineTo(s, s); ctx.lineTo(s * 0.30, s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.font = '300px "Bebas"';
  ctx.fillText(letters, s / 2, s / 2 + 105);
  return canvas.toBuffer('image/png');
}

/** 128x128 badge emoji: colored shape with short text or a drawn glyph. */
function badge({ text, color, shape = 'circle', fg = C.white, size = 84, glyph }) {
  const s = 128;
  const canvas = createCanvas(s, s);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  if (shape === 'circle') { ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill(); }
  else if (shape === 'diamond') {
    const inset = text === '' ? 22 : 4; // plain diamonds are drawn smaller so they read as bullets
    ctx.beginPath(); ctx.moveTo(64, inset); ctx.lineTo(128 - inset, 64); ctx.lineTo(64, 128 - inset); ctx.lineTo(inset, 64); ctx.closePath(); ctx.fill();
  }
  else { roundRect(ctx, 6, 6, 116, 116, 28); ctx.fill(); }
  ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (glyph === 'check') { ctx.beginPath(); ctx.moveTo(36, 66); ctx.lineTo(56, 86); ctx.lineTo(94, 44); ctx.stroke(); }
  else if (glyph === 'cross') { ctx.beginPath(); ctx.moveTo(42, 42); ctx.lineTo(86, 86); ctx.moveTo(86, 42); ctx.lineTo(42, 86); ctx.stroke(); }
  else if (glyph === 'plus') { ctx.beginPath(); ctx.moveTo(64, 34); ctx.lineTo(64, 94); ctx.moveTo(34, 64); ctx.lineTo(94, 64); ctx.stroke(); }
  else if (glyph === 'minus') { ctx.beginPath(); ctx.moveTo(34, 64); ctx.lineTo(94, 64); ctx.stroke(); }
  else if (glyph === 'arrow') { ctx.beginPath(); ctx.moveTo(50, 34); ctx.lineTo(82, 64); ctx.lineTo(50, 94); ctx.stroke(); }
  else if (text) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitText(ctx, text, 100, size, 'Bebas');
    ctx.fillText(text, 64, 70);
  }
  return canvas.toBuffer('image/png');
}

module.exports = { banner, welcomeCard, rankCard, icon, badge, COLORS: C };
