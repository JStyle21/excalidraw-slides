import {
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  APP_DEFAULT_BACKGROUND,
  FRAME_NAME_PREFIX,
  SLIDE_CONTENT_HEIGHT,
  SLIDE_CONTENT_Y,
  SLIDE_HEIGHT,
  SLIDE_TITLE_HEIGHT,
  SLIDE_WIDTH,
} from "./constants";
import type {
  DeckDocument,
  MermaidImportRecord,
  SlideLayout,
  SlideDocument,
  SlideScene,
} from "./types";

const elementSchema = z.object({
  id: z.string(),
}).passthrough();

const importSchema: z.ZodType<MermaidImportRecord> = z.object({
  id: z.string(),
  kind: z.literal("mermaid"),
  source: z.string(),
  config: z.record(z.unknown()).optional(),
  elementIds: z.array(z.string()),
  fileIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const slideSceneSchema: z.ZodType<SlideScene> = z.object({
  elements: z.array(elementSchema) as unknown as z.ZodType<ExcalidrawElement[]>,
  appState: z.record(z.unknown()),
  files: z.record(z.any()) as unknown as z.ZodType<SlideScene["files"]>,
});

const slideSchema = z.object({
  id: z.string(),
  title: z.string(),
  layout: z.enum(["slide", "freeform"]).optional().default("slide"),
  scene: slideSceneSchema,
  imports: z.array(importSchema),
});

export const deckSchema = z.object({
  type: z.literal("excalidraw-slides.deck"),
  version: z.literal(1),
  meta: z.object({
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  slides: z.array(slideSchema).min(1),
});

const nowIso = () => new Date().toISOString();

const PAGE_NUMBER_TITLE = /^Page (\d+)$/;
const SLIDE_NUMBER_TITLE = /^Slide (\d+)$/;

export const normalizeDefaultTitleForLayout = (
  title: string,
  layout: SlideLayout,
) => {
  if (layout === "freeform") {
    const slideMatch = title.match(SLIDE_NUMBER_TITLE);
    if (slideMatch) {
      return `Page ${slideMatch[1]}`;
    }
    return title;
  }

  const pageMatch = title.match(PAGE_NUMBER_TITLE);
  if (pageMatch) {
    return `Slide ${pageMatch[1]}`;
  }
  return title;
};

export const createSlideFrame = (title: string) => {
  const [frame] = convertToExcalidrawElements([
    {
      id: nanoid(),
      type: "frame",
      x: 0,
      y: SLIDE_CONTENT_Y,
      width: SLIDE_WIDTH,
      height: SLIDE_CONTENT_HEIGHT,
      children: [],
      name: `${FRAME_NAME_PREFIX}${title}`,
      strokeColor: "transparent",
      backgroundColor: APP_DEFAULT_BACKGROUND,
      locked: true,
    },
  ]) as ExcalidrawFrameElement[];

  return frame;
};

const isLegacyFullSlideFrame = (frame: ExcalidrawFrameElement) =>
  frame.x === 0 &&
  frame.y === 0 &&
  frame.width === SLIDE_WIDTH &&
  frame.height === SLIDE_HEIGHT;

const isReservedTitleFrame = (frame: ExcalidrawFrameElement) =>
  frame.x === 0 &&
  frame.y === SLIDE_CONTENT_Y &&
  frame.width === SLIDE_WIDTH &&
  frame.height === SLIDE_CONTENT_HEIGHT;

const isReservedFrameElement = (element: ExcalidrawElement) =>
  element.type === "frame" &&
  typeof element.name === "string" &&
  element.name.startsWith(FRAME_NAME_PREFIX);

export const isFreeformSlide = (slide: Pick<SlideDocument, "layout">) =>
  slide.layout === "freeform";

export const getFrameElement = (
  slide: SlideDocument,
) => {
  if (isFreeformSlide(slide)) {
    return undefined;
  }

  const reservedFrame = slide.scene.elements.find(
    (element) =>
      element.type === "frame" &&
      typeof element.name === "string" &&
      element.name.startsWith(FRAME_NAME_PREFIX),
  );

  return (reservedFrame ??
    slide.scene.elements.find((element) => element.type === "frame")) as
    | ExcalidrawFrameElement
    | undefined;
};

export const getRenderableElements = (slide: SlideDocument) => {
  const frame = getFrameElement(slide);

  return slide.scene.elements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }

    if (isReservedFrameElement(element)) {
      return false;
    }

    return !frame || element.id !== frame.id;
  }) as NonDeletedExcalidrawElement[];
};

export const getLayoutBackground = (
  slide: Pick<SlideDocument, "scene">,
) => slide.scene.appState.viewBackgroundColor ?? APP_DEFAULT_BACKGROUND;

export const getExportAppState = (
  slide: Pick<SlideDocument, "scene">,
) => ({
  ...slide.scene.appState,
  exportBackground: true,
  exportWithDarkMode: slide.scene.appState.theme === "dark",
  viewBackgroundColor: getLayoutBackground(slide),
});

export const createEmptyPage = (
  title = "Untitled page",
  background = APP_DEFAULT_BACKGROUND,
): SlideDocument => ({
  id: nanoid(),
  title,
  layout: "freeform",
  scene: {
    elements: [],
    appState: {
      viewBackgroundColor: background,
      currentItemFontFamily: 1,
      currentItemFontSize: 28,
      exportBackground: true,
      exportScale: 1,
    },
    files: {},
  },
  imports: [],
});

export const createEmptySlide = (
  title = "Untitled slide",
  background = APP_DEFAULT_BACKGROUND,
): SlideDocument => ({
  id: nanoid(),
  title,
  layout: "slide",
  scene: {
    elements: [createSlideFrame(title)],
    appState: {
      viewBackgroundColor: background,
      currentItemFontFamily: 1,
      currentItemFontSize: 28,
      exportBackground: true,
      exportScale: 1,
    },
    files: {},
  },
  imports: [],
});

export const createInitialDeck = (): DeckDocument => {
  const createdAt = nowIso();
  return {
    type: "excalidraw-slides.deck",
    version: 1,
    meta: {
      title: "Untitled project",
      createdAt,
      updatedAt: createdAt,
    },
    slides: [createEmptyPage("Page 1")],
  };
};

export const ensureDeckShape = (deck: DeckDocument): DeckDocument => {
  const slides = deck.slides.map((slide) => {
    const layout: SlideLayout = slide.layout ?? "slide";
    const title = normalizeDefaultTitleForLayout(slide.title, layout);

    if (layout === "freeform") {
      const reservedFrameIds = new Set(
        slide.scene.elements
          .filter((element) => !element.isDeleted && isReservedFrameElement(element))
          .map((element) => element.id),
      );
      const elements = slide.scene.elements
        .filter((element) => !reservedFrameIds.has(element.id))
        .map((element) =>
          "frameId" in element && element.frameId && reservedFrameIds.has(element.frameId)
            ? { ...element, frameId: null }
            : element,
        );

      return {
        ...slide,
        title,
        layout,
        scene: {
          ...slide.scene,
          appState: {
            ...slide.scene.appState,
            viewBackgroundColor: getLayoutBackground(slide),
          },
          elements,
          files: slide.scene.files ?? {},
        },
        imports: slide.imports ?? [],
      };
    }

    const existingFrame = getFrameElement(slide);
    const shouldMigrateLegacyFrame = existingFrame ? isLegacyFullSlideFrame(existingFrame) : false;

    let elements = slide.scene.elements;

    if (!existingFrame) {
      elements = [createSlideFrame(slide.title), ...slide.scene.elements];
    } else if (isReservedTitleFrame(existingFrame)) {
      elements = slide.scene.elements.map((element) =>
        element.id === existingFrame.id
          ? { ...element, name: `${FRAME_NAME_PREFIX}${slide.title}` }
          : element,
      );
    } else {
      elements = slide.scene.elements.map((element) =>
        element.id === existingFrame.id
          ? {
              ...element,
              x: 0,
              y: SLIDE_CONTENT_Y,
              width: SLIDE_WIDTH,
              height: SLIDE_CONTENT_HEIGHT,
              name: `${FRAME_NAME_PREFIX}${slide.title}`,
            }
          : shouldMigrateLegacyFrame && element.type !== "frame"
            ? { ...element, y: element.y + SLIDE_TITLE_HEIGHT / 2 }
            : element,
      );
    }

    return {
      ...slide,
      title,
      layout,
      scene: {
        ...slide.scene,
        appState: {
          ...slide.scene.appState,
          viewBackgroundColor: getLayoutBackground(slide),
        },
        elements,
        files: slide.scene.files ?? {},
      },
      imports: slide.imports ?? [],
    };
  });

  return {
    ...deck,
    slides,
    meta: {
      ...deck.meta,
      title: deck.meta.title === "Untitled deck" ? "Untitled project" : deck.meta.title,
      updatedAt: nowIso(),
    },
  };
};

export const parseDeckDocument = (value: unknown) =>
  ensureDeckShape(deckSchema.parse(value));

export const renameSlide = (slide: SlideDocument, title: string): SlideDocument => {
  const frame = getFrameElement(slide);
  return {
    ...slide,
    title,
    scene: {
      ...slide.scene,
      elements: slide.scene.elements.map((element) =>
        frame && element.id === frame.id
          ? { ...element, name: `${FRAME_NAME_PREFIX}${title}` }
          : element,
      ),
    },
  };
};

export const centerElementsOnFrame = (
  slide: SlideDocument,
  elements: ExcalidrawElement[],
): ExcalidrawElement[] => {
  const frame = getFrameElement(slide);
  if (!frame || elements.length === 0) {
    return elements;
  }

  const visible = elements.filter((element) => !element.isDeleted);
  if (visible.length === 0) {
    return elements;
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(
    visible as NonDeletedExcalidrawElement[],
  );
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const offsetX = frame.x + (frame.width - contentWidth) / 2 - minX;
  const offsetY = frame.y + (frame.height - contentHeight) / 2 - minY;

  return elements.map((element) => ({
    ...element,
    x: element.x + offsetX,
    y: element.y + offsetY,
    frameId: frame.id,
  }));
};

export const setSlideLayout = (
  slide: SlideDocument,
  layout: SlideLayout,
): SlideDocument => {
  if (slide.layout === layout) {
    return slide;
  }

  const title = normalizeDefaultTitleForLayout(slide.title, layout);
  const background = getLayoutBackground(slide);

  if (layout === "freeform") {
    const frame = getFrameElement(slide);
    return {
      ...slide,
      title,
      layout,
      scene: {
        ...slide.scene,
        appState: {
          ...slide.scene.appState,
          viewBackgroundColor: background,
        },
        elements: slide.scene.elements.map((element) => {
          if (frame && element.id === frame.id) {
            return { ...element, isDeleted: true };
          }

          if ("frameId" in element && frame && element.frameId === frame.id) {
            return { ...element, frameId: null };
          }

          return element;
        }),
      },
    };
  }

  const frame = createSlideFrame(title);
  const sceneElements = slide.scene.elements.filter(
    (element) => !element.isDeleted && element.type !== "frame",
  );
  const reframedElements = centerElementsOnFrame(
    {
      ...slide,
      layout: "slide",
      scene: {
        ...slide.scene,
        elements: [frame],
      },
    },
    sceneElements,
  );

  return {
    ...slide,
    title,
    layout,
    scene: {
      ...slide.scene,
      appState: {
        ...slide.scene.appState,
        viewBackgroundColor: background,
      },
      elements: [frame, ...reframedElements],
    },
  };
};

export const mergeFiles = (
  current: SlideScene["files"],
  next: SlideScene["files"],
) => ({
  ...current,
  ...next,
});

export const touchDeck = (deck: DeckDocument): DeckDocument => ({
  ...deck,
  meta: {
    ...deck.meta,
    updatedAt: nowIso(),
  },
});
