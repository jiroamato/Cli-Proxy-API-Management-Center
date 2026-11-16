// Logit Foundry "Bleed" mark: an oversized LF cropped by an inner frame, with a red F crossbar.
const LOGO_SVG_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<defs><clipPath id="frame"><rect x="5" y="5" width="54" height="54" rx="10"/></clipPath></defs>' +
  '<rect width="64" height="64" rx="15" fill="#141414"/>' +
  '<g clip-path="url(#frame)" fill="none" stroke-width="12">' +
  '<path d="M16 0V43H32M41 64V21H64" stroke="#ecebe6"/>' +
  '<path d="M47 37H58" stroke="#e5484d"/>' +
  '</g></svg>';

export const LOGO_SVG = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG_MARKUP)}`;
