// PremierJob — courriels aux candidats après la réponse de l'employeur (copie identique dans reponse/ et suivi/).
// Anti-doublon : chaque envoi est réservé dans notifications (unique type + ref + destinataire).
// Règle : on ramène le candidat sur premierjob.ca, jamais vers le site d'un employeur.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const EXPEDITEUR = Deno.env.get("EXPEDITEUR") ?? "PremierJob <candidatures@premierjob.ca>";
export const SITE = "https://premierjob.ca";
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

export async function rest(chemin: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  let data: any = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { ok: r.ok, status: r.status, data };
}

export async function admins(): Promise<string[]> {
  return ((await rest("admins?select=email")).data ?? []).map((x: any) => x.email);
}

async function reserver(type: string, ref_id: string, a: string): Promise<number | null> {
  const r = await rest("notifications?on_conflict=type,ref_id,destinataire", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ type, ref_id, destinataire: a }),
  });
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].id : null;
}
async function terminer(id: number, statut: string, erreur?: string) {
  await rest(`notifications?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ statut, erreur: erreur ? erreur.slice(0, 300) : null }) });
}

// Réserve d'abord toutes les références (une candidature = une ligne), puis envoie un seul courriel.
// Renvoie "envoye", "deja" (tout était déjà envoyé), "ignore" ou "echec".
export async function envoyer(type: string, refs: string[], a: string, sujet: string, texte: string, repondreA?: string, essai = false) {
  if (essai) return "essai";
  const ids: number[] = [];
  for (const ref of refs) { const id = await reserver(type, ref, a); if (id) ids.push(id); }
  if (!ids.length) return "deja";
  if (!RESEND) { for (const id of ids) await terminer(id, "ignore", "RESEND_API_KEY absente"); return "ignore"; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EXPEDITEUR, to: [a], subject: sujet, text: texte, ...(repondreA ? { reply_to: repondreA } : {}) }),
    });
    const err = r.ok ? undefined : `${r.status} ${await r.text()}`;
    for (const id of ids) await terminer(id, r.ok ? "envoye" : "echec", err);
    return r.ok ? "envoye" : "echec";
  } catch (e) {
    for (const id of ids) await terminer(id, "echec", (e as Error).message);
    return "echec";
  }
}

// Jusqu'à 3 offres publiées qui vont avec les disponibilités du candidat, sans celles où il a déjà postulé.
export async function offresPour(courriel: string, dispos: string[], ville: string | null, exclure: string[] = []) {
  const deja: string[] = ((await rest(`candidatures?courriel=ilike.${encodeURIComponent(courriel)}&select=offre_id`)).data ?? []).map((x: any) => x.offre_id);
  const sauf = new Set([...deja, ...exclure]);
  const os: any[] = (await rest("offres?statut=eq.published&select=id,titre,employeur,ville,creneaux_obligatoires,publiee_le,created_at&order=publiee_le.desc.nullslast&limit=200")).data ?? [];
  const D = new Set(dispos ?? []);
  return os
    .filter((o) => !sauf.has(o.id))
    .filter((o) => !D.size || (o.creneaux_obligatoires ?? []).every((c: string) => D.has(c)))
    .map((o) => ({ o, s: (ville && o.ville === ville ? 2 : 0) + ((o.creneaux_obligatoires ?? []).length ? 1 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ o }) => `- ${o.titre}, ${o.employeur} (${o.ville}) : ${SITE}/o/${o.id}`);
}

export const PIED = ["", "Bonne chance,", "L'équipe PremierJob", "", "Pour retirer ta candidature ou faire supprimer tes données, réponds simplement à ce courriel."];

export function texteAppele(prenom: string, titre: string, employeur: string) {
  return [`Bonjour ${prenom},`, "",
    `Bonne nouvelle : ${employeur} nous dit t'avoir appelé(e) ou avoir prévu une entrevue pour le poste « ${titre} ».`, "",
    "Si tu n'as pas eu l'appel, regarde ta boîte vocale et rappelle-le vite.", "",
    "Pour l'entrevue :",
    "- arrive 10 minutes d'avance;",
    "- apporte ton CV, même s'il l'a déjà;",
    "- prépare deux exemples qui montrent que tu es fiable (école, sport, bénévolat, garde d'enfants…);",
    "- dis clairement tes disponibilités.",
    ...PIED].join("\n");
}

export function texteEmbauche(prenom: string, titre: string, employeur: string) {
  return [`Bonjour ${prenom},`, "",
    `${employeur} nous confirme que tu es embauché(e) pour le poste « ${titre} ».`, "",
    "Si tu as une minute dans quelques jours, réponds à ce courriel pour nous dire comment se passent tes débuts. Ça nous aide à trouver de bons emplois pour les prochains candidats.",
    "", "L'équipe PremierJob", "", "Pour faire supprimer tes données, réponds simplement à ce courriel."].join("\n");
}
