import { App, FuzzySuggestModal, MarkdownView, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, Text } from "@codemirror/state";

type FontChoice = "patrick-hand" | "system-cursive";

interface CahierSettings {
	enabled: boolean;
	defaultOnForAllNotes: boolean; // if false, a note needs `cahier: true` (frontmatter, or the ribbon button) to get the look
	paperColor: string;
	lineColor: string;
	marginColor: string;
	textColor: string;
	lineHeight: number; // px, distance between two ruled lines
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
}

const DEFAULT_SETTINGS: CahierSettings = {
	enabled: true,
	defaultOnForAllNotes: false,
	paperColor: "#faf5e9",
	lineColor: "#a9c8e8",
	marginColor: "#e08585",
	textColor: "#2b3a55",
	lineHeight: 30,
	marginPosition: 48,
	paperWidth: 820,
	paperSideMargin: 20,
	fontChoice: "patrick-hand",
	fontSize: 17,

	linesPerPage: 25,
	pageMargin: 24,
	pageGapSize: 40,

	coverColor: "#274472",
};

const FONT_STACKS: Record<FontChoice, string> = {
	"patrick-hand": `"Cahier Ecolier Patrick Hand", "Patrick Hand", cursive`,
	"system-cursive": `"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`,
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"]);

class ImagePickerModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder("Choisir une image pour la couverture…");
	}
	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => IMAGE_EXTENSIONS.has(f.extension.toLowerCase()));
	}
	getItemText(file: TFile): string {
		return file.path;
	}
	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

// ---- Sauts de page (CodeMirror 6) ----

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

// ---- Page de couverture (CodeMirror 6) ----

interface CoverConf {
	enabled: boolean;
	title: string;
	color: string;
	image: string | null;
	pos: number; // doc offset to insert at — after any frontmatter, so it isn't split across it
	height: number; // px — fixed, so CodeMirror can measure the block reliably during scroll; matches one page's height
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
		// Le titre n'est superposé que sur une couverture de couleur — une
		// image de couverture est affichée telle quelle, sans texte dessus.
		const title = document.createElement("div");
		title.className = "cahier-cover-title";
		title.textContent = conf.title;
		div.appendChild(title);
	}
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
				// La couverture, puis un vrai "saut de page" juste après, avant le
				// contenu — pas seulement une marge, pour rester cohérent avec les
				// sauts de page entre les feuilles suivantes.
				return Decoration.set([
					Decoration.widget({ widget: new CoverWidget(e.value), side: -2, block: true }).range(e.value.pos),
					Decoration.widget({ widget: new PageGapWidget(), side: -1, block: true }).range(e.value.pos),
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
	private resizeHandler: (() => void) | null = null;
	private resizeDebounce: number | null = null;
	private editorResizeObserver: ResizeObserver | null = null;
	private observedScroller: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CahierEcolierSettingTab(this.app, this));
		this.registerEditorExtension([pagingField, coverField]);
		this.applyStyles();

		this.addRibbonIcon("book-open", "Cahier d'écolier : activer/désactiver pour cette note", async () => {
			await this.toggleNoteEnabled();
		});

		this.addCommand({
			id: "toggle-cahier-ecolier",
			name: "Activer / désactiver le cahier d'écolier (tout le plugin)",
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				this.applyStyles();
			},
		});

		this.addCommand({
			id: "toggle-cahier-note",
			name: "Activer / désactiver le cahier pour cette note",
			callback: async () => this.toggleNoteEnabled(),
		});

		this.addCommand({
			id: "enable-cahier-paged",
			name: "Activer la pagination pour cette note",
			callback: async () => {
				await this.setFrontmatterFlags({ cahier: true, "cahier-paged": true });
			},
		});

		this.addCommand({
			id: "enable-cahier-cover",
			name: "Ajouter une page de couverture à cette note (couleur)",
			callback: async () => {
				await this.setFrontmatterFlags({ cahier: true, "cahier-cover": true }, (fm) => {
					if (!fm["cahier-cover-color"] && !fm["cahier-cover-image"]) {
						fm["cahier-cover-color"] = this.settings.coverColor;
					}
				});
			},
		});

		this.addCommand({
			id: "pick-cahier-cover-image",
			name: "Choisir une image de couverture pour cette note (parcourir le coffre)",
			callback: () => {
				new ImagePickerModal(this.app, async (file) => {
					await this.setFrontmatterFlags({ cahier: true, "cahier-cover": true, "cahier-cover-image": file.path });
				}).open();
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
		this.app.workspace.onLayoutReady(() => {
			this.updateActiveFileFeatures();
			// Au tout premier affichage, la zone d'édition peut ne pas encore
			// avoir sa taille définitive (panneaux en cours de mise en place).
			setTimeout(() => this.updateActiveFileFeatures(), 400);
		});

		// La couverture prend toute la hauteur visible : la recalculer si la
		// fenêtre (ou un panneau latéral) change de taille.
		this.resizeHandler = () => {
			if (this.resizeDebounce) window.clearTimeout(this.resizeDebounce);
			this.resizeDebounce = window.setTimeout(() => {
				this.resizeDebounce = null;
				this.updateActiveFileFeatures();
			}, 200);
		};
		window.addEventListener("resize", this.resizeHandler);
	}

	onunload() {
		if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
		if (this.resizeDebounce) window.clearTimeout(this.resizeDebounce);
		this.editorResizeObserver?.disconnect();
		document.body.classList.remove("cahier-ecolier-enabled", "cahier-ecolier-paged", "cahier-ecolier-cover");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async setFrontmatterFlags(
		flags: Record<string, unknown>,
		extra?: (fm: Record<string, unknown>) => void
	) {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			Object.assign(fm, flags);
			extra?.(fm);
		});
		this.updateActiveFileFeatures();
	}

	private async toggleNoteEnabled() {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		const cache = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const current = typeof cache?.["cahier"] === "boolean" ? (cache["cahier"] as boolean) : this.settings.defaultOnForAllNotes;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm["cahier"] = !current;
		});
		this.updateActiveFileFeatures();
	}

	applyStyles() {
		const body = document.body;
		const s = this.settings;

		body.style.setProperty("--cahier-paper", s.paperColor);
		body.style.setProperty("--cahier-line-color", s.lineColor);
		body.style.setProperty("--cahier-margin-color", s.marginColor);
		body.style.setProperty("--cahier-text-color", s.textColor);
		body.style.setProperty("--cahier-line-height", `${s.lineHeight}px`);
		body.style.setProperty("--cahier-margin-position", `${s.marginPosition}px`);
		body.style.setProperty("--cahier-paper-width", `${s.paperWidth}px`);
		body.style.setProperty("--cahier-paper-side-margin", `${s.paperSideMargin}px`);
		body.style.setProperty("--cahier-font-family", FONT_STACKS[s.fontChoice]);
		body.style.setProperty("--cahier-font-size", `${s.fontSize}px`);
		body.style.setProperty("--cahier-page-margin", `${s.pageMargin}px`);
		body.style.setProperty("--cahier-page-gap-size", `${s.pageGapSize}px`);
		if (!body.style.getPropertyValue("--cahier-content-offset")) {
			body.style.setProperty("--cahier-content-offset", "0px");
		}

		this.updateActiveFileFeatures();
	}

	private getCm(): EditorView | undefined {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// L'API publique d'Obsidian n'expose pas l'EditorView CodeMirror 6 sous-jacent ;
		// `editor.cm` est un accès non documenté mais stable, utilisé par de nombreux plugins.
		return (mdView?.editor as unknown as { cm?: EditorView })?.cm;
	}

	private ensureResizeObserver(cm: EditorView) {
		const target = cm.scrollDOM;
		if (this.observedScroller === target) return;
		this.editorResizeObserver?.disconnect();
		this.observedScroller = target;
		// Plus fiable qu'un délai deviné après l'ouverture d'un fichier : se
		// déclenche exactement quand la taille réelle de la zone d'édition est
		// connue, y compris au tout premier affichage (panneaux en cours de
		// mise en place) — c'est de là que dépend la hauteur de la couverture.
		this.editorResizeObserver = new ResizeObserver(() => this.updateActiveFileFeatures());
		this.editorResizeObserver.observe(target);
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
		const s = this.settings;
		if (!s.enabled) {
			document.body.classList.remove("cahier-ecolier-enabled", "cahier-ecolier-paged", "cahier-ecolier-cover");
			return;
		}

		const file = this.app.workspace.getActiveFile();
		const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;

		const noteOverride = fm?.["cahier"];
		const noteEnabled = typeof noteOverride === "boolean" ? noteOverride : s.defaultOnForAllNotes;
		const overallEnabled = s.enabled && noteEnabled;

		document.body.classList.toggle("cahier-ecolier-enabled", overallEnabled);

		const coverEnabled = overallEnabled && !!fm?.["cahier-cover"];
		const title = (fm?.title as string) || file?.basename || "";
		const color = (fm?.["cahier-cover-color"] as string) || s.coverColor;
		const imageRaw = fm?.["cahier-cover-image"] as string | undefined;
		const image = imageRaw ? this.resolveImagePath(imageRaw) : null;

		const paged = overallEnabled && !!fm?.["cahier-paged"];
		const linesPerPage = Number(fm?.["cahier-lines-per-page"]) || s.linesPerPage;

		document.body.classList.toggle("cahier-ecolier-cover", coverEnabled);
		document.body.classList.toggle("cahier-ecolier-paged", paged);

		const cm = this.getCm();
		if (!cm) return;
		this.ensureResizeObserver(cm);

		let coverPos = 0;
		let startLine = 0;
		const doc = cm.state.doc;
		const fmEndLine = frontmatterEndLine(doc);
		startLine = fmEndLine;
		if (fmEndLine > 0) {
			const line = doc.line(fmEndLine);
			coverPos = Math.min(line.to + 1, doc.length);
		}

		const coverConf: CoverConf = {
			enabled: coverEnabled,
			title,
			color,
			image,
			pos: coverPos,
			// La couverture prend toute la hauteur visible de l'éditeur (l'écran
			// au premier affichage), pas seulement la hauteur d'une page de texte.
			height: Math.max(cm.scrollDOM.clientHeight || 0, linesPerPage * s.lineHeight),
		};
		const pagingConf: PagingConf = { enabled: paged, linesPerPage, startLine };

		// Décalage du motif de lignes de fond (voir styles.css) pour qu'il
		// commence juste après la couverture + son saut de page, plutôt qu'au
		// tout début de .cm-content — sinon les lignes "préremplies" se
		// dessineraient par-dessus la couverture elle-même.
		const gapHeight = s.pageMargin * 2 + s.pageGapSize;
		const contentOffset = coverEnabled ? coverConf.height + gapHeight : 0;
		document.body.style.setProperty("--cahier-content-offset", `${contentOffset}px`);

		// Évite de redispatcher (et donc de reconstruire le widget) quand rien n'a
		// changé — "layout-change" se déclenche pour toutes sortes de raisons.
		const key = JSON.stringify([coverConf, pagingConf]);
		if (this.lastConfKeys.get(cm) !== key) {
			this.lastConfKeys.set(cm, key);
			cm.dispatch({ effects: [setCover.of(coverConf), setPaging.of(pagingConf)] });
		}
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
			text: "Papier ligné bleu à marge rouge et police manuscrite, pour retrouver l'ambiance d'un cahier d'écolier — directement dans l'éditeur, en écrivant. La vue de lecture d'Obsidian n'est pas touchée par le plugin.",
		});

		new Setting(containerEl)
			.setName("Activer (tout le plugin)")
			.setDesc("Interrupteur général. Une fois activé, chaque note décide individuellement si elle utilise le cahier — voir ci-dessous.")
			.addToggle((t) =>
				t.setValue(s.enabled).onChange(async (v) => {
					s.enabled = v;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				})
			);

		new Setting(containerEl)
			.setName("Notes concernées par défaut")
			.setDesc(
				"Désactivé : seules les notes marquées (bouton dans la barre latérale, ou `cahier: true` dans le frontmatter) ont le look cahier. Activé : toutes les notes l'ont, sauf celles marquées `cahier: false`."
			)
			.addToggle((t) =>
				t.setValue(s.defaultOnForAllNotes).onChange(async (v) => {
					s.defaultOnForAllNotes = v;
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
			text: "Désactivé par défaut. Pour découper une note en feuilles séparées par un espace, utilise la commande « Activer la pagination pour cette note » (ou ajoute `cahier-paged: true` dans le frontmatter, avec `cahier-lines-per-page: 30` en option pour surcharger la valeur ci-dessous pour cette note).",
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
			text: "Désactivée par défaut. Utilise la commande « Ajouter une page de couverture à cette note » (couleur) ou « Choisir une image de couverture pour cette note » (parcourt ton coffre), ou ajoute `cahier-cover: true` dans le frontmatter à la main, avec `cahier-cover-color: \"#274472\"` ou `cahier-cover-image: \"chemin/vers/image.jpg\"` (prioritaire sur la couleur). Le titre affiché est la propriété `title` du frontmatter, sinon le nom du fichier. Sa hauteur correspond à celle d'une page (lignes par page × espacement des lignes), avec un saut de page avant le contenu.",
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
