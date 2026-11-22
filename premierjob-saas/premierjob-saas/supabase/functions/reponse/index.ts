// PremierJob — fonction « reponse » (Supabase Edge Function, Deno)
// Réponse de l'employeur en un clic, depuis les liens du courriel de transmission.
//   GET  ?j=<jeton>             → { ok, prenom, poste, employeur, reponse } (affichage de la page)
//   POST { j, r }               → enregistre la réponse (r = appele | embauche | pas_retenu)
// La page premierjob.ca/reponse demande toujours une confirmation avant le POST :
// les antivirus de courriel ouvrent les liens tout seuls, un simple GET ne change donc rien.
// Le jeton (uuid aléatoire) est la seule clé : pas de compte, rien d'autre n'est exposé.
// L'admin reçoit un courriel à chaque réponse. Le candidat est prévenu tout de suite pour « appelé » et
// « embauché » ; pour « pas retenu », la fonction « suivi » le prévient une heure plus tard (le temps de
// corriger un mauvais clic).
import { envoyer as envoyerCandidat, texteAppele, texteEmbauche } from "./candidat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const EXPEDITEUR = Deno.env.get("EXPEDITEUR") ?? "PremierJob <candidatures@premierjob.ca>";
const SITE = "https://premierjob.ca";

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const CHOIX: Record<string, { statut: string; libelle: string }> = {
  appele: { statut: "interview", libelle: "a appelé le candidat ou prévu une entrevue" },
  embauche: { statut: "hired", libelle: "a embauché le candidat" },
  pas_retenu: { statut: "rejected", libelle: "n'a pas retenu le candidat (ou poste comblé)" },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rest(chemin: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  let data: any = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { ok: r.ok, status: r.status, data };
}

async function charger(j: string) {
  const t = ((await rest(`reponses_employeur?jeton=eq.${j}&select=*`)).data ?? [])[0];
  if (!t) return null;
  const c = ((await rest(`candidatures?id=eq.${t.candidature_id}&select=id,prenom,nom,statut,offre_id`)).data ?? [])[0];
  if (!c) return null;
  const o = ((await rest(`offres?id=eq.${c.offre_id}&select=titre,employeur`)).data ?? [])[0] ?? {};
  return { t, c, o };
}

// Statut visé selon le statut actuel. null = on enregistre la réponse sans toucher au statut.
function chemin(actuel: string, vise: string): string[] | null {
  if (actuel === vise || actuel === "withdrawn") return null;
  if (actuel === "hired" && vise === "interview") return null; // ne pas rétrograder une embauche
  if (["received", "intent", "declared"].includes(actuel)) return ["forwarded", vise];
  if (actuel === "rejected") return null; // l'admin corrige à la main si besoin
  return [vise];
}

async function avertirAdmins(sujet: string, texte: string, ref: string, type: string) {
  if (!RESEND) return;
  const admins: string[] = ((await rest("admins?select=email")).data ?? []).map((x: any) => x.email);
  for (const a of admins) {
    const res = await rest("notifications", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ type, ref_id: ref, destinataire: a }) });
    const id = Array.isArray(res.data) && res.data[0] ? res.data[0].id : null;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EXPEDITEUR, to: [a], subject: sujet, text: texte }),
      });
      if (id) await rest(`notifications?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ statut: r.ok ? "envoye" : "echec", erreur: r.ok ? null : `${r.status} ${(await r.text()).slice(0, 250)}` }) });
    } catch (e) {
      if (id) await rest(`notifications?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ statut: "echec", erreur: (e as Error).message.slice(0, 300) }) });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const j = url.searchParams.get("j") ?? "";
    if (!UUID.test(j)) return json({ ok: false, erreur: "lien" }, 400);
    const d = await charger(j);
    if (!d) return json({ ok: false, erreur: "lien" }, 404);
    return json({ ok: true, prenom: d.c.prenom, poste: d.o.titre ?? null, employeur: d.o.employeur ?? null, reponse: d.t.reponse, statut: d.c.statut });
  }

  if (req.method !== "POST") return json({ ok: false, erreur: "methode" }, 405);
  let corps: any;
  try { corps = await req.json(); } catch { return json({ ok: false, erreur: "requete" }, 400); }
  const j = String(corps?.j ?? ""), r = String(corps?.r ?? "");
  if (!UUID.test(j) || !CHOIX[r]) return json({ ok: false, erreur: "requete" }, 400);
  const d = await charger(j);
  if (!d) return json({ ok: false, erreur: "lien" }, 404);
  if (d.t.nb_reponses >= 20) return json({ ok: false, erreur: "trop" }, 429);

  // 1. La réponse est toujours enregistrée.
  await rest(`reponses_employeur?jeton=eq.${j}`, { method: "PATCH", body: JSON.stringify({ reponse: r, repondu_le: new Date().toISOString(), nb_reponses: d.t.nb_reponses + 1 }) });

  // 2. Le statut suit quand la transition est permise (le déclencheur garde l'historique).
  let statutMaj = "inchangé";
  const etapes = chemin(d.c.statut, CHOIX[r].statut);
  if (etapes) {
    for (const st of etapes) {
      const u = await rest(`candidatures?id=eq.${d.c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ statut: st, statut_par: "employeur", confirmee_employeur: true }) });
      if (!u.ok) { statutMaj = `non changé (${String(typeof u.data === "string" ? u.data : u.data?.message ?? u.status).slice(0, 160)})`; break; }
      statutMaj = st;
    }
  } else {
    await rest(`candidatures?id=eq.${d.c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ confirmee_employeur: true }) });
  }

  // 3. L'admin est prévenu.
  const nom = `${d.c.prenom} ${d.c.nom ?? ""}`.trim();
  const ref = String(d.c.id).slice(0, 8).toUpperCase();
  await avertirAdmins(
    `PremierJob · Réponse employeur : ${nom} (${d.o.employeur ?? "?"})`,
    [`${d.o.employeur ?? "L'employeur"} ${CHOIX[r].libelle}.`, "",
     `Candidat : ${nom} · Référence ${ref}`,
     `Poste : ${d.o.titre ?? "?"}`,
     `Statut : ${d.c.statut} → ${statutMaj}`, "",
     `Tableau de bord : ${SITE}/admin.html`].join("\n"),
    d.c.id, `reponse_employeur_${r}_${(d.t.nb_reponses + 1)}`,
  );

  // 4. Le candidat est prévenu (une seule fois par type de nouvelle).
  //    Seulement si le statut correspond bien (pas de « bonne nouvelle » après une embauche ou un refus).
  const c = ((await rest(`candidatures?id=eq.${d.c.id}&select=courriel,statut`)).data ?? [])[0];
  if (c && ((r === "appele" && c.statut === "interview") || (r === "embauche" && c.statut === "hired"))) {
    const admins: string[] = ((await rest("admins?select=email")).data ?? []).map((x: any) => x.email);
    if (c?.courriel) {
      const titre = d.o.titre ?? "le poste", emp = d.o.employeur ?? "L'employeur";
      if (r === "appele") await envoyerCandidat("candidat_appele", [d.c.id], c.courriel, `Bonne nouvelle · ${titre}`, texteAppele(d.c.prenom, titre, emp), admins[0]);
      else await envoyerCandidat("candidat_embauche", [d.c.id], c.courriel, `Félicitations · ${titre}`, texteEmbauche(d.c.prenom, titre, emp), admins[0]);
    }
  }

  return json({ ok: true, reponse: r, prenom: d.c.prenom });
});
