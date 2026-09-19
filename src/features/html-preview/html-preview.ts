// §8: 静态 HTML 预览。DOMPurify 净化 + CSP + 完全沙箱 iframe：脚本永不执行，
// 远程资源永不抓取，但页面自身的 <head> 样式必须保留，否则布局全部丢失。
const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; img-src data: blob:;";

function buildFrameDocument(clean: string): string {
  const parsed = new DOMParser().parseFromString(clean, "text/html");
  // sandbox 已禁止顶层跳转，再去掉 href 防止预览框自身被导航到外部站点。
  parsed.querySelectorAll("a[href]").forEach((anchor) => anchor.removeAttribute("href"));
  const csp = parsed.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", HTML_PREVIEW_CSP);
  parsed.head.insertBefore(csp, parsed.head.firstChild);
  if (!parsed.querySelector("meta[charset]")) {
    const charset = parsed.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    parsed.head.insertBefore(charset, csp.nextSibling);
  }
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

export async function renderHtmlPreviewDocument(source: string): Promise<string> {
  const { default: DOMPurify } = await import("dompurify");
  // WHOLE_DOCUMENT 让净化结果包含原始 <head>（含 <style>）；只取 body 会丢掉全部样式。
  const clean = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "frame", "object", "embed", "link", "base", "form", "meta"],
    FORBID_ATTR: ["action", "formaction"],
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_TAGS: ["foreignobject"],
  });
  return buildFrameDocument(String(clean));
}
