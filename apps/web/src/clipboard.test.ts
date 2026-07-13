import { beforeAll, describe, expect, it, vi } from "vitest";
import { createEmptyPage } from "./deck";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: unknown) => elements,
  exportToClipboard: vi.fn(),
}));

let createWrappedTextCardElements: typeof import("./clipboard").createWrappedTextCardElements;
let handleClipboardPayload: typeof import("./clipboard").handleClipboardPayload;

beforeAll(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        measureText: (text: string) => ({ width: text.length * 16 }),
      }) as CanvasRenderingContext2D,
  );
  ({ createWrappedTextCardElements, handleClipboardPayload } = await import("./clipboard"));
});

describe("handleClipboardPayload", () => {
  it("detects plain text when the payload is not Mermaid", () => {
    expect(handleClipboardPayload({ text: "hello world" } as never)).toEqual({
      kind: "text",
      text: "hello world",
    });
  });

  it("prefers a text card when plain text paste also includes a generated text element", () => {
    expect(
      handleClipboardPayload({
        text: "hello world",
        elements: [{ type: "text" }],
      } as never),
    ).toEqual({
      kind: "text",
      text: "hello world",
    });
  });
});

describe("createWrappedTextCardElements", () => {
  it("creates a rectangle container with wrapped label text", () => {
    const slide = createEmptyPage("Page 1");
    const elements = createWrappedTextCardElements(
      slide,
      "This is a long line of pasted text that should wrap into a card instead of stretching across the whole canvas.",
    );

    expect(elements[0]).toMatchObject({
      type: "rectangle",
      label: {
        text: expect.stringContaining("\n"),
        textAlign: "left",
      },
    });
  });
});
