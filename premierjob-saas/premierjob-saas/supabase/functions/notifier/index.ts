// PremierJob — fonction « notifier » (Supabase Edge Function, Deno)
// Appelée par la base (déclencheur pg_net) après chaque nouvelle offre d'employeur
// ou nouvelle candidature. Envoie les courriels avec Resend.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   RESEND_API_KEY  (obligatoire pour envoyer quoi que ce soit)
//   EXPEDITEUR      (facultatif) ex. « PremierJob <bonjour@mondomaine.ca> », domaine vérifié chez Resend.
//                   Sans lui : seuls les courriels à l'admin partent (adresse de test Resend),
//                   la confirmation au candidat est journalisée « ignore ».
// Anti-doublon : chaque envoi est réservé dans la table notifications (unique type + ref + destinataire).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const EXPEDITEUR = Deno.env.get("EXPEDITEUR") ?? "";
const SITE = "https://premierjob-saguenay.netlify.app";
const FRAICHEUR_MS = 15 * 60 * 1000; // on ne notifie que des lignes créées il y a moins de 15 min

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

async function rest(chemin: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  let data: any = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = null; }
  return { ok: r.ok, status: r.status, data };
}

async function reserver(type: string, ref_id: string, destinataire: string): Promise<number | null> {
  const r = await rest("notifications?on_conflict=type,ref_id,destinataire", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ type, ref_id, destinataire }),
  });
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].id : null;
}

async function terminer(id: number, statut: string, erreur?: string) {
  await rest(`notifications?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ statut, erreur: erreur ? String(erreur).slice(0, 300) : null }),
  });
}

async function envoyer(type: string, ref_id: string, a: string, sujet: string, texte: string, opts: { externe?: boolean; repondreA?: string } = {}) {
  const id = await reserver(type, ref_id, a);
  if (!id) return "deja";
  if (!RESEND) { await terminer(id, "ignore", "RESEND_API_KEY absente"); return "ignore"; }
  if (opts.externe && !EXPEDITEUR) { await terminer(id, "ignore", "domaine d'envoi non vérifié (secret EXPEDITEUR absent)"); return "ignore"; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EXPEDITEUR || "PremierJob <onboarding@resend.dev>",
        to: [a], subject: sujet, text: texte,
        ...(opts.repondreA ? { reply_to: opts.repondreA } : {}),
      }),
    });
    if (!r.ok) { await terminer(id, "echec", `${r.status} ${await r.text()}`); return "echec"; }
    await terminer(id, "envoye");
    return "envoye";
  } catch (e) {
    await terminer(id, "echec", (e as Error).message);
    return "echec";
  }
}

const recent = (d: string) => Date.now() - new Date(d).getTime() < FRAICHEUR_MS;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Méthode non permise", { status: 405 });
  let corps: any;
  try { corps = await req.json(); } catch { return new Response("JSON invalide", { status: 400 }); }
  const { type, id } = corps ?? {};
  if (!["offre", "candidature"].includes(type) || !/^[0-9a-f-]{36}$/i.test(id ?? "")) {
    return new Response("Requête invalide", { status: 400 });
  }
  const admins: string[] = ((await rest("admins?select=email")).data ?? []).map((x: any) => x.email);
  const resultats: string[] = [];

  if (type === "offre") {
    const o = ((await rest(`offres?id=eq.${id}&select=*`)).data ?? [])[0];
    if (!o || o.source !== "employeur" || !recent(o.created_at)) return new Response("ignoré", { status: 200 });
    const texte = [
      "Nouvelle offre à valider sur PremierJob", "",
      `Poste : ${o.titre}`,
      `Entreprise : ${o.employeur} (${o.ville}${o.lieu ? ", " + o.lieu : ""})`,
      `Contact : ${o.contact_nom} · ${o.contact_courriel ?? "pas de courriel"} · ${o.contact_tel ?? "pas de téléphone"}`,
      `Salaire : ${o.salaire ?? "—"} · ${o.type}`,
      o.alerte_experience ? `\nATTENTION : ${o.alerte_experience}` : "",
      "", `Vérifier et publier : ${SITE}/admin.html`,
    ].join("\n");
    for (const a of admins) resultats.push(await envoyer("offre_soumise", o.id, a, `PremierJob · Offre à valider : ${o.titre}`, texte));
  } else {
    const c = ((await rest(`candidatures?id=eq.${id}&select=*`)).data ?? [])[0];
    if (!c || !recent(c.created_at)) return new Response("ignoré", { status: 200 });
    const o = ((await rest(`offres?id=eq.${c.offre_id}&select=titre,employeur,ville`)).data ?? [])[0] ?? {};
    const ref = String(c.id).slice(0, 8).toUpperCase();
    if (c.canal === "externe") {
      // Candidature faite sur le site de l'employeur, puis déclarée sur PremierJob :
      // aucun courriel (ni admin ni candidat). Elle apparaît dans le tableau de bord.
      return new Response(JSON.stringify({ ok: true, ignore: "candidature externe : pas de courriel" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const pourAdmin = [
      "Nouvelle candidature à traiter", "",
      `${c.prenom} ${c.nom ?? ""} · ${c.telephone} · ${c.courriel}`,
      `Poste : ${o.titre ?? "?"} chez ${o.employeur ?? "?"}`,
      `CV : ${c.cv_path ? "oui" : "non"} · Référence : ${ref}`,
      "", `Ouvrir le tableau de bord : ${SITE}/admin.html`,
    ].join("\n");
    for (const a of admins) resultats.push(await envoyer("candidature_recue", c.id, a, `PremierJob · Candidature : ${c.prenom} pour ${o.titre ?? "une offre"}`, pourAdmin));
    const pourCandidat = [
      `Bonjour ${c.prenom},`, "",
      `Ta candidature pour « ${o.titre ?? "le poste"} » chez ${o.employeur ?? "l'employeur"} est bien reçue (référence ${ref}).`, "",
      "Nous la vérifions, puis la transmettons à l'employeur. S'il veut te rencontrer, il t'appellera directement : réponds même si le numéro est inconnu.", "",
      "Pour retirer ta candidature ou faire supprimer tes données, réponds simplement à ce courriel.", "",
      "PremierJob Saguenay", SITE,
    ].join("\n");
    resultats.push(await envoyer("confirmation_candidat", c.id, c.courriel, `Candidature reçue · ${o.titre ?? "PremierJob"}`, pourCandidat, { externe: true, repondreA: admins[0] }));
  }
  return new Response(JSON.stringify({ ok: true, resultats }), { status: 200, headers: { "Content-Type": "application/json" } });
});
