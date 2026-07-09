import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const exportToBlobMock = vi.fn();
const exportToSvgMock = vi.fn();
const serializeAsJSONMock = vi.fn();

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: unknown) => elements,
  exportToBlob: exportToBlobMock,
  exportToSvg: exportToSvgMock,
  getCommonBounds: () => [0, 0, 100, 100],
  serializeAsJSON: serializeAsJSONMock,
}));

const downloadBlobMock = vi.fn();
const downloadTextMock = vi.fn();

vi.mock("./download", () => ({
  blobToDataUrl: vi.fn(),
  blobToUint8Array: vi.fn(),
  downloadBlob: downloadBlobMock,
  downloadText: downloadTextMock,
}));

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    create: vi.fn(),
  },
}));

vi.mock("pptxgenjs", () => ({
  default: vi.fn(),
}));

let classifyPptxElement: typeof import("./export").classifyPptxElement;
let classifyPptxSlide: typeof import("./export").classifyPptxSlide;
let exportCurrentSlide: typeof import("./export").exportCurrentSlide;
let exportDeck: typeof import("./export").exportDeck;
let createEmptyPage: typeof import("./deck").createEmptyPage;
let createEmptySlide: typeof import("./deck").createEmptySlide;
let createInitialDeck: typeof import("./deck").createInitialDeck;

beforeAll(async () => {
  if (!Blob.prototype.text) {
    Blob.prototype.text = function text() {
      return new Response(this).text();
    };
  }

  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer() {
      return new Response(this).arrayBuffer();
    };
  }

  ({ classifyPptxElement, classifyPptxSlide, exportCurrentSlide, exportDeck } =
    await import("./export"));
  ({ createEmptyPage, createEmptySlide, createInitialDeck } = await import("./deck"));
});

beforeEach(() => {
  exportToBlobMock.mockReset();
  exportToSvgMock.mockReset();
  serializeAsJSONMock.mockReset();
  downloadBlobMock.mockReset();
  downloadTextMock.mockReset();
});

describe("classifyPptxElement", () => {
  it("marks core shapes as editable", () => {
    expect(
      classifyPptxElement({
        type: "rectangle",
      } as never),
    ).toBe("editable");
  });

  it("marks unsupported shapes as fallback", () => {
    expect(
      classifyPptxElement({
        type: "freedraw",
      } as never),
    ).toBe("fallback");
  });

  it("forces mermaid-backed slides to svg fallback", () => {
    expect(classifyPptxSlide()).toBe("hybrid-editable");
  });
});

describe("exportCurrentSlide", () => {
  it("does not pass a null exporting frame for freeform page exports", async () => {
    exportToBlobMock.mockResolvedValue(new Blob(["png"], { type: "image/png" }));

    const page = createEmptyPage("Page 1");
    page.scene.elements = [
      {
        id: "shape-1",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 100,
        height: 80,
      } as never,
    ];

    await exportCurrentSlide(page, "png");

    expect(exportToBlobMock).toHaveBeenCalledTimes(1);
    expect(exportToBlobMock.mock.calls[0]?.[0]).toMatchObject({
      exportingFrame: undefined,
    });
  });

  it("passes the reserved frame when exporting slide layouts", async () => {
    exportToBlobMock.mockResolvedValue(new Blob(["png"], { type: "image/png" }));

    const slide = createEmptySlide("Slide 1");

    await exportCurrentSlide(slide, "png");

    expect(exportToBlobMock).toHaveBeenCalledTimes(1);
    expect(exportToBlobMock.mock.calls[0]?.[0]?.exportingFrame).toMatchObject({
      type: "frame",
      name: expect.stringContaining("Slide 1"),
    });
  });
});

describe("exportDeck", () => {
  it("uses the raw freeform SVG export path for workspace svg zip", async () => {
    exportToSvgMock.mockImplementation(async () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.textContent = "raw-svg";
      svg.appendChild(text);
      return svg;
    });

    const deck = createInitialDeck();
    deck.meta.title = "Workspace";
    deck.slides[0]!.scene.elements = [
      {
        id: "shape-1",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 100,
        height: 80,
      } as never,
    ];

    await exportDeck(deck, "svg-zip");

    expect(exportToSvgMock).toHaveBeenCalledTimes(1);
    expect(exportToSvgMock.mock.calls[0]?.[0]).toMatchObject({
      exportingFrame: undefined,
    });
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
  });

  it("uses the raw freeform PNG export path for workspace png zip", async () => {
    exportToBlobMock.mockResolvedValue(new Blob(["raw-png"], { type: "image/png" }));

    const deck = createInitialDeck();
    deck.meta.title = "Workspace";
    deck.slides[0]!.scene.elements = [
      {
        id: "shape-1",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 100,
        height: 80,
      } as never,
    ];

    await exportDeck(deck, "png-zip");

    expect(exportToBlobMock).toHaveBeenCalledTimes(1);
    expect(exportToBlobMock.mock.calls[0]?.[0]).toMatchObject({
      exportingFrame: undefined,
    });
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
  });
});
