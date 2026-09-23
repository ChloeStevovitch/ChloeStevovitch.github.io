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
