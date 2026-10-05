// Inputs are the unscaled, two-pane CSS dimensions, in both HTTP and WebSocket requests.
export function rdpDimensions(width, height, scale) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Size must contain positive safe integers.');
  }
  const multiplier = Math.min(scale, 4096 / width, 4096 / height);
  return {
    width: Math.max(200, Math.round(width * multiplier / 2) * 2),
    height: Math.max(200, Math.round(height * multiplier)),
  };
}
