import { animate } from "motion";

let $panel = null;
let $content = null;
let $title = null;
let $mask = null;

function createPanel() {
  $panel = (
    <div className="run-output-panel" />
  );

  const $dragHandle = <div className="drag-handle" />;

  const $closeBtn = (
    <button className="action-btn close-btn" onclick={hide}>
      <span className="icon clearclose" />
    </button>
  );

  $title = <div className="header-title"></div>;

  const $header = (
    <div className="panel-header">
      <div className="header-content">{$title}</div>
      <div className="header-actions">{$closeBtn}</div>
    </div>
  );

  $content = <div className="panel-content" />;

  $panel.append($dragHandle, $header, $content);

  $mask = <span className="run-output-mask" onclick={hide} />;
}

function ensurePanel() {
  if (!$panel) createPanel();
}

function show(title) {
  ensurePanel();
  $title.textContent = title;
  $content.replaceChildren();

  app.append($panel, $mask);

  requestAnimationFrame(() => {
    $mask.classList.add("visible");
    $panel.classList.add("visible");
    animate($panel, { opacity: 1 }, { duration: 0.2, ease: "easeOut" });
  });
}

function hide() {
  if (!$panel) return;

  $mask.classList.remove("visible");
  $panel.classList.remove("visible");
  animate(
    $panel,
    { opacity: 0, transform: "translateY(100%)" },
    { duration: 0.25, ease: "easeIn" },
  ).then(() => {
    $panel.remove();
    $mask.remove();
    $panel = null;
    $content = null;
    $title = null;
    $mask = null;
  });
}

function appendLine(type, text) {
  if (!$content) return;
  const $line = (
    <div className={`output-line ${type}`} />
  );
  $line.textContent = text;
  $content.append($line);
  $content.scrollTop = $content.scrollHeight;
}

export default {
  show,
  hide,
  appendLine,
};
