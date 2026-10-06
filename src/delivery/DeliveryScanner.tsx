import { useEffect, useRef, useState } from 'react';

export function DeliveryScanner({ captured, close }: { captured: (file: File) => void; close: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const generation = useRef(0);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const stop = () => { generation.current++; stream.current?.getTracks().forEach(t => t.stop()); stream.current = undefined; setActive(false); setPending(false); };
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop);
    return () => { generation.current++; stream.current?.getTracks().forEach(t => t.stop()); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop); };
  }, []);
  async function start() {
    const token = ++generation.current; setPending(true); setError('');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('HTTPS');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2400 }, height: { ideal: 1800 } }, audio: false });
      if (token !== generation.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      if (token === generation.current) { setActive(true); setPending(false); }
    } catch (e) {
      if (token !== generation.current) return;
      stop();
      const name = (e as { name?: string })?.name;
      setError(name === 'NotAllowedError' ? 'Cameratoegang is geweigerd. Geef toestemming of upload een foto.' : name === 'NotFoundError' ? 'Er is geen geschikte camera gevonden. Upload een foto.' : 'De camera kan niet starten. Controleer of de app via HTTPS is geopend en probeer Foto maken of uploaden.');
    }
  }
  function takePhoto() {
    const element = video.current;
    if (!element?.videoWidth || !element.videoHeight) { setError('De camera is nog niet klaar. Probeer opnieuw.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight;
    canvas.getContext('2d')!.drawImage(element, 0, 0);
    stop(); canvas.toBlob(blob => { if (blob) captured(new File([blob], 'pakbon-camera.jpg', { type: 'image/jpeg' })); else setError('De foto kon niet worden gemaakt. Probeer opnieuw.'); }, 'image/jpeg', .95);
  }
  return <section className="card scanner"><h2>Pakbon scannen</h2><p>Breng de hele bon in beeld. Zorg voor voldoende licht en houd de iPad stil.</p><div className="video-frame"><video ref={video} autoPlay playsInline muted /></div>{error && <p className="error" role="alert">{error}</p>}<div className="actions">{active ? <button className="primary" onClick={takePhoto}>Pakbon vastleggen</button> : <button className="primary" disabled={pending} onClick={() => void start()}>{pending ? 'Camera openen…' : 'Camera starten'}</button>}<button onClick={() => { stop(); close(); }}>Camera sluiten</button></div></section>;
}
