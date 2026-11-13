// PremierJob — page publique d'une offre (Netlify Edge Function), /o/<id>
// - Une vraie page lisible (aussi sans JavaScript), avec un bouton « Postuler ».
// - Les balises Open Graph pour les aperçus de partage (Messenger, Facebook…).
// - Les données JobPosting (JSON-LD) pour apparaître dans Google for Jobs.
// - Offre fermée ou introuvable : code 404 et page « plus disponible » (Google la retire).
// Utilise seulement la clé publique : le public ne lit que les offres publiées.

const SUPABASE_URL = "https://hejkousthfnfckblwkqw.supabase.co";
const CLE_PUBLIQUE = "sb_publishable_rgYHtZv4yq6S39nzOAhVKQ_RptFXlad";
const COLONNES = "id,titre,employeur,ville,lieu,salaire,type,description,qualification,date_debut,nb_postes,verifie_le,publiee_le,creneaux_obligatoires,creneaux_souhaites,horaires,candidature_externe";
const VALIDITE_JOURS = 30; // une offre non reconfirmée n'est plus annoncée à Google après 30 jours

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const JOURS = { lun: "lundi", mar: "mardi", mer: "mercredi", jeu: "jeudi", ven: "vendredi", sam: "samedi", dim: "dimanche" };
const MOMENTS = { jour: "jour", soir: "soir", nuit: "nuit" };
const creneau = (k) => { const [j, m] = String(k).split("-"); return `${JOURS[j] || j} ${MOMENTS[m] || m}`; };
const TYPES_GOOGLE = { "Temps partiel": "PART_TIME", "Temps plein": "FULL_TIME", "Stage": "INTERN", "Été": "TEMPORARY" };
const fmtDate = (d) => { try { return new Date(String(d).length === 10 ? d + "T12:00:00" : d).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return d; } };

// « 16,10 à 18,50 $/h » → { min: 16.1, max: 18.5 } ; seulement pour un salaire horaire
export function salaireHoraire(texte) {
  const t = String(texte || "");
  if (!/\/\s*h\b|heure/i.test(t)) return null;
  const n = (t.match(/\d+(?:[,.]\d+)?/g) || []).map((x) => parseFloat(x.replace(",", "."))).filter((x) => x > 5 && x < 200);
  if (!n.length) return null;
  return { min: n[0], max: n.length > 1 && n[1] > n[0] ? n[1] : null };
}

export function jobPosting(o, page) {
  const debut = o.publiee_le || o.verifie_le;
  const base = o.verifie_le ? new Date(o.verifie_le + "T23:59:00-05:00") : new Date(debut);
  const valide = new Date(base.getTime() + VALIDITE_JOURS * 864e5);
  const req = (o.creneaux_obligatoires || []).map(creneau), ideal = (o.creneaux_souhaites || []).map(creneau);
  const desc = [
    `<p>${esc(o.description || "")}</p>`,
    "<p><b>Aucune expérience professionnelle préalable exigée.</b></p>",
    o.qualification ? `<p>Exigence : ${esc(o.qualification)}</p>` : "",
    req.length ? `<p>Quarts requis : ${esc(req.join(", "))}</p>` : "",
    ideal.length ? `<p>Quarts souhaités : ${esc(ideal.join(", "))}</p>` : "",
  ].join("");
  const j = {
    "@context": "https://schema.org/", "@type": "JobPosting",
    title: o.titre, description: desc,
    identifier: { "@type": "PropertyValue", name: "PremierJob", value: o.id },
    datePosted: String(debut).slice(0, 10),
    validThrough: valide.toISOString(),
    hiringOrganization: { "@type": "Organization", name: o.employeur },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", ...(o.lieu ? { streetAddress: o.lieu } : {}), addressLocality: o.ville, addressRegion: "QC", addressCountry: "CA" } },
    experienceRequirements: "no requirements",
    directApply: !o.candidature_externe,
    url: page,
  };
  if (TYPES_GOOGLE[o.type]) j.employmentType = TYPES_GOOGLE[o.type];
  if (o.nb_postes > 1) j.totalJobOpenings = o.nb_postes;
  if (o.date_debut) j.jobStartDate = o.date_debut;
  const s = salaireHoraire(o.salaire);
  if (s) j.baseSalary = { "@type": "MonetaryAmount", currency: "CAD", value: s.max ? { "@type": "QuantitativeValue", minValue: s.min, maxValue: s.max, unitText: "HOUR" } : { "@type": "QuantitativeValue", value: s.min, unitText: "HOUR" } };
  return j;
}

const json = (x) => JSON.stringify(x).replace(/</g, "\\u003c");

function gabarit({ titre, desc, page, origin, corps, jsonld, indexer }) {
  return `<!DOCTYPE html><html lang="fr-CA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titre)}</title><meta name="description" content="${esc(desc)}">
${indexer ? "" : '<meta name="robots" content="noindex">'}
<meta name="theme-color" content="#07080a">
<meta property="og:type" content="website"><meta property="og:site_name" content="PremierJob Saguenay"><meta property="og:locale" content="fr_CA">
<meta property="og:title" content="${esc(titre)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}"><meta property="og:image" content="${esc(origin)}/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${esc(page)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${jsonld ? `<script type="application/ld+json">${json(jsonld)}</script>` : ""}
</head><body>
<div class="glow" aria-hidden="true"></div><div class="page">
<nav class="nav"><div class="wrap"><a class="logo" href="/"><span class="mark">P</span>PremierJob <small>Saguenay</small></a>
<div class="navlinks"><a class="btn ghost sm" href="/#offres">Toutes les offres</a></div></div></nav>
<main class="wrap offre-page">${corps}</main>
<footer><div class="wrap"><div class="foot-row"><span>PremierJob · lancé au Saguenay</span><span><a href="/confidentialite.html">Confidentialité</a> · <a href="/conditions.html">Conditions</a> · <a href="/employeur.html">Afficher une offre</a></span></div></div></footer>
</div></body></html>`;
}

export default async (request) => {
  const url = new URL(request.url);
  const id = (url.pathname.split("/")[2] || "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.redirect(url.origin + "/", 302);
  const page = `${url.origin}/o/${id}`;

  let o = null, erreur = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/offres?id=eq.${id}&statut=eq.published&select=${COLONNES}`, {
      headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${CLE_PUBLIQUE}` },
    });
    if (r.ok) o = (await r.json())[0] || null; else erreur = true;
  } catch (e) { erreur = true; }

  if (!o) {
    const corps = `<section class="offre-carte"><h1 class="offre-titre">${erreur ? "Offre momentanément indisponible" : "Cette offre n'est plus disponible"}</h1>
      <p class="lead">${erreur ? "Réessaie dans un instant." : "Le poste est pourvu ou l'offre est fermée."} Voici les offres actuelles, toutes sans expérience exigée.</p>
      <div class="cta"><a class="btn" href="/#offres">Voir les offres</a><a class="btn ghost" href="/#alerte">M'avertir des nouvelles</a></div></section>`;
    return new Response(gabarit({ titre: "Offre non disponible · PremierJob Saguenay", desc: "Cette offre est pourvue ou fermée. Voir les offres actuelles sur PremierJob.", page, origin: url.origin, corps, indexer: false }), {
      status: erreur ? 503 : 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  const titre = `${o.titre} · ${o.employeur} (${o.ville})`;
  const desc = `Sans expérience exigée · ${o.type}${o.salaire ? " · " + o.salaire : ""}. ${String(o.description || "").slice(0, 120)}`;
  const req = (o.creneaux_obligatoires || []).map(creneau), ideal = (o.creneaux_souhaites || []).map(creneau);
  const ligne = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
  const corps = `<article class="offre-carte">
    <div class="tags"><span class="badge ok">✓ Sans expérience exigée · vérifiée avec l'employeur</span></div>
    <h1 class="offre-titre">${esc(o.titre)}</h1>
    <p class="offre-emp">${esc(o.employeur)} · ${esc(o.ville)}</p>
    <dl class="kv">
      ${ligne("Lieu", o.lieu)}${ligne("Type", o.type)}${ligne("Salaire", o.salaire)}
      ${o.nb_postes > 1 ? ligne("Postes", String(o.nb_postes)) : ""}${o.date_debut ? ligne("Début", fmtDate(o.date_debut)) : ""}
      ${ligne("Exigé", o.qualification)}${req.length ? ligne("Quarts requis", req.join(", ")) : ""}${ideal.length ? ligne("Quarts souhaités", ideal.join(", ")) : ""}
      ${o.verifie_le ? ligne("Vérifiée le", fmtDate(o.verifie_le)) : ""}
    </dl>
    ${o.description ? `<p class="desc">${esc(o.description)}</p>` : ""}
    <div class="cta"><a class="btn" href="/#offre-${esc(o.id)}">Postuler</a><a class="btn ghost" href="/#offres">Voir les autres offres</a></div>
    <p class="small">Gratuit, sans compte. ${o.candidature_externe ? `La candidature se termine sur le formulaire officiel de ${esc(o.employeur)}.` : "Ta candidature est transmise à l'employeur seulement avec ton accord."}</p>
  </article>`;
  return new Response(gabarit({ titre, desc, page, origin: url.origin, corps, jsonld: jobPosting(o, page), indexer: true }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
};

export const config = { path: "/o/*" };
