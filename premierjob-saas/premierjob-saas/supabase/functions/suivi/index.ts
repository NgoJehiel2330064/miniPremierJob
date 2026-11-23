// PremierJob — fonction « suivi » (Supabase Edge Function, Deno), appelée chaque heure par pg_cron.
// Prévient les candidats pour qu'aucun ne reste sans nouvelles :
//   1. Pas retenu : l'employeur a cliqué « pas retenu » il y a plus d'une heure (le délai laisse
//      à l'employeur le temps de corriger un mauvais clic) → courriel doux + 3 offres qui lui conviennent.
//   2. Sans réponse : candidature transmise il y a 7 à 30 jours, toujours « Transmise » → courriel
//      « où en est ta candidature » + 3 offres. Un seul courriel par candidat, même s'il en a plusieurs.
// Envoie seulement entre 8 h et 20 h (heure du Québec). Chaque envoi est unique (table notifications).
// POST seulement. ?essai=1 : n'envoie rien, renvoie la liste de ce qui partirait.
import { rest, admins, envoyer, offresPour, PIED, SITE } from "./candidat.ts";

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const dateFr = (d: string) => new Date(d).toLocaleDateString("fr-CA", { day: "numeric", month: "long", timeZone: "America/Toronto" });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const url = new URL(req.url);
  const essai = url.searchParams.get("essai") === "1";
  const heure = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hour12: false, timeZone: "America/Toronto" }).format(new Date()));
  if (!essai && (heure < 8 || heure >= 20)) return json({ ok: true, ignore: "hors des heures d'envoi" });

  const repondreA = (await admins())[0];
  const maintenant = Date.now();
  const rapport: any[] = [];

  // 1. Pas retenu
  const ilYaUneHeure = new Date(maintenant - 3600e3).toISOString();
  const refus: any[] = (await rest(`reponses_employeur?reponse=eq.pas_retenu&repondu_le=lt.${ilYaUneHeure}&select=candidature_id`)).data ?? [];
  for (const { candidature_id } of refus) {
    const c = ((await rest(`candidatures?id=eq.${candidature_id}&statut=eq.rejected&select=id,prenom,courriel,dispos,ville,offre_id`)).data ?? [])[0];
    if (!c) continue;
    const deja = ((await rest(`notifications?type=eq.candidat_pas_retenu&ref_id=eq.${c.id}&select=id`)).data ?? []).length;
    if (deja) continue;
    const o = ((await rest(`offres?id=eq.${c.offre_id}&select=titre,employeur`)).data ?? [])[0] ?? {};
    const offres = await offresPour(c.courriel, c.dispos, c.ville, [c.offre_id]);
    const texte = [`Bonjour ${c.prenom},`, "",
      `${o.employeur ?? "L'employeur"} nous a répondu pour le poste « ${o.titre ?? "?"} » : ta candidature n'a pas été retenue cette fois-ci. Souvent, le poste était déjà comblé.`, "",
      "Ce n'est pas un jugement sur toi. Un premier emploi se trouve souvent après plusieurs candidatures : continue.", "",
      ...(offres.length ? ["Voici des offres qui vont avec tes disponibilités :", ...offres, ""] : []),
      `Toutes les offres sans expérience exigée : ${SITE}`, ...PIED].join("\n");
    const res = await envoyer("candidat_pas_retenu", [c.id], c.courriel, `Des nouvelles de ta candidature · ${o.titre ?? "PremierJob"}`, texte, repondreA, essai);
    rapport.push({ type: "pas_retenu", ref: String(c.id).slice(0, 8), offres: offres.length, res });
  }

  // 2. Sans réponse depuis 7 jours (regroupé par candidat)
  const il7j = new Date(maintenant - 7 * 864e5).toISOString(), il30j = new Date(maintenant - 30 * 864e5).toISOString();
  const attente: any[] = (await rest(`candidatures?statut=eq.forwarded&canal=eq.interne&transmise_le=lt.${il7j}&transmise_le=gt.${il30j}&select=id,prenom,courriel,dispos,ville,offre_id,transmise_le&order=transmise_le.asc`)).data ?? [];
  const deja7 = new Set(((await rest(`notifications?type=eq.candidat_sans_nouvelles_7j&select=ref_id`)).data ?? []).map((x: any) => x.ref_id));
  const parCandidat = new Map<string, any[]>();
  for (const c of attente) {
    if (deja7.has(c.id)) continue;
    const k = c.courriel.toLowerCase();
    parCandidat.set(k, [...(parCandidat.get(k) ?? []), c]);
  }
  for (const [, cs] of parCandidat) {
    const c0 = cs[0];
    const lignes: string[] = [];
    for (const c of cs) {
      const o = ((await rest(`offres?id=eq.${c.offre_id}&select=titre,employeur`)).data ?? [])[0] ?? {};
      lignes.push(`- « ${o.titre ?? "?"} » chez ${o.employeur ?? "?"}, transmise le ${dateFr(c.transmise_le)}`);
    }
    const offres = await offresPour(c0.courriel, c0.dispos, c0.ville, cs.map((c) => c.offre_id));
    const plusieurs = cs.length > 1;
    const texte = [`Bonjour ${c0.prenom},`, "",
      plusieurs ? "Voici où en sont tes candidatures :" : "Voici où en est ta candidature :", ...lignes, "",
      `${plusieurs ? "Les employeurs ne nous ont" : "L'employeur ne nous a"} pas encore donné de nouvelles. C'est fréquent : certains appellent seulement quand ils sont prêts à embaucher. S'il t'appelle, réponds même si le numéro est inconnu.`, "",
      ...(offres.length ? ["Pour ne pas seulement attendre, postule aussi à ces offres qui vont avec tes disponibilités :", ...offres, ""] : []),
      `Toutes les offres : ${SITE}`, ...PIED].join("\n");
    const res = await envoyer("candidat_sans_nouvelles_7j", cs.map((c) => c.id), c0.courriel, plusieurs ? "Où en sont tes candidatures · PremierJob" : "Où en est ta candidature · PremierJob", texte, repondreA, essai);
    rapport.push({ type: "sans_nouvelles_7j", candidatures: cs.length, offres: offres.length, res });
  }

  return json({ ok: true, essai, heure, rapport });
});
