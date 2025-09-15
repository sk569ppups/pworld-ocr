// ass.js
const ass = (() => {
  const steps = [];
  let running = false;

  const add = (label, fn) => steps.push({ label, fn });

  const run = async ({ onStatus } = {}) => {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        onStatus && onStatus(`${s.label}…`);
        // eslint-disable-next-line no-await-in-loop
        await s.fn();
      }
    } finally {
      steps.length = 0;
      running = false;
    }
  };

  return { add, run };
})();
