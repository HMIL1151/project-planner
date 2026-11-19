// Mock implementations for Obsidian API
import * as yaml from "yaml";

export class TFile {
  path: string;
  basename: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    this.basename = path.split("/").pop()?.replace(/\.md$/, "") || "";
    this.extension = "md";
  }
}

export class Vault {
  private files: Map<string, string> = new Map();

  getAbstractFileByPath(path: string): TFile | null {
    if (this.files.has(path)) {
      return new TFile(path);
    }
    return null;
  }

  getFileByPath(path: string): TFile | null {
    return this.getAbstractFileByPath(path);
  }

  async process(file: TFile, fn: (content: string) => string): Promise<string> {
    const content = this.files.get(file.path) || "";
    const newContent = fn(content);
    this.files.set(file.path, newContent);
    return newContent;
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) || "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  // Test utility methods
  setFileContent(path: string, content: string): void {
    this.files.set(path, content);
  }

  getFileContent(path: string): string {
    return this.files.get(path) || "";
  }

  listFiles(): string[] {
    return Array.from(this.files.keys());
  }
}

/**
 * Enough of Obsidian's metadata cache to resolve a wiki-link and read a note's
 * frontmatter, which is what the companion-note property store runs on.
 */
export class MetadataCache {
  private vault: Vault;
  private frontmatter: Map<string, Record<string, unknown>> = new Map();

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Obsidian resolves a link by trying the path as given, then with `.md`, then
   * by basename anywhere in the vault. The source path only matters for
   * relative links, which the plugin never writes.
   */
  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    const candidates = [linkpath, `${linkpath}.md`];
    for (const path of candidates) {
      const file = this.vault.getFileByPath(path);
      if (file) return file;
    }

    const basename = linkpath.split("/").pop();
    for (const path of this.vault.listFiles()) {
      if (new TFile(path).basename === basename) return new TFile(path);
    }

    return null;
  }

  getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
    const stored = this.frontmatter.get(file.path);
    if (stored) return { frontmatter: stored };

    // Fall back to reading the note, so a test can just write a file
    const content = this.vault.getFileContent(file.path);
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    return { frontmatter: parseYaml(match[1]) || {} };
  }

  // Test utility method
  setFrontmatter(path: string, frontmatter: Record<string, unknown>): void {
    this.frontmatter.set(path, frontmatter);
  }
}

/**
 * A tab, as far as opening a task's note cares.
 *
 * A tab Obsidian has not got round to loading has no view to ask which file
 * it is on; the file is only in its view state until then. `loaded: false`
 * stands one of those up.
 */
export class WorkspaceLeaf {
  view: { file?: TFile | null };
  private viewState: { state?: { file?: string } };

  constructor(file: string | null = null, loaded = true) {
    this.view = loaded && file ? { file: new TFile(file) } : {};
    this.viewState = file ? { state: { file } } : {};
  }

  getViewState(): { state?: { file?: string } } {
    return this.viewState;
  }
}

/** Which tabs are open, and a record of what was asked of the workspace. */
export class Workspace {
  leaves: WorkspaceLeaf[] = [];
  revealed: WorkspaceLeaf | null = null;
  activated: WorkspaceLeaf | null = null;
  openedLinks: string[] = [];

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return type === "markdown" ? this.leaves : [];
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    this.revealed = leaf;
  }

  setActiveLeaf(leaf: WorkspaceLeaf, _options?: { focus?: boolean }): void {
    this.activated = leaf;
  }

  async openLinkText(link: string, _sourcePath: string): Promise<void> {
    this.openedLinks.push(link);
  }
}

export class App {
  vault: Vault;
  metadataCache: MetadataCache;
  workspace: Workspace;

  constructor() {
    this.vault = new Vault();
    this.metadataCache = new MetadataCache(this.vault);
    this.workspace = new Workspace();
  }
}

export class Notice {
  constructor(message: string, timeout?: number) {
    // Mock implementation - does nothing
  }
}

/**
 * Obsidian's normalizePath: forward slashes, no doubled or edge slashes, and
 * Unicode composed so two spellings of the same name resolve to one path.
 */
export function normalizePath(path: string): string {
  return path
    .replace(/([\\/])+/g, "/")
    .replace(/(^\/+|\/+$)/g, "")
    .trim()
    .normalize("NFC");
}

/**
 * Wrapper around yaml for Obsidian's parseYaml API
 * Matches Obsidian's behavior
 */
export function parseYaml(yamlString: string): any {
  try {
    return yaml.parse(yamlString);
  } catch (e) {
    // Return empty object on parse error, similar to Obsidian
    return {};
  }
}

/**
 * Wrapper around yaml for Obsidian's stringifyYaml API
 * Matches Obsidian's YAML formatting style
 */
export function stringifyYaml(obj: any): string {
  return yaml.stringify(obj, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
    sortMapEntries: false, // Preserve key order
  });
}
