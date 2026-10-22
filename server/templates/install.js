import { escapeSource } from '../../src/lib/cells.js';

/**
 * The provisioning deck. A kernel is a child process, so "installing a
 * backend" means putting an interpreter on disk where the registry looks:
 * `~/.labjs/bin`. JavaScript and TypeScript need nothing — they run on the
 * Node that serves the app — so only Python, Ruby and the shells appear here.
 *
 * The cells are shells on purpose. Python and Ruby cells cannot run before
 * Python and Ruby exist, and a JavaScript cell is sandboxed without
 * child_process, so a shell is the only language that can bootstrap the rest.
 *
 * Two things the cells deliberately do not do:
 *
 *   - Prompt for a password. A kernel cell has no TTY, so `sudo` would fail or
 *     hang. Where an installer needs one, the cell says so and prints the exact
 *     command to run in a real terminal.
 *   - Assume Homebrew, apt, dnf or pacman. Each cell probes and skips what is
 *     already there, so re-running is cheap and safe.
 */

const BOX = { x: 5, y: 28, w: 90, h: 58 };

function cell(id, lang, code, exec = 'kernel') {
  const { x, y, w, h } = BOX;
  return [
    `<div class="nb-cell" data-cell-id="${id}"`,
    `     data-cell-x="${x}" data-cell-y="${y}" data-cell-w="${w}" data-cell-h="${h}"`,
    `     style="left:${x}%;top:${y}%;width:${w}%;height:${h}%">`,
    `<script type="text/nb-cell" data-cell-id="${id}" data-lang="${lang}" data-exec="${exec}">`,
    escapeSource(code),
    '</script>',
    '</div>',
  ].join('\n');
}

function section(id, badge, title, body, inner) {
  return [
    `<section class="slide" data-slide-id="${id}">`,
    `  <span class="badge">${badge}</span>`,
    `  <h1>${title}</h1>`,
    `  <p>${body}</p>`,
    inner ? `  ${inner}` : '',
    '</section>',
  ]
    .filter(Boolean)
    .join('\n');
}

const MAC = [
  'set -u',
  'BIN="$HOME/.labjs/bin"',
  'mkdir -p "$BIN"',
  '',
  'say() { printf "\\n== %s\\n" "$*"; }',
  '',
  '# Homebrew installs to /opt/homebrew on Apple Silicon and /usr/local on Intel.',
  '# A non-login shell does not get either on PATH, so put them there explicitly.',
  'for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do',
  '  [ -x "$p" ] && eval "$("$p" shellenv)"',
  'done',
  '',
  'say "Homebrew"',
  'if command -v brew >/dev/null 2>&1; then',
  '  echo "already installed: $(brew --version | head -1)"',
  'else',
  '  echo "installing — this asks for your password, which a cell cannot answer."',
  '  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {',
  '    echo',
  '    echo "Homebrew was not installed. Run this in Terminal, then re-run this cell:"',
  '    echo',
  '    echo \'  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\'',
  '    exit 1',
  '  }',
  '  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do',
  '    [ -x "$p" ] && eval "$("$p" shellenv)"',
  '  done',
  'fi',
  '',
  'say "Python"',
  'if [ -x "$BIN/python3" ]; then',
  '  echo "already linked: $("$BIN/python3" --version)"',
  'else',
  '  brew install python@3.12 || exit 1',
  '  ln -sf "$(brew --prefix)/opt/python@3.12/bin/python3.12" "$BIN/python3"',
  '  echo "linked $BIN/python3"',
  'fi',
  '',
  'say "Ruby"',
  'if [ -x "$BIN/ruby" ]; then',
  '  echo "already linked: $("$BIN/ruby" --version)"',
  'else',
  '  brew install ruby || exit 1',
  '  ln -sf "$(brew --prefix ruby)/bin/ruby" "$BIN/ruby"',
  '  echo "linked $BIN/ruby"',
  'fi',
  '',
  'say "Done"',
  'ls -l "$BIN"',
].join('\n');

const LINUX = [
  'set -u',
  'BIN="$HOME/.labjs/bin"',
  'mkdir -p "$BIN"',
  '',
  'say() { printf "\\n== %s\\n" "$*"; }',
  '',
  '# sudo cannot read a password here, so try -n and print the command if it',
  '# refuses. -n means "fail instead of prompting", never "hang forever".',
  'as_root() {',
  '  if sudo -n true 2>/dev/null; then sudo -n "$@"; else',
  '    echo "needs a password — run this in a terminal:"',
  '    echo "  sudo $*"',
  '    return 1',
  '  fi',
  '}',
  '',
  'install_pkg() {',
  '  name="$1"',
  '  if command -v apt-get >/dev/null 2>&1; then as_root apt-get install -y "$name"',
  '  elif command -v dnf >/dev/null 2>&1; then as_root dnf install -y "$name"',
  '  elif command -v pacman >/dev/null 2>&1; then as_root pacman -S --noconfirm "$name"',
  '  elif command -v apk >/dev/null 2>&1; then as_root apk add "$name"',
  '  else echo "no known package manager"; return 1',
  '  fi',
  '}',
  '',
  'say "Python"',
  'if command -v python3 >/dev/null 2>&1; then',
  '  echo "on PATH: $(python3 --version)"',
  '  ln -sf "$(command -v python3)" "$BIN/python3"',
  'elif install_pkg python3; then',
  '  ln -sf "$(command -v python3)" "$BIN/python3"',
  'fi',
  '',
  'say "Ruby"',
  'if command -v ruby >/dev/null 2>&1; then',
  '  echo "on PATH: $(ruby --version)"',
  '  ln -sf "$(command -v ruby)" "$BIN/ruby"',
  'elif install_pkg ruby; then',
  '  ln -sf "$(command -v ruby)" "$BIN/ruby"',
  'fi',
  '',
  'say "Done"',
  'ls -l "$BIN"',
].join('\n');

const WINDOWS = [
  "$ErrorActionPreference = 'Continue'",
  "$Bin = Join-Path $HOME '.labjs\\bin'",
  'New-Item -ItemType Directory -Force -Path $Bin | Out-Null',
  '',
  'function Say($m) { Write-Host ""; Write-Host "== $m" }',
  '',
  "Say 'winget'",
  'if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {',
  '  Write-Host "winget is missing. Install App Installer from the Microsoft Store, then re-run this cell."',
  '  exit 1',
  '}',
  '',
  "Say 'Python'",
  'if (Get-Command python -ErrorAction SilentlyContinue) {',
  '  Write-Host "on PATH: $((Get-Command python).Source)"',
  '} else {',
  '  winget install --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements',
  '}',
  '$py = Get-ChildItem "$env:LOCALAPPDATA\\Programs\\Python" -Recurse -Filter python.exe -ErrorAction SilentlyContinue |',
  '  Sort-Object FullName -Descending | Select-Object -First 1',
  'if ($py) { Copy-Item $py.FullName (Join-Path $Bin "python3.exe") -Force; Write-Host "linked $($py.FullName)" }',
  '',
  "Say 'Ruby'",
  'if (Get-Command ruby -ErrorAction SilentlyContinue) {',
  '  Write-Host "on PATH: $((Get-Command ruby).Source)"',
  '} else {',
  '  winget install --id RubyInstallerTeam.Ruby.3.3 --silent --accept-package-agreements --accept-source-agreements',
  '}',
  '$rb = Get-ChildItem "$env:LOCALAPPDATA\\Programs\\Ruby" -Recurse -Filter ruby.exe -ErrorAction SilentlyContinue |',
  '  Select-Object -First 1',
  'if ($rb) { Copy-Item $rb.FullName (Join-Path $Bin "ruby.exe") -Force; Write-Host "linked $($rb.FullName)" }',
  '',
  "Say 'Done'",
  'Get-ChildItem $Bin',
  'Write-Host ""',
  'Write-Host "Restart the notebookjs server so it picks up the new PATH entries."',
].join('\n');

const VERIFY = [
  "fetch('/api/kernel/languages')",
  '  .then(function (r) { return r.json(); })',
  '  .then(function (d) {',
  '    console.log("installed backends live in " + d.binDir);',
  '    console.log("");',
  '    d.languages.forEach(function (l) {',
  '      var mark = l.ok ? "ok  " : "MISS";',
  '      console.log(mark + "  " + l.label.padEnd(12) + (l.error || l.cmd));',
  '    });',
  '    console.log("");',
  '    console.log("A backend installed after the server started is picked up on the");',
  '    console.log("first run in that language — no restart needed.");',
  '  })',
  '  .catch(function (e) { console.error(e.message); });',
].join('\n');

export function installDeck() {
  const slides = [
    section(
      's1',
      'notebookjs',
      'Install the kernels',
      'Each slide runs a shell cell that installs an interpreter into <code>~/.labjs/bin</code>. ' +
        'Run the one for your OS, then the verification slide. JavaScript and TypeScript need nothing — ' +
        'they run on the Node that serves this app.',
      null,
    ),
    section(
      's2',
      'macOS',
      'Install on macOS',
      'Installs Homebrew if it is missing, then Python and Ruby, and links both into <code>~/.labjs/bin</code>. ' +
        'If it asks for a password, run the printed command in Terminal and re-run the cell.',
      cell('c1', 'bash', MAC),
    ),
    section(
      's3',
      'Linux',
      'Install on Linux',
      'Links a <code>python3</code> and <code>ruby</code> already on PATH, or installs them with apt, dnf, pacman or apk. ' +
        '<code>sudo</code> cannot read a password from a cell, so where one is needed the cell prints the command instead.',
      cell('c2', 'bash', LINUX),
    ),
    section(
      's4',
      'Windows',
      'Install on Windows',
      'Uses <code>winget</code>, which installs without administrator rights. Links the interpreters into <code>~/.labjs/bin</code>.',
      cell('c3', 'pwsh', WINDOWS),
    ),
    section(
      's5',
      'Verify',
      'Check what resolved',
      'Reads the server\'s own resolution table. Anything marked <code>MISS</code> has the reason next to it.',
      cell('c4', 'javascript', VERIFY, 'inline'),
    ),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install kernels — notebookjs</title>
</head>
<body>
<div id="deck">
${slides}
</div>
</body>
</html>`;
}