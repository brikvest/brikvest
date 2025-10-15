import { useEffect, useState, useRef } from 'react';

export default function GuzapeHtmlPage() {
  const [src, setSrc] = useState('/guzape.html'); // served from /public by default
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      // re-scrape + persist server-side, then cache-bust iframe
      await fetch('/api/scrape/guzape-html?persist=1', { method: 'GET' });
      const bust = `/guzape.html?ts=${Date.now()}`;
      setSrc(bust);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // ensure it fills viewport height nicely
    if (iframeRef.current) {
      iframeRef.current.style.height = 'calc(100vh - 5rem)'; // adjust if you have a header
      iframeRef.current.style.width = '100%';
      iframeRef.current.style.border = '1px solid #e5e7eb';
      iframeRef.current.style.borderRadius = '0.75rem';
      iframeRef.current.style.background = 'white';
    }
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Guzape (Raw HTML)</h1>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
          data-testid="button-refresh"
        >
          {loading ? 'Refreshing…' : 'Refresh from Source'}
        </button>
      </div>
      <iframe ref={iframeRef} title="Guzape HTML" src={src} data-testid="iframe-guzape" />
    </div>
  );
}
