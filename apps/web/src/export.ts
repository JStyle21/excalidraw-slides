import {
  exportToBlob,
  exportToSvg,
  getCommonBounds,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawBindableElement,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  PointBinding,
} from "@excalidraw/excalidraw/element/types";
import { PDFDocument } from "pdf-lib";
import PptxGenJS from "pptxgenjs";
import { zipSync, strFromU8, strToU8, unzipSync } from "fflate";
import { blobToDataUrl, blobToUint8Array, downloadBlob, downloadText } from "./download";
import {
  getExportAppState,
  getFrameElement,
  getLayoutBackground,
  getRenderableElements,
  isFreeformSlide,
} from "./deck";
import {
  SLIDE_CONTENT_HEIGHT,
  PPTX_LAYOUT_NAME,
  SLIDE_CONTENT_Y,
  SLIDE_HEIGHT,
  SLIDE_TITLE_HEIGHT,
  SLIDE_WIDTH,
} from "./constants";
import type {
  DeckDocument,
  ExportCurrentSlideFormat,
  ExportDeckFormat,
  SlideDocument,
} from "./types";

const PPTX_WIDTH = 13.333;
const PPTX_HEIGHT = 7.5;
const PPTX_BASE_SCALE = PPTX_WIDTH / SLIDE_WIDTH;
const PPTX_FREEFORM_PADDING = 0.35;
const EXPORT_TITLE_PADDING_X = 72;
const EXPORT_TITLE_FONT = "700 38px 'IBM Plex Sans', 'Segoe UI', sans-serif";
const PPTX_PT_TO_EMU = 12700;
const PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

const toPptX = (x: number, max: number, target: number) => (x / max) * target;
const radToDeg = (radians: number) => (radians * 180) / Math.PI;

type Point = {
  x: number;
  y: number;
};

type PptxTransform = {
  fontScale: number;
  scale: number;
  targetHeight: number;
  targetWidth: number;
  targetX: number;
  targetY: number;
  toHeight: (value: number) => number;
  toPoint: (point: Point) => Point;
  toWidth: (value: number) => number;
  toX: (value: number) => number;
  toY: (value: number) => number;
};

const pptObjectName = (elementId: string) => `excalidraw-${elementId}`;

const shapeColors = (element: ExcalidrawElement) => ({
  color: element.strokeColor?.replace("#", "") || "1F2937",
  transparency: element.opacity ? 100 - element.opacity : 0,
  fill: {
    color:
      element.backgroundColor && element.backgroundColor !== "transparent"
        ? element.backgroundColor.replace("#", "")
        : "FFFFFF",
    transparency:
      !element.backgroundColor || element.backgroundColor === "transparent"
        ? 100
        : 0,
  },
});

const lineDash = (element: ExcalidrawElement) => {
  switch (element.strokeStyle) {
    case "dashed":
      return "dash";
    case "dotted":
      return "dot";
    default:
      return "solid";
  }
};

const buildLineProps = (
  element: ExcalidrawElement,
  overrides: Record<string, unknown> = {},
  scale = 1,
) =>
  ({
    color: shapeColors(element).color,
    width: Math.max(0.5, (element.strokeWidth ?? 1) * 0.75 * scale),
    ...overrides,
    dashType: lineDash(element),
  }) as never;

const isEditablePptxElement = (element: ExcalidrawElement) =>
  ["text", "rectangle", "ellipse", "diamond", "line", "arrow", "image"].includes(
    element.type,
  );

const svgToBlob = (svg: SVGSVGElement) =>
  new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" });

const getFrameForExport = (slide: SlideDocument) => getFrameElement(slide);

const getExportBackground = (slide: SlideDocument) => getLayoutBackground(slide);
const toPptxColor = (value: string) => value.replace("#", "");

const getPptxTransform = (slide: SlideDocument): PptxTransform => {
  if (!isFreeformSlide(slide)) {
    return {
      scale: PPTX_BASE_SCALE,
      fontScale: 1,
      targetX: 0,
      targetY: 0,
      targetWidth: PPTX_WIDTH,
      targetHeight: PPTX_HEIGHT,
      toX: (value) => toPptX(value, SLIDE_WIDTH, PPTX_WIDTH),
      toY: (value) => toPptX(value, SLIDE_HEIGHT, PPTX_HEIGHT),
      toWidth: (value) => toPptX(value, SLIDE_WIDTH, PPTX_WIDTH),
      toHeight: (value) => toPptX(value, SLIDE_HEIGHT, PPTX_HEIGHT),
      toPoint: (point) => ({
        x: toPptX(point.x, SLIDE_WIDTH, PPTX_WIDTH),
        y: toPptX(point.y, SLIDE_HEIGHT, PPTX_HEIGHT),
      }),
    };
  }

  const elements = getRenderableElements(slide);
  if (elements.length === 0) {
    return {
      scale: PPTX_BASE_SCALE,
      fontScale: 1,
      targetX: PPTX_FREEFORM_PADDING,
      targetY: PPTX_FREEFORM_PADDING,
      targetWidth: PPTX_WIDTH - PPTX_FREEFORM_PADDING * 2,
      targetHeight: PPTX_HEIGHT - PPTX_FREEFORM_PADDING * 2,
      toX: (value) => PPTX_FREEFORM_PADDING + value * PPTX_BASE_SCALE,
      toY: (value) => PPTX_FREEFORM_PADDING + value * PPTX_BASE_SCALE,
      toWidth: (value) => value * PPTX_BASE_SCALE,
      toHeight: (value) => value * PPTX_BASE_SCALE,
      toPoint: (point) => ({
        x: PPTX_FREEFORM_PADDING + point.x * PPTX_BASE_SCALE,
        y: PPTX_FREEFORM_PADDING + point.y * PPTX_BASE_SCALE,
      }),
    };
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const sourceWidth = Math.max(maxX - minX, 1);
  const sourceHeight = Math.max(maxY - minY, 1);
  const availableWidth = PPTX_WIDTH - PPTX_FREEFORM_PADDING * 2;
  const availableHeight = PPTX_HEIGHT - PPTX_FREEFORM_PADDING * 2;
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const targetWidth = sourceWidth * scale;
  const targetHeight = sourceHeight * scale;
  const targetX = PPTX_FREEFORM_PADDING + (availableWidth - targetWidth) / 2;
  const targetY = PPTX_FREEFORM_PADDING + (availableHeight - targetHeight) / 2;

  return {
    scale,
    fontScale: scale / PPTX_BASE_SCALE,
    targetX,
    targetY,
    targetWidth,
    targetHeight,
    toX: (value) => targetX + (value - minX) * scale,
    toY: (value) => targetY + (value - minY) * scale,
    toWidth: (value) => value * scale,
    toHeight: (value) => value * scale,
    toPoint: (point) => ({
      x: targetX + (point.x - minX) * scale,
      y: targetY + (point.y - minY) * scale,
    }),
  };
};

const loadImageFromBlob = async (blob: Blob) => {
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load export image"));
      img.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const decoratePngBlobWithTitle = async (slide: SlideDocument, blob: Blob) => {
  const image = await loadImageFromBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_WIDTH;
  canvas.height = SLIDE_HEIGHT;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  context.fillStyle = getExportBackground(slide);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, SLIDE_CONTENT_Y, image.width, image.height);
  context.strokeStyle = "rgba(24, 33, 39, 0.14)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(EXPORT_TITLE_PADDING_X, SLIDE_TITLE_HEIGHT - 18);
  context.lineTo(canvas.width - EXPORT_TITLE_PADDING_X, SLIDE_TITLE_HEIGHT - 18);
  context.stroke();
  context.fillStyle = "#24343a";
  context.font = EXPORT_TITLE_FONT;
  context.textBaseline = "middle";
  context.fillText(slide.title, EXPORT_TITLE_PADDING_X, SLIDE_TITLE_HEIGHT / 2);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error("Failed to serialize titled PNG export"));
        return;
      }
      resolve(result);
    }, "image/png");
  });
};

const decorateSvgBlobWithTitle = async (slide: SlideDocument, blob: Blob) => {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const documentNode = parser.parseFromString(await blob.text(), "image/svg+xml");
  const svg = documentNode.documentElement as unknown as SVGSVGElement;
  const namespace = svg.namespaceURI || "http://www.w3.org/2000/svg";

  const group = documentNode.createElementNS(namespace, "g");
  group.setAttribute("transform", `translate(0 ${SLIDE_CONTENT_Y})`);

  while (svg.firstChild) {
    group.appendChild(svg.firstChild);
  }

  const background = documentNode.createElementNS(namespace, "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", String(SLIDE_WIDTH));
  background.setAttribute("height", String(SLIDE_HEIGHT));
  background.setAttribute("fill", getExportBackground(slide));

  const divider = documentNode.createElementNS(namespace, "line");
  divider.setAttribute("x1", String(EXPORT_TITLE_PADDING_X));
  divider.setAttribute("y1", String(SLIDE_TITLE_HEIGHT - 18));
  divider.setAttribute("x2", String(SLIDE_WIDTH - EXPORT_TITLE_PADDING_X));
  divider.setAttribute("y2", String(SLIDE_TITLE_HEIGHT - 18));
  divider.setAttribute("stroke", "rgba(24, 33, 39, 0.14)");
  divider.setAttribute("stroke-width", "2");

  const title = documentNode.createElementNS(namespace, "text");
  title.setAttribute("x", String(EXPORT_TITLE_PADDING_X));
  title.setAttribute("y", String(SLIDE_TITLE_HEIGHT / 2 + 10));
  title.setAttribute("fill", "#24343a");
  title.setAttribute("font-size", "38");
  title.setAttribute("font-weight", "700");
  title.setAttribute("font-family", "IBM Plex Sans, Segoe UI, sans-serif");
  title.textContent = slide.title;

  svg.setAttribute("width", String(SLIDE_WIDTH));
  svg.setAttribute("height", String(SLIDE_HEIGHT));
  svg.setAttribute("viewBox", `0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`);
  svg.append(background, title, divider, group);

  return new Blob([serializer.serializeToString(documentNode)], {
    type: "image/svg+xml;charset=utf-8",
  });
};

const exportSlideSvgBlob = async (slide: SlideDocument) => {
  const svg = await exportToSvg({
    elements: getRenderableElements(slide),
    appState: getExportAppState(slide),
    files: slide.scene.files,
    exportingFrame: getFrameForExport(slide),
  });
  return svgToBlob(svg);
};

const exportSlidePngBlob = async (slide: SlideDocument) =>
  exportToBlob({
    elements: getRenderableElements(slide),
    appState: getExportAppState(slide),
    files: slide.scene.files,
    exportingFrame: getFrameForExport(slide),
    mimeType: "image/png",
  });

const exportDeckSlideSvgBlob = async (slide: SlideDocument) =>
  decorateSvgBlobWithTitle(slide, await exportSlideSvgBlob(slide));

const exportDeckSlidePngBlob = async (slide: SlideDocument) =>
  decoratePngBlobWithTitle(slide, await exportSlidePngBlob(slide));

const exportSlidePdfBlob = async (slide: SlideDocument) => {
  const pdf = await PDFDocument.create();
  const pngBytes = await blobToUint8Array(await exportSlidePngBlob(slide));
  const image = await pdf.embedPng(pngBytes);
  const page = pdf.addPage([image.width, image.height]);

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });

  const pdfBytes = await pdf.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
};

const addFallbackOverlay = async (
  pptxSlide: PptxGenJS.Slide,
  slide: SlideDocument,
  fallbackElements: ExcalidrawElement[],
  transform: PptxTransform,
) => {
  if (fallbackElements.length === 0) {
    return;
  }

  const svg = await exportToSvg({
    elements: fallbackElements as NonDeletedExcalidrawElement[],
    appState: getExportAppState(slide),
    files: slide.scene.files,
    exportingFrame: getFrameForExport(slide),
  });
  const data = await blobToDataUrl(svgToBlob(svg));
  const targetX = isFreeformSlide(slide) ? transform.targetX : 0;
  const targetY = isFreeformSlide(slide)
    ? transform.targetY
    : toPptX(SLIDE_CONTENT_Y, SLIDE_HEIGHT, PPTX_HEIGHT);
  const targetWidth = isFreeformSlide(slide) ? transform.targetWidth : PPTX_WIDTH;
  const targetHeight = isFreeformSlide(slide)
    ? transform.targetHeight
    : toPptX(SLIDE_CONTENT_HEIGHT, SLIDE_HEIGHT, PPTX_HEIGHT);
  pptxSlide.addImage({
    data,
    x: targetX,
    y: targetY,
    w: targetWidth,
    h: targetHeight,
  });
};

const mapPptxArrowType = (
  arrowhead: string | null | undefined,
): "none" | "triangle" | "arrow" | "oval" => {
  switch (arrowhead) {
    case "triangle":
      return "triangle";
    case "arrow":
      return "arrow";
    case "dot":
      return "oval";
    default:
      return "none";
  }
};

const getElementCenter = (element: ExcalidrawElement): Point => ({
  x: element.x + element.width / 2,
  y: element.y + element.height / 2,
});

const normalizeFixedPoint = (
  fixedPoint: readonly [number, number] | null | undefined,
) => {
  if (
    fixedPoint &&
    (Math.abs(fixedPoint[0] - 0.5) < 1e-4 || Math.abs(fixedPoint[1] - 0.5) < 1e-4)
  ) {
    return fixedPoint.map((ratio) =>
      Math.abs(ratio - 0.5) < 1e-4 ? 0.5001 : ratio,
    ) as [number, number];
  }

  return fixedPoint ? ([fixedPoint[0], fixedPoint[1]] as [number, number]) : null;
};

const getGlobalFixedPointForBindableElement = (
  fixedPointRatio: readonly [number, number],
  element: ExcalidrawBindableElement,
): Point => {
  const [fixedX, fixedY] = normalizeFixedPoint(fixedPointRatio) ?? [0.5, 0.5];
  return {
    x: element.x + element.width * fixedX,
    y: element.y + element.height * fixedY,
  };
};

const isFixedPointBinding = (
  binding: PointBinding | null | undefined,
): binding is PointBinding & { fixedPoint: readonly [number, number] } =>
  Boolean(binding && "fixedPoint" in binding && binding.fixedPoint);

const getBindingPoint = (
  binding: PointBinding | null | undefined,
  element: ExcalidrawBindableElement | undefined,
) => {
  if (!binding || !element || !isFixedPointBinding(binding)) {
    return undefined;
  }

  const fixedPoint = normalizeFixedPoint(binding.fixedPoint);
  if (!fixedPoint) {
    return undefined;
  }
  return getGlobalFixedPointForBindableElement(fixedPoint, element);
};

const getLinearTextLabelPosition = (
  container: Extract<ExcalidrawElement, { type: "line" | "arrow" }>,
  textElement: Extract<ExcalidrawElement, { type: "text" }>,
  elementLookup: Map<string, ExcalidrawElement>,
) => {
  const points = snapLinearEndpointsToBindings(container, elementLookup);
  const labelOffset =
    Math.max(12, Math.min(26, Math.max(textElement.width, textElement.height) * 0.35));

  if (points.length < 2) {
    return undefined;
  }

  const getOffsetPosition = (anchor: Point, previous: Point, next: Point) => {
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    let normalX = -dy / length;
    let normalY = dx / length;
    const labelCenterX = textElement.x + textElement.width / 2;
    const labelCenterY = textElement.y + textElement.height / 2;
    const preferredSide =
      (labelCenterX - anchor.x) * normalX + (labelCenterY - anchor.y) * normalY;

    if (preferredSide < 0 || (preferredSide === 0 && normalY > 0)) {
      normalX *= -1;
      normalY *= -1;
    }

    return {
      x: anchor.x + normalX * labelOffset - textElement.width / 2,
      y: anchor.y + normalY * labelOffset - textElement.height / 2,
    };
  };

  if (container.points.length % 2 === 1) {
    const index = Math.floor(points.length / 2);
    const anchor = points[index];
    const previous = points[index - 1];
    const next = points[index + 1];

    if (!anchor || !previous || !next) {
      return undefined;
    }

    return getOffsetPosition(anchor, previous, next);
  }

  const index = Math.floor(points.length / 2) - 1;
  const start = points[index];
  const end = points[index + 1];

  if (!start || !end) {
    return undefined;
  }

  return getOffsetPosition(
    {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    start,
    end,
  );
};

const intersectRectLike = (
  element: ExcalidrawElement,
  target: Point,
): Point => {
  const center = getElementCenter(element);
  const halfWidth = Math.max(element.width / 2, 1);
  const halfHeight = Math.max(element.height / 2, 1);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (dx === 0 && dy === 0) {
    return { x: center.x, y: element.y };
  }

  const scale = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight, 1);
  return {
    x: center.x + dx / scale,
    y: center.y + dy / scale,
  };
};

const intersectEllipse = (
  element: ExcalidrawElement,
  target: Point,
): Point => {
  const center = getElementCenter(element);
  const radiusX = Math.max(element.width / 2, 1);
  const radiusY = Math.max(element.height / 2, 1);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (dx === 0 && dy === 0) {
    return { x: center.x, y: element.y };
  }

  const scale = Math.sqrt((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY));
  return {
    x: center.x + dx / Math.max(scale, 1),
    y: center.y + dy / Math.max(scale, 1),
  };
};

const intersectDiamond = (
  element: ExcalidrawElement,
  target: Point,
): Point => {
  const center = getElementCenter(element);
  const halfWidth = Math.max(element.width / 2, 1);
  const halfHeight = Math.max(element.height / 2, 1);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (dx === 0 && dy === 0) {
    return { x: center.x, y: element.y };
  }

  const scale = Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight;
  return {
    x: center.x + dx / Math.max(scale, 1),
    y: center.y + dy / Math.max(scale, 1),
  };
};

const intersectBoundShape = (
  element: ExcalidrawElement,
  target: Point,
): Point => {
  switch (element.type) {
    case "ellipse":
      return intersectEllipse(element, target);
    case "diamond":
      return intersectDiamond(element, target);
    default:
      return intersectRectLike(element, target);
  }
};

const getLinearAbsolutePoints = (
  element: Extract<ExcalidrawElement, { type: "line" | "arrow" }>,
): Point[] => {
  const points =
    element.points.length > 0
      ? element.points
      : ([
          [0, 0],
          [element.width, element.height],
        ] as const);

  return points.map((point) => ({
    x: element.x + point[0],
    y: element.y + point[1],
  }));
};

const snapLinearEndpointsToBindings = (
  element: Extract<ExcalidrawElement, { type: "line" | "arrow" }>,
  elementLookup: Map<string, ExcalidrawElement>,
): Point[] => {
  const points = getLinearAbsolutePoints(element);

  if (points.length < 2) {
    return points;
  }

  const startTarget = points[1] ?? points[0];
  const endTarget = points[points.length - 2] ?? points[points.length - 1];
  const startBound = element.startBinding
    ? (elementLookup.get(element.startBinding.elementId) as ExcalidrawBindableElement | undefined)
    : undefined;
  const endBound = element.endBinding
    ? (elementLookup.get(element.endBinding.elementId) as ExcalidrawBindableElement | undefined)
    : undefined;
  const startFixedPoint = getBindingPoint(element.startBinding, startBound);
  const endFixedPoint = getBindingPoint(element.endBinding, endBound);

  if (startFixedPoint) {
    points[0] = startFixedPoint;
  } else if (startBound) {
    points[0] = intersectBoundShape(startBound, startTarget);
  }

  if (endFixedPoint) {
    points[points.length - 1] = endFixedPoint;
  } else if (endBound) {
    points[points.length - 1] = intersectBoundShape(endBound, endTarget);
  }

  return points;
};

const getConnectorSiteIndex = (
  element: ExcalidrawElement,
  target: Point,
) => {
  const center = getElementCenter(element);
  const halfWidth = Math.max(element.width / 2, 1);
  const halfHeight = Math.max(element.height / 2, 1);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (Math.abs(dx) / halfWidth > Math.abs(dy) / halfHeight) {
    return dx >= 0 ? 3 : 1;
  }

  return dy >= 0 ? 2 : 0;
};

const toLineWidthEmu = (value: number) => Math.round(value * PPTX_PT_TO_EMU);

const toTransformedEmu = (value: number) => Math.round(value * 914400);

const toOoxmlDash = (element: ExcalidrawElement) => {
  switch (lineDash(element)) {
    case "dash":
      return "dash";
    case "dot":
      return "sysDot";
    default:
      return "solid";
  }
};

const buildConnectorXml = ({
  element,
  connectorId,
  sourceShapeId,
  sourceIdx,
  targetShapeId,
  targetIdx,
  points,
  transform,
}: {
  element: Extract<ExcalidrawElement, { type: "line" | "arrow" }>;
  connectorId: number;
  sourceShapeId: number;
  sourceIdx: number;
  targetShapeId: number;
  targetIdx: number;
  points: Point[];
  transform: PptxTransform;
}) => {
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const flipH = end.x < start.x ? ' flipH="1"' : "";
  const flipV = end.y < start.y ? ' flipV="1"' : "";
  const offX = Math.min(...points.map((point) => point.x));
  const offY = Math.min(...points.map((point) => point.y));
  const extX = Math.max(Math.max(...points.map((point) => point.x)) - offX, 1);
  const extY = Math.max(Math.max(...points.map((point) => point.y)) - offY, 1);
  const strokeColor = element.strokeColor?.replace("#", "") || "1F2937";
  const strokeWidth = toLineWidthEmu(
    Math.max(0.5, (element.strokeWidth ?? 1) * 0.75 * transform.fontScale),
  );
  const startArrowType =
    element.type === "arrow" ? mapPptxArrowType(element.startArrowhead) : "none";
  const endArrowType =
    element.type === "arrow" ? mapPptxArrowType(element.endArrowhead) : "none";
  const connectorVariant = Math.min(Math.max(points.length - 1, 2), 5);
  const preset =
    element.type === "arrow" && "elbowed" in element && element.elbowed
      ? `bentConnector${connectorVariant}`
      : points.length > 2 || Boolean(element.roundness)
        ? `curvedConnector${connectorVariant}`
        : "straightConnector1";

  return `
    <p:cxnSp>
      <p:nvCxnSpPr>
        <p:cNvPr id="${connectorId}" name="${pptObjectName(element.id)}"/>
        <p:cNvCxnSpPr>
          <a:stCxn id="${sourceShapeId}" idx="${sourceIdx}"/>
          <a:endCxn id="${targetShapeId}" idx="${targetIdx}"/>
        </p:cNvCxnSpPr>
        <p:nvPr/>
      </p:nvCxnSpPr>
      <p:spPr>
        <a:xfrm${flipH}${flipV}>
          <a:off x="${toTransformedEmu(transform.toX(offX))}" y="${toTransformedEmu(transform.toY(offY))}"/>
          <a:ext cx="${toTransformedEmu(transform.toWidth(extX))}" cy="${toTransformedEmu(transform.toHeight(extY))}"/>
        </a:xfrm>
        <a:prstGeom prst="${preset}">
          <a:avLst/>
        </a:prstGeom>
        <a:noFill/>
        <a:ln w="${strokeWidth}">
          <a:solidFill><a:srgbClr val="${strokeColor}"/></a:solidFill>
          <a:prstDash val="${toOoxmlDash(element)}"/>
          <a:headEnd type="${startArrowType}"/>
          <a:tailEnd type="${endArrowType}"/>
        </a:ln>
      </p:spPr>
    </p:cxnSp>
  `.trim();
};

const getDirectSpTreeChildren = (spTree: Element) =>
  Array.from(spTree.childNodes).filter(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE,
  );

const getNodeObjectName = (node: Element) =>
  node.getElementsByTagNameNS(PML_NS, "cNvPr")[0]?.getAttribute("name") ?? null;

const getSpTreeChildByName = (spTree: Element, name: string) =>
  getDirectSpTreeChildren(spTree).find((node) => getNodeObjectName(node) === name) ?? null;

const getNodeBounds = (node: Element) => {
  const xfrm = node.getElementsByTagNameNS(DML_NS, "xfrm")[0];
  const off = xfrm?.getElementsByTagNameNS(DML_NS, "off")[0];
  const ext = xfrm?.getElementsByTagNameNS(DML_NS, "ext")[0];

  if (!off || !ext) {
    return null;
  }

  const x = Number(off.getAttribute("x") ?? "0");
  const y = Number(off.getAttribute("y") ?? "0");
  const cx = Number(ext.getAttribute("cx") ?? "0");
  const cy = Number(ext.getAttribute("cy") ?? "0");

  return {
    x,
    y,
    cx,
    cy,
  };
};

const createGroupNode = (
  documentNode: XMLDocument,
  groupId: number,
  name: string,
  memberNodes: Element[],
) => {
  const bounds = memberNodes
    .map((node) => getNodeBounds(node))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (bounds.length === 0) {
    return null;
  }

  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.cx));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.cy));

  const grpSp = documentNode.createElementNS(PML_NS, "p:grpSp");
  const nvGrpSpPr = documentNode.createElementNS(PML_NS, "p:nvGrpSpPr");
  const cNvPr = documentNode.createElementNS(PML_NS, "p:cNvPr");
  cNvPr.setAttribute("id", String(groupId));
  cNvPr.setAttribute("name", name);

  const cNvGrpSpPr = documentNode.createElementNS(PML_NS, "p:cNvGrpSpPr");
  const nvPr = documentNode.createElementNS(PML_NS, "p:nvPr");
  nvGrpSpPr.append(cNvPr, cNvGrpSpPr, nvPr);

  const grpSpPr = documentNode.createElementNS(PML_NS, "p:grpSpPr");
  const xfrm = documentNode.createElementNS(DML_NS, "a:xfrm");
  const off = documentNode.createElementNS(DML_NS, "a:off");
  off.setAttribute("x", String(minX));
  off.setAttribute("y", String(minY));
  const ext = documentNode.createElementNS(DML_NS, "a:ext");
  ext.setAttribute("cx", String(Math.max(maxX - minX, 1)));
  ext.setAttribute("cy", String(Math.max(maxY - minY, 1)));
  const chOff = documentNode.createElementNS(DML_NS, "a:chOff");
  chOff.setAttribute("x", String(minX));
  chOff.setAttribute("y", String(minY));
  const chExt = documentNode.createElementNS(DML_NS, "a:chExt");
  chExt.setAttribute("cx", String(Math.max(maxX - minX, 1)));
  chExt.setAttribute("cy", String(Math.max(maxY - minY, 1)));
  xfrm.append(off, ext, chOff, chExt);
  grpSpPr.append(xfrm);

  grpSp.append(nvGrpSpPr, grpSpPr);
  return grpSp;
};

const mapVerticalAlign = (
  value: string | null | undefined,
): "top" | "middle" | "bottom" => {
  switch (value) {
    case "top":
      return "top";
    case "bottom":
      return "bottom";
    default:
      return "middle";
  }
};

const getBoundContainer = (
  element: ExcalidrawElement,
  elementLookup: Map<string, ExcalidrawElement>,
) =>
  "containerId" in element && element.containerId
    ? elementLookup.get(element.containerId)
    : undefined;

const getShapeTextOptions = (
  textElement: ExcalidrawElement | undefined,
  common: { rotate: number },
) => {
  if (!textElement || textElement.type !== "text") {
    return undefined;
  }

  return {
    text: textElement.text ?? "",
    fontSize: (textElement.fontSize ?? 20) * 0.75,
    color: textElement.strokeColor?.replace("#", "") || "1F2937",
    align: (textElement.textAlign ?? "left") as "left" | "center" | "right" | "justify",
    valign: mapVerticalAlign(textElement.verticalAlign),
    margin: [0, 0, 0, 0] as [number, number, number, number],
    fit: "shrink" as const,
    breakLine: false,
    lineSpacingMultiple: 1,
    bold: false,
    ...common,
  };
};

const addEditableElement = (
  pptxSlide: PptxGenJS.Slide,
  element: ExcalidrawElement,
  files: SlideDocument["scene"]["files"],
  elementLookup: Map<string, ExcalidrawElement>,
  containerTextLookup: Map<string, ExcalidrawElement>,
  transform: PptxTransform,
) => {
  const common = {
    rotate: radToDeg(element.angle ?? 0),
  };
  const colors = shapeColors(element);

  switch (element.type) {
    case "text":
      {
        const container = getBoundContainer(element, elementLookup);
        if (
          container &&
          (container.type === "rectangle" ||
            container.type === "ellipse" ||
            container.type === "diamond")
        ) {
          return true;
        }
        const linearLabelPosition =
          container && (container.type === "line" || container.type === "arrow")
            ? getLinearTextLabelPosition(
                container,
                element,
                elementLookup,
              )
            : undefined;
        pptxSlide.addText(element.text ?? "", {
          x: transform.toX(linearLabelPosition?.x ?? element.x),
          y: transform.toY(linearLabelPosition?.y ?? element.y),
          w: transform.toWidth(Math.max(24, element.width)),
          h: transform.toHeight(Math.max(24, element.height)),
          objectName: pptObjectName(element.id),
          fontSize: (element.fontSize ?? 20) * 0.75 * transform.fontScale,
          color: colors.color,
          align: (element.textAlign ?? "left") as "left" | "center" | "right" | "justify",
          valign: mapVerticalAlign(element.verticalAlign),
          margin: [0, 0, 0, 0],
          fit: "shrink",
          breakLine: false,
          lineSpacingMultiple: 1,
          bold: false,
          ...common,
        });
        return true;
      }
    case "rectangle": {
      const textElement = containerTextLookup.get(element.id);
      const textOptions = getShapeTextOptions(textElement, common);
      if (textOptions) {
        pptxSlide.addText(textOptions.text, {
          x: transform.toX(element.x),
          y: transform.toY(element.y),
          w: transform.toWidth(element.width),
          h: transform.toHeight(element.height),
          objectName: pptObjectName(element.id),
          shape: "rect",
          line: buildLineProps(element, {}, transform.fontScale),
          fill: colors.fill,
          fontSize: textOptions.fontSize * transform.fontScale,
          color: textOptions.color,
          align: textOptions.align,
          valign: textOptions.valign,
          margin: textOptions.margin,
          fit: textOptions.fit,
          breakLine: textOptions.breakLine,
          lineSpacingMultiple: textOptions.lineSpacingMultiple,
          bold: textOptions.bold,
          ...common,
        });
        return true;
      }
      pptxSlide.addShape("rect", {
        x: transform.toX(element.x),
        y: transform.toY(element.y),
        w: transform.toWidth(element.width),
        h: transform.toHeight(element.height),
        objectName: pptObjectName(element.id),
        line: buildLineProps(element, {}, transform.fontScale),
        fill: colors.fill,
        ...common,
      });
      return true;
    }
    case "ellipse": {
      const textElement = containerTextLookup.get(element.id);
      const textOptions = getShapeTextOptions(textElement, common);
      if (textOptions) {
        pptxSlide.addText(textOptions.text, {
          x: transform.toX(element.x),
          y: transform.toY(element.y),
          w: transform.toWidth(element.width),
          h: transform.toHeight(element.height),
          objectName: pptObjectName(element.id),
          shape: "ellipse",
          line: buildLineProps(element, {}, transform.fontScale),
          fill: colors.fill,
          fontSize: textOptions.fontSize * transform.fontScale,
          color: textOptions.color,
          align: textOptions.align,
          valign: textOptions.valign,
          margin: textOptions.margin,
          fit: textOptions.fit,
          breakLine: textOptions.breakLine,
          lineSpacingMultiple: textOptions.lineSpacingMultiple,
          bold: textOptions.bold,
          ...common,
        });
        return true;
      }
      pptxSlide.addShape("ellipse", {
        x: transform.toX(element.x),
        y: transform.toY(element.y),
        w: transform.toWidth(element.width),
        h: transform.toHeight(element.height),
        objectName: pptObjectName(element.id),
        line: buildLineProps(element, {}, transform.fontScale),
        fill: colors.fill,
        ...common,
      });
      return true;
    }
    case "diamond": {
      const textElement = containerTextLookup.get(element.id);
      const textOptions = getShapeTextOptions(textElement, common);
      if (textOptions) {
        pptxSlide.addText(textOptions.text, {
          x: transform.toX(element.x),
          y: transform.toY(element.y),
          w: transform.toWidth(element.width),
          h: transform.toHeight(element.height),
          objectName: pptObjectName(element.id),
          shape: "diamond",
          line: buildLineProps(element, {}, transform.fontScale),
          fill: colors.fill,
          fontSize: textOptions.fontSize * transform.fontScale,
          color: textOptions.color,
          align: textOptions.align,
          valign: textOptions.valign,
          margin: textOptions.margin,
          fit: textOptions.fit,
          breakLine: textOptions.breakLine,
          lineSpacingMultiple: textOptions.lineSpacingMultiple,
          bold: textOptions.bold,
          ...common,
        });
        return true;
      }
      pptxSlide.addShape("diamond", {
        x: transform.toX(element.x),
        y: transform.toY(element.y),
        w: transform.toWidth(element.width),
        h: transform.toHeight(element.height),
        objectName: pptObjectName(element.id),
        line: buildLineProps(element, {}, transform.fontScale),
        fill: colors.fill,
        ...common,
      });
      return true;
    }
    case "line":
    case "arrow": {
      const snappedPoints = snapLinearEndpointsToBindings(element, elementLookup);
      const minX = Math.min(...snappedPoints.map((point) => point.x));
      const minY = Math.min(...snappedPoints.map((point) => point.y));
      const maxX = Math.max(...snappedPoints.map((point) => point.x));
      const maxY = Math.max(...snappedPoints.map((point) => point.y));
      const width = Math.max(maxX - minX, 1);
      const height = Math.max(maxY - minY, 1);
      const startArrowType =
        element.type === "arrow" ? mapPptxArrowType(element.startArrowhead) : "none";
      const endArrowType =
        element.type === "arrow" ? mapPptxArrowType(element.endArrowhead) : "none";
      pptxSlide.addShape("custGeom" as never, {
        x: transform.toX(minX),
        y: transform.toY(minY),
        w: transform.toWidth(width),
        h: transform.toHeight(height),
        objectName: pptObjectName(element.id),
        points: snappedPoints.map((point, index) => ({
          x: transform.toWidth(point.x - minX),
          y: transform.toHeight(point.y - minY),
          ...(index === 0 ? { moveTo: true } : {}),
        })),
        line: buildLineProps(element, {
          beginArrowType: startArrowType,
          endArrowType,
        }, transform.fontScale),
        lineHead: startArrowType,
        lineTail: endArrowType,
        ...common,
      });
      return true;
    }
    case "image": {
      const file = element.fileId ? files[element.fileId] : undefined;
      if (!file) {
        return false;
      }
      pptxSlide.addImage({
        data: file.dataURL,
        x: transform.toX(element.x),
        y: transform.toY(element.y),
        w: transform.toWidth(element.width),
        h: transform.toHeight(element.height),
        objectName: pptObjectName(element.id),
      });
      return true;
    }
    default:
      return false;
  }
};

export const exportCurrentSlide = async (
  slide: SlideDocument,
  format: ExportCurrentSlideFormat,
) => {
  if (format === "png") {
    downloadBlob(await exportSlidePngBlob(slide), `${slide.title}.png`);
    return;
  }

  if (format === "svg") {
    downloadBlob(await exportSlideSvgBlob(slide), `${slide.title}.svg`);
    return;
  }

  if (format === "pdf") {
    downloadBlob(await exportSlidePdfBlob(slide), `${slide.title}.pdf`);
    return;
  }

  const json = serializeAsJSON(
    getRenderableElements(slide),
    getExportAppState(slide) as never,
    slide.scene.files,
    "local",
  );
  downloadText(json, `${slide.title}.excalidraw`, "application/json;charset=utf-8");
};

export const exportDeckJson = (deck: DeckDocument) => {
  downloadText(
    JSON.stringify(deck, null, 2),
    `${deck.meta.title}.deck.json`,
    "application/json;charset=utf-8",
  );
};

const exportDeckPdfBlob = async (deck: DeckDocument) => {
  const pdf = await PDFDocument.create();

  for (const slide of deck.slides) {
    const blob = isFreeformSlide(slide)
      ? await exportSlidePngBlob(slide)
      : await exportDeckSlidePngBlob(slide);
    const pngBytes = await blobToUint8Array(blob);
    const image = await pdf.embedPng(pngBytes);
    const page = pdf.addPage(
      isFreeformSlide(slide) ? [image.width, image.height] : [SLIDE_WIDTH, SLIDE_HEIGHT],
    );
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: isFreeformSlide(slide) ? image.width : SLIDE_WIDTH,
      height: isFreeformSlide(slide) ? image.height : SLIDE_HEIGHT,
    });
  }

  const pdfBytes = await pdf.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
};

const exportDeckZipBlob = async (
  deck: DeckDocument,
  type: "png" | "svg",
) => {
  const entries: Record<string, Uint8Array> = {};

  for (const [index, slide] of deck.slides.entries()) {
    const fileName = `${String(index + 1).padStart(2, "0")}-${slide.title}.${type}`;
    const blob =
      type === "png"
        ? isFreeformSlide(slide)
          ? await exportSlidePngBlob(slide)
          : await exportDeckSlidePngBlob(slide)
        : isFreeformSlide(slide)
          ? await exportSlideSvgBlob(slide)
          : await exportDeckSlideSvgBlob(slide);
    entries[fileName] =
      type === "png"
        ? await blobToUint8Array(blob)
        : strToU8(await blob.text());
  }

  const zipped = zipSync(entries);
  return new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
};

const patchPptxConnectorsBlob = async (
  deck: DeckDocument,
  blob: Blob,
) => {
  const archive = unzipSync(await blobToUint8Array(blob));

  deck.slides.forEach((slide, index) => {
    const transform = getPptxTransform(slide);
    const entryName = `ppt/slides/slide${index + 1}.xml`;
    const entry = archive[entryName];
    if (!entry) {
      return;
    }

    const xml = strFromU8(entry);
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(xml, "application/xml");
    const serializer = new XMLSerializer();
    const spTree = documentNode.getElementsByTagNameNS(PML_NS, "spTree")[0];

    if (!spTree) {
      return;
    }

    const shapeIds = new Map<string, number>();
    let maxShapeId = 1;

    Array.from(documentNode.getElementsByTagNameNS(PML_NS, "cNvPr")).forEach((node) => {
      const name = node.getAttribute("name");
      const id = Number(node.getAttribute("id") ?? "0");
      if (name) {
        shapeIds.set(name, id);
      }
      maxShapeId = Math.max(maxShapeId, id);
    });

    for (const element of getRenderableElements(slide)) {
      if (
        (element.type !== "line" && element.type !== "arrow") ||
        !element.startBinding ||
        !element.endBinding
      ) {
        continue;
      }

      const sourceShapeId = shapeIds.get(pptObjectName(element.startBinding.elementId));
      const targetShapeId = shapeIds.get(pptObjectName(element.endBinding.elementId));
      const sourceShape = slide.scene.elements.find(
        (candidate) => candidate.id === element.startBinding?.elementId,
      );
      const targetShape = slide.scene.elements.find(
        (candidate) => candidate.id === element.endBinding?.elementId,
      );

      if (!sourceShapeId || !targetShapeId || !sourceShape || !targetShape) {
        continue;
      }

      const points = snapLinearEndpointsToBindings(
        element,
        new Map(slide.scene.elements.map((sceneElement) => [sceneElement.id, sceneElement])),
      );
      const sourceIdx = getConnectorSiteIndex(sourceShape, points[1] ?? points[0]!);
      const targetIdx = getConnectorSiteIndex(
        targetShape,
        points[points.length - 2] ?? points[points.length - 1]!,
      );

      const shapeNodes = getDirectSpTreeChildren(spTree).filter(
        (node) => node.localName === "sp" && getNodeObjectName(node) === pptObjectName(element.id),
      );

      for (const shapeNode of shapeNodes) {
        maxShapeId += 1;
        const connectorXml = buildConnectorXml({
          element,
          connectorId: maxShapeId,
          sourceShapeId,
          sourceIdx,
          targetShapeId,
          targetIdx,
          points,
          transform,
        });
        const connectorNode = parser.parseFromString(
          `<wrapper xmlns:p="${PML_NS}" xmlns:a="${DML_NS}">${connectorXml}</wrapper>`,
          "application/xml",
        ).documentElement.firstElementChild;

        if (connectorNode) {
          spTree.replaceChild(documentNode.importNode(connectorNode, true), shapeNode);
        }
      }
    }

    const linearElementIds = new Set(
      slide.scene.elements
        .filter((element) => element.type === "line" || element.type === "arrow")
        .map((element) => element.id),
    );
    const groupedLabelIds = new Set<string>();

    for (const element of slide.scene.elements) {
      if (
        element.type !== "text" ||
        !("containerId" in element) ||
        !element.containerId ||
        groupedLabelIds.has(element.id) ||
        !linearElementIds.has(element.containerId)
      ) {
        continue;
      }

      const relatedLabels = slide.scene.elements.filter(
        (candidate) =>
          candidate.type === "text" &&
          "containerId" in candidate &&
          candidate.containerId === element.containerId,
      );
      const connectorNode = getSpTreeChildByName(spTree, pptObjectName(element.containerId));
      const labelNodes = relatedLabels
        .map((label) => ({
          label,
          node: getSpTreeChildByName(spTree, pptObjectName(label.id)),
        }))
        .filter((entry): entry is { label: typeof relatedLabels[number]; node: Element } =>
          Boolean(entry.node),
        );

      if (!connectorNode || labelNodes.length === 0) {
        continue;
      }

      const orderedMembers = [connectorNode, ...labelNodes.map((entry) => entry.node)].sort(
        (left, right) =>
          getDirectSpTreeChildren(spTree).indexOf(left) -
          getDirectSpTreeChildren(spTree).indexOf(right),
      );
      maxShapeId += 1;
      const groupNode = createGroupNode(
        documentNode,
        maxShapeId,
        `${pptObjectName(element.containerId)}-group`,
        orderedMembers,
      );

      if (!groupNode) {
        continue;
      }

      const anchorNode = orderedMembers[0];
      spTree.insertBefore(groupNode, anchorNode);
      orderedMembers.forEach((member) => {
        groupNode.appendChild(member);
      });
      labelNodes.forEach((entry) => groupedLabelIds.add(entry.label.id));
    }

    archive[entryName] = strToU8(serializer.serializeToString(documentNode));
  });

  const zipped = zipSync(archive);
  return new Blob([zipped as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
};

const exportDeckPptx = async (deck: DeckDocument) => {
  const pptx = new PptxGenJS();
  pptx.layout = PPTX_LAYOUT_NAME;
  pptx.author = "OpenAI Codex";
  pptx.subject = deck.meta.title;
  pptx.title = deck.meta.title;

  for (const slide of deck.slides) {
    const pptxSlide = pptx.addSlide();
    const transform = getPptxTransform(slide);
    pptxSlide.background = { color: toPptxColor(getExportBackground(slide)) };
    if (!isFreeformSlide(slide)) {
      pptxSlide.addText(slide.title, {
        x: 0.5,
        y: 0.2,
        w: PPTX_WIDTH - 1,
        h: 0.45,
        fontSize: 24,
        bold: true,
        color: "24343A",
        margin: 0,
      });
    }
    const fallbackElements: ExcalidrawElement[] = [];
    const elementLookup = new Map(slide.scene.elements.map((element) => [element.id, element]));
    const containerTextLookup = new Map(
      slide.scene.elements.flatMap((element) =>
        element.type === "text" && "containerId" in element && element.containerId
          ? [[element.containerId, element] as const]
          : [],
      ),
    );

    for (const element of getRenderableElements(slide)) {
      if (
        !isEditablePptxElement(element) ||
        !addEditableElement(
          pptxSlide,
          element,
          slide.scene.files,
          elementLookup,
          containerTextLookup,
          transform,
        )
      ) {
        fallbackElements.push(element);
      }
    }

    await addFallbackOverlay(pptxSlide, slide, fallbackElements, transform);
  }

  const rawBlob = await pptx.write({ outputType: "blob" as never });
  const patchedBlob = await patchPptxConnectorsBlob(deck, rawBlob as Blob);
  downloadBlob(patchedBlob, `${deck.meta.title}.pptx`);
};

export const exportDeck = async (
  deck: DeckDocument,
  format: ExportDeckFormat,
) => {
  switch (format) {
    case "pdf":
      downloadBlob(await exportDeckPdfBlob(deck), `${deck.meta.title}.pdf`);
      return;
    case "png-zip":
      downloadBlob(await exportDeckZipBlob(deck, "png"), `${deck.meta.title}-png.zip`);
      return;
    case "svg-zip":
      downloadBlob(await exportDeckZipBlob(deck, "svg"), `${deck.meta.title}-svg.zip`);
      return;
    case "pptx":
      await exportDeckPptx(deck);
      return;
  }
};

export const classifyPptxElement = (element: ExcalidrawElement) =>
  isEditablePptxElement(element) ? "editable" : "fallback";
export const classifyPptxSlide = () => "hybrid-editable";
