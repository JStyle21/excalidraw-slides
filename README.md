# Excalidraw Slides Workspace

A canvas-first presentation workspace built on Excalidraw. You can work in freeform pages or slide layout, import Mermaid into the current page, and export the current page or the whole project as PNG, SVG, PDF, PPTX, or `.excalidraw`.


## Demo
[https://jstyle21.github.io/excalidraw-slides/](https://jstyle21.github.io/excalidraw-slides/)

## Behavior notes

- Project state is stored in IndexedDB in the browser.
- Freeform and slide layout are project-wide modes, not mixed per page.

## License

- The root project is MIT-licensed.
- `packages/mermaid-to-excalidraw` is vendored upstream code and keeps its own MIT license file.
- If you redistribute the repository, keep both license files and the upstream notes.