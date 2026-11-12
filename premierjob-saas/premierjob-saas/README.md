# PremierJob Saguenay — mise en ligne en 30 minutes

Coût : 0 $. Outils : **Supabase** (base de données + connexion admin) et **Netlify** (hébergement).

```
premierjob-saas/
├── supabase/schema.sql   ← tables + règles de sécurité (à coller dans Supabase)
└── site/                 ← le dossier à mettre en ligne
    ├── index.html        ← offres publiques + inscription des étudiants
    ├── employeur.html    ← formulaire pour les employeurs
    ├── admin.html        ← ton tableau de bord (connexion requise)
    ├── config.js         ← LE SEUL fichier à modifier
    ├── common.js, styles.css, robots.txt
```

## Étape 1 — Créer la base Supabase (10 min)

1. Va sur **supabase.com** → *Start your project* → connecte-toi avec GitHub.
2. *New project* : nom `premierjob`, choisis un mot de passe de base de données (garde-le), région **Canada (Central)**.
3. Ouvre `supabase/schema.sql`. À la **dernière ligne**, remplace `ton-courriel@exemple.com` par **ton** courriel.
4. Dans Supabase : *SQL Editor* → *New query* → colle tout le fichier → **Run**. Tu dois voir « Success ».

### Base déjà créée? Lance la migration 002

Si ta base existait avant la refonte visuelle, colle aussi `supabase/migration-002-transport.sql` dans le *SQL Editor* et clique **Run**. Elle ajoute le moyen de transport des candidats. Sans elle, le site marche quand même, mais le transport n'est pas enregistré.

## Étape 2 — Créer ton compte admin (3 min)

1. *Authentication* → *Users* → *Add user* → *Create new user*.
2. Mets **le même courriel** qu'à l'étape 1.3, un mot de passe solide, coche *Auto Confirm User*.
3. *Authentication* → *Sign In / Providers* → désactive **Allow new users to sign up**.
   (Même si quelqu'un créait un compte, il ne verrait rien : seul un courriel présent dans la table `admins` a accès.)

## Étape 3 — Relier le site (2 min)

1. Supabase → *Project Settings* → *API* (ou *API Keys*).
2. Copie **Project URL** et la clé **anon public** (appelée *publishable* dans les nouveaux projets).
3. Colle-les dans `site/config.js`, avec ton courriel de contact et le nom du responsable Loi 25.

La clé anon est faite pour être publique. Ne mets **jamais** la clé `service_role` / `secret` dans le site.

## Étape 4 — Mettre en ligne sur Netlify (5 min)

1. Va sur **app.netlify.com/drop**.
2. Glisse le dossier **`site`** (pas le dossier parent) dans la page.
3. Tu obtiens une adresse du type `https://xxxx.netlify.app`. Crée un compte Netlify pour la garder, puis *Site configuration* → *Change site name* → `premierjob-saguenay`.
4. Dans Supabase → *Authentication* → *URL Configuration* → *Site URL* : colle ton adresse Netlify.

**Mettre à jour le site plus tard** : Netlify → ton site → *Deploys* → glisse à nouveau le dossier `site`.

## Étape 5 — Tester (5 min)

1. Ouvre `.../admin.html`, connecte-toi, clique **+ Nouvelle offre**, publie-la.
2. Ouvre la page d'accueil : l'offre apparaît. Inscris-toi avec un courriel de test.
3. Ouvre `.../employeur.html`, soumets une offre : elle arrive dans l'onglet **À valider**.
4. Onglet **Jumelage** : choisis l'offre, tu vois les candidats disponibles pendant ses horaires. Copie leurs courriels et envoie-leur l'offre en **Cci** depuis Gmail.

## Ce que fait la sécurité (déjà testée)

| Qui | Peut | Ne peut pas |
|---|---|---|
| Visiteur | Lire les offres publiées, s'inscrire, soumettre une offre | Voir les candidats, voir les coordonnées des employeurs, publier une offre lui-même |
| Compte connecté non admin | Rien de plus qu'un visiteur | Lire ou modifier quoi que ce soit d'autre |
| Toi (admin) | Tout : valider, publier, archiver, supprimer, exporter en CSV | — |

Autres protections : consentement obligatoire, courriel unique, champ piège anti-robots, longueurs limitées, page admin exclue de Google.

## Bon à savoir

- **Supabase gratuit met en pause un projet inactif depuis 7 jours.** Tant que des gens visitent le site, aucun souci. Sinon, va sur le tableau de bord Supabase et clique *Restore*.
- **Loi 25** : la politique est sur la page d'accueil. Si quelqu'un demande la suppression de ses données, onglet **Candidats** → *Supprimer*.
- **Statistiques gratuites (facultatif)** : crée un compte sur goatcounter.com et ajoute avant `</body>` de chaque page :
  `<script data-goatcounter="https://TONCODE.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`
  Les clics sur les offres et les inscriptions sont déjà envoyés à GoatCounter s'il est présent.
- **Nom de domaine** (plus tard, environ 15 $/an) : Netlify → *Domain management*.

## Les chiffres à suivre pendant 4 semaines

Inscriptions d'étudiants, offres soumises par des employeurs, candidats présentés, et entrevues obtenues. Si tu as environ 50 inscriptions et au moins un employeur qui embauche grâce à toi, tu as un vrai signal.
