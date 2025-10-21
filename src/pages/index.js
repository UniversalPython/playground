import React, {useEffect, useState, useRef, useMemo} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import CodeEditor from '@site/src/components/CodeEditor';
import { Box, TextField, MenuItem, Button, Dialog, CircularProgress, Snackbar, Alert, IconButton, Tooltip } from '@mui/material';
import useGeoLocation from 'react-ipgeolocation';
import { useColorMode } from '@docusaurus/theme-common';
import { EditorView } from '@codemirror/view';
import { Blocks } from 'react-loader-spinner';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';

// Constants
const PYPI_PROJECT = 'universalpython';
const PYPI_JSON = `https://pypi.org/pypi/${PYPI_PROJECT}/json`;
export const defaultLightThemeOption = EditorView.theme({ '&': { backgroundColor: 'whitesmoke' } }, { dark: false });
import styles from './index.module.css';

// languages (kept short here; extend as needed)
const languages = [
  { id: 'EN', code3: 'eng', code2: 'en', name: 'English', i18nName: 'English', fontFamily: "Hack, 'Courier New', monospace" },
  { id: 'HI', default: true, code3: 'hin', code2: 'hi', name: 'Hindi', i18nName: 'Hindi', fontFamily: "Hack, 'Courier New', monospace" },
  { id: 'UR', code3: 'urd', code2: 'ur', name: 'Urdu', i18nName: 'اردو', direction: 'rtl', fontFamily: "Hack, 'Courier New', monospace" },
  { id: 'FR', code3: 'fra', code2: 'fr', name: 'French', i18nName: 'Français', fontFamily: "Hack, 'Courier New', monospace" },
];

const initialCodes = [
  { id: 'hello_world', name: ' Simple Hello World', en: `print("Hello world!")` },
  { id: 'conditionals', name: 'If/Else', en: `something = 2

if something == 1:
  print ("Hello")
elif something == 2:
  print ("World")
else:
  print ("Didn't understand...")` },
  { id: 'loop', name: 'Loop', en: `things = ['💻', '📷', '🧸']

for thing in things:
  print(thing)
` },
];

// -----------------------------
// Utilities: base64url encode/decode
// -----------------------------
function base64UrlEncode(str) {
  try {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) { return ''; }
}
function base64UrlDecode(s) {
  try {
    if (!s) return null;
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  } catch (e) { return null; }
}

// -----------------------------
// PyScript loader singleton (best-effort caching and single-insert behavior)
// -----------------------------
function ensurePyscriptLoaded() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if (window.__pyscriptLoader && window.__pyscriptLoader.promise) return window.__pyscriptLoader.promise;
  let resolveOuter, rejectOuter;
  const promise = new Promise((resolve, reject) => { resolveOuter = resolve; rejectOuter = reject; });
  window.__pyscriptLoader = { promise, loaded: false };
  const CSS_URL = 'https://pyscript.net/releases/2024.1.1/core.css';
  const JS_URL = 'https://pyscript.net/releases/2024.1.1/core.js';
  if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = CSS_URL; document.head.appendChild(link);
  }
  if (!document.querySelector(`script[src="${JS_URL}"]`)) {
    const script = document.createElement('script'); script.defer = true; script.type = 'module'; script.src = JS_URL;
    script.onerror = () => rejectOuter(new Error('Failed to load pyscript core.js'));
    document.head.appendChild(script);
  }
  const onReady = () => { window._py_ready_already = true; window.__pyscriptLoader.loaded = true; resolveOuter(true); window.removeEventListener('py:ready', onReady); };
  window.addEventListener('py:ready', onReady);
  setTimeout(() => { if (!window.__pyscriptLoader.loaded) resolveOuter(true); }, 20000);
  return promise;
}

// -----------------------------
// Fetch latest wheel url from PyPI (cache 24h in sessionStorage)
// -----------------------------
async function fetchLatestWheelUrl() {
  try {
    const cached = sessionStorage.getItem('universalpython_latest_wheel');
    const ts = sessionStorage.getItem('universalpython_latest_wheel_ts');
    if (cached && ts && (Date.now() - parseInt(ts, 10) < 1000 * 60 * 60 * 24)) return cached;
  } catch(e){}
  try {
    const res = await fetch(PYPI_JSON, { cache: 'no-cache' }); if (!res.ok) return null; const j = await res.json();
    const version = j.info.version; const releaseFiles = j.releases[version] || [];
    const wheel = releaseFiles.find(f => f.filename && f.filename.endsWith('.whl')) || releaseFiles[0];
    if (wheel && wheel.url) { try { sessionStorage.setItem('universalpython_latest_wheel', wheel.url); sessionStorage.setItem('universalpython_latest_wheel_ts', String(Date.now())); } catch (e){} return wheel.url; }
  } catch (e) { console.warn('PyPI lookup failed', e); }
  return null;
}

// -----------------------------
// update URL with code + src + tgt (debounced by caller)
// -----------------------------
function updateUrlParams({ code, src, tgt }) {
  try {
    const u = new URL(window.location.href);
    if (code) u.searchParams.set('code', base64UrlEncode(code)); else u.searchParams.delete('code');
    if (src) u.searchParams.set('src', src); else u.searchParams.delete('src');
    if (tgt) u.searchParams.set('tgt', tgt); else u.searchParams.delete('tgt');
    window.history.replaceState({}, '', u.toString());
  } catch(e) { }
}

// -----------------------------
// IDE wrapper - restores styling + theme behavior
// -----------------------------
// --- Copy buttons and Share will be added below
const IDE = ({ basicSetup, value, onChange, readOnly, style, handleReadOnlyTyping, ...props }) => {
  const { colorMode } = useColorMode(); const isDarkTheme = colorMode === 'dark';
  const [internal, setInternal] = useState(value || '');
  useEffect(() => setInternal(value || ''), [value]);
  useEffect(() => { const t = setTimeout(() => onChange && onChange(internal), 300); return () => clearTimeout(t); }, [internal]);

  // pass a small handler to the CodeEditor via props (if it supports handleDOMEvents)
  const extraProps = {};
  if (handleReadOnlyTyping) {
    extraProps.handleDOMEvents = {
      keydown: (view, event) => {
        if (readOnly) {
          // inform parent (show snackbar)
          handleReadOnlyTyping();
          event.preventDefault();
          return true;
        }
        return false;
      }
    };
  }

  return (
    <CodeEditor
      value={internal}
      onChange={text => setInternal(text)}
      basicSetup={basicSetup}
      readOnly={readOnly}
      theme={isDarkTheme ? 'dark' : (readOnly ? defaultLightThemeOption : 'light')}
      style={{ fontFamily: style?.fontFamily || "Hack, 'Courier New', monospace", fontSize: style?.fontSize || '1.15rem', ...style }}
      {...extraProps}
      {...props}
    />
  );
};

function HomepageHeader() { const { siteConfig } = useDocusaurusContext(); return (
  <header className={clsx('hero hero--primary', styles.heroBanner)}>
    <div className="container">
      <h1 className="hero__title">{siteConfig.title}</h1>
      <p className="hero__subtitle">{siteConfig.tagline}</p>
      <div className={styles.buttons}>
        <Link className="button button--secondary button--lg" to="https://universalpython.github.io/tutorial.html">Tutorial - 5 min ⏱️</Link>
      </div>
    </div>
  </header>
); }

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  const isBrowser = useIsBrowser();
  const { country } = useGeoLocation();

  const [editorCode, setEditorCode] = useState(initialCodes[0].en);
  const [code, setCode] = useState(initialCodes[0].en);
  const [translatedCode, setTranslatedCode] = useState('');
  const [isWaitingForCode, setIsWaitingForCode] = useState(false);
  const [isDetected, setIsDetected] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState(languages.find(l => l.code2 === 'en'));
  const [targetLanguage, setTargetLanguage] = useState(languages.find(l => l.default));
  const [loadingPyscript, setLoadingPyscript] = useState(true);
  const [wheelUrl, setWheelUrl] = useState(null);

  // existing read-only snackbar (when overlay clicked)
  const [snackOpen, setSnackOpen] = useState(false);

  // snackbar for copy confirmations
  const [copySnack, setCopySnack] = useState({ open: false, msg: '', anchorOrigin: {} });

  // share dialog state (fallback)
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrlValue, setShareUrlValue] = useState('');

  // read query params on load
  useEffect(() => {
    if (!isBrowser) return;
    const u = new URL(window.location.href);
    const codeParam = u.searchParams.get('code');
    const src = u.searchParams.get('src');
    const tgt = u.searchParams.get('tgt');
    const decoded = codeParam ? base64UrlDecode(codeParam) : null;
    if (decoded !== null) { setEditorCode(decoded); setCode(decoded); }
    if (src) {
      const found = languages.find(l => l.code2 === src || l.id === src);
      if (found) setSourceLanguage(found);
    }
    if (tgt) {
      const found = languages.find(l => l.code2 === tgt || l.id === tgt);
      if (found) setTargetLanguage(found);
    }
  }, [isBrowser]);

  // update URL when code or languages change (debounced)
  const urlTimer = useRef(null);
  useEffect(() => {
    clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => updateUrlParams({ code, src: sourceLanguage?.code2, tgt: targetLanguage?.code2 }), 600);
    return () => clearTimeout(urlTimer.current);
  }, [code, sourceLanguage, targetLanguage]);

  // initialise pyscript + fetch wheel
  useEffect(() => {
    let mounted = true;
    (async () => {
      const wheel = await fetchLatestWheelUrl(); if (mounted && wheel) setWheelUrl(wheel);
      try { await ensurePyscriptLoaded(); } catch(e) { console.warn(e); }
      if (mounted) setLoadingPyscript(false);
    })();
    return () => { mounted = false; }
  }, []);

  // keep isWaitingForCode in sync while typing
  useEffect(() => {
    setIsWaitingForCode(true);
    const t = setTimeout(() => { setIsWaitingForCode(false); setCode(editorCode); }, 400);
    return () => clearTimeout(t);
  }, [editorCode]);

  // swap languages & swap editor text by swapping React state (fixes your issue)
  const swapLanguages = () => {
    // swap language objects
    setSourceLanguage(prevSource => { const oldSource = prevSource; setTargetLanguage(oldSource); return targetLanguage; });
    // swap code content between editor and translated output (we maintain code as the source text)
    try {
      const rightTextEl = document.getElementById('translated-output-data');
      let rightText = rightTextEl ? (rightTextEl.textContent || '') : '';
      // convert NBSP back to spaces
      rightText = rightText.replace(/ /g, ' ');
      const left = editorCode;
      // if rightText empty, we keep left as-is
      const newLeft = rightText || left;
      setEditorCode(newLeft);
      setCode(newLeft);
      setTranslatedCode(left);
    } catch (e) { console.warn('swap failed', e); }
  };

  // Build safe py-script content using JSON.stringify to embed user code
  const pyScriptContent = useMemo(() => {
    const wheel = wheelUrl || '';
    const safeOriginal = code || '';
    // Use JSON.stringify so embedded string is safe
    return `from universalpython import run_module, SCRIPTDIR
from pyscript import document, display
import os, sys

original_code = ${JSON.stringify(safeOriginal)}

# Translate to English if necessary
if \"${sourceLanguage?.id}\" == \"EN\":
    english_code = original_code
else:
    english_code = run_module(
        mode=\"lex\",
        code=original_code,
        args={
            'translate': True,
            'dictionary': '',
            'source_language': \"${sourceLanguage?.code2}\",
            'file': '',
            'reverse': False,
            'keep': False,
            'keep_only': False,
            'return': True,
        }
    )

# Redirect print to display (same behavior as before)
print = display
try:
    exec(english_code)
except Exception as e:
    display(f\"[Runtime Error] {e}\")

# Translate back to target language if required
if \"${targetLanguage?.id}\" == \"EN\":
    translated_code = english_code
else:
    translated_code = run_module(
        mode=\"lex\",
        code=english_code,
        args={
            'translate': True,
            'dictionary': '',
            'source_language': \"${targetLanguage?.code2}\",
            'file': '',
            'reverse': True,
            'keep': False,
            'keep_only': False,
            'return': True,
        }
    )

# Publish translated code into a data node for React to pick up
data_el = document.getElementById(\"translated-output-data\")
if data_el is not None:
    data_el.textContent = translated_code
`;
  }, [code, sourceLanguage, targetLanguage, wheelUrl]);

  // MutationObserver: pick up translated output as soon as PyScript writes it
  useEffect(() => {
    if (!isBrowser) return;
    const el = document.getElementById('translated-output-data');
    if (!el) return;
    const observer = new MutationObserver(() => {
      const txt = el.textContent || '';
      if (txt !== translatedCode) setTranslatedCode(txt);
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    // also read once immediately in case PyScript already wrote
    const initial = el.textContent || '';
    if (initial && initial !== translatedCode) setTranslatedCode(initial);
    return () => observer.disconnect();
  }, [isBrowser]);

  // Snackbar helper (read-only)
  const showReadOnlySnack = () => {
    setSnackOpen(true);
  };

  const handleSnackClose = (_, reason) => {
    if (reason === 'clickaway') return;
    setSnackOpen(false);
  };

  // Copy helpers for both editors
  const handleCopyLeft = async () => {
    try {
      await navigator.clipboard.writeText(editorCode || '');
      setCopySnack({ open: true, msg: 'Original code (left) copied to clipboard', anchorOrigin: { vertical: 'bottom', horizontal: 'left' }});
    } catch (e) {
      setCopySnack({ open: true, msg: 'Copy failed — please select and copy' });
      console.warn('copy left failed', e);
    }
  };
  const handleCopyRight = async () => {
    try {
      await navigator.clipboard.writeText(translatedCode || '');
      setCopySnack({ open: true, msg: 'Translated code (right) copied to clipboard', anchorOrigin: { vertical: 'bottom', horizontal: 'right' }});
    } catch (e) {
      setCopySnack({ open: true, msg: 'Copy failed — please select and copy' });
      console.warn('copy right failed', e);
    }
  };
  const handleCopySnackClose = () => setCopySnack({ open: false, msg: '' });

  // Share helpers
  const openShareFallback = (url) => {
    setShareUrlValue(url);
    setShareDialogOpen(true);
  };
  const handleShareClose = () => setShareDialogOpen(false);

  const handleShareNow = async () => {
    if (!isBrowser) return;
    const url = window.location.href;
    try {
      // Check navigator.canShare first (user requested this)
      if (navigator.canShare && navigator.canShare({ url })) {
        // use native share
        await navigator.share({
          title: siteConfig.title,
          text: `${siteConfig.tagline}`,
          url,
        });
      } else if (navigator.share) {
        // fallback: if canShare not available but share is, still try
        await navigator.share({
          title: siteConfig.title,
          text: `${siteConfig.tagline}`,
          url,
        });
      } else {
        openShareFallback(url);
      }
    } catch (e) {
      // On any error, open the fallback dialog so user can copy
      console.warn('native share failed', e);
      openShareFallback(url);
    }
  };

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrlValue || window.location.href);
      setCopySnack({ open: true, msg: 'Share URL copied to clipboard' });
    } catch (e) {
      setCopySnack({ open: true, msg: 'Copy failed — please select and copy' });
      console.warn('copy share url failed', e);
    }
  };

  return (
    <Layout title={`${siteConfig.title} | Programming for everyone`} description="Write Python in any human language. Can't find yours? Easily contribute.">
      <Head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1.0" />
        <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/hack-font@3/build/web/hack.css" />
      </Head>

      <MaterialThemeWrapper>
        <HomepageHeader />

        <Dialog open={loadingPyscript} aria-labelledby="loading-dialog" fullWidth maxWidth="xs">
          <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CircularProgress />
            <div style={{ fontWeight: 600 }}>Loading Python runtime…</div>
            <div style={{ opacity: 0.8, fontSize: '0.9rem', textAlign: 'center' }}>We cache runtime files where possible so future visits will be faster.</div>
          </Box>
        </Dialog>

        <main>
          <Box sx={{ padding: { xs: '20px', md: '48px' }, maxWidth: '100%' }}>
            {/* Preset row with share button on the right (T2 layout) */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Box width="250px">
                <TextField select fullWidth label="Choose Preset" onChange={(e) => { const found = initialCodes.find(l => l.id === e.target.value); if (found) { setEditorCode(found.en); setCode(found.en); } }} value={initialCodes.find(c => c.en === code)?.id || 'custom'}>
                  {initialCodes.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                  <MenuItem value="custom">Custom</MenuItem>
                </TextField>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flex: 1 }}>
                <Button startIcon={<ShareIcon />} variant="outlined" onClick={handleShareNow}>
                  Share
                </Button>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, mt: 2 }}>
              {/* Left editor container (position: relative for floating button) */}
              <div style={{ flex: 1, position: 'relative' }}>
                <Box width="250px">
                  <TextField label="From" fullWidth select onChange={(e) => { const found = languages.find(l => l.id === e.target.value); if (found) { setSourceLanguage(found); setIsDetected(false); } }} value={sourceLanguage?.id}>
                    {languages.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                  </TextField>
                </Box>

                {/* Floating copy button for left editor */}
                <Tooltip title="Copy original code">
                  <IconButton
                    onClick={handleCopyLeft}
                    size="small"
                    aria-label="Copy original code"
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      zIndex: 30,
                      boxShadow: 1,
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <IDE id="python-code-editor1" value={editorCode} mode="python" onChange={(text) => { setEditorCode(text); }} height={'240px'} style={{ margin: 12, fontFamily: sourceLanguage?.fontFamily }} />
              </div>

              <Button sx={{ height: 'fit-content', width: { xs: '100%', md: '5%' }, m: { xs: '10px 0', md: 0 } }} onClick={swapLanguages}>&#8644;</Button>

              <div style={{ flex: 1, marginLeft: 12, position: 'relative' }}>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <TextField select label="To" fullWidth onChange={(e) => { const found = languages.find(l => l.id === e.target.value); if (found) setTargetLanguage(found); }} value={targetLanguage?.id} sx={{ maxWidth: 250 }}>
                    {languages.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}{targetLanguage?.id === l.id ? isDetected ? ' - detected' : '' : ''}</MenuItem>)}
                  </TextField>
                </Box>

                {/* Floating copy button for right editor (above overlay; high z-index) */}
                <Tooltip title="Copy translated code">
                  <IconButton
                    onClick={handleCopyRight}
                    size="small"
                    aria-label="Copy translated code"
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      zIndex: 40,
                      boxShadow: 1,
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                {/* Right-hand editor: real CodeMirror, readOnly. We render an overlay to catch interactions and show snackbar */}
                <div style={{ position: 'relative' }}>
                  <IDE id="python-code-editor2" mode="python" height={'240px'} readOnly={true} value={translatedCode} basicSetup={{ direction: targetLanguage?.direction || 'ltr' }} style={{ margin: 12, whiteSpace: 'pre', fontFamily: targetLanguage?.fontFamily }} handleReadOnlyTyping={showReadOnlySnack} />

                  {/* transparent overlay to block interactions and show tooltip/snackbar on attempt */}
                  <div
                    onClick={() => setSnackOpen(true)}
                    style={{ position: 'absolute', inset: 0, cursor: 'not-allowed', background: 'transparent', zIndex: 10 }}
                    aria-hidden={true}
                  />

                  {/* hidden data node where py-script writes translated text for React to pick up */}
                  <div id="translated-output-data" style={{ display: 'none' }} />
                </div>
              </div>
            </Box>

            <div style={{ background: '#232323', border: '1px solid gray', padding: '0 0 24px', borderRadius: 8, color: 'whitesmoke', marginTop: 20, overflow: 'hidden' }}>
              <div style={{ textTransform: 'uppercase', opacity: 0.67, fontSize: '0.8rem', letterSpacing: '0.1rem', padding: '12px 24px', height: 44, marginBottom: 12, background: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Blocks visible={isWaitingForCode} height={'14'} width={isWaitingForCode ? '14' : '0'} ariaLabel="blocks-loading" wrapperStyle={{ paddingTop: 4 }} />
                {isWaitingForCode ? 'Waiting for you to stop typing...' : 'Output'}
              </div>

              {isBrowser && (
                <div>
                  <py-config>{`packages = ["${wheelUrl || ''}"]`}</py-config>
                  <py-script type="py" id="output-terminal" style={{ fontFamily: "Hack, 'Courier New', monospaced", marginBottom: '1rem', display: 'flex', flexDirection: 'column-reverse', overflowY: 'auto', maxHeight: '300px', padding: '12px 18px 0px' }} key={String(code) + (sourceLanguage?.id || '') + (targetLanguage?.id || '')}>
                    {pyScriptContent}
                  </py-script>
                </div>
              )}

            </div>

          </Box>
        </main>

        {/* Read-only snackbar */}
        <Snackbar open={snackOpen} autoHideDuration={2500} onClose={handleSnackClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={handleSnackClose} severity="info" sx={{ width: '100%' }}>
            This panel is read-only. Edit on the left, or swap languages to edit the translation.
          </Alert>
        </Snackbar>

        {/* Copy confirmation snackbar */}
        <Snackbar open={copySnack.open} autoHideDuration={2000} onClose={handleCopySnackClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center', ...copySnack.anchorOrigin }}>
          <Alert onClose={handleCopySnackClose} severity="success" sx={{ width: '100%' }}>
            {copySnack.msg}
          </Alert>
        </Snackbar>

        {/* Share fallback dialog (URL + copy) */}
        <Dialog open={shareDialogOpen} onClose={handleShareClose} fullWidth maxWidth="sm" aria-labelledby="share-dialog">
          <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontWeight: 700 }}>Share this session</div>
            <TextField fullWidth multiline value={shareUrlValue} onChange={(e) => setShareUrlValue(e.target.value)} />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button variant="outlined" onClick={handleCopyShareUrl} startIcon={<ContentCopyIcon />}>Copy URL</Button>
              <Button variant="contained" onClick={handleShareClose}>Close</Button>
            </Box>
          </Box>
        </Dialog>

      </MaterialThemeWrapper>
    </Layout>
  );
}

const MaterialThemeWrapper = ({ children }) => {
  const { colorMode } = useColorMode(); const isDarkTheme = colorMode === 'dark';
  const theme = React.useMemo(() => createTheme({ palette: { mode: isDarkTheme ? 'dark' : 'light' } }), [isDarkTheme]);
  return <ThemeProvider theme={theme}><CssBaseline />{children}</ThemeProvider>;
};
