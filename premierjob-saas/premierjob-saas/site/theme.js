/* PremierJob : thème clair par défaut, sombre au choix.
   Chargé dans le <head> pour appliquer le choix avant l'affichage (pas de flash),
   puis ajoute un bouton soleil / lune dans la barre du haut. Le choix est gardé sur cet appareil. */
(function () {
  var CLE = "pj-theme", racine = document.documentElement;
  var SOLEIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var LUNE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function lire() { try { return localStorage.getItem(CLE); } catch (e) { return null; } }
  function sombre() { return racine.getAttribute("data-theme") === "dark"; }
  function appliquer(t) {
    if (t === "dark") racine.setAttribute("data-theme", "dark"); else racine.removeAttribute("data-theme");
    // Safari (iPhone) ne relit pas toujours la couleur de la barre du haut : on remplace la balise au lieu de la modifier.
    var ancien = document.querySelector('meta[name="theme-color"]'), m = document.createElement("meta");
    m.name = "theme-color"; m.content = t === "dark" ? "#07080a" : "#f8f7f4";
    if (ancien) ancien.parentNode.replaceChild(m, ancien); else document.head.appendChild(m);
  }
  // Après un changement, un défilement d'un pixel aller-retour oblige Safari à recalculer la couleur de la barre.
  function rafraichirBarre() {
    var y = window.scrollY, st = racine.style;
    st.scrollBehavior = "auto"; window.scrollTo(0, y + 1);
    setTimeout(function () { window.scrollTo(0, y); st.scrollBehavior = ""; }, 60);
  }
  appliquer(lire());

  function ajouterBouton() {
    var nav = document.querySelector(".navlinks");
    if (!nav || nav.querySelector(".theme-btn")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "theme-btn";
    function maj() {
      var s = sombre();
      b.innerHTML = s ? SOLEIL : LUNE;
      b.setAttribute("aria-label", s ? "Passer au mode clair" : "Passer au mode sombre");
      b.title = b.getAttribute("aria-label");
    }
    b.addEventListener("click", function () {
      var t = sombre() ? "light" : "dark";
      try { localStorage.setItem(CLE, t); } catch (e) {}
      appliquer(t);
      maj();
      rafraichirBarre();
    });
    maj();
    nav.appendChild(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ajouterBouton);
  else ajouterBouton();
})();
