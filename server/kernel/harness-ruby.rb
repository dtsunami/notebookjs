#!/usr/bin/env ruby
# Ruby kernel for notebookjs.
#
# Speaks the same newline-delimited JSON protocol as harness-node.mjs and
# harness-python.py:
#
#   in  {"type": "exec", "id": 1, "code": "..."}
#   out {"type": "ready", "lang": "ruby"}
#       {"type": "result", "id": 1, "ok": true, "entries": [...], "ms": 12}
#
# Every cell is evaluated against one retained Binding, so locals, methods and
# classes defined in one cell stay visible in the next. That is the same
# persistence model as Jupyter.

require 'json'
require 'stringio'

module NB
  # Captures a cell's writes and turns each line into an entry, the way
  # Jupyter's stdout capture does — one output row per line, not one blob.
  class Capture < StringIO
    def initialize(sink, level)
      super()
      @sink = sink
      @level = level
    end

    def write(text)
      text.to_s.each_line do |line|
        stripped = line.chomp
        @sink << { level: @level, text: stripped } unless stripped.empty?
      end
      text.to_s.length
    end

    def flush; end
  end

  # STDOUT, not $stdout: a cell may have reassigned $stdout, and replies still
  # have to reach the host on the real pipe.
  def self.reply(obj)
    STDOUT.write(JSON.generate(obj) + "\n")
    STDOUT.flush
  end

  def self.describe(value)
    value.inspect
  rescue Exception => e
    "#<#{value.class}: inspect raised #{e.class}>"
  end

  def self.exception_text(err)
    lines = ["#{err.class}: #{err.message}"]
    backtrace = err.backtrace
    lines.concat(backtrace.first(5)) if backtrace
    lines.join("\n")
  end
end

# One retained binding per kernel process. `binding` inside initialize captures
# this method's frame; the frame lives as long as @binding is referenced, so
# locals introduced by eval survive into later cells.
class CellScope
  def initialize
    @binding = binding
  end

  def evaluate(src)
    Kernel.eval(src, @binding, '(cell)')
  end
end

def run_cell(scope, code)
  entries = []
  started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  ok = true

  real_stdout = $stdout
  real_stderr = $stderr
  $stdout = NB::Capture.new(entries, 'log')
  $stderr = NB::Capture.new(entries, 'error')

  begin
    value = scope.evaluate(code)
    entries << { level: 'return', text: NB.describe(value) } unless value.nil?
  rescue SystemExit
    entries << { level: 'error', text: 'exit is disabled inside a notebook cell' }
    ok = false
  rescue SyntaxError => e
    entries << { level: 'error', text: NB.exception_text(e) }
    ok = false
  rescue Exception => e
    entries << { level: 'error', text: NB.exception_text(e) }
    ok = false
  ensure
    $stdout = real_stdout
    $stderr = real_stderr
  end

  ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
  { ok: ok, entries: entries, ms: ms }
end

scope = CellScope.new
NB.reply({ type: 'ready', lang: 'ruby' })

STDIN.each_line do |line|
  line = line.strip
  next if line.empty?

  begin
    msg = JSON.parse(line)
  rescue JSON::ParserError
    next
  end

  case msg['type']
  when 'ping'
    NB.reply({ type: 'pong', id: msg['id'] })
  when 'exec'
    result = run_cell(scope, msg['code'].to_s)
    NB.reply({
      type: 'result',
      id: msg['id'],
      ok: result[:ok],
      entries: result[:entries],
      ms: result[:ms],
    })
  end
end