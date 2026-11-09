const fs = require('fs');
const path = require('path');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { BRAND } = require('./constants');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));

const embed = (o = {}) => new EmbedBuilder({ color: BRAND.color, ...o });

// Custom emoji by short name (see EMOJIS in constants), with a plain fallback.
const E = (name, fallback = '•') => cfg.emojis?.[`wd_${name}`] ?? fallback;

// XP needed to go from level l to l+1 (MEE6-style curve).
const need = (l) => 5 * l * l + 50 * l + 100;
function levelFor(xp) {
  let l = 0;
  while (xp >= need(l)) { xp -= need(l); l++; }
  return { level: l, into: xp, next: need(l) };
}

// Per-key cooldowns: returns seconds left, or 0 if allowed (and starts the cooldown).
const cooldowns = new Map();
function cooldown(key, userId, seconds) {
  const k = `${key}:${userId}`;
  const now = Date.now();
  const until = cooldowns.get(k) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  cooldowns.set(k, now + seconds * 1000);
  return 0;
}
setInterval(() => { const now = Date.now(); for (const [k, t] of cooldowns) if (t < now) cooldowns.delete(k); }, 10 * 60 * 1000).unref();

// Reply only the user can see.
const ephemeral = (i, content, extra = {}) => {
  const payload = typeof content === 'string' ? { content, ...extra } : { ...content, ...extra };
  payload.flags = MessageFlags.Ephemeral;
  return i.replied || i.deferred ? i.followUp(payload) : i.reply(payload);
};

async function modLog(guild, data) {
  const ch = guild.channels.cache.get(cfg.channels.modLogs);
  if (!ch) return;
  await ch.send(data.title || data.description ? { embeds: [embed({ color: BRAND.gray, ...data })] } : data).catch(() => {});
}

const isStaff = (member) => !!member && (member.roles.cache.has(cfg.roles.mod) || member.roles.cache.has(cfg.roles.owner) || member.roles.cache.has(cfg.roles.tech)
  || member.permissions.has('Administrator'));
const isSupporter = (member) => !!member && (member.roles.cache.has(cfg.roles.supporter) || !!member.premiumSince);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Message IDs removed by the filters (so XP etc. ignore them).
const flagged = new Set();
setInterval(() => flagged.clear(), 60 * 60 * 1000).unref();

module.exports = { cfg, embed, E, need, levelFor, flagged, cooldown, ephemeral, modLog, isStaff, isSupporter, pick, shuffle };
