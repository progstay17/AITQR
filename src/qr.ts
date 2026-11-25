import qrcodegen from "../vendor/qrcodegen/index.js";

export type EccName = "L" | "M" | "Q" | "H";

/** Error-correction level by name (the bundle uses names, the vendor library uses constants). */
export function eccFor(name: EccName): qrcodegen.QrCode.Ecc {
  switch (name) {
    case "L":
      return qrcodegen.QrCode.Ecc.LOW;
    case "M":
      return qrcodegen.QrCode.Ecc.MEDIUM;
    case "H":
      return qrcodegen.QrCode.Ecc.HIGH;
    case "Q":
    default:
      return qrcodegen.QrCode.Ecc.QUARTILE;
  }
}

export interface QrRenderOptions {
  ecc: EccName;
  quietModules: number;
  /** Rendered pixel size of the square; modules stay integral and centred. */
  sizePx: number;
}

export interface QrRender {
  markup: string;
  modules: number;
  version: number;
}

/**
 * Pure black on pure white, quiet zone of at least four modules, no logo, no rounded modules.
 * Base45 text is uppercase alphanumeric, so the segment builder picks QR alphanumeric mode.
 */
export function renderQr(token: string, options: QrRenderOptions): QrRender {
  const qr = qrcodegen.QrCode.encodeText(token, eccFor(options.ecc));
  const quiet = Math.max(4, Math.floor(options.quietModules || 4));
  const total = qr.size + quiet * 2;
  const scale = Math.max(1, Math.floor(options.sizePx / total));
  const side = scale * total;

  const parts: string[] = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) {
        parts.push(`M${(x + quiet) * scale} ${(y + quiet) * scale}h${scale}v${scale}h-${scale}z`);
      }
    }
  }

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" ` +
    `role="img" aria-label="QR" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#FFFFFF"/>` +
    `<path d="${parts.join("")}" fill="#000000"/>` +
    `</svg>`;

  return { markup, modules: qr.size, version: (qr.size - 17) / 4 };
}

export function qrModuleCount(token: string, ecc: EccName): number {
  return qrcodegen.QrCode.encodeText(token, eccFor(ecc)).size;
}
