# Cahier d'écolier

Plugin Obsidian qui habille l'éditeur (et, si tu veux, la vue de lecture) en
papier ligné bleu à marge rouge, avec une police manuscrite — l'ambiance d'un
cahier d'écolier. Tout est réglable en direct depuis les paramètres du
plugin : couleurs, espacement des lignes, position de la marge, police,
taille du texte.

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

Désactivées par défaut pour ne pas s'imposer à toutes tes notes — tu les
actives note par note via le frontmatter (YAML en haut du fichier) :

```yaml
---
title: "Mon histoire"
cahier-paged: true
cahier-lines-per-page: 30
cahier-cover: true
cahier-cover-color: "#274472"
cahier-cover-image: "attachments/couverture.jpg"
---
```

- `cahier-paged: true` — découpe la note en feuilles séparées par un espace,
  avec une marge blanche (sans lignes) en haut et en bas de chaque feuille.
  Ne s'applique qu'à l'éditeur (source / édition en direct), pas à la vue de
  lecture. `cahier-lines-per-page` surcharge, pour cette note, le réglage
  global "Lignes par page".
- `cahier-cover: true` — ajoute une page de couverture avant le contenu, en
  éditeur comme en vue de lecture. `cahier-cover-image` (un chemin d'image
  du coffre, un lien `[[...]]` ou une URL) est prioritaire sur
  `cahier-cover-color`. Le titre affiché est la propriété `title` du
  frontmatter, sinon le nom du fichier.

Comme je ne peux pas prévisualiser Obsidian moi-même, ces deux réglages sont
volontairement gardés simples pour une première version — dis-moi ce qu'il
faut ajuster une fois testé en vrai (positions, tailles, comportement).
