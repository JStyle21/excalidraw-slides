import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  APP_DEFAULT_BACKGROUND,
  SLIDE_CONTENT_Y,
  SLIDE_CONTENT_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
} from "./constants";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: unknown) => elements,
  getCommonBounds: () => [0, 0, 100, 100],
}));

let createInitialDeck: typeof import("./deck").createInitialDeck;
let ensureDeckShape: typeof import("./deck").ensureDeckShape;
let parseDeckDocument: typeof import("./deck").parseDeckDocument;
let createEmptySlide: typeof import("./deck").createEmptySlide;
let setSlideLayout: typeof import("./deck").setSlideLayout;

beforeAll(async () => {
  ({
    createEmptySlide,
    createInitialDeck,
    ensureDeckShape,
    parseDeckDocument,
    setSlideLayout,
  } = await import("./deck"));
});

describe("deck schema", () => {
  it("round-trips the initial deck format", () => {
    const deck = createInitialDeck();
    const parsed = parseDeckDocument(JSON.parse(JSON.stringify(deck)));
    expect(parsed.type).toBe("excalidraw-slides.deck");
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.slides[0]?.layout).toBe("freeform");
    expect(parsed.slides[0]?.title).toBe("Page 1");
    expect(parsed.slides[0]?.scene.elements).toHaveLength(0);
    expect(parsed.meta.title).toBe("Untitled project");
  });

  it("migrates legacy full-slide frames into the reserved title layout", () => {
    const deck = createInitialDeck();
    const slide = deck.slides[0]!;
    slide.layout = "slide";
    slide.scene.elements = [
      {
        id: "frame-1",
        type: "frame",
        x: 0,
        y: 0,
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        name: "__legacy__",
      } as never,
      {
        id: "text-1",
        type: "text",
        x: 20,
        y: 40,
      } as never,
    ];

    const migrated = ensureDeckShape(deck);
    const frame = migrated.slides[0]?.scene.elements.find((element) => element.type === "frame");
    const text = migrated.slides[0]?.scene.elements.find((element) => element.id === "text-1");

    expect(frame).toMatchObject({
      x: 0,
      y: SLIDE_CONTENT_Y,
      width: SLIDE_WIDTH,
      height: SLIDE_CONTENT_HEIGHT,
    });
    expect(text).toMatchObject({
      y: 40 + SLIDE_CONTENT_Y / 2,
    });
  });

  it("preserves freeform pages without injecting a slide frame", () => {
    const deck = createInitialDeck();
    const slide = deck.slides[0]!;
    slide.layout = "freeform";
    slide.scene.elements = [
      {
        id: "shape-1",
        type: "rectangle",
        x: 120,
        y: 80,
        width: 640,
        height: 320,
      } as never,
    ];

    const migrated = ensureDeckShape(deck);

    expect(migrated.slides[0]?.layout).toBe("freeform");
    expect(migrated.slides[0]?.scene.elements).toHaveLength(1);
    expect(migrated.slides[0]?.scene.elements[0]).toMatchObject({
      id: "shape-1",
      type: "rectangle",
      x: 120,
      y: 80,
    });
  });

  it("strips reserved slide frames from freeform pages", () => {
    const deck = createInitialDeck();
    const slide = deck.slides[0]!;
    slide.layout = "freeform";
    slide.scene.elements = [
      {
        id: "frame-1",
        type: "frame",
        x: 0,
        y: SLIDE_CONTENT_Y,
        width: SLIDE_WIDTH,
        height: SLIDE_CONTENT_HEIGHT,
        name: "__slide-frame__Slide 1",
      } as never,
      {
        id: "shape-1",
        type: "rectangle",
        x: 200,
        y: 120,
        width: 300,
        height: 180,
        frameId: "frame-1",
      } as never,
    ];

    const migrated = ensureDeckShape(deck);
    const elements = migrated.slides[0]?.scene.elements ?? [];

    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      id: "shape-1",
      frameId: null,
    });
  });

  it("normalizes generated titles to match layout", () => {
    const deck = createInitialDeck();
    const slide = deck.slides[0]!;
    slide.title = "Slide 1";
    slide.layout = "freeform";

    const migrated = ensureDeckShape(deck);
    expect(migrated.slides[0]?.title).toBe("Page 1");

    migrated.slides[0]!.layout = "slide";
    migrated.slides[0]!.title = "Page 2";
    const remigrated = ensureDeckShape(migrated);
    expect(remigrated.slides[0]?.title).toBe("Slide 2");
  });

  it("preserves the current background color when switching layouts", () => {
    const deck = createInitialDeck();
    const slide = deck.slides[0]!;
    slide.scene.appState.viewBackgroundColor = "#abc123";

    const asSlide = setSlideLayout(slide, "slide");
    expect(asSlide.scene.appState.viewBackgroundColor).toBe("#abc123");

    const backToFreeform = setSlideLayout(asSlide, "freeform");
    expect(backToFreeform.scene.appState.viewBackgroundColor).toBe("#abc123");
  });

  it("creates new slides with the requested background", () => {
    const slide = createEmptySlide("Slide 2", "#112233");
    expect(slide.scene.appState.viewBackgroundColor).toBe("#112233");
  });

  it("fills missing background color from the app default", () => {
    const deck = createInitialDeck();
    delete deck.slides[0]!.scene.appState.viewBackgroundColor;

    const migrated = ensureDeckShape(deck);
    expect(migrated.slides[0]!.scene.appState.viewBackgroundColor).toBe(
      APP_DEFAULT_BACKGROUND,
    );
  });

  it("can convert multiple items to a single shared layout", () => {
    const first = createInitialDeck().slides[0]!;
    const second = createEmptySlide("Slide 2", "#ffffff");

    const allFreeform = [first, second].map((slide) => setSlideLayout(slide, "freeform"));
    expect(allFreeform.every((slide) => slide.layout === "freeform")).toBe(true);

    const allSlides = allFreeform.map((slide) => setSlideLayout(slide, "slide"));
    expect(allSlides.every((slide) => slide.layout === "slide")).toBe(true);
  });
});
