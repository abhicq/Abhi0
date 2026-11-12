// Seeds a demo workspace: `npm run seed` → log in as demo@rankpilot.local / demo12345
import { q, id, getDb } from './db.js';
import { hashPassword } from './auth.js';
import { grant } from './credits.js';
import { activatePlan } from './billing.js';
import * as google from './services/google.js';
import * as auto from './services/automation.js';
import { recordLead } from './services/leads.js';

getDb();
const email = 'demo@rankpilot.local';
const old = q.get('SELECT tenant_id FROM users WHERE email = ?', email);
if (old) q.run('DELETE FROM tenants WHERE id = ?', old.tenant_id);

const tenantId = id('ten_');
q.run("INSERT INTO tenants (id, name, plan) VALUES (?, 'Demo Agency', 'trial')", tenantId);
q.run('INSERT INTO users (id, tenant_id, email, name, password_hash, is_platform_admin) VALUES (?,?,?,?,?,1)', id('usr_'), tenantId, email, 'Demo Owner', hashPassword('demo12345'));
grant(tenantId, 300, 'trial_credits');
activatePlan(tenantId, 'growth');

const connId = google.createDemoConnection(tenantId);
const conn = q.get('SELECT * FROM google_connections WHERE id = ?', connId);
const remote = await google.listRemoteLocations(conn);
for (const r of remote) {
  const lid = auto.importLocation(tenantId, connId, r);
  await auto.syncLocation(tenantId, lid);
  await auto.buildKeywords(tenantId, lid, { withVolumes: true });
  const before = auto.runAudit(tenantId, lid);
  q.run("UPDATE audits SET created_at = datetime('now','-30 days') WHERE id = ?", before.id);
  const kw = auto.listKeywords(lid)[0].keyword;
  const s1 = await auto.scanKeyword(tenantId, lid, kw, { size: 7, radiusKm: 6 });
  q.run("UPDATE grid_scans SET created_at = datetime('now','-28 days') WHERE id = ?", s1.id);
  const opt = await auto.generateOptimization(tenantId, lid);
  await auto.applyOptimization(tenantId, lid, opt);
  auto.updateLocationFields(lid, { photos_count: 18, attributes: ['Online estimates', 'Onsite services'] });
  for (let i = 0; i < 4; i++) {
    const p = await auto.createAiPost(tenantId, lid, {});
    await auto.publishPostNow(tenantId, p.id);
    q.run("UPDATE posts SET published_at = datetime('now', ?) WHERE id = ?", `-${i * 2} days`, p.id);
  }
  await auto.fillPostingQueue(tenantId, lid);
  await auto.autoReplyReviews(tenantId, lid);
  for (const ch of ['call', 'sms']) { try { (await import('./services/leads.js')).createLink(tenantId, auto.getLocation(tenantId, lid), ch); } catch { /* no phone */ } }
  const links = q.all('SELECT * FROM tracking_links WHERE location_id = ?', lid);
  for (let d = 0; d < 30; d++) for (const l of links) if (Math.random() < 0.35) {
    recordLead({ tenantId, locationId: lid, channel: l.channel, source: 'tracking_link', linkId: l.id });
    q.run("UPDATE lead_events SET created_at = datetime('now', ?) WHERE rowid = (SELECT MAX(rowid) FROM lead_events)", `-${d} days`);
  }
  const orders = ['yelp', 'bing', 'facebook', 'bbb', 'yellowpages', 'foursquare'];
  for (const did of orders) {
    const cid = id('ci_');
    q.run("INSERT OR IGNORE INTO citations (id, tenant_id, location_id, directory_id, status, credits_charged, nap_match, listing_url) VALUES (?,?,?,?,?,?,?,?)",
      cid, tenantId, lid, did, did === 'bbb' ? 'in_progress' : 'live', 200, did === 'bbb' ? null : did === 'yellowpages' ? 0 : 1, did === 'bbb' ? null : `https://example.com/${did}/listing`);
  }
  q.run("UPDATE citations SET notes = 'NAP mismatch: phone' WHERE location_id = ? AND directory_id = 'yellowpages'", lid);
  await auto.scanKeyword(tenantId, lid, kw, { size: 7, radiusKm: 6 });
  auto.runAudit(tenantId, lid);
  console.log(`Seeded ${r.name}`);
}
console.log(`\nDemo ready → ${email} / demo12345`);
