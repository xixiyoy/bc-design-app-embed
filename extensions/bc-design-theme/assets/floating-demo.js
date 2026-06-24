document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.bc-floating-demo').forEach((root) => {
    const toggle = root.querySelector('.bc-floating-demo__toggle');
    const panel = root.querySelector('.bc-floating-demo__panel');

    if (!toggle || !panel) return;

    toggle.addEventListener('click', () => {
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';

      toggle.setAttribute('aria-expanded', String(!isOpen));
      panel.hidden = isOpen;
    });
  });
});
