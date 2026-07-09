import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DefaultSidebar, Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nanoid } from "nanoid";
import { copySlideToExcalidrawClipboard, handleClipboardPayload, mergeClipboardElements } from "./clipboard";
import {
  createEmptyPage,
  createEmptySlide,
  createInitialDeck,
  ensureDeckShape,
  getFrameElement,
  getLayoutBackground,
  getRenderableElements,
  parseDeckDocument,
  renameSlide,
  setSlideLayout,
  touchDeck,
} from "./deck";
import { exportCurrentSlide, exportDeck, exportDeckJson } from "./export";
import { applyMermaidImport, extractMermaidDefinition } from "./mermaid";
import { loadDeck, saveDeck } from "./persistence";
import type { DeckDocument, ExportCurrentSlideFormat, ExportDeckFormat, SlideDocument } from "./types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

const isExcalidrawScenePayload = (
  value: unknown,
): value is { elements: ExcalidrawElement[]; appState?: unknown; files?: Record<string, unknown> } =>
  Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { elements?: unknown }).elements),
  );

const readTextFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(file);
  });

const filePickerAccept = (accept: string) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  return new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
};

const getBaseName = (fileName: string) =>
  fileName.replace(/\.[^.]+$/, "").trim() || "Untitled page";

const isTextInputTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

const getResetCanvasShortcutLabel = () => {
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform)) {
    return "Cmd+Shift+Backspace";
  }

  return "Ctrl+Shift+Backspace";
};

const updateSlideInDeck = (
  deck: DeckDocument,
  slideId: string,
  updater: (slide: SlideDocument) => SlideDocument,
) => ({
  ...deck,
  slides: deck.slides.map((slide) => (slide.id === slideId ? updater(slide) : slide)),
});

const pickPersistedAppState = (
  appState: unknown,
): SlideDocument["scene"]["appState"] => {
  const source = (appState ?? {}) as Record<string, unknown>;

  return {
    viewBackgroundColor: source.viewBackgroundColor as string | undefined,
    currentItemFontFamily: source.currentItemFontFamily as number | undefined,
    currentItemFontSize: source.currentItemFontSize as number | undefined,
    exportBackground: source.exportBackground as boolean | undefined,
    exportScale: source.exportScale as number | undefined,
    theme: source.theme as "light" | "dark" | undefined,
  };
};

const scenesEqual = (
  left: SlideDocument["scene"],
  right: SlideDocument["scene"],
) =>
  JSON.stringify(left.elements) === JSON.stringify(right.elements) &&
  JSON.stringify(left.appState) === JSON.stringify(right.appState) &&
  JSON.stringify(left.files) === JSON.stringify(right.files);

const isBlankSlide = (slide: SlideDocument) =>
  getRenderableElements(slide).length === 0 && slide.imports.length === 0;

export const App = () => {
  const [deck, setDeck] = useState<DeckDocument>(createInitialDeck());
  const [activeSlideId, setActiveSlideId] = useState<string>("");
  const [mermaidDraft, setMermaidDraft] = useState("");
  const [isMermaidOpen, setIsMermaidOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [editorMountNonce, setEditorMountNonce] = useState(0);
  const [editorSceneNonce, setEditorSceneNonce] = useState(0);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    loadDeck().then((savedDeck) => {
      const nextDeck = ensureDeckShape(savedDeck);
      setDeck(nextDeck);
      setActiveSlideId(nextDeck.slides[0]?.id ?? "");
      setIsReady(true);
    });
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void saveDeck(deck);
  }, [deck, isReady]);

  const activeSlide = deck.slides.find((slide) => slide.id === activeSlideId) ?? deck.slides[0];
  const hasMultiplePages = deck.slides.length > 1;
  const hasProjectContent = deck.slides.some((slide) => !isBlankSlide(slide));
  const canExportPptx =
    activeSlide?.layout === "slide" &&
    deck.slides.some((slide) => slide.layout === "slide");
  const initialSceneData = activeSlide
    ? {
        ...activeSlide.scene,
        scrollToContent: true,
      }
    : null;

  useEffect(() => {
    if (!activeSlide && deck.slides[0]) {
      setActiveSlideId(deck.slides[0].id);
    }
  }, [activeSlide, deck.slides]);

  useEffect(() => {
    if (!isReady || !activeSlide || !apiRef.current) {
      return;
    }

    const visibleElements = getRenderableElements(activeSlide);
    const slideFrame = getFrameElement(activeSlide);
    const api = apiRef.current;
    const fitScene = () => {
      api.refresh();

      if (slideFrame) {
        api.scrollToContent(slideFrame, {
          fitToViewport: true,
          viewportZoomFactor: 0.86,
          animate: false,
        });
        return true;
      }

      if (visibleElements.length > 0) {
        api.scrollToContent(visibleElements, {
          fitToViewport: true,
          viewportZoomFactor: 0.98,
          animate: false,
        });
        return true;
      }

      api.updateScene({
        appState: {
          scrollX: 0,
          scrollY: 0,
          zoom: { value: 1 as AppState["zoom"]["value"] },
        },
      });
      return false;
    };

    const timers = [120, 360, 900].map((delay) =>
      window.setTimeout(() => {
        fitScene();
      }, delay),
    );

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [activeSlide?.id, activeSlide?.layout, editorMountNonce, isReady]);

  const setDeckWithTouch = (updater: (current: DeckDocument) => DeckDocument) => {
    setDeck((current) => touchDeck(updater(current)));
  };

  const syncActiveSlideToEditor = (_slide: SlideDocument) => {
    setEditorSceneNonce((value) => value + 1);
  };

  const resetSlideCanvas = (slide: SlideDocument): SlideDocument => {
    const background = getLayoutBackground(slide);
    const base =
      slide.layout === "slide"
        ? createEmptySlide(slide.title, background)
        : createEmptyPage(slide.title, background);

    return {
      ...base,
      id: slide.id,
      scene: {
        ...base.scene,
        appState: {
          ...base.scene.appState,
          ...pickPersistedAppState(slide.scene.appState),
          viewBackgroundColor: background,
        },
      },
    };
  };

  const onSceneChange = (
    elements: readonly ExcalidrawElement[],
    appState: unknown,
    files: SlideDocument["scene"]["files"],
  ) => {
    if (!activeSlide) {
      return;
    }

    setDeck((current) => {
      const existingSlide =
        current.slides.find((slide) => slide.id === activeSlide.id) ?? activeSlide;
      const nextScene: SlideDocument["scene"] = {
        elements: [...elements] as ExcalidrawElement[],
        appState: pickPersistedAppState(appState),
        files,
      };

      if (scenesEqual(existingSlide.scene, nextScene)) {
        return current;
      }

      return updateSlideInDeck(current, activeSlide.id, (slide) => ({
        ...slide,
        scene: nextScene,
      }));
    });
  };

  const handleMermaidSubmit = async () => {
    if (!activeSlide || !mermaidDraft.trim()) {
      return;
    }

    const source = extractMermaidDefinition(mermaidDraft) ?? mermaidDraft.trim();
    const { slide } = await applyMermaidImport(activeSlide, source);
    setDeckWithTouch((current) =>
      updateSlideInDeck(current, activeSlide.id, () => slide),
    );
    syncActiveSlideToEditor(slide);
    setMermaidDraft("");
    setIsMermaidOpen(false);
  };

  const handlePaste = async (data: ClipboardData) => {
    if (!activeSlide) {
      return false;
    }

    const action = handleClipboardPayload(data);
    if (action.kind === "excalidraw" && data.elements) {
      if (isBlankSlide(activeSlide)) {
        const importedBackground = getLayoutBackground(activeSlide);
        setDeckWithTouch((current) =>
          updateSlideInDeck(current, activeSlide.id, (slide) => ({
            ...slide,
            layout: "freeform",
            imports: [],
            scene: {
              elements: [...(data.elements ?? [])] as ExcalidrawElement[],
              appState: {
                ...pickPersistedAppState(undefined),
                viewBackgroundColor: importedBackground,
              },
              files: (data.files ?? {}) as BinaryFiles,
            },
          })),
        );
        syncActiveSlideToEditor({
          ...activeSlide,
          layout: "freeform",
          imports: [],
          scene: {
            elements: [...(data.elements ?? [])] as ExcalidrawElement[],
            appState: {
              ...pickPersistedAppState(undefined),
              viewBackgroundColor: importedBackground,
            },
            files: (data.files ?? {}) as BinaryFiles,
          },
        });
        return true;
      }

      const mergedSlide = mergeClipboardElements(activeSlide, data.elements ?? [], data.files ?? {});
      setDeckWithTouch((current) =>
        updateSlideInDeck(current, activeSlide.id, (slide) =>
          mergeClipboardElements(slide, data.elements ?? [], data.files ?? {}),
        ),
      );
      syncActiveSlideToEditor(mergedSlide);
      return true;
    }

    if (action.kind === "mermaid" && action.text) {
      const { slide } = await applyMermaidImport(activeSlide, action.text);
      setDeckWithTouch((current) =>
        updateSlideInDeck(current, activeSlide.id, () => slide),
      );
      syncActiveSlideToEditor(slide);
      return true;
    }

    return false;
  };

  const addPage = () => {
    const nextSlide = createEmptyPage(
      `Page ${deck.slides.length + 1}`,
      getLayoutBackground(activeSlide),
    );
    setDeckWithTouch((current) => ({
      ...current,
      slides: [...current.slides, nextSlide],
    }));
    setActiveSlideId(nextSlide.id);
  };

  const addSlide = () => {
    const nextSlide = createEmptySlide(
      `Slide ${deck.slides.length + 1}`,
      getLayoutBackground(activeSlide),
    );
    setDeckWithTouch((current) => ({
      ...current,
      slides: [...current.slides, nextSlide],
    }));
    setActiveSlideId(nextSlide.id);
  };

  const deleteSlide = () => {
    if (!activeSlide || deck.slides.length === 1) {
      return;
    }

    const index = deck.slides.findIndex((slide) => slide.id === activeSlide.id);
    setDeckWithTouch((current) => ({
      ...current,
      slides: current.slides.filter((slide) => slide.id !== activeSlide.id),
    }));
    const replacement = deck.slides[index - 1] ?? deck.slides[index + 1];
    if (replacement) {
      setActiveSlideId(replacement.id);
    }
  };

  const duplicateSlide = () => {
    if (!activeSlide) {
      return;
    }

    const duplicate: SlideDocument = {
      ...activeSlide,
      id: nanoid(),
      title: `${activeSlide.title} copy`,
      scene: {
        ...activeSlide.scene,
        elements: activeSlide.scene.elements.map((element) => ({
          ...element,
          id: nanoid(),
          groupIds: [...element.groupIds],
        })),
      },
      imports: activeSlide.imports.map((record) => ({
        ...record,
        id: nanoid(),
      })),
    };

    setDeckWithTouch((current) => ({
      ...current,
      slides: [...current.slides, duplicate],
    }));
    setActiveSlideId(duplicate.id);
  };

  const renameActiveSlide = (title: string) => {
    if (!activeSlide) {
      return;
    }

    setDeckWithTouch((current) =>
      updateSlideInDeck(current, activeSlide.id, (slide) => renameSlide(slide, title)),
    );
  };

  const setActiveLayout = (layout: SlideDocument["layout"]) => {
    if (!activeSlide) {
      return;
    }

    setDeckWithTouch((current) => ({
      ...current,
      slides: current.slides.map((slide) => setSlideLayout(slide, layout)),
    }));
  };

  const importDeckFile = async () => {
    const file = await filePickerAccept(".json,.deck.json");
    if (!file) {
      return;
    }

    const nextDeck = parseDeckDocument(JSON.parse(await readTextFile(file)));
    setDeck(nextDeck);
    setActiveSlideId(nextDeck.slides[0]?.id ?? "");
  };

  const importExcalidrawSlide = async () => {
    if (!activeSlide) {
      return;
    }

    const file = await filePickerAccept(".excalidraw,.json");
    if (!file) {
      return;
    }

    const parsed = JSON.parse(await readTextFile(file));
    if (!isExcalidrawScenePayload(parsed)) {
      return;
    }

    setDeckWithTouch((current) =>
      updateSlideInDeck(current, activeSlide.id, (slide) => ({
        ...slide,
        title: getBaseName(file.name),
        layout: "freeform",
        imports: [],
        scene: {
          elements: parsed.elements as ExcalidrawElement[],
          appState: {
            ...pickPersistedAppState(parsed.appState),
            viewBackgroundColor:
              (parsed.appState as { viewBackgroundColor?: string } | undefined)
                ?.viewBackgroundColor ?? getLayoutBackground(slide),
          },
          files: (parsed.files ?? {}) as BinaryFiles,
        },
      })),
    );
    syncActiveSlideToEditor({
      ...activeSlide,
      title: getBaseName(file.name),
      layout: "freeform",
      imports: [],
      scene: {
        elements: parsed.elements as ExcalidrawElement[],
        appState: {
          ...pickPersistedAppState(parsed.appState),
          viewBackgroundColor:
            (parsed.appState as { viewBackgroundColor?: string } | undefined)
              ?.viewBackgroundColor ?? getLayoutBackground(activeSlide),
        },
        files: (parsed.files ?? {}) as BinaryFiles,
      },
    });
  };

  const copyCurrentMermaid = async () => {
    if (!activeSlide || activeSlide.imports.length === 0) {
      return;
    }

    const source = activeSlide.imports.map((record) => record.source).join("\n\n");
    await navigator.clipboard.writeText(source);
  };

  const resetActiveCanvas = () => {
    if (!activeSlide || isBlankSlide(activeSlide)) {
      return;
    }

    const resetSlide = resetSlideCanvas(activeSlide);
    setDeckWithTouch((current) =>
      updateSlideInDeck(current, activeSlide.id, () => resetSlide),
    );
    syncActiveSlideToEditor(resetSlide);
  };

  const copyCurrentSlide = async () => {
    if (!activeSlide) {
      return;
    }
    await copySlideToExcalidrawClipboard(activeSlide);
  };

  const runCurrentSlideExport = async (format: ExportCurrentSlideFormat) => {
    if (!activeSlide) {
      return;
    }
    await exportCurrentSlide(activeSlide, format);
  };

  const runWorkspaceExport = async (format: ExportDeckFormat) => {
    await exportDeck(deck, format);
  };

  if (!activeSlide) {
    return null;
  }

  const isCanvasEmpty = isBlankSlide(activeSlide);
  const resetCanvasShortcutLabel = getResetCanvasShortcutLabel();
  const workspaceBackground = getLayoutBackground(activeSlide);
  const workspaceTheme = activeSlide.scene.appState?.theme ?? "light";
  const appShellStyle = {
    "--workspace-bg": workspaceBackground,
    "--workspace-panel-bg": workspaceBackground,
    "--workspace-input-bg":
      workspaceTheme === "dark"
        ? `color-mix(in srgb, ${workspaceBackground} 84%, #101215)`
        : `color-mix(in srgb, ${workspaceBackground} 82%, #ffffff)`,
  } as CSSProperties;
  const toggleLibrary = () => {
    apiRef.current?.toggleSidebar({
      name: "default",
      tab: "library",
      force: undefined,
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !activeSlide ||
        isCanvasEmpty ||
        isTextInputTarget(event.target) ||
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.key !== "Backspace"
      ) {
        return;
      }

      event.preventDefault();
      resetActiveCanvas();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSlide, isCanvasEmpty]);

  return (
    <div
      className={[
        "app-shell",
        isSidebarCollapsed ? "sidebar-collapsed" : "",
        workspaceTheme === "dark" ? "theme-dark" : "theme-light",
      ]
        .filter(Boolean)
        .join(" ")}
      style={appShellStyle}
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <button
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? ">" : "<"}
          </button>
        </div>

        <div className="sidebar-scroll">
          <label className="stack">
            <span className="label">Project title</span>
            <input
              value={deck.meta.title}
              onChange={(event) =>
                setDeckWithTouch((current) => ({
                  ...current,
                  meta: {
                    ...current.meta,
                    title: event.target.value,
                  },
                }))
              }
            />
          </label>

          <div className="stack">
            <div className="panel-title">Pages</div>
            <div className="slide-list">
              {deck.slides.map((slide, index) => (
                <button
                  key={slide.id}
                  className={slide.id === activeSlide.id ? "slide-card active" : "slide-card"}
                  onClick={() => setActiveSlideId(slide.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div className="slide-meta">
                    <strong>{slide.title}</strong>
                    <small>{slide.layout === "freeform" ? "Freeform" : "Slide"}</small>
                  </div>
                </button>
              ))}
            </div>
            <div className="button-row">
              <button onClick={activeSlide.layout === "slide" ? addSlide : addPage}>
                {activeSlide.layout === "slide" ? "Add slide" : "Add page"}
              </button>
              <button onClick={duplicateSlide}>Duplicate</button>
              <button onClick={deleteSlide} disabled={deck.slides.length === 1}>
                Delete
              </button>
            </div>
          </div>

          <label className="stack">
            <span className="label">
              {activeSlide.layout === "slide" ? "Current slide title" : "Current page title"}
            </span>
            <input
              value={activeSlide.title}
              onChange={(event) => renameActiveSlide(event.target.value)}
            />
          </label>

          <div className="stack">
            <div className="panel-title">Page layout</div>
            <div className="button-row">
              <button
                className={activeSlide.layout === "freeform" ? "active-toggle" : "ghost"}
                onClick={() => setActiveLayout("freeform")}
              >
                Freeform
              </button>
              <button
                className={activeSlide.layout === "slide" ? "active-toggle" : "ghost"}
                onClick={() => setActiveLayout("slide")}
              >
                Slide
              </button>
            </div>
          </div>

          <div className="stack">
            <div className="panel-title">Page actions</div>
            <div className="stack action-group">
              <span className="label">Mermaid</span>
              <div className="button-grid">
                <button type="button" onClick={() => setIsMermaidOpen(true)}>
                  Paste Mermaid
                </button>
                <button
                  type="button"
                  onClick={copyCurrentMermaid}
                  disabled={activeSlide.imports.length === 0}
                >
                  Copy Mermaid
                </button>
              </div>
            </div>
            <div className="stack action-group">
              <span className="label">Excalidraw</span>
              <div className="button-grid">
                <button type="button" onClick={copyCurrentSlide} disabled={isCanvasEmpty}>
                  Copy to Excalidraw
                </button>
                <button type="button" onClick={importExcalidrawSlide}>
                  Import .excalidraw
                </button>
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="panel-title">Current page export</div>
            <div className="button-row">
              <button onClick={() => runCurrentSlideExport("png")} disabled={isCanvasEmpty}>
                PNG
              </button>
              <button onClick={() => runCurrentSlideExport("svg")} disabled={isCanvasEmpty}>
                SVG
              </button>
              <button onClick={() => runCurrentSlideExport("pdf")} disabled={isCanvasEmpty}>
                PDF
              </button>
              <button
                onClick={() => runCurrentSlideExport("excalidraw")}
                disabled={isCanvasEmpty}
              >
                .excalidraw
              </button>
            </div>
          </div>

          <div className="stack">
            <div className="panel-title">Project</div>
            <div className="button-grid">
              <button onClick={importDeckFile}>Import project JSON</button>
              <button onClick={() => exportDeckJson(deck)}>Export project JSON</button>
            </div>
          </div>

          {hasMultiplePages || canExportPptx ? (
            <div className="stack">
              <div className="panel-title">Project export</div>
              <div className="button-grid">
                {hasMultiplePages ? (
                  <>
                    <button
                      onClick={() => runWorkspaceExport("pdf")}
                      disabled={!hasProjectContent}
                    >
                      PDF
                    </button>
                    <button
                      onClick={() => runWorkspaceExport("png-zip")}
                      disabled={!hasProjectContent}
                    >
                      PNG ZIP
                    </button>
                    <button
                      onClick={() => runWorkspaceExport("svg-zip")}
                      disabled={!hasProjectContent}
                    >
                      SVG ZIP
                    </button>
                  </>
                ) : null}
                {canExportPptx ? (
                  <button
                    onClick={() => runWorkspaceExport("pptx")}
                    disabled={!hasProjectContent}
                  >
                    PPTX
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="editor-shell">
        {isSidebarCollapsed ? (
          <button
            className="sidebar-reveal"
            onClick={() => setIsSidebarCollapsed(false)}
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            {">"}
          </button>
        ) : null}
        <div className="editor-frame">
          <Excalidraw
            key={`${activeSlide.id}:${activeSlide.layout}:${editorSceneNonce}`}
            excalidrawAPI={(api) => {
              apiRef.current = api;
              setEditorMountNonce((value) => value + 1);
            }}
            initialData={initialSceneData}
            onChange={onSceneChange}
            onPaste={handlePaste}
            UIOptions={{
              canvasActions: {
                saveToActiveFile: false,
                loadScene: false,
                export: false,
              },
            }}
            renderTopRightUI={() => (
              <button
                type="button"
                className="local-library-trigger"
                onClick={toggleLibrary}
              >
                Library
              </button>
            )}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.Item
                shortcut={resetCanvasShortcutLabel}
                disabled={isCanvasEmpty}
                onClick={resetActiveCanvas}
              >
                Reset the canvas
              </MainMenu.Item>
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
            <DefaultSidebar />
          </Excalidraw>
        </div>
      </main>

      {isMermaidOpen ? (
        <div className="modal-backdrop" onClick={() => setIsMermaidOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Paste Mermaid or AI output</p>
                <h2>Insert into current page</h2>
              </div>
              <button type="button" className="ghost" onClick={() => setIsMermaidOpen(false)}>
                Close
              </button>
            </div>
            <textarea
              value={mermaidDraft}
              onChange={(event) => setMermaidDraft(event.target.value)}
              placeholder={"```mermaid\nflowchart TD\n  A[Idea] --> B[Slide]\n```"}
            />
            <div className="button-row">
              <button type="button" onClick={handleMermaidSubmit}>
                Insert Mermaid
              </button>
              <button type="button" className="ghost" onClick={() => setMermaidDraft("")}>
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
