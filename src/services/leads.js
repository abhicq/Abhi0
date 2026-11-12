// Lead capture & attribution for calls, SMS and WhatsApp.
// Tracking links (e.g. https://app/t/abc123) are placed in GBP posts CTAs,
// the website/appointment URL, and review-request messages. Each click is
// logged as a lead intent, then redirected to tel:, sms: or wa.me.
import crypto from 'node:crypto';
import { q, id } from '../db.js';

export function buildTarget(channel, number, message = '') {
  const digits = String(number || '').replace(/[^\d+]/g, '');
  if (channel === 'call') return `tel:${digits}`;
  if (channel === 'sms') return `sms:${digits}${message ? `?&body=${encodeURIComponent(message)}` : ''}`;
  if (channel === 'whatsapp') return `https://wa.me/${digits.replace(/\D/g, '')}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  if (channel === 'review') return number; // number = review URL
  throw new Error(`Unknown channel ${channel}`);
}

export async function createLink(tenantId, loc, channel, { label, message, number } = {}) {
  const num = number || (channel === 'whatsapp' ? loc.whatsapp || loc.phone : loc.phone);
  if (!num) throw Object.assign(new Error(`Location has no ${channel === 'whatsapp' ? 'WhatsApp/phone' : 'phone'} number`), { status: 400 });
  const msg = message ?? (channel === 'call' ? '' : `Hi ${loc.name}, I found you on Google and would like a quote.`);
  const code = crypto.randomBytes(5).toString('base64url');
  const linkId = id('tl_');
  await q.run('INSERT INTO tracking_links (id, tenant_id, location_id, code, channel, target, label, message) VALUES (?,?,?,?,?,?,?,?)',
    linkId, tenantId, loc.id, code, channel, buildTarget(channel, num, msg), label || `${channel} (GBP)`, msg);
  return await q.get('SELECT * FROM tracking_links WHERE id = ?', linkId);
}

export async function recordLead({ tenantId, locationId, channel, source, linkId = null, meta = null }) {
  await q.run('INSERT INTO lead_events (id, tenant_id, location_id, channel, source, link_id, meta) VALUES (?,?,?,?,?,?,?)',
    id('le_'), tenantId, locationId, channel, source, linkId, meta ? JSON.stringify(meta) : null);
}

/** Combined leads: tracked clicks (ours) + Google-reported actions (Performance API). */
export async function leadSummary(locationIds, days = 30) {
  if (!locationIds.length) return { tracked: {}, google: {}, total_leads: 0, daily: [] };
  const ph = locationIds.map(() => '?').join(',');
  const tracked = Object.fromEntries((await q.all(`SELECT channel, COUNT(*) n FROM lead_events WHERE location_id IN (${ph}) AND created_at >= datetime('now', ?) GROUP BY channel`, ...locationIds, `-${days} days`)).map((r) => [r.channel, r.n]));
  const google = Object.fromEntries((await q.all(`SELECT metric, SUM(value) n FROM gbp_metrics WHERE location_id IN (${ph}) AND date >= date('now', ?) GROUP BY metric`, ...locationIds, `-${days + 3} days`)).map((r) => [r.metric, r.n]));
  const daily = await q.all(`SELECT date, SUM(CASE WHEN metric='CALL_CLICKS' THEN value ELSE 0 END) calls, SUM(CASE WHEN metric='BUSINESS_CONVERSATIONS' THEN value ELSE 0 END) messages,
      SUM(CASE WHEN metric='WEBSITE_CLICKS' THEN value ELSE 0 END) website, SUM(CASE WHEN metric='BUSINESS_DIRECTION_REQUESTS' THEN value ELSE 0 END) directions,
      SUM(CASE WHEN metric LIKE 'BUSINESS_IMPRESSIONS%' THEN value ELSE 0 END) impressions
      FROM gbp_metrics WHERE location_id IN (${ph}) AND date >= date('now', ?) GROUP BY date ORDER BY date`, ...locationIds, `-${days + 3} days`);
  const calls = Math.max(google.CALL_CLICKS || 0, tracked.call || 0);
  const messages = (google.BUSINESS_CONVERSATIONS || 0) + (tracked.sms || 0) + (tracked.whatsapp || 0);
  const total = calls + messages + (google.BUSINESS_DIRECTION_REQUESTS || 0) + (google.BUSINESS_BOOKINGS || 0);
  return { tracked, google, calls, messages, total_leads: total, daily };
}
