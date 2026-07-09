import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: unknown) => elements,
}));

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: vi.fn(),
}));

let extractMermaidDefinition: typeof import("./mermaid").extractMermaidDefinition;

beforeAll(async () => {
  ({ extractMermaidDefinition } = await import("./mermaid"));
});

describe("extractMermaidDefinition", () => {
  it("extracts fenced mermaid blocks from AI output", () => {
    const input = "Here you go\n```mermaid\nflowchart TD\nA --> B\n```";
    expect(extractMermaidDefinition(input)).toBe("flowchart TD\nA --> B");
  });

  it("accepts plain mermaid text", () => {
    expect(extractMermaidDefinition("sequenceDiagram\nAlice->>Bob: Hi")).toBe(
      "sequenceDiagram\nAlice->>Bob: Hi",
    );
  });

  it("extracts a mermaid block from mixed AI text without fences", () => {
    const input = "Architecture draft:\n\nflowchart TD\nA --> B\nB --> C";
    expect(extractMermaidDefinition(input)).toBe("flowchart TD\nA --> B\nB --> C");
  });

  it("ignores unrelated text", () => {
    expect(extractMermaidDefinition("hello world")).toBeNull();
  });
});
