"""Python kernel for notebookjs.

Speaks the same newline-delimited JSON protocol as harness-node.mjs:
  in  {"type": "exec", "id": 1, "code": "..."}
  out {"type": "ready", "lang": "python"}
      {"type": "result", "id": 1, "ok": true, "entries": [...], "ms": 12}

Cells share one module namespace, so names defined in one cell are visible in
the next — the same persistence model as Jupyter, implemented by compiling each
cell against a single shared dict.
"""

import sys
import json
import time
import io
import traceback

_ns = {"__name__": "__nbcell__", "__builtins__": __builtins__}
_seq = 0


class _Capture(io.StringIO):
    def __init__(self, sink, level):
        super().__init__()
        self._sink = sink
        self._level = level

    def write(self, text):
        if text:
            for line in text.splitlines():
                if line:
                    self._sink.append({"level": self._level, "text": line})
        return len(text)

    def flush(self):
        pass


def _reply(obj):
    sys.__stdout__.write(json.dumps(obj) + "\n")
    sys.__stdout__.flush()


def _expr_source(code):
    """Decide whether the cell is a bare expression whose value to display."""
    try:
        compile(code, "<cell>", "eval")
        return code
    except SyntaxError:
        return None


def run_cell(code):
    entries = []
    started = time.time()

    real_stdout, real_stderr = sys.stdout, sys.stderr
    sys.stdout = _Capture(entries, "log")
    sys.stderr = _Capture(entries, "error")

    ok = True
    try:
        expr = _expr_source(code)
        if expr is not None:
            value = eval(compile(expr, "<cell>", "eval"), _ns)
            if value is not None:
                entries.append({"level": "return", "text": repr(value)})
        else:
            exec(compile(code, "<cell>", "exec"), _ns)
    except SystemExit:
        entries.append({"level": "error", "text": "SystemExit is disabled inside a notebook cell"})
        ok = False
    except BaseException:
        entries.append({"level": "error", "text": traceback.format_exc(limit=6).rstrip()})
        ok = False
    finally:
        sys.stdout = real_stdout
        sys.stderr = real_stderr

    return {"ok": ok, "entries": entries, "ms": int((time.time() - started) * 1000)}


def main():
    _reply({"type": "ready", "lang": "python"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue

        if msg.get("type") == "ping":
            _reply({"type": "pong", "id": msg.get("id")})
            continue

        if msg.get("type") == "exec":
            result = run_cell(str(msg.get("code") or ""))
            _reply({"type": "result", "id": msg.get("id"), **result})


if __name__ == "__main__":
    main()