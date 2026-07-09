import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export interface SlideScene {
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

export type SlideLayout = "slide" | "freeform";

export interface MermaidImportRecord {
  id: string;
  kind: "mermaid";
  source: string;
  config?: Record<string, unknown>;
  elementIds: string[];
  fileIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SlideDocument {
  id: string;
  title: string;
  layout: SlideLayout;
  scene: SlideScene;
  imports: MermaidImportRecord[];
}

export interface DeckDocument {
  type: "excalidraw-slides.deck";
  version: 1;
  meta: {
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  slides: SlideDocument[];
}

export interface MermaidImportResult {
  elements: ExcalidrawElement[];
  files: BinaryFiles;
}

export interface ExcalidrawSceneLike {
  type?: string;
  appState?: Partial<AppState>;
  elements?: ExcalidrawElement[];
  files?: Record<string, BinaryFileData>;
}

export type ExportCurrentSlideFormat = "png" | "svg" | "pdf" | "excalidraw";
export type ExportDeckFormat = "pdf" | "pptx" | "png-zip" | "svg-zip";
