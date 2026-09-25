# Cahier d'écolier

Plugin Obsidian qui habille l'éditeur (Live Preview / source, celui où tu
écris) en papier ligné bleu à marge rouge, avec une police manuscrite —
l'ambiance d'un cahier d'écolier, directement pendant que tu tapes. La vue
de lecture d'Obsidian n'est pas touchée par le plugin — un seul mode plutôt
que d'essayer de synchroniser deux affichages différents. Tout est réglable
en direct depuis les paramètres du plugin : couleurs, espacement des lignes,
position de la marge, police, taille du texte.

Par défaut, **aucune note ne l'a automatiquement** — tu choisis toi-même
lesquelles, avec le bouton dans la barre latérale gauche (icône livre ouvert)
qui bascule le cahier pour la note actuellement ouverte. Tu peux aussi
changer ce comportement dans les paramètres ("Notes concernées par défaut")
si tu préfères que toutes les notes l'aient sauf celles marquées
`cahier: false`.

## Installation manuelle

1. Copie tout le dossier `obsidian-cahier-ecolier` dans le dossier
   `<ton-coffre>/.obsidian/plugins/` de ton coffre Obsidian, en le renommant
   `cahier-ecolier` (garde `manifest.json`, `main.js`, `styles.css` et le
   dossier `fonts/`).
2. Dans Obsidian : *Paramètres → Plugins tiers*, désactive le mode sans
   échec si besoin, puis active **Cahier d'écolier** dans la liste.
3. Va dans les paramètres du plugin pour ajuster les couleurs, l'espacement
   des lignes et la police jusqu'à ce que le texte tombe pile sur les
   lignes.

## Développement

```bash
npm install
npm run dev     # watch + build en continu
npm run build   # build de production (main.js)
```

## Police

La police manuscrite "Patrick Hand" (Google Fonts, licence SIL Open Font
License) est embarquée dans `fonts/` — aucune connexion internet n'est
nécessaire pour l'afficher. Une option "police manuscrite du système" est
aussi disponible dans les paramètres si tu préfères une police déjà
installée sur ta machine.

## Pages et couverture (par note)

Désactivées par défaut. Le plus simple : ouvre la palette de commandes
(Ctrl/Cmd+P) et lance :

- **Activer / désactiver le cahier pour cette note** — bascule le look
  cahier (même chose que le bouton de la barre latérale).
- **Activer la pagination pour cette note** — découpe la note en feuilles
  séparées par un espace, avec une marge blanche (sans lignes) en haut et
  en bas de chaque feuille.
- **Ajouter une page de couverture à cette note (couleur)** — insère une
  couverture avant le contenu (couleur par défaut depuis les paramètres),
  avec un vrai saut de page avant que le texte commence. Sa hauteur
  correspond toujours à celle d'une page (lignes par page × espacement
  des lignes).
- **Choisir une image de couverture pour cette note (parcourir le coffre)**
  — même chose, mais ouvre un sélecteur listant les images du coffre
  (png/jpg/jpeg/gif/bmp/svg/webp/avif) au lieu d'une couleur.

Ces commandes remplissent le frontmatter pour toi. Tu peux aussi l'écrire
à la main si tu préfères :

```yaml
---
title: "Mon histoire"
cahier: true
cahier-paged: true
cahier-lines-per-page: 30
cahier-cover: true
cahier-cover-color: "#274472"
cahier-cover-image: "attachments/couverture.jpg"
cahier-cover-fit: contain
---
```

`cahier-lines-per-page` surcharge, pour cette note, le réglage global
"Lignes par page". `cahier-cover-image` (un chemin d'image du coffre, un
lien `[[...]]` ou une URL) est prioritaire sur `cahier-cover-color`. Le
titre affiché sur la couverture est la propriété `title` du frontmatter,
sinon le nom du fichier (une couverture-image n'affiche pas de titre).
`cahier-cover-fit` règle l'ajustement d'une couverture-image : `cover`
(par défaut, remplit en rognant), `contain` (image entière, marges
visibles) ou `stretch` (étirée pour remplir exactement).

Testé contre une vraie instance d'Obsidian (Electron piloté à distance) —
alignement du texte sur les lignes, couverture, pagination et bascule par
note vérifiés visuellement, pas seulement en théorie.
