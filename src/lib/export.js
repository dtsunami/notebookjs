export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slugify(name) {
  return (
    String(name || 'deck')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'deck'
  );
}

const RUNTIME_RE = /<script\s+id\s*=\s*["']nb-runtime["'][^>]*>[\s\S]*?<\/script>/i;
const FOCUS_RE = /<style\s+id\s*=\s*["']__nb_focus["'][^>]*>[\s\S]*?<\/style>/i;

export function stripPreviewArtifacts(html) {
  return html.replace(RUNTIME_RE, '').replace(FOCUS_RE, '').replace(/\n{3,}/g, '\n\n');
}

export function exportHtml({ html, name, withRuntime = true, runtimeScript = '' }) {
  let doc = stripPreviewArtifacts(html);
  if (withRuntime && runtimeScript) {
    doc = doc.replace(/<\/body>/i, `${runtimeScript}\n</body>`);
  }
  download(`${slugify(name)}.html`, doc, 'text/html');
}

export function exportJson({ html, styleSettings, messages, name }) {
  const payload = {
    name: name || 'Untitled deck',
    html,
    styleSettings: styleSettings || null,
    messages: messages || [],
    exportedAt: new Date().toISOString(),
  };
  download(`${slugify(name)}.notebookjs.json`, JSON.stringify(payload, null, 2), 'application/json');
}

export function printDeck() {
  window.print();
}

export async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}