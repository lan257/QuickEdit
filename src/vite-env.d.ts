declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const workerUrl: string;
  export default workerUrl;
}

declare module "mammoth/mammoth.browser" {
  export function convertToHtml(options: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: unknown[];
  }>;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
