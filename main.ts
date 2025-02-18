// main.ts
import { Plugin, Editor, moment, Notice, PluginSettingTab, App, Setting } from "obsidian";

interface URLToPageSettings {
	template: string;
	fileNameStrategy: "title" | "domain-date";
	folders: string[];
}

const DEFAULT_SETTINGS: Partial<URLToPageSettings> = {
	template: "",
	fileNameStrategy: "title",
	folders: [],
};

interface ExtractedLink {
	fullMatch: string;
	alias: string;
	url: string;
}


export default class PagurlPlugin extends Plugin {
	settings: URLToPageSettings;

	async onload() {
		await this.loadSettings();

		this.addCommands(this.settings.folders);
		this.addSettingTab(new SettingTab(this.app, this));
	}
	private command(name: string) {
		return {
			id: `pagurl-${name}`,
			name,
			editorCallback: async (editor: Editor) => {
				await this.callback(editor, name);
			}
		}
	}
	private async callback(editor: Editor, folder: string) {
		try {
			const link = this.extractMarkdownLink(editor);
			if (!link) throw new Error("No valid Markdown link found");

			const { newFileName, content } = await this.processLink(link);
			await this.createNote(newFileName, content, folder);
			this.replaceMarkdownLink(editor, link.fullMatch, newFileName);

			new Notice(`Créé: ${newFileName}`);
		} catch (error) {
			new Notice(`Attention! ${error.message}`);
		}
	}
	private addCommands(names: string[]) {
		for (const name of names) {
			this.addCommand(this.command(name));
		}
	}
	private extractMarkdownLink(editor: Editor): ExtractedLink | null {
		const selection = editor.getSelection();
		const cursorPos = editor.getCursor();
		const lineContent = editor.getLine(cursorPos.line);

		return this.findMarkdownLink(selection || lineContent);
	}

	private findMarkdownLink(text: string): ExtractedLink | null {
		const mdLinkRegex = /\[([^\]]+)\]\(\s*<?(https?:\/\/[^\s>]+)>?\s*\)/i;
		const match = text.match(mdLinkRegex);
		if (!match) return null;

		return {
			fullMatch: match[0],
			alias: match[1].trim(),
			url: match[2].trim()
		};
	}

	private async processLink(link: ExtractedLink): Promise<{
		newFileName: string;
		content: string;
	}> {
		const existingNote = this.findExistingNote(link.url);
		if (existingNote) {
			return {
				newFileName: existingNote,
				content: ""
			};
		}

		return {
			newFileName: this.generateFileName(link),
			content: this.generateNoteContent(link)
		};
	}

	private findExistingNote(url: string): string | null {
		return this.app.vault.getFiles().find(file =>
			file.frontmatter?.url === url
		)?.basename || null;
	}

	private generateFileName(link: ExtractedLink): string {
		const sanitizedAlias = this.sanitizeFileName(link.alias);

		switch (this.settings.fileNameStrategy) {
			case "domain-date":
				try {
					const domain = new URL(link.url).hostname;
					const date = moment().format("YYYY-MM-DD");
					return `${domain}-${date}`;
				} catch {
					return sanitizedAlias;
				}
			default:
				return sanitizedAlias;
		}
	}

	private sanitizeFileName(name: string): string {
		return name.replace(/[\/\\#%&\{\}\|<>*?$!'":@]/g, "-");
	}

	private generateNoteContent(link: ExtractedLink): string {
		const frontmatter = `---\nurl: "${link.url}"\naliases:\n  - ${link.alias}\n---\n`;
		const content = this.settings.template
			.replace(/{{alias}}/g, link.alias)
			.replace(/{{url}}/g, link.url);

		return frontmatter + content;
	}

	private async createNote(fileName: string, content: string, folder: string): Promise<void> {
		await this.app.vault.create(`${folder}/${fileName}.md`, content);
	}

	private replaceMarkdownLink(editor: Editor, originalMatch: string, newFileName: string): void {
		const cursor = editor.getCursor();
		const content = editor.getValue();
		const newLink = `[[${newFileName}|${newFileName}]]`;

		const newContent = content.replace(
			originalMatch,
			newLink
		);

		editor.setValue(newContent);
		editor.setCursor(cursor);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: PagurlPlugin;

	constructor(app: App, plugin: PagurlPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for My Awesome Plugin.' });

		new Setting(containerEl)
			.setName('Folders')
			.setDesc('Where to store the notes, separated by commas')
			.addTextArea((text) => text
				.setValue(this.plugin.settings.folders.join(',')) // Display the list as comma-separated
				.onChange(async (value) => {
					this.plugin.settings.folders = value.split(',').map(item => item.trim()); // Split and trim the input
					await this.plugin.saveSettings();
					console.log("List updated:", this.plugin.settings.folders);  // Log the updated list
				}));
	}
}