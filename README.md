# Excalidraw Slides Workspace

A canvas-first presentation workspace built on Excalidraw. You can work in freeform pages or slide layout, import Mermaid into the current page, and export the current page or the whole project as PNG, SVG, PDF, PPTX, or `.excalidraw`.

## Repository layout

- `apps/web`: main React + Vite application
- `packages/mermaid-to-excalidraw`: vendored Mermaid conversion package
- `UPSTREAM.md`: notes about copied upstream code

## Prerequisites

- Node.js 20+
- `pnpm@10`

## Commands

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm lint`

## Behavior notes

- Project state is stored in IndexedDB in the browser.
- Freeform and slide layout are project-wide modes, not mixed per page.
- Page-level exports are disabled when the current canvas is empty.
- Project media exports are disabled when the whole project is empty.

## GitHub Pages

- A deployment workflow is included at `.github/workflows/deploy-pages.yml`.
- Expected GitHub Pages URL for this repository: `https://jstyle21.github.io/excalidraw-slides/`
- The Vite `base` path is derived automatically in GitHub Actions from the repository name, so standard repo Pages deployments work without hardcoding a subpath locally.
- If you later deploy under a custom domain or a custom subpath, set `VITE_BASE_PATH` in the workflow environment.
- In GitHub repository settings, set `Pages -> Source` to `GitHub Actions`.

## License

- The root project is MIT-licensed.
- `packages/mermaid-to-excalidraw` is vendored upstream code and keeps its own MIT license file.
- If you redistribute the repository, keep both license files and the upstream notes.
