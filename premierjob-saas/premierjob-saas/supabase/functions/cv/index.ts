// PremierJob — fonction « cv » (Supabase Edge Function, Deno)
// Sert le CV d'une candidature pour qu'il parte en pièce jointe du courriel de transmission à l'employeur.
//   POST { id: <uuid candidature> }  avec l'en-tête x-jeton  → le fichier (binaire), nom dans x-nom-fichier
// Accès : une clé longue et aléatoire, gardée hors du dépôt. Seule son empreinte SHA-256 est ici.
// Garde-fous : candidat consentant, candidature ni retirée ni refusée, offre active, fichier ≤ 10 Mo.
// verify_jwt = false : la clé ci-dessous remplace le JWT. Pour changer la clé, remplacer l'empreinte et redéployer.
const EMPREINTE = "4c7bd3dcc893df859127738499f260ff14837702b827a80cfdd8187b765da2aa";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (d: unknown, status: number) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function sha256(t: string) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function egal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  if (!egal(await sha256(req.headers.get("x-jeton") ?? ""), EMPREINTE)) return json({ ok: false }, 401);
  let id = "";
  try { id = String((await req.json())?.id ?? ""); } catch { /* vide */ }
  if (!UUID.test(id)) return json({ ok: false, erreur: "id" }, 400);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${id}&select=prenom,nom,cv_path,consentement,statut,offres(statut)`, { headers: H });
  const c = ((await r.json()) ?? [])[0];
  if (!c || !c.cv_path) return json({ ok: false, erreur: "pas de CV" }, 404);
  if (!c.consentement || ["withdrawn", "rejected"].includes(c.statut) || !["published", "paused"].includes(c.offres?.statut)) return json({ ok: false, erreur: "non transmissible" }, 403);

  const f = await fetch(`${SUPABASE_URL}/storage/v1/object/cvs/${encodeURIComponent(c.cv_path)}`, { headers: H });
  if (!f.ok) return json({ ok: false, erreur: "fichier" }, 404);
  const octets = await f.arrayBuffer();
  if (octets.byteLength > 10 * 1024 * 1024) return json({ ok: false, erreur: "trop gros" }, 413);
  const ext = (c.cv_path.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  const nom = `CV - ${c.prenom} ${c.nom ?? ""}`.trim().replace(/[\\/:*?"<>|\r\n]/g, "") + "." + ext;
  return new Response(octets, { status: 200, headers: { "Content-Type": f.headers.get("Content-Type") ?? "application/octet-stream", "x-nom-fichier": encodeURIComponent(nom), "Cache-Control": "no-store" } });
});
