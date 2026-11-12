// PremierJob — aperçu de partage d'une offre (Netlify Edge Function)
// /o/<id> renvoie une petite page avec le titre, l'entreprise et le salaire
// dans les balises Open Graph (lues par Messenger, Facebook, WhatsApp…),
// puis redirige la personne vers l'offre sur le site.
// Utilise seulement la clé publique : le public ne lit que les offres publiées.

const SUPABASE_URL = "https://hejkousthfnfckblwkqw.supabase.co";
const CLE_PUBLIQUE = "sb_publishable_rgYHtZv4yq6S39nzOAhVKQ_RptFXlad";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default async (request) => {
  const url = new URL(request.url);
  const id = (url.pathname.split("/")[2] || "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.redirect(url.origin + "/", 302);
  const cible = `${url.origin}/#offre-${id}`;

  let o = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/offres?id=eq.${id}&statut=eq.published&select=titre,employeur,ville,salaire,type`, {
      headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${CLE_PUBLIQUE}` },
    });
    if (r.ok) o = (await r.json())[0] || null;
  } catch (e) { o = null; }

  const titre = o ? `${o.titre} · ${o.employeur} (${o.ville})` : "Offre non disponible · PremierJob Saguenay";
  const desc = o
    ? `Sans expérience exigée · ${o.type}${o.salaire ? " · " + o.salaire : ""}. Postule en 2 minutes sur PremierJob.`
    : "Cette offre est pourvue ou fermée. Voir les offres actuelles sur PremierJob.";
  const page = url.origin + url.pathname;

  const html = `<!DOCTYPE html><html lang="fr-CA"><head><meta charset="utf-8">
<title>${esc(titre)}</title><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="PremierJob Saguenay"><meta property="og:locale" content="fr_CA">
<meta property="og:title" content="${esc(titre)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}"><meta property="og:image" content="${esc(url.origin)}/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${esc(page)}">
<meta http-equiv="refresh" content="0; url=${esc(cible)}"></head>
<body style="background:#07080a;color:#f4f4f5;font-family:system-ui,sans-serif"><p><a style="color:#fff" href="${esc(cible)}">Voir l'offre sur PremierJob</a></p>
<script>location.replace(${JSON.stringify(cible).replace(/</g, "\\u003c")})</script></body></html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
};

export const config = { path: "/o/*" };
