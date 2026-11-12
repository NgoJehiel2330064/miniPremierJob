// Code partagé par toutes les pages PremierJob.
(function () {
  const HORAIRES = { jour: "Jour", soirs: "Soirs", nuit: "Nuit", fds: "Fins de semaine", flexible: "Flexible" };
  const TYPES = ["Temps partiel", "Temps plein", "Stage", "Été"];
  const VILLES = ["Jonquière", "Chicoutimi", "La Baie"];
  const JOURS = [["lun", "Lun"], ["mar", "Mar"], ["mer", "Mer"], ["jeu", "Jeu"], ["ven", "Ven"], ["sam", "Sam"], ["dim", "Dim"]];
  const PERIODES = [["jour", "Jour"], ["soir", "Soir"], ["nuit", "Nuit"]];
  const ETABLISSEMENTS = ["Cégep de Jonquière", "Cégep de Chicoutimi", "UQAC", "École secondaire", "Nouvel arrivant", "Autre"];
  const HORAIRES_COURTS = { jour: "Jour", soirs: "Soir", nuit: "Nuit", fds: "FDS", flexible: "Flex" };
  const TRANSPORTS = { auto: "J'ai une auto", autobus: "Autobus", "pied-velo": "À pied ou à vélo" };

  // Teinte stable (0-359) tirée d'un texte : chaque secteur garde sa couleur d'icône.
  const teinte = (s) => { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initiale = (s) => (String(s || "?").trim()[0] || "?").toUpperCase();

  // Insère une ligne. Si une colonne récente n'existe pas encore dans Supabase
  // (migration pas encore exécutée), on réessaie sans ces colonnes.
  async function insererAvecRepli(table, row, colonnesRecentes) {
    const sb = client();
    let r = await sb.from(table).insert(row);
    const manque = r.error && (r.error.code === "42703" || r.error.code === "PGRST204" || /column/i.test(r.error.message || ""));
    if (manque && colonnesRecentes && colonnesRecentes.some((c) => c in row)) {
      const copie = { ...row };
      colonnesRecentes.forEach((c) => delete copie[c]);
      r = await sb.from(table).insert(copie);
    }
    return r;
  }
  // Colonnes que le public a le droit de lire (voir schema.sql).
  const OFFRE_PUBLIQUE = "id,titre,employeur,ville,lieu,secteur,type,horaires,salaire,description,lien,confirme,statut,verifie_le,publiee_le,date_debut,qualification,nb_postes,creneaux_obligatoires,creneaux_souhaites,candidature_externe";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" }) : "");
  const today = () => new Date().toLocaleDateString("en-CA");
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

  function client() {
    const c = window.PJ_CONFIG || {};
    if (!c.supabaseUrl || c.supabaseUrl.includes("VOTRE-PROJET") || !c.supabaseAnonKey || c.supabaseAnonKey.includes("VOTRE-CLE")) {
      throw new Error("config");
    }
    if (!window.supabase || !window.supabase.createClient) throw new Error("lib");
    if (!window.__pjClient) window.__pjClient = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
    return window.__pjClient;
  }

  function configMessage(err) {
    if (err && err.message === "config") return "Le site n'est pas encore relié à Supabase : remplis supabaseUrl et supabaseAnonKey dans config.js.";
    if (err && err.message === "lib") return "La bibliothèque Supabase n'a pas pu se charger. Vérifie ta connexion.";
    return "Une erreur est survenue. Réessaie dans un moment.";
  }

  // Créneaux couverts par les horaires d'une offre.
  function creneauxOffre(horaires) {
    const s = new Set();
    const semaine = ["lun", "mar", "mer", "jeu", "ven"];
    (horaires || []).forEach((h) => {
      if (h === "jour") semaine.forEach((j) => s.add(j + "-jour"));
      if (h === "soirs") semaine.forEach((j) => s.add(j + "-soir"));
      if (h === "nuit") JOURS.forEach(([j]) => s.add(j + "-nuit"));
      if (h === "fds") ["sam", "dim"].forEach((j) => { s.add(j + "-jour"); s.add(j + "-soir"); });
      if (h === "flexible") JOURS.forEach(([j]) => PERIODES.forEach(([p]) => s.add(j + "-" + p)));
    });
    return s;
  }

  // Score de compatibilité candidat ↔ offre.
  function jumeler(offre, candidat) {
    const slots = creneauxOffre(offre.horaires);
    const communs = (candidat.dispos || []).filter((d) => slots.has(d));
    const typeOk = !candidat.types || candidat.types.length === 0 || candidat.types.includes(offre.type);
    const villeOk = !candidat.ville || candidat.ville === "Peu importe" || candidat.ville === offre.ville;
    return { communs, typeOk, villeOk, score: communs.length + (typeOk ? 5 : 0) + (villeOk ? 3 : 0) };
  }

  // Bouton à bascule réutilisable.
  function chip(label, pressed, onToggle) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.addEventListener("click", () => onToggle(b));
    return b;
  }

  // Grille de disponibilités : renvoie un Set mis à jour au clic.
  function grilleDispos(table, initial) {
    const dispo = new Set(initial || []);
    table.innerHTML = "<tr><th></th>" + JOURS.map(([, l]) => `<th scope="col">${l}</th>`).join("") + "</tr>";
    PERIODES.forEach(([p, pl]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row">${pl}</th>`;
      JOURS.forEach(([j, jl]) => {
        const k = j + "-" + p;
        const td = document.createElement("td");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "slot"; b.dataset.k = k;
        b.setAttribute("aria-label", `${jl} ${pl.toLowerCase()}`);
        const sync = () => { const on = dispo.has(k); b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "✓" : ""; };
        b.addEventListener("click", () => { dispo.has(k) ? dispo.delete(k) : dispo.add(k); sync(); });
        sync();
        td.appendChild(b);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    return dispo;
  }

  function track(path) {
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path, event: true }); } catch (e) { /* stats facultatives */ }
  }

  // ----- CV -----
  const CV_TYPES = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"
  };
  const CV_MAX = 5 * 1024 * 1024;
  function verifierCV(f) {
    if (!f) return "";
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!CV_TYPES[f.type] && !["pdf", "doc", "docx"].includes(ext)) return "Ton CV doit être un PDF ou un document Word.";
    if (f.size > CV_MAX) return "Ton CV dépasse 5 Mo. Exporte-le en PDF, il sera plus léger.";
    return "";
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // Dépose le CV dans le stockage privé et renvoie son chemin (nom aléatoire, jamais le nom de la personne).
  async function deposerCV(f) {
    const ext = CV_TYPES[f.type] || (f.name.split(".").pop() || "pdf").toLowerCase();
    const type = Object.keys(CV_TYPES).find((k) => CV_TYPES[k] === ext) || "application/pdf";
    const chemin = uuid() + "." + ext;
    const { error } = await client().storage.from("cvs").upload(chemin, f, { contentType: type, upsert: false });
    if (error) throw error;
    return chemin;
  }


  // ----- Règle « aucune expérience exigée » (miroir de pj_experience_exigee côté base) -----
  const PAT_EXIGE = [
    /((\d+|un|une|deux|trois|quatre|cinq|six)\s*\+?\s*(an|ans|année|années|annee|annees|mois)\s+(minimum\s+|au moins\s+)?(d'|d\s+|de\s+)?\s*(exp[eé]rience|exp(?![\p{L}])))/u,
    /(exp[eé]rience\s+(de\s+|d'|minimum\s+|minimale\s+de\s+|d'au moins\s+|d'un minimum de\s+)?(\d+|un|une|deux|trois|quatre|cinq|six)\s*(an|ans|année|années|annee|annees|mois)(?![\p{L}]))/u,
    /((?<!aucune )(?<!sans )(?<!pas d')(?<!pas de )exp[eé]rience\s+((professionnelle|pr[eé]alable|pertinente|minimale|similaire|dans le domaine|en [\p{L}_]+)\s+)?(obligatoire|exig[eé]e|essentielle|indispensable))/u,
    /(\d+\s*\+?\s*(years?|yrs?)\s+(of\s+)?(relevant\s+)?experience)/u
  ];
  const norm = (t) => String(t || "").toLowerCase().replace(/’/g, "'");
  function experienceExigee(t) {
    const s = norm(t);
    for (const p of PAT_EXIGE) { const m = s.match(p); if (m) return m[1]; }
    return null;
  }
  function experienceMentionnee(t) {
    let s = norm(t);
    s = s.replace(/(aucune|sans|pas d'|pas de)\s*([\p{L}_]+\s+)?exp[eé]rience(\s+(professionnelle|pr[eé]alable|requise|exig[eé]e|n[eé]cessaire|obligatoire))*/gu, " ");
    s = s.replace(/exp[eé]rience\s+(non|pas)\s+(requise|exig[eé]e|n[eé]cessaire|obligatoire)/gu, " ");
    s = s.replace(/no experience( required| needed)?/g, " ");
    return /(exp[eé]rience|experience)/.test(s);
  }
  // Message lisible pour les erreurs renvoyées par la base (codes PJ_…)
  function messageErreur(err, defaut) {
    const m = (err && err.message) || "";
    const pj = m.match(/PJ_[A-Z]+:\s*(.*)$/);
    if (pj) return pj[1];
    if (err && err.code === "23505") return "Cette information existe déjà.";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "Pas de connexion Internet. Vérifie ton réseau, puis réessaie : rien n'a été perdu.";
    return defaut || "Une erreur est survenue. Réessaie dans un moment.";
  }

  // ----- Statuts -----
  const OFFRE_STATUTS = { pending: "À valider", published: "Publiée", paused: "Suspendue", closed: "Fermée", rejected: "Refusée" };
  const CAND_STATUTS = { received: "Reçue", intent: "Intention", declared: "Déclarée", forwarded: "Transmise", interview: "Entrevue", hired: "Embauché", rejected: "Non retenue", withdrawn: "Retirée" };
  const RESULTATS_DECLARES = { pas_encore: "pas encore envoyée", sans_nouvelles: "sans nouvelles", appele: "dit avoir été appelé(e)", embauche: "dit avoir été embauché(e)" };
  // Même règle que la base (pj_lien_concurrent) : jamais de renvoi vers une autre plateforme d'emploi
  const lienConcurrent = (u) => /^https?:\/\/([a-z0-9-]+\.)*(indeed|jobillico|jobboom|glassdoor|monster|workopolis|ziprecruiter|linkedin|talent|simplyhired|neuvoo|jooble|careerbeacon|eluta)\.[a-z.]+(\/|\?|#|$)/i.test(u || "");
  // Lien vers le formulaire de l'employeur, étiqueté PremierJob (sans effet si son site ne le lit pas)
  function lienEtiquete(u) {
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return null; if (!x.searchParams.has("utm_source")) { x.searchParams.set("utm_source", "premierjob"); x.searchParams.set("utm_medium", "referral"); } return x.toString(); } catch (e) { return null; }
  }

  // ----- Horaires du poste : grille à 3 états (vide → Requis → Idéal → vide) -----
  function grilleOffre(table, oblig, souh) {
    const O = new Set(oblig || []), S = new Set(souh || []);
    table.innerHTML = "<tr><th></th>" + JOURS.map(([, l]) => `<th scope="col">${l}</th>`).join("") + "</tr>";
    PERIODES.forEach(([p, pl]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row">${pl}</th>`;
      JOURS.forEach(([j, jl]) => {
        const k = j + "-" + p, td = document.createElement("td"), b = document.createElement("button");
        b.type = "button"; b.className = "slot";
        const sync = () => {
          const etat = O.has(k) ? "req" : S.has(k) ? "ideal" : "";
          b.dataset.etat = etat; b.setAttribute("aria-pressed", etat ? "true" : "false");
          b.textContent = etat === "req" ? "R" : etat === "ideal" ? "I" : "";
          b.setAttribute("aria-label", `${jl} ${pl.toLowerCase()} : ${etat === "req" ? "requis" : etat === "ideal" ? "idéal" : "non travaillé"}`);
        };
        b.addEventListener("click", () => {
          if (O.has(k)) { O.delete(k); S.add(k); } else if (S.has(k)) { S.delete(k); } else { O.add(k); }
          sync();
        });
        sync(); td.appendChild(b); tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    return { O, S };
  }
  // Grille en lecture seule (page publique, dossier admin)
  function grilleLecture(oblig, souh, dispos) {
    const O = new Set(oblig || []), S = new Set(souh || []), D = dispos ? new Set(dispos) : null;
    if (!O.size && !S.size) return "";
    const lignes = PERIODES.filter(([p]) => JOURS.some(([j]) => O.has(j + "-" + p) || S.has(j + "-" + p)));
    return `<table class="glect"><tr><th></th>${JOURS.map(([, l]) => `<th>${l}</th>`).join("")}</tr>` +
      lignes.map(([p, pl]) => `<tr><th>${pl}</th>${JOURS.map(([j]) => {
        const k = j + "-" + p, e = O.has(k) ? "req" : S.has(k) ? "ideal" : "";
        const manque = D && e === "req" && !D.has(k) ? " manque" : "";
        return `<td><span class="g ${e}${manque}">${e === "req" ? "R" : e === "ideal" ? "I" : ""}</span></td>`;
      }).join("")}</tr>`).join("") + "</table>";
  }

  // ----- Jumelage (règles simples, l'admin garde la décision) -----
  function jumelerV2(offre, cand) {
    const D = new Set(cand.dispos || []);
    let O = offre.creneaux_obligatoires || [], S = offre.creneaux_souhaites || [];
    if (!O.length && !S.length) S = [...creneauxOffre(offre.horaires)];
    const manquants = O.filter((k) => !D.has(k));
    const couverts = S.filter((k) => D.has(k)).length + (O.length - manquants.length);
    const aucuneDispo = D.size === 0;
    const compatible = !aucuneDispo && manquants.length === 0 && (O.length > 0 || couverts > 0);
    const villeOk = !cand.ville || cand.ville === "Peu importe" || cand.ville === offre.ville;
    const deplacement = !villeOk && cand.transport === "pied-velo" ? "Autre ville et sans auto : déplacement à vérifier" : !villeOk ? "Habite une autre ville" : "";
    const typeOk = !cand.types || !cand.types.length || cand.types.includes(offre.type);
    return { compatible, aucuneDispo, manquants, couverts, villeOk, deplacement, typeOk,
             score: (compatible ? 100 : 0) + couverts * 2 + (villeOk ? 5 : 0) + (typeOk ? 3 : 0) - manquants.length * 10 };
  }
  const nomCreneau = (k) => { const [j, p] = k.split("-"); const jl = (JOURS.find((x) => x[0] === j) || [, j])[1]; const pl = (PERIODES.find((x) => x[0] === p) || [, p])[1]; return jl + " " + pl.toLowerCase(); };

  // Statistiques GoatCounter : chargées seulement si un code est configuré (pas sur la page admin).
  (function chargerStats() {
    const code = (window.PJ_CONFIG || {}).goatcounter;
    if (!code || !/^[a-z0-9-]+$/i.test(code) || /admin\.html$/.test(location.pathname)) return;
    const s = document.createElement("script");
    s.async = true; s.src = "https://gc.zgo.at/count.js";
    s.dataset.goatcounter = "https://" + code + ".goatcounter.com/count";
    document.head.appendChild(s);
  })();

  window.PJ = { RESULTATS_DECLARES, lienConcurrent, lienEtiquete, experienceExigee, experienceMentionnee, messageErreur, OFFRE_STATUTS, CAND_STATUTS, grilleOffre, grilleLecture, jumelerV2, nomCreneau, uuid, verifierCV, deposerCV, HORAIRES, HORAIRES_COURTS, TRANSPORTS, teinte, initiale, insererAvecRepli, TYPES, VILLES, JOURS, PERIODES, ETABLISSEMENTS, OFFRE_PUBLIQUE, esc, fmtDate, today, safeUrl, client, configMessage, creneauxOffre, jumeler, chip, grilleDispos, track };
})();
