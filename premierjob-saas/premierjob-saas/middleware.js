// PremierJob — hébergement Vercel : mêmes pages dynamiques que sur Netlify.
//   /o/<id>       aperçu de partage d'une offre (Open Graph + Google for Jobs)
//   /sitemap.xml  plan du site généré à partir des offres publiées
// On réutilise tel quel le code des fonctions Netlify (netlify/edge-functions),
// pour qu'il n'existe qu'une seule version de cette logique.
import offre from "./netlify/edge-functions/offre.js";
import sitemap from "./netlify/edge-functions/sitemap.js";

export const config = { matcher: ["/o/:path*", "/sitemap.xml"] };

export default function middleware(request) {
  return new URL(request.url).pathname === "/sitemap.xml" ? sitemap(request) : offre(request);
}
