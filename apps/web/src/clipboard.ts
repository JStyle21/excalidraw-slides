import { convertToExcalidrawElements, exportToClipboard } from "@excalidraw/excalidraw";
import type {
  ClipboardData,
} from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import { centerElementsOnFrame, getExportAppState, getRenderableElements, mergeFiles } from "./deck";
import { extractMermaidDefinition } from "./mermaid";
import type { SlideDocument } from "./types";

const TEXT_CARD_MAX_WIDTH = 720;
const TEXT_CARD_MIN_WIDTH = 220;
const TEXT_CARD_PADDING_X = 28;
const TEXT_CARD_PADDING_Y = 22;
const DEFAULT_FONT_SIZE = 28;
const DEFAULT_LINE_HEIGHT = 1.25;

const measureTextWidth = (text: string, fontSize: number) => {
  if (
    typeof document === "undefined" ||
    (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent))
  ) {
    return text.length * fontSize * 0.6;
  }

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return text.length * fontSize * 0.6;
    }

    context.font = `${fontSize}px "IBM Plex Sans", "Segoe UI", sans-serif`;
    return context.measureText(text).width;
  } catch {
    return text.length * fontSize * 0.6;
  }
};

const wrapLine = (line: string, maxWidth: number, fontSize: number) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return [""];
  }

  const words = trimmed.split(/\s+/);
  const wrapped: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (measureTextWidth(candidate, fontSize) <= maxWidth || !currentLine) {
      currentLine = candidate;
      continue;
    }

    wrapped.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    wrapped.push(currentLine);
  }

  return wrapped;
};

const wrapTextForCard = (text: string, maxWidth: number, fontSize: number) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => wrapLine(line, maxWidth, fontSize));

export const createWrappedTextCardElements = (
  slide: SlideDocument,
  text: string,
) => {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return [];
  }

  const fontSize = slide.scene.appState.currentItemFontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = DEFAULT_LINE_HEIGHT;
  const textMaxWidth = TEXT_CARD_MAX_WIDTH - TEXT_CARD_PADDING_X * 2;
  const lines = wrapTextForCard(normalizedText, textMaxWidth, fontSize);
  const wrappedText = lines.join("\n");
  const widestLine = lines.reduce(
    (max, line) => Math.max(max, measureTextWidth(line || " ", fontSize)),
    0,
  );
  const width = Math.min(
    TEXT_CARD_MAX_WIDTH,
    Math.max(TEXT_CARD_MIN_WIDTH, Math.ceil(widestLine + TEXT_CARD_PADDING_X * 2)),
  );
  const height = Math.ceil(
    Math.max(fontSize * lineHeight + TEXT_CARD_PADDING_Y * 2, lines.length * fontSize * lineHeight + TEXT_CARD_PADDING_Y * 2),
  );

  const elements = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: 0,
      y: 0,
      width,
      height,
      roundness: { type: 3 },
      label: {
        text: wrappedText,
        fontSize,
        fontFamily: slide.scene.appState.currentItemFontFamily ?? 1,
        textAlign: "left",
        verticalAlign: "middle",
      },
    },
  ]);

  const container = elements.find((element) => element.type === "rectangle");
  if (!container) {
    return elements;
  }

  return elements.map((element) => {
    if (element.type !== "text" || element.containerId !== container.id) {
      return element;
    }

    return {
      ...element,
      text: wrappedText,
      originalText: wrappedText,
      autoResize: false,
      width: Math.max(width - TEXT_CARD_PADDING_X * 2, TEXT_CARD_MIN_WIDTH - TEXT_CARD_PADDING_X * 2),
    };
  });
};

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
): { kind: "excalidraw" | "mermaid" | "text" | "pass"; text?: string } => {
  const textOnlyElements =
    payload.elements?.length &&
    payload.elements.every((element) => element.type === "text")
      ? (payload.elements as readonly ExcalidrawTextElement[])
      : null;
  const textFromElements = textOnlyElements
    ?.map((element) => element.originalText || element.text)
    .join("\n")
    .trim();
  const definition = payload.text ? extractMermaidDefinition(payload.text) : null;
  if (definition) {
    return { kind: "mermaid", text: definition };
  }

  const plainText = payload.text?.trim();
  const looksLikePlainTextPaste =
    !!(plainText || textFromElements) &&
    (!payload.elements?.length || !!textOnlyElements);

  if (looksLikePlainTextPaste) {
    return { kind: "text", text: plainText || textFromElements || "" };
  }

  if (payload.elements?.length) {
    return { kind: "excalidraw" };
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
