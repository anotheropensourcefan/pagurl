// this Obsidian plugin turns a URL link into a page
import { Plugin, Editor, moment, Notice, PluginSettingTab, App, Setting } from "obsidian"

interface PagurlSettings {
	template: string
	vaultWideNoDuplicate: boolean
	nameStrategy: "title" | "domain-date"
	folders: string[]
}

const DEFAULT_SETTINGS: Partial<PagurlSettings> = {
	template: "",
	vaultWideNoDuplicate: false,
	nameStrategy: "title",
	folders: [],
}

interface ExtractedLink {
	fullMatch: string
	alias: string
	url: string
}


export default class PagurlPlugin extends Plugin {
	settings: PagurlSettings

	async onload() {
		await this.loadSettings()

		this.addCommands(this.settings.folders)

		this.addCommand({
			id: 'current',
			name: 'current',
			editorCallback: async (editor: Editor) => {
				await this.callback(editor, 'current')
			}
		})

		this.addSettingTab(new SettingTab(this.app, this))
	}

	private command(name: string) {
		return {
			id: name,
			name,
			editorCallback: async (editor: Editor) => {
				await this.callback(editor, name)
			}
		}
	}

	private addCommands(names: string[]) {
		for (const name of names) {
			this.addCommand(this.command(name))
		}
	}

	private async callback(editor: Editor, folder: string) {
		if (folder === 'current') {
			const activeFile = this.app.workspace.getActiveFile()
			if (!activeFile) throw new Error("No active file to determine its folder.")
			folder = activeFile?.parent?.path || folder
		}

		let link = this.extractMarkdownLink(editor)
		if (!link) {
			const selectedText = editor.getSelection().trim()
			if (!selectedText) {
				throw new Error("Select a valid text or Markdown link")
			}
			link = {
				fullMatch: selectedText,
				alias: selectedText,
				url: ""
			}
		}
		try {

			const existingFile = this.findExistingFile(link.url, folder)
			let name = existingFile?.name

			if (!existingFile) {
				const note = await this.generateNote(link)
				name = note.name
				await this.createFile(name, note.content, folder)
			}
			if (name) {
				this.replaceMarkdownLink(editor, link.fullMatch, name, link.alias)
				new Notice(`Pagurl: ${link.url} ${existingFile ? '-->' : '==>'} ${existingFile?.folder || folder}/${name}`)
				// --> a link to an existing file
				// ==> a newly created file
			}
		} catch (error) {
			new Notice(`Pagurl error: ${error.message}`)
		}
	}

	private extractMarkdownLink(editor: Editor): ExtractedLink | null {
		const selection = editor.getSelection()
		const cursorPos = editor.getCursor()
		const lineContent = editor.getLine(cursorPos.line)

		return this.findMarkdownLink(selection || lineContent)
	}

	private findMarkdownLink(text: string): ExtractedLink | null {
		const mdLinkRegex = /\[([^\]]+)\]\(\s*<?(https?:\/\/[^\s>]+)>?\s*\)/i
		const match = text.match(mdLinkRegex)
		if (!match) return null

		return {
			fullMatch: match[0],
			alias: match[1].trim(),
			url: match[2].trim()
		}
	}

	private async generateNote(link: ExtractedLink): Promise<{
		name: string
		content: string
	}> {
		return {
			name: this.generateName(link),
			content: this.generateContent(link)
		}
	}

	private findExistingFile(url: string, folder: string) {

		const file = this.app.vault.getMarkdownFiles()
			.filter(file => {
				return this.settings.vaultWideNoDuplicate || file.parent?.path === folder
			})
			.find(file => {
				const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
				return frontmatter && frontmatter?.url === url
			})
		if (file) {
			return { name: file.basename, folder: file.parent?.path }
		}
		return null
	}

	private generateName(link: ExtractedLink): string {
		const sanitizedAlias = this.sanitizeName(link.alias)
		if (!link.url) return sanitizedAlias
		switch (this.settings.nameStrategy) {
			case "domain-date":
				try {
					const domain = new URL(link.url).hostname
					const date = moment().format("YYYY-MM-DD")
					return `${domain}-${date}`
				} catch {
					return sanitizedAlias
				}
			default:
				return sanitizedAlias
		}
	}

	private sanitizeName(name: string): string {
		return name.replace(/[\/\\#%&\{\}\|<>*?$!'":@]/g, "-")
	}

	private generateContent(link: ExtractedLink): string {
		const frontmatter = `---\n` + (link.url ? `url: "${link.url}"\n` : ``) + `aliases:\n  - ${link.alias}\n---\n`
		const content = this.settings.template
			.replace(/{{alias}}/g, link.alias)
			.replace(/{{url}}/g, link.url)

		return frontmatter + content
	}

	private async createFile(name: string, content: string, folder: string): Promise<void> {
		await this.app.vault.create(`${folder}/${name}.md`, content)
	}

	private replaceMarkdownLink(editor: Editor, originalMatch: string, name: string, alias?: string): void {
		const cursor = editor.getCursor()
		const content = editor.getValue()
		const newLink = `[[${name}|${alias || name}]]`

		const newContent = content.replace(
			originalMatch,
			newLink
		)

		editor.setValue(newContent)
		editor.setCursor(cursor)
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}

class SettingTab extends PluginSettingTab {
	plugin: PagurlPlugin

	constructor(app: App, plugin: PagurlPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this

		containerEl.empty()

		new Setting(containerEl)
			.setName('Folders')
			.setDesc('Where to store the notes, separated by commas')
			.addTextArea((text) => text
				.setValue(this.plugin.settings.folders.join(',')) // Display the list as comma-separated
				.onChange(async (value) => {
					this.plugin.settings.folders = value.split(',').map(item => item.trim()); // Split and trim the input
					await this.plugin.saveSettings()
				}))

		new Setting(containerEl)
			.setName('Vault-wide no-duplicate')
			.setDesc('By default, Pagurl only checks if the current folder has a note with the same URL. If enabled, it will check the entire vault.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.vaultWideNoDuplicate)
				.onChange(async (value) => {
					this.plugin.settings.vaultWideNoDuplicate = value
					await this.plugin.saveSettings()
				}))
	}
}