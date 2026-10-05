export const webpSupported = (async () => {
  if (window.ImageDecoder && window.ReadableStream) {
    try { return await ImageDecoder.isTypeSupported('image/webp'); }
    catch { return false; }
  }
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image.width === 1);
    image.onerror = () => resolve(false);
    image.src = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
  });
})();
