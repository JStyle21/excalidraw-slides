export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadText = (
  content: string,
  fileName: string,
  mimeType = "text/plain;charset=utf-8",
) => {
  downloadBlob(new Blob([content], { type: mimeType }), fileName);
};

export const blobToUint8Array = async (blob: Blob) =>
  new Uint8Array(await blob.arrayBuffer());

export const blobToDataUrl = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
