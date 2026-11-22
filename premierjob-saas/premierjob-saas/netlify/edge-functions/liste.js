// PremierJob — pages de référencement (Edge Function), lisibles par Google sans JavaScript :
//   /emplois                 toutes les offres
//   /emplois/<ville>         offres d'une ville (chicoutimi, jonquiere, la-baie, laterriere, alma)
//   /emploi-etudiant         offres qui conviennent aux étudiants (temps partiel, été, stage, « étudiant »)
// Chaque page : un titre et un texte propres, la liste des offres (liens vers /o/<id>), et des liens
// vers les autres pages. Une page sans offre n'est pas indexée et montre toutes les offres.
// Utilise seulement la clé publique : le public ne lit que les offres publiées.

import { gabarit } from "./offre.js";

const SUPABASE_URL = "https://hejkousthfnfckblwkqw.supabase.co";
const CLE_PUBLIQUE = "sb_publishable_rgYHtZv4yq6S39nzOAhVKQ_RptFXlad";
const COLONNES = "id,titre,employeur,ville,salaire,type,offre_publique,publiee_le";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const VILLES = {
  chicoutimi: "Chicoutimi",
  jonquiere: "Jonquière",
  "la-baie": "La Baie",
  laterriere: "Laterrière",
  alma: "Alma",
};

const estEtudiant = (o) => ["Temps partiel", "Été", "Stage"].includes(o.type) || /[ée]tudiant/i.test(o.titre || "");

export const PAGES = {
  "/emplois": {
    titre: "Emplois sans expérience au Saguenay et à Alma · PremierJob",
    h1: "Emplois sans expérience au Saguenay et à Alma",
    intro: "Toutes les offres où l'expérience n'est pas exigée, à Chicoutimi, Jonquière, La Baie, Laterrière et Alma. Chaque offre affiche ses vrais horaires : tu vois tout de suite si elle va avec les tiens. Postuler est gratuit et prend 2 minutes.",
    filtre: () => true,
  },
  "/emploi-etudiant": {
    titre: "Emploi étudiant au Saguenay et à Alma, sans expérience · PremierJob",
    h1: "Emploi étudiant au Saguenay et à Alma",
    intro: "Des jobs à temps partiel, d'été et des stages qui conviennent aux étudiants du secondaire, du cégep et de l'université. Aucune expérience exigée. Choisis tes moments libres entre les cours et postule en 2 minutes, gratuitement.",
    filtre: estEtudiant,
  },
  ...Object.fromEntries(Object.entries(VILLES).map(([slug, ville]) => [`/emplois/${slug}`, {
    titre: `Emplois sans expérience à ${ville} · PremierJob`,
    h1: `Emplois sans expérience à ${ville}`,
    intro: `Les offres d'emploi à ${ville} où l'expérience n'est pas exigée : commerce, restauration, entrepôt, entretien et premiers stages. Chaque offre affiche ses vrais horaires, et tu postules en 2 minutes, gratuitement.`,
    filtre: (o) => o.ville === ville,
  }])),
};

const nouveau = (o) => o.publiee_le && Date.now() - new Date(o.publiee_le).getTime() < 7 * 864e5;
const item = (o) => `<li class="liste-offre"><a href="/o/${esc(o.id)}"><b>${esc(o.titre)}</b></a>${nouveau(o) ? ' <span class="badge new-b">Nouveau</span>' : ""}
  <span class="small">${esc(o.employeur)} · ${esc(o.ville)} · ${esc(o.type)}${o.salaire ? " · " + esc(o.salaire) : ""}</span></li>`;

export default async (request) => {
  const url = new URL(request.url);
  const chemin = url.pathname.replace(/\/+$/, "") || "/emplois";
  const p = PAGES[chemin];
  if (!p) return Response.redirect(url.origin + "/emplois", 302);
  const page = url.origin + chemin;

  let offres = [], erreur = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/offres?statut=eq.published&select=${COLONNES}&order=publiee_le.desc&limit=500`, {
      headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${CLE_PUBLIQUE}` },
    });
    if (r.ok) offres = await r.json(); else erreur = true;
  } catch (e) { erreur = true; }

  const choisies = offres.filter(p.filtre);
  const vide = choisies.length === 0;
  const montrees = vide ? offres : choisies;
  const autres = [["/emplois", "Toutes les offres"], ["/emploi-etudiant", "Emploi étudiant"], ...Object.entries(VILLES).map(([s, v]) => [`/emplois/${s}`, v])]
    .filter(([c]) => c !== chemin).map(([c, t]) => `<a href="${c}">${esc(t)}</a>`).join(" · ");

  const corps = `<section class="offre-carte">
    <h1 class="offre-titre">${esc(p.h1)}</h1>
    <p class="lead" style="margin:0">${esc(p.intro)}</p>
    <p class="small" style="margin:0">${erreur ? "Les offres se chargent mal en ce moment : réessaie dans un instant." : vide ? "Aucune offre ici pour le moment. Voici toutes les offres de la région :" : `${choisies.length} offre${choisies.length > 1 ? "s" : ""} en ce moment.`}</p>
    <ul class="liste-offres">${montrees.map(item).join("")}</ul>
    <div class="cta"><a class="btn" href="/#offres">Voir les offres selon mon horaire</a><a class="btn ghost" href="/#alerte">Recevoir les nouvelles offres</a></div>
    <p class="small" style="margin:0">Aussi sur PremierJob : ${autres}</p>
  </section>`;

  return new Response(gabarit({ titre: p.titre, desc: p.intro.slice(0, 155), page, origin: url.origin, corps, jsonld: null, indexer: !vide && !erreur }), {
    status: erreur ? 503 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
};

export const config = { path: ["/emplois", "/emplois/*", "/emploi-etudiant"] };
