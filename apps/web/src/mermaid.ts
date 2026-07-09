import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { nanoid } from "nanoid";
import {
  centerElementsOnFrame,
  mergeFiles,
} from "./deck";
import type {
  MermaidImportRecord,
  SlideDocument,
} from "./types";

const MERMAID_HINTS = [
  "architecture-beta",
  "block-beta",
  "flowchart",
  "graph ",
  "graph\n",
  "sequenceDiagram",
  "classDiagram",
  "erDiagram",
  "gantt",
  "gitGraph",
  "journey",
  "mindmap",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "timeline",
];

export const extractMermaidDefinition = (input: string): string | null => {
  const fencedMatch = input.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]?.trim()) {
    return fencedMatch[1].trim();
  }

  const trimmed = input.trim();
  if (
    MERMAID_HINTS.some((hint) =>
      trimmed.toLowerCase().startsWith(hint.toLowerCase()),
    )
  ) {
    return trimmed;
  }

  const firstMermaidLine = trimmed
    .split(/\r?\n/)
    .findIndex((line) =>
      MERMAID_HINTS.some((hint) =>
        line.trimStart().toLowerCase().startsWith(hint.toLowerCase()),
      ),
    );

  if (firstMermaidLine >= 0) {
    const lines = trimmed.split(/\r?\n/).slice(firstMermaidLine).join("\n").trim();
    return lines || null;
  }

  return null;
};

export const applyMermaidImport = async (
  slide: SlideDocument,
  source: string,
): Promise<{
  slide: SlideDocument;
  record: MermaidImportRecord;
}> => {
  const result = await parseMermaidToExcalidraw(source);
  const materializedElements = convertToExcalidrawElements(
    result.elements.map((element) => ({
      ...element,
      customData: {
        ...(element.customData ?? {}),
      },
    })),
  );
  const centeredElements = centerElementsOnFrame(slide, materializedElements);
  const importId = nanoid();

  const record: MermaidImportRecord = {
    id: importId,
    kind: "mermaid",
    source,
    config: undefined,
    elementIds: centeredElements.map((element) => element.id),
    fileIds: Object.keys(result.files ?? {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const taggedElements = centeredElements.map((element) => ({
    ...element,
    customData: {
      ...(element.customData ?? {}),
      mermaidImportId: importId,
    },
  }));

  return {
    slide: {
      ...slide,
      scene: {
        ...slide.scene,
        elements: [...slide.scene.elements, ...taggedElements],
        files: mergeFiles(slide.scene.files, result.files ?? {}),
      },
      imports: [...slide.imports, record],
    },
    record,
  };
};

export const replaceMermaidImport = async (
  slide: SlideDocument,
  recordId: string,
) => {
  const existing = slide.imports.find((record) => record.id === recordId);
  if (!existing) {
    return slide;
  }

  const cleanedSlide: SlideDocument = {
    ...slide,
    scene: {
      ...slide.scene,
      elements: slide.scene.elements.filter(
        (element) => !existing.elementIds.includes(element.id),
      ),
      files: Object.fromEntries(
        Object.entries(slide.scene.files).filter(
          ([fileId]) => !existing.fileIds.includes(fileId),
        ),
      ),
    },
    imports: slide.imports.filter((record) => record.id !== recordId),
  };

  return (await applyMermaidImport(cleanedSlide, existing.source)).slide;
};
