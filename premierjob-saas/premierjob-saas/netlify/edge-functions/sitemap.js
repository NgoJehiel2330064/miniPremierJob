// PremierJob — plan du site pour Google (Netlify Edge Function), /sitemap.xml
// Pages fixes + une entrée par offre publiée (/o/<id>). Si la base ne répond pas,
// on renvoie quand même les pages fixes.

const SUPABASE_URL = "https://hejkousthfnfckblwkqw.supabase.co";
const CLE_PUBLIQUE = "sb_publishable_rgYHtZv4yq6S39nzOAhVKQ_RptFXlad";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

export default async (request) => {
  const origin = new URL(request.url).origin;
  const fixes = [["/", "daily", "1.0"], ["/employeur.html", "monthly", "0.8"], ["/confidentialite.html", "yearly", "0.3"], ["/conditions.html", "yearly", "0.3"]];
  let offres = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/offres?statut=eq.published&select=id,publiee_le,verifie_le&order=publiee_le.desc&limit=1000`, {
      headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${CLE_PUBLIQUE}` },
    });
    if (r.ok) offres = await r.json();
  } catch (e) { offres = []; }
  const url = (loc, extra) => `  <url><loc>${esc(origin + loc)}</loc>${extra}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${fixes.map(([p, f, pr]) => url(p, `<changefreq>${f}</changefreq><priority>${pr}</priority>`)).join("\n")}
${offres.filter((o) => /^[0-9a-f-]{36}$/.test(o.id)).map((o) => url(`/o/${o.id}`, `<lastmod>${esc(String(o.verifie_le || o.publiee_le || "").slice(0, 10))}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority>`)).join("\n")}
</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600" } });
};

export const config = { path: "/sitemap.xml" };
