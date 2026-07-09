import { exportToClipboard } from "@excalidraw/excalidraw";
import type {
  ClipboardData,
} from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { centerElementsOnFrame, getExportAppState, getRenderableElements, mergeFiles } from "./deck";
import { extractMermaidDefinition } from "./mermaid";
import type { SlideDocument } from "./types";

export const mergeClipboardElements = (
  slide: SlideDocument,
  incomingElements: readonly ExcalidrawElement[],
  incomingFiles: SlideDocument["scene"]["files"] = {},
) => {
  const centeredElements = centerElementsOnFrame(slide, [
    ...incomingElements.filter((element) => !element.isDeleted),
  ]);

  return {
    ...slide,
    scene: {
      ...slide.scene,
      elements: [...slide.scene.elements, ...centeredElements],
      files: mergeFiles(slide.scene.files, incomingFiles),
    },
  };
};

export const handleClipboardPayload = (
  payload: ClipboardData,
): { kind: "excalidraw" | "mermaid" | "pass"; text?: string } => {
  if (payload.elements?.length) {
    return { kind: "excalidraw" };
  }

  const definition = payload.text ? extractMermaidDefinition(payload.text) : null;
  if (definition) {
    return { kind: "mermaid", text: definition };
  }

  return { kind: "pass" };
};

export const copySlideToExcalidrawClipboard = async (slide: SlideDocument) => {
  await exportToClipboard({
    type: "json",
    elements: getRenderableElements(slide) as never,
    files: slide.scene.files,
    appState: getExportAppState(slide),
  });
};
