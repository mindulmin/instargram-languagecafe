// Never return/log paging URLs (Meta can embed credentials in them).
function session(value) {
  const s = typeof value === 'string' ? JSON.parse(value) : value;
  if (!s?.accessToken || !/^\d+$/.test(s.accountId || '') || !/^v\d+\.\d+$/.test(s.graphVersion || '')) throw Error('instagram_session_invalid');
  return s;
}
async function graph(s, object, fields, request = fetch) {
  const u = new URL(`https://graph.facebook.com/${s.graphVersion}/${object}`);
  for (const [key, value] of Object.entries(fields)) u.searchParams.set(key, String(value));
  // Query authentication is required by the existing Facebook-login setup.
  u.searchParams.set('access_token', s.accessToken);
  const r = await request(u, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  const j = await r.json();
  if (!r.ok || j.error) throw Error(`instagram_read_failed_http_${r.status}_code_${Number(j.error?.code) || 0}`);
  return j;
}
async function recentMedia(value, request = fetch) {
  const s = session(value), media = [];
  let after;
  for (let page = 0; page < 10; page++) {
    const j = await graph(s, `${s.accountId}/media`, { fields: 'id,caption,media_type,permalink,timestamp', limit: 100, ...(after ? { after } : {}) }, request);
    if (!Array.isArray(j.data)) throw Error('instagram_media_list_invalid');
    for (const m of j.data) media.push({ id: m.id, caption: m.caption || '', media_type: m.media_type, permalink: m.permalink, timestamp: m.timestamp });
    if (!j.paging?.next) return { checkedAt: new Date().toISOString(), source: 'official_instagram_graph_api_recent_media', complete: true, media };
    if (!j.paging?.cursors?.after || j.paging.cursors.after === after) throw Error('instagram_paging_invalid');
    after = j.paging.cursors.after;
  }
  throw Error('instagram_history_incomplete');
}
module.exports = { session, graph, recentMedia };
