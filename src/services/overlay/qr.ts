import QRCode from 'qrcode';
/** Local encoding only: four-module quiet zone is added by the renderer. */
export function qrMatrix(payload: string) {
  try {
    const url = new URL(payload);
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    )
      return null;
    const { modules } = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const cells: string[] = [];
    for (let y = 0; y < modules.size; y++)
      for (let x = 0; x < modules.size; x++)
        if (modules.get(y, x)) cells.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    return { size: modules.size + 8, path: cells.join('') };
  } catch {
    return null;
  }
}
