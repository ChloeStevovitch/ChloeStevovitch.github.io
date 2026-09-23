import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

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
};

const FONT_STACKS: Record<FontChoice, string> = {
	"patrick-hand": `"Cahier Ecolier Patrick Hand", "Patrick Hand", cursive`,
	"system-cursive": `"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`,
};

export default class CahierEcolierPlugin extends Plugin {
	settings: CahierSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CahierEcolierSettingTab(this.app, this));
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
	}

	onunload() {
		document.body.classList.remove(
			"cahier-ecolier-enabled",
			"cahier-ecolier-editor",
			"cahier-ecolier-reading"
		);
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
