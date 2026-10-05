// Header button and floating palette that send single key presses to the remote desktop.
export function createSpecialKeys(sendKeys) {
  const $ = id => document.getElementById(id);
  const button = $('keys-button');
  const palette = $('keys-palette');
  let connected = false;

  const update = open => {
    palette.hidden = !open;
    button.disabled = !connected;
    button.setAttribute('aria-expanded', String(open));
    for (const key of palette.querySelectorAll('button')) key.disabled = !connected;
  };
  button.addEventListener('click', () => update(palette.hidden));
  palette.addEventListener('click', event => {
    const key = event.target.closest('button[data-keys]');
    if (key) sendKeys(key.dataset.keys.split(' ').map(code => parseInt(code, 16)));
  });
  update(false);
  return {
    setConnected(value) {
      connected = value;
      update(connected && !palette.hidden);
    },
  };
}
