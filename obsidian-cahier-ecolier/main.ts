import { App, MarkdownView, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, Text } from "@codemirror/state";

type FontChoice = "patrick-hand" | "system-cursive";

interface CahierSettings {
	enabled: boolean;
	applyToEditor: boolean;
	applyToReadingView: boolean;
	paperColor: string;
	lineColor: string;
	marginColor: string;
	textColor: string;
	lineHeight: number; // px, distance between two ruled lines
	baselineOffset: number; // px, distance from top of content to the first rule
	marginPosition: number; // px, distance of the red margin from the left edge
	paperWidth: number; // px, width of the paper sheet itself (wider than the text, narrower than the page)
	paperSideMargin: number; // px, blank unruled margin on each side of the ruled lines
	fontChoice: FontChoice;
	fontSize: number; // px

	// Pagination — off by default, turned on per note via frontmatter (cahier-paged: true)
	linesPerPage: number;
	pageMargin: number; // px, blank unruled margin at the top/bottom of each sheet
	pageGapSize: number; // px, visible empty gap between two sheets

	// Cover page — off by default, turned on per note via frontmatter (cahier-cover: true)
	coverColor: string; // fallback colour when the note doesn't set cahier-cover-color
	coverHeight: number; // px, fixed height — CodeMirror needs a stable, non-dynamic height to keep a block widget from misbehaving during scroll
}

const DEFAULT_SETTINGS: CahierSettings = {
	enabled: true,
	applyToEditor: true,
	applyToReadingView: true,
	paperColor: "#faf5e9",
	lineColor: "#a9c8e8",
	marginColor: "#e08585",
	textColor: "#2b3a55",
	lineHeight: 30,
	baselineOffset: 24,
	marginPosition: 48,
	paperWidth: 820,
	paperSideMargin: 20,
	fontChoice: "patrick-hand",
	fontSize: 17,

	linesPerPage: 25,
	pageMargin: 24,
	pageGapSize: 40,

	coverColor: "#274472",
	coverHeight: 480,
};

const FONT_STACKS: Record<FontChoice, string> = {
	"patrick-hand": `"Cahier Ecolier Patrick Hand", "Patrick Hand", cursive`,
	"system-cursive": `"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`,
};

// ---- Sauts de page (éditeur uniquement — CodeMirror 6) ----

interface PagingConf {
	enabled: boolean;
	linesPerPage: number;
	startLine: number; // 1-indexed doc line where pagination starts counting (after any frontmatter)
}

const setPaging = StateEffect.define<PagingConf>();

// Le frontmatter (--- ... ---) ne doit compter ni pour la pagination ni
// porter la couverture : elle doit s'afficher juste après.
function frontmatterEndLine(doc: Text): number {
	if (doc.lines < 1 || doc.line(1).text.trim() !== "---") return 0;
	for (let ln = 2; ln <= doc.lines; ln++) {
		if (doc.line(ln).text.trim() === "---") return ln;
	}
	return 0;
}

class PageGapWidget extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		const div = document.createElement("div");
		div.className = "cahier-page-gap";
		return div;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

function buildPageBreaks(doc: Text, linesPerPage: number, startLine: number): DecorationSet {
	if (linesPerPage < 1) return Decoration.none;
	const widgets = [];
	const total = doc.lines;
	for (let ln = startLine + linesPerPage; ln < total; ln += linesPerPage) {
		const line = doc.line(ln);
		widgets.push(Decoration.widget({ widget: new PageGapWidget(), side: 1, block: true }).range(line.to));
	}
	return Decoration.set(widgets, true);
}

const pagingField = StateField.define<{ conf: PagingConf; deco: DecorationSet }>({
	create() {
		return { conf: { enabled: false, linesPerPage: 25, startLine: 0 }, deco: Decoration.none };
	},
	update(value, tr) {
		let conf = value.conf;
		let confChanged = false;
		for (const e of tr.effects) {
			if (e.is(setPaging)) {
				conf = e.value;
				confChanged = true;
			}
		}
		if (!conf.enabled) return { conf, deco: Decoration.none };
		if (tr.docChanged || confChanged) {
			return { conf, deco: buildPageBreaks(tr.state.doc, conf.linesPerPage, conf.startLine) };
		}
		return { conf, deco: value.deco.map(tr.changes) };
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// ---- Page de couverture (éditeur — CodeMirror 6, et vue de lecture — DOM direct) ----

interface CoverConf {
	enabled: boolean;
	title: string;
	color: string;
	image: string | null;
	pos: number; // doc offset to insert at — after any frontmatter, so it isn't split across it
	height: number; // px — fixed, so CodeMirror can measure the block reliably during scroll
}

const setCover = StateEffect.define<CoverConf>();

class CoverWidget extends WidgetType {
	constructor(private conf: CoverConf) {
		super();
	}
	eq(other: CoverWidget): boolean {
		return (
			other.conf.title === this.conf.title &&
			other.conf.color === this.conf.color &&
			other.conf.image === this.conf.image &&
			other.conf.height === this.conf.height
		);
	}
	toDOM(): HTMLElement {
		return buildCoverEl(this.conf);
	}
	ignoreEvent(): boolean {
		return false;
	}
}

function buildCoverEl(conf: CoverConf): HTMLElement {
	const div = document.createElement("div");
	div.className = "cahier-cover-page";
	// Hauteur fixe posée en style inline (pas en CSS aspect-ratio/vh) : CodeMirror
	// a besoin de connaître la hauteur du widget de façon stable et synchrone pour
	// bien le gérer pendant le défilement (virtualisation).
	div.style.height = `${conf.height}px`;
	if (conf.image) {
		div.style.backgroundImage = `url("${conf.image.replace(/"/g, '\\"')}")`;
	} else {
		div.style.backgroundColor = conf.color;
	}
	const title = document.createElement("div");
	title.className = "cahier-cover-title";
	title.textContent = conf.title;
	div.appendChild(title);
	return div;
}

const coverField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(deco, tr) {
		for (const e of tr.effects) {
			if (e.is(setCover)) {
				if (!e.value.enabled) return Decoration.none;
				return Decoration.set([
					Decoration.widget({ widget: new CoverWidget(e.value), side: -1, block: true }).range(e.value.pos),
				]);
			}
		}
		return deco.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

export default class CahierEcolierPlugin extends Plugin {
	settings: CahierSettings;
	private lastConfKeys = new WeakMap<EditorView, string>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CahierEcolierSettingTab(this.app, this));
		this.registerEditorExtension([pagingField, coverField]);
		this.applyStyles();

		this.addCommand({
			id: "toggle-cahier-ecolier",
			name: "Activer / désactiver le cahier d'écolier",
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				this.applyStyles();
			},
		});

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateActiveFileFeatures()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.updateActiveFileFeatures()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.updateActiveFileFeatures()));
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file === this.app.workspace.getActiveFile()) this.updateActiveFileFeatures();
			})
		);
		this.app.workspace.onLayoutReady(() => this.updateActiveFileFeatures());
	}

	onunload() {
		document.body.classList.remove(
			"cahier-ecolier-enabled",
			"cahier-ecolier-editor",
			"cahier-ecolier-reading",
			"cahier-ecolier-paged",
			"cahier-ecolier-cover"
		);
		document.querySelectorAll(".cahier-cover-page").forEach((el) => el.remove());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	applyStyles() {
		const body = document.body;
		const s = this.settings;

		body.classList.toggle("cahier-ecolier-enabled", s.enabled);
		body.classList.toggle("cahier-ecolier-editor", s.enabled && s.applyToEditor);
		body.classList.toggle("cahier-ecolier-reading", s.enabled && s.applyToReadingView);

		body.style.setProperty("--cahier-paper", s.paperColor);
		body.style.setProperty("--cahier-line-color", s.lineColor);
		body.style.setProperty("--cahier-margin-color", s.marginColor);
		body.style.setProperty("--cahier-text-color", s.textColor);
		body.style.setProperty("--cahier-line-height", `${s.lineHeight}px`);
		body.style.setProperty("--cahier-baseline-offset", `${s.baselineOffset}px`);
		body.style.setProperty("--cahier-margin-position", `${s.marginPosition}px`);
		body.style.setProperty("--cahier-paper-width", `${s.paperWidth}px`);
		body.style.setProperty("--cahier-paper-side-margin", `${s.paperSideMargin}px`);
		body.style.setProperty("--cahier-font-family", FONT_STACKS[s.fontChoice]);
		body.style.setProperty("--cahier-font-size", `${s.fontSize}px`);
		body.style.setProperty("--cahier-page-margin", `${s.pageMargin}px`);
		body.style.setProperty("--cahier-page-gap-size", `${s.pageGapSize}px`);

		this.updateActiveFileFeatures();
	}

	private getCm(): EditorView | undefined {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// L'API publique d'Obsidian n'expose pas l'EditorView CodeMirror 6 sous-jacent ;
		// `editor.cm` est un accès non documenté mais stable, utilisé par de nombreux plugins.
		return (mdView?.editor as unknown as { cm?: EditorView })?.cm;
	}

	private resolveImagePath(raw: string): string {
		const clean = raw.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0];
		if (/^https?:\/\//.test(clean)) return clean;
		const activePath = this.app.workspace.getActiveFile()?.path || "";
		const dest = this.app.metadataCache.getFirstLinkpathDest(clean, activePath);
		if (dest instanceof TFile) return this.app.vault.adapter.getResourcePath(dest.path);
		return clean;
	}

	updateActiveFileFeatures() {
		if (!this.settings.enabled) return;
		const file = this.app.workspace.getActiveFile();
		const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;

		const coverEnabled = !!fm?.["cahier-cover"];
		const title = (fm?.title as string) || file?.basename || "";
		const color = (fm?.["cahier-cover-color"] as string) || this.settings.coverColor;
		const imageRaw = fm?.["cahier-cover-image"] as string | undefined;
		const image = imageRaw ? this.resolveImagePath(imageRaw) : null;

		const paged = !!fm?.["cahier-paged"];
		const linesPerPage = Number(fm?.["cahier-lines-per-page"]) || this.settings.linesPerPage;

		document.body.classList.toggle("cahier-ecolier-cover", coverEnabled);
		document.body.classList.toggle("cahier-ecolier-paged", paged);

		const cm = this.getCm();
		let coverPos = 0;
		let startLine = 0;
		if (cm) {
			const doc = cm.state.doc;
			const fmEndLine = frontmatterEndLine(doc);
			startLine = fmEndLine;
			if (fmEndLine > 0) {
				const line = doc.line(fmEndLine);
				coverPos = Math.min(line.to + 1, doc.length);
			}
		}
		const coverConf: CoverConf = {
			enabled: coverEnabled,
			title,
			color,
			image,
			pos: coverPos,
			height: this.settings.coverHeight,
		};
		const pagingConf: PagingConf = { enabled: paged, linesPerPage, startLine };

		if (cm) {
			// Évite de redispatcher (et donc de reconstruire le widget) quand rien n'a
			// changé — "layout-change" se déclenche pour toutes sortes de raisons.
			const key = JSON.stringify([coverConf, pagingConf]);
			if (this.lastConfKeys.get(cm) !== key) {
				this.lastConfKeys.set(cm, key);
				cm.dispatch({ effects: [setCover.of(coverConf), setPaging.of(pagingConf)] });
			}
		}

		this.renderReadingCover(coverConf);
	}

	private renderReadingCover(conf: CoverConf) {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sizer = mdView?.contentEl?.querySelector(".markdown-preview-sizer") as HTMLElement | null;
		if (!sizer) return;
		const existing = sizer.querySelector(":scope > .cahier-cover-page");
		if (!conf.enabled) {
			existing?.remove();
			return;
		}
		const fresh = buildCoverEl(conf);
		if (existing) {
			existing.replaceWith(fresh);
			return;
		}
		// Insère après le bloc de propriétés (Properties) rendu par Obsidian s'il y en a un,
		// pour ne pas passer devant le frontmatter.
		const metadata = sizer.querySelector(":scope > .metadata-container");
		if (metadata) metadata.insertAdjacentElement("afterend", fresh);
		else sizer.insertBefore(fresh, sizer.firstChild);
	}
}

class CahierEcolierSettingTab extends PluginSettingTab {
	plugin: CahierEcolierPlugin;

	constructor(app: App, plugin: CahierEcolierPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		containerEl.createEl("h2", { text: "Cahier d'écolier" });
		containerEl.createEl("p", {
			text: "Papier ligné bleu à marge rouge et police manuscrite, pour retrouver l'ambiance d'un cahier d'écolier.",
		});

		new Setting(containerEl)
			.setName("Activer")
			.setDesc("Bascule l'habillage cahier d'écolier.")
			.addToggle((t) =>
				t.setValue(s.enabled).onChange(async (v) => {
					s.enabled = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		new Setting(containerEl)
			.setName("Appliquer à l'éditeur")
			.addToggle((t) =>
				t.setValue(s.applyToEditor).onChange(async (v) => {
					s.applyToEditor = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		new Setting(containerEl)
			.setName("Appliquer à la vue de lecture")
			.addToggle((t) =>
				t.setValue(s.applyToReadingView).onChange(async (v) => {
					s.applyToReadingView = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		containerEl.createEl("h3", { text: "Couleurs" });

		new Setting(containerEl)
			.setName("Couleur du papier")
			.addColorPicker((c) =>
				c.setValue(s.paperColor).onChange(async (v) => {
					s.paperColor = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		new Setting(containerEl)
			.setName("Couleur des lignes")
			.addColorPicker((c) =>
				c.setValue(s.lineColor).onChange(async (v) => {
					s.lineColor = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		new Setting(containerEl)
			.setName("Couleur de la marge")
			.addColorPicker((c) =>
				c.setValue(s.marginColor).onChange(async (v) => {
					s.marginColor = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		new Setting(containerEl)
			.setName("Couleur du texte")
			.addColorPicker((c) =>
				c.setValue(s.textColor).onChange(async (v) => {
					s.textColor = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		containerEl.createEl("h3", { text: "Grille" });
		containerEl.createEl("p", {
			text: "Ajustez ces valeurs jusqu'à ce que le texte tombe pile sur les lignes.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Espacement des lignes")
			.setDesc(`${s.lineHeight}px`)
			.addSlider((sl) =>
				sl
					.setLimits(20, 48, 1)
					.setValue(s.lineHeight)
					.onChange(async (v) => {
						s.lineHeight = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Décalage de la première ligne")
			.setDesc(`${s.baselineOffset}px`)
			.addSlider((sl) =>
				sl
					.setLimits(0, 60, 1)
					.setValue(s.baselineOffset)
					.onChange(async (v) => {
						s.baselineOffset = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Position de la marge rouge")
			.setDesc(`${s.marginPosition}px depuis le bord gauche`)
			.addSlider((sl) =>
				sl
					.setLimits(0, 160, 1)
					.setValue(s.marginPosition)
					.onChange(async (v) => {
						s.marginPosition = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		containerEl.createEl("h3", { text: "Papier" });
		containerEl.createEl("p", {
			text: "Le papier est plus large que le texte, mais moins large que la page — au-delà, le fond reste celui d'Obsidian.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Largeur du papier")
			.setDesc(`${s.paperWidth}px`)
			.addSlider((sl) =>
				sl
					.setLimits(400, 1400, 10)
					.setValue(s.paperWidth)
					.onChange(async (v) => {
						s.paperWidth = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Marge blanche (sans lignes)")
			.setDesc(`${s.paperSideMargin}px de chaque côté des lignes bleues`)
			.addSlider((sl) =>
				sl
					.setLimits(0, 120, 1)
					.setValue(s.paperSideMargin)
					.onChange(async (v) => {
						s.paperSideMargin = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		containerEl.createEl("h3", { text: "Texte" });

		new Setting(containerEl)
			.setName("Police")
			.addDropdown((d) =>
				d
					.addOption("patrick-hand", "Patrick Hand (manuscrite, fournie)")
					.addOption("system-cursive", "Police manuscrite du système")
					.setValue(s.fontChoice)
					.onChange(async (v) => {
						s.fontChoice = v as FontChoice;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
					})
			);

		new Setting(containerEl)
			.setName("Taille du texte")
			.setDesc(`${s.fontSize}px`)
			.addSlider((sl) =>
				sl
					.setLimits(14, 24, 1)
					.setValue(s.fontSize)
					.onChange(async (v) => {
						s.fontSize = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		containerEl.createEl("h3", { text: "Pages (par note)" });
		containerEl.createEl("p", {
			text: "Désactivé par défaut. Pour découper une note en feuilles séparées par un espace, ajoute `cahier-paged: true` dans son frontmatter (optionnellement `cahier-lines-per-page: 30` pour surcharger la valeur ci-dessous pour cette note). Ne s'applique qu'à l'éditeur, pas à la vue de lecture.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Lignes par page")
			.setDesc(`${s.linesPerPage} lignes`)
			.addSlider((sl) =>
				sl
					.setLimits(10, 60, 1)
					.setValue(s.linesPerPage)
					.onChange(async (v) => {
						s.linesPerPage = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Marge blanche haut/bas de chaque feuille")
			.setDesc(`${s.pageMargin}px`)
			.addSlider((sl) =>
				sl
					.setLimits(0, 80, 1)
					.setValue(s.pageMargin)
					.onChange(async (v) => {
						s.pageMargin = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Espace entre les feuilles")
			.setDesc(`${s.pageGapSize}px`)
			.addSlider((sl) =>
				sl
					.setLimits(0, 160, 1)
					.setValue(s.pageGapSize)
					.onChange(async (v) => {
						s.pageGapSize = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		containerEl.createEl("h3", { text: "Page de couverture (par note)" });
		containerEl.createEl("p", {
			text: "Désactivée par défaut. Pour ajouter une couverture avant le contenu, ajoute `cahier-cover: true` dans le frontmatter de la note, avec `cahier-cover-color: \"#274472\"` (une couleur) ou `cahier-cover-image: \"chemin/vers/image.jpg\"` (une image, prioritaire sur la couleur). Le titre affiché est la propriété `title` du frontmatter, sinon le nom du fichier.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Couleur de couverture par défaut")
			.setDesc("Utilisée si la note ne précise pas cahier-cover-color.")
			.addColorPicker((c) =>
				c.setValue(s.coverColor).onChange(async (v) => {
					s.coverColor = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		new Setting(containerEl)
			.setName("Hauteur de la couverture")
			.setDesc(`${s.coverHeight}px`)
			.addSlider((sl) =>
				sl
					.setLimits(200, 900, 10)
					.setValue(s.coverHeight)
					.onChange(async (v) => {
						s.coverHeight = v;
						await this.plugin.saveSettings();
						this.plugin.applyStyles();
						this.display();
					})
			);

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Réinitialiser aux valeurs par défaut")
				.onClick(async () => {
					this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
					this.display();
				})
		);
	}
}
