// PremierJob — hébergement Vercel : mêmes pages dynamiques que sur Netlify.
//   /o/<id>       aperçu de partage d'une offre (Open Graph + Google for Jobs)
//   /sitemap.xml  plan du site généré à partir des offres publiées
//   /emplois, /emplois/<ville>, /emploi-etudiant  pages de référencement (liste des offres)
// On réutilise tel quel le code des fonctions Netlify (netlify/edge-functions),
// pour qu'il n'existe qu'une seule version de cette logique.
import offre from "./netlify/edge-functions/offre.js";
import sitemap from "./netlify/edge-functions/sitemap.js";
import liste from "./netlify/edge-functions/liste.js";

export const config = { matcher: ["/o/:path*", "/sitemap.xml", "/emplois", "/emplois/:path*", "/emploi-etudiant"] };

export default function middleware(request) {
  const p = new URL(request.url).pathname;
  if (p === "/sitemap.xml") return sitemap(request);
  if (p.startsWith("/o/")) return offre(request);
  return liste(request);
}
