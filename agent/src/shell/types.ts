/** Subconjunto da API Electron usada pelo shell — injetável para testes sem GUI. */
export interface AppLike {
  getVersion(): string;
  setLoginItemSettings(settings: { openAtLogin: boolean; openAsHidden?: boolean }): void;
  requestSingleInstanceLock(): boolean;
  on(event: "second-instance" | "window-all-closed" | "before-quit", listener: () => void): void;
  quit(): void;
}

export interface TrayLike {
  setToolTip(tip: string): void;
  setContextMenu(menu: unknown): void;
  displayBalloon?(options: { title: string; content: string }): void;
  destroy(): void;
}

export interface TrayCtor {
  new (icon: string): TrayLike;
}

export interface MenuLike {
  buildFromTemplate(template: Array<Record<string, unknown>>): unknown;
}
