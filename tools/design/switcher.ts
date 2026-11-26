// This module is injected by the design server into both product HTML entries.
const panel = document.createElement('details');
panel.style.cssText =
  'position:fixed;bottom:12px;left:12px;z-index:99999;padding:8px 12px;background:#181522;color:white;border:1px solid #8879a1;border-radius:8px;font:14px system-ui;max-width:calc(100vw - 24px)';
const label = document.createElement('summary');
label.textContent = 'Design states';
label.style.cursor = 'pointer';
const choices = document.createElement('select');
choices.setAttribute('aria-label', 'Design preview state');
choices.style.cssText =
  'display:block;margin-top:8px;max-width:100%;padding:6px;color:#181522;background:white';
const placeholder = new Option('Choose a screen or state', '');
placeholder.disabled = true;
choices.add(placeholder);
panel.append(label, choices);
document.body.append(panel);

type Menu = { current: string; states: Record<string, [string, string]> };
const menu = (await fetch('/__design/menu').then((response) => response.json())) as Menu;
for (const [key, [name]] of Object.entries(menu.states)) choices.add(new Option(name, key));
choices.value = menu.current;

async function selectState(next: string) {
  const entry = menu.states[next];
  if (!entry) return;
  const response = await fetch('/__design/state/' + encodeURIComponent(next), { method: 'POST' });
  if (!response.ok) return;
  const target = new URL(entry[1], location.origin);
  if (target.href === location.href) location.reload();
  else location.assign(target.href);
}

choices.addEventListener('change', () => {
  void selectState(choices.value);
});

if (menu.current === 'accept') {
  const openDialog = () => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Accept idea 1' && !candidate.disabled,
    );
    if (button) {
      observer.disconnect();
      button.click();
    }
  };
  const observer = new MutationObserver(openDialog);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  openDialog();
  window.setTimeout(() => observer.disconnect(), 10_000);
}

export {};
