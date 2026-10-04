// GPU detection. A web page cannot pick the GPU itself: the browser asks the OS / driver, and on
// dual-GPU laptops Windows decides per executable. We request 'high-performance' and then tell the
// player which adapter actually got used, with steps to switch to the dedicated card if needed.

export const CONTEXT_ATTRIBUTES = {
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
  stencil: false,
};

const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Microsoft Basic Render|Basic Display/i;
const INTEGRATED = /Intel|Iris|UHD Graphics|HD Graphics|Mali|Adreno|PowerVR|Apple M\d|AMD Radeon\(TM\) (Vega |R\d )?Graphics|Radeon Vega \d|Radeon\(TM\) Graphics/i;
const DISCRETE = /NVIDIA|GeForce|Quadro|RTX|GTX|Radeon (RX|Pro|HD 7|R9)|Arc A\d/i;

/** Clean up an ANGLE renderer string, e.g. "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x...) Direct3D11 ...)". */
export function prettyRenderer(raw) {
  if (!raw) return 'Unknown GPU';
  const inner = raw.replace(/^ANGLE \(/, '').replace(/\)\s*$/, '');
  const parts = inner.split(/,\s*/);
  let name = parts.length >= 2 ? parts[1] : inner;
  name = name.replace(/\s*\(0x[0-9A-Fa-f]+\)/, '').replace(/\s+(Direct3D\d*|OpenGL|Metal)(\s.*)?$/i, '').trim();
  return name || raw;
}

export function classifyRenderer(raw) {
  if (!raw) return 'unknown';
  if (SOFTWARE.test(raw)) return 'software';
  if (DISCRETE.test(raw)) return 'discrete';
  if (INTEGRATED.test(raw)) return 'integrated';
  return 'unknown';
}

export function detectGPU(gl) {
  let raw = '';
  let vendor = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
      vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '';
    } else {
      raw = gl.getParameter(gl.RENDERER) || '';
      vendor = gl.getParameter(gl.VENDOR) || '';
    }
  } catch { /* privacy settings may block this */ }
  const kind = classifyRenderer(raw);
  return {
    raw,
    vendor,
    name: prettyRenderer(raw),
    kind,
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    browser: detectBrowser(),
  };
}

export function detectBrowser() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Edg\//.test(ua)) return { name: 'Edge', exe: 'msedge.exe', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', flags: 'edge://flags/#force-high-performance-gpu', gpuPage: 'edge://gpu' };
  if (/OPR\//.test(ua)) return { name: 'Opera', exe: 'opera.exe', path: '%LOCALAPPDATA%\\Programs\\Opera\\opera.exe', flags: 'opera://flags/#force-high-performance-gpu', gpuPage: 'opera://gpu' };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', exe: 'firefox.exe', path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', flags: null, gpuPage: 'about:support' };
  if (/Electron\//.test(ua) || /Claude\//.test(ua)) return { name: 'Claude desktop app', exe: 'Claude', store: true, path: '', flags: null, gpuPage: null };
  if (typeof navigator !== 'undefined' && navigator.brave) return { name: 'Brave', exe: 'brave.exe', path: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', flags: 'brave://flags/#force-high-performance-gpu', gpuPage: 'brave://gpu' };
  if (/Chrome\//.test(ua)) return { name: 'Chrome', exe: 'chrome.exe', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe  or  C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', flags: 'chrome://flags/#force-high-performance-gpu', gpuPage: 'chrome://gpu' };
  return { name: 'your browser', exe: 'the browser .exe', path: '', flags: null, gpuPage: null };
}
