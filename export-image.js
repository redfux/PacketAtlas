// PNG/SVG export of the currently active view.
// thought up by human, created by ai

function inlineComputedStyles(liveRoot, cloneRoot) {
  const liveElements = liveRoot.querySelectorAll('*');
  const cloneElements = cloneRoot.querySelectorAll('*');
  const props = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'font-size', 'font-family', 'opacity', 'text-anchor'];
  liveElements.forEach((liveEl, i) => {
    const cloneEl = cloneElements[i];
    const computed = getComputedStyle(liveEl);
    for (const prop of props) {
      const value = computed.getPropertyValue(prop);
      if (value) cloneEl.style.setProperty(prop, value);
    }
  });
}

function serializeSvg(svgElement) {
  const clone = svgElement.cloneNode(true);
  inlineComputedStyles(svgElement, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const width = svgElement.viewBox.baseVal.width || svgElement.clientWidth;
  const height = svgElement.viewBox.baseVal.height || svgElement.clientHeight;
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.style.setProperty('background', getComputedStyle(svgElement).backgroundColor);
  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Exports the given root <svg> element (matrix or graph) as PNG or SVG. */
export function exportActiveViewAsImage(svgElement, format, filenameBase) {
  const { markup, width, height } = serializeSvg(svgElement);

  if (format === 'svg') {
    downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), `${filenameBase}.svg`);
    return;
  }

  const scale = 2; // export at 2x for sharper PNGs on high-DPI screens
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = getComputedStyle(svgElement).backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((blob) => downloadBlob(blob, `${filenameBase}.png`), 'image/png');
  };
  image.onerror = () => URL.revokeObjectURL(svgUrl);
  image.src = svgUrl;
}
