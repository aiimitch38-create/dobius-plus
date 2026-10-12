export const TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT = String.raw`
var geometryProbe = (function() {
  var MAX_FRAMES = 3600;
  var MAX_RECORDS = 24;
  var MAX_WINDOW_MS = 30000;
  var MAX_WINDOWS_PER_GENERATION = 3;
  var running = false;
  var active = false;
  var animationFrameId = null;
  var timeoutId = null;
  var frames = 0;
  var records = 0;
  var windows = 0;
  var startedAtMs = 0;
  var lastSignature = '';
  var reason = 'active';
  var outputCount = 0;
  var outputLastAtMs = 0;
  var outputIntervalMs = 0;
  var renderCount = 0;
  var renderLastAtMs = 0;
  var renderIntervalMs = 0;
  var fitPassCount = 0;
  var fitLastAtMs = 0;
  var fitIntervalMs = 0;

  function round(value) {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
  }

  function addRect(values, prefix, element) {
    values[prefix + '.present'] = element ? 1 : 0;
    if (!element) return;
    var rect = element.getBoundingClientRect();
    values[prefix + '.x'] = round(rect.x);
    values[prefix + '.y'] = round(rect.y);
    values[prefix + '.left'] = round(rect.left);
    values[prefix + '.top'] = round(rect.top);
    values[prefix + '.right'] = round(rect.right);
    values[prefix + '.bottom'] = round(rect.bottom);
    values[prefix + '.width'] = round(rect.width);
    values[prefix + '.height'] = round(rect.height);
    values[prefix + '.clientWidth'] = round(element.clientWidth);
    values[prefix + '.clientHeight'] = round(element.clientHeight);
  }

  function addTransform(values, element) {
    if (!element) return;
    var style = window.getComputedStyle(element);
    var transform = String(style.transform || 'none');
    var matrixMatch = transform.match(/^matrix(?:3d)?\(([^)]+)\)$/i);
    var numbers = matrixMatch
      ? matrixMatch[1].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []
      : [];
    var matrix = numbers.map(Number);
    if (matrix.length >= 16) {
      values['transform.a'] = round(matrix[0]);
      values['transform.b'] = round(matrix[1]);
      values['transform.c'] = round(matrix[4]);
      values['transform.d'] = round(matrix[5]);
      values['transform.tx'] = round(matrix[12]);
      values['transform.ty'] = round(matrix[13]);
    } else if (matrix.length >= 6) {
      values['transform.a'] = round(matrix[0]);
      values['transform.b'] = round(matrix[1]);
      values['transform.c'] = round(matrix[2]);
      values['transform.d'] = round(matrix[3]);
      values['transform.tx'] = round(matrix[4]);
      values['transform.ty'] = round(matrix[5]);
    } else {
      values['transform.a'] = 1;
      values['transform.b'] = 0;
      values['transform.c'] = 0;
      values['transform.d'] = 1;
      values['transform.tx'] = 0;
      values['transform.ty'] = 0;
    }
    var origin = String(style.transformOrigin || '0px 0px').match(/-?(?:\d+\.?\d*|\.\d+)/g) || [];
    values['transformOrigin.x'] = round(Number(origin[0] || 0));
    values['transformOrigin.y'] = round(Number(origin[1] || 0));
    values['transformOrigin.z'] = round(Number(origin[2] || 0));
  }

  function noteCadence(kind) {
    var now = Date.now();
    if (kind === 'output') {
      if (outputLastAtMs) outputIntervalMs = now - outputLastAtMs;
      outputLastAtMs = now;
      outputCount += 1;
    } else if (kind === 'render') {
      if (renderLastAtMs) renderIntervalMs = now - renderLastAtMs;
      renderLastAtMs = now;
      renderCount += 1;
    } else {
      if (fitLastAtMs) fitIntervalMs = now - fitLastAtMs;
      fitLastAtMs = now;
      fitPassCount += 1;
    }
  }

  function readGeometry() {
    var values = {};
    var root = document.documentElement;
    var container = document.getElementById('terminal-container');
    var currentSurface = document.getElementById('terminal-surface') || surface;
    var xterm = term && term.element ? term.element : null;
    var canvas = xterm && xterm.querySelector ? xterm.querySelector('.xterm-screen canvas') : null;
    addRect(values, 'root', root);
    addRect(values, 'container', container);
    addRect(values, 'surface', currentSurface);
    addRect(values, 'xterm', xterm);
    addRect(values, 'xtermCanvas', canvas);
    addTransform(values, currentSurface);
    values.panX = round(panX);
    values.panY = round(panY);
    values.fitScale = round(currentScale);
    values.userScale = round(userScale);
    values.totalScale = round(getTotalScale());
    values.cols = term ? round(term.cols) : 0;
    values.rows = term ? round(term.rows) : 0;
    values.cellWidth = round(getCellWidth());
    values.cellHeight = round(getCellHeight());
    values.windowWidth = round(window.innerWidth);
    values.windowHeight = round(window.innerHeight);
    values.pageXOffset = round(window.pageXOffset);
    values.pageYOffset = round(window.pageYOffset);
    var viewport = window.visualViewport;
    values.visualViewportPresent = viewport ? 1 : 0;
    values.visualViewportWidth = viewport ? round(viewport.width) : 0;
    values.visualViewportHeight = viewport ? round(viewport.height) : 0;
    values.visualViewportOffsetLeft = viewport ? round(viewport.offsetLeft) : 0;
    values.visualViewportOffsetTop = viewport ? round(viewport.offsetTop) : 0;
    values.visualViewportPageLeft = viewport ? round(viewport.pageLeft) : 0;
    values.visualViewportPageTop = viewport ? round(viewport.pageTop) : 0;
    values.visualViewportScale = viewport ? round(viewport.scale) : 0;
    values.outputCount = outputCount;
    values.outputLastAtMs = outputLastAtMs;
    values.outputIntervalMs = outputIntervalMs;
    values.renderCount = renderCount;
    values.renderLastAtMs = renderLastAtMs;
    values.renderIntervalMs = renderIntervalMs;
    values.fitPassCount = fitPassCount;
    values.fitLastAtMs = fitLastAtMs;
    values.fitIntervalMs = fitIntervalMs;
    return values;
  }

  function stop() {
    running = false;
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function sample() {
    animationFrameId = null;
    if (!running || !active) return stop();
    frames += 1;
    var geometry = readGeometry();
    var signatureGeometry = {};
    Object.keys(geometry).forEach(function(key) {
      if (
        key.indexOf('output') !== 0 &&
        key.indexOf('render') !== 0 &&
        key.indexOf('fitPass') !== 0 &&
        key.indexOf('fitLast') !== 0 &&
        key.indexOf('fitInterval') !== 0
      ) {
        signatureGeometry[key] = geometry[key];
      }
    });
    var signature = JSON.stringify(signatureGeometry);
    if (signature !== lastSignature && records < MAX_RECORDS) {
      records += 1;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'geometry-probe',
        reason: reason,
        frame: frames,
        sampledAtMs: Date.now(),
        elapsedMs: Date.now() - startedAtMs,
        geometry: geometry
      }));
      lastSignature = signature;
    }
    if (frames >= MAX_FRAMES || records >= MAX_RECORDS || Date.now() - startedAtMs >= MAX_WINDOW_MS) {
      return stop();
    }
    animationFrameId = window.requestAnimationFrame(sample);
  }

  function start(nextReason) {
    if (!active) return;
    if (nextReason !== 'active' && nextReason !== 'init' && nextReason !== 'fit') return;
    if (nextReason === 'fit' || nextReason === 'init') noteCadence('fit');
    var reasonChanged = reason !== nextReason;
    reason = nextReason;
    if (running) {
      if (reasonChanged) lastSignature = '';
      return;
    }
    var elapsedMs = windows === 0 ? 0 : Date.now() - startedAtMs;
    if (
      windows >= MAX_WINDOWS_PER_GENERATION ||
      frames >= MAX_FRAMES ||
      records >= MAX_RECORDS ||
      elapsedMs >= MAX_WINDOW_MS
    ) return;
    if (windows === 0) startedAtMs = Date.now();
    windows += 1;
    lastSignature = '';
    running = true;
    timeoutId = window.setTimeout(stop, MAX_WINDOW_MS - (Date.now() - startedAtMs));
    animationFrameId = window.requestAnimationFrame(sample);
  }

  function setActive(nextActive) {
    active = nextActive === true;
    if (active) start('active');
    else {
      stop();
      outputLastAtMs = 0;
      outputIntervalMs = 0;
      renderLastAtMs = 0;
      renderIntervalMs = 0;
      fitLastAtMs = 0;
      fitIntervalMs = 0;
    }
  }

  window.addEventListener('pagehide', stop);
  return {
    start: start,
    setActive: setActive,
    stop: stop,
    noteOutput: function() {
      if (active) noteCadence('output');
    },
    noteRender: function() {
      if (active) noteCadence('render');
    }
  };
})();
`
