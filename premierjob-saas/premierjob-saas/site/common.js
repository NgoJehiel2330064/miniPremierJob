// Code partagé par toutes les pages PremierJob.
(function () {
  const HORAIRES = { jour: "Jour", soirs: "Soirs", fds: "Fins de semaine", flexible: "Flexible" };
  const TYPES = ["Temps partiel", "Temps plein", "Stage", "Été"];
  const VILLES = ["Jonquière", "Chicoutimi", "La Baie"];
  const JOURS = [["lun", "Lun"], ["mar", "Mar"], ["mer", "Mer"], ["jeu", "Jeu"], ["ven", "Ven"], ["sam", "Sam"], ["dim", "Dim"]];
  const PERIODES = [["jour", "Jour"], ["soir", "Soir"]];
  const ETABLISSEMENTS = ["Cégep de Jonquière", "Cégep de Chicoutimi", "UQAC", "École secondaire", "Nouvel arrivant", "Autre"];
  // Colonnes que le public a le droit de lire (voir schema.sql).
  const OFFRE_PUBLIQUE = "id,titre,employeur,ville,secteur,type,horaires,salaire,description,lien,confirme,statut,verifie_le";

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
        b.className = "slot";
        b.setAttribute("aria-label", `${jl} ${pl.toLowerCase()}`);
        const sync = () => { const on = dispo.has(k); b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "Oui" : "—"; };
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

  window.PJ = { HORAIRES, TYPES, VILLES, JOURS, PERIODES, ETABLISSEMENTS, OFFRE_PUBLIQUE, esc, fmtDate, today, safeUrl, client, configMessage, creneauxOffre, jumeler, chip, grilleDispos, track };
})();
