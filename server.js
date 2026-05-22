import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

const app = express();

// Enable global middlewares
app.use(cors());
app.use(express.json());

// 1. Core Frontend Router: Delivers interactive React SPA right in the client window
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VaporWave Studio Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body class="bg-[#0f0f1b]">
    <div id="root"></div>

    <script type="text/babel">
      function App() {
        const [inputUrl, setInputUrl] = React.useState('');
        const [isDownloading, setIsDownloading] = React.useState(false);
        const [audioFileLabel, setAudioFileLabel] = React.useState(null);
        const [isPlaying, setIsPlaying] = React.useState(false);
        const [duration, setDuration] = React.useState(0);
        const [currentTime, setCurrentTime] = React.useState(0);
        const [speed, setSpeed] = React.useState(0.85);
        const [reverbWet, setReverbWet] = React.useState(0.6);
        const [crackleVolume, setCrackleVolume] = React.useState(0.3);

        const audioCtxRef = React.useRef(null);
        const sourceNodeRef = React.useRef(null);
        const audioBufferRef = React.useRef(null);
        const reverbGainRef = React.useRef(null);
        const crackleGainRef = React.useRef(null);
        const crackleSourceRef = React.useRef(null);
        const canvasRef = React.useRef(null);
        const animationRef = React.useRef(null);
        const analyserRef = React.useRef(null);
        const startTimeRef = React.useRef(0);
        const pauseTimeRef = React.useRef(0);

        React.useEffect(() => {
          lucide.createIcons();
          return () => {
            if (audioCtxRef.current) audioCtxRef.current.close();
            cancelAnimationFrame(animationRef.current);
          };
        }, []);

        React.useEffect(() => { lucide.createIcons(); }, [audioFileLabel, isPlaying]);

        React.useEffect(() => {
          if (sourceNodeRef.current && isPlaying) sourceNodeRef.current.playbackRate.value = speed;
        }, [speed, isPlaying]);

        React.useEffect(() => {
          if (reverbGainRef.current) reverbGainRef.current.gain.value = reverbWet;
        }, [reverbWet]);

        React.useEffect(() => {
          if (crackleGainRef.current) crackleGainRef.current.gain.value = crackleVolume;
        }, [crackleVolume]);

        const handleUrlSubmit = async (e) => {
          e.preventDefault();
          if (!inputUrl.trim()) return;
          setIsDownloading(true);
          resetEngine();
          try {
            const response = await fetch('/api/extract-audio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: inputUrl })
            });
            if (!response.ok) throw new Error("Extraction error");
            const blob = await response.blob();
            setAudioFileLabel("Remote Track Stream Link");
            const arrayBuffer = await blob.arrayBuffer();
            initAudioEngine(arrayBuffer);
          } catch (err) {
            alert("Failed to process link. Check if URL is valid.");
          } finally {
            setIsDownloading(false);
          }
        };

        const handleFileUpload = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          setAudioFileLabel(file.name);
          resetEngine();
          const arrayBuffer = await file.arrayBuffer();
          initAudioEngine(arrayBuffer);
        };

        const initAudioEngine = async (arrayBuffer) => {
          if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
          }
          audioCtxRef.current.decodeAudioData(arrayBuffer, (buffer) => {
            audioBufferRef.current = buffer;
            setDuration(buffer.duration);
            setupVisualizer();
          }, (err) => alert("Could not parse audio tracking buffers. Try another format."));
        };

        const resetEngine = () => {
          setIsPlaying(false);
          setCurrentTime(0);
          pauseTimeRef.current = 0;
          if (sourceNodeRef.current) { try { sourceNodeRef.current.stop(); } catch(e){} }
          cancelAnimationFrame(animationRef.current);
        };

        const createVinylCrackleBuffer = (ctx) => {
          const bufferSize = ctx.sampleRate * 5;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            let noise = Math.random() * 2 - 1;
            data[i] = Math.random() > 0.9995 ? noise * 0.4 : noise * 0.012;
          }
          return buffer;
        };

        const createReverbImpulseResponse = (ctx) => {
          const len = ctx.sampleRate * 2.5;
          const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
          const left = impulse.getChannelData(0);
          const right = impulse.getChannelData(1);
          for (let i = 0; i < len; i++) {
            const decay = Math.exp(-i / (ctx.sampleRate * 0.8));
            left[i] = (Math.random() * 2 - 1) * decay;
            right[i] = (Math.random() * 2 - 1) * decay;
          }
          return impulse;
        };

        const playAudio = () => {
          if (!audioBufferRef.current || isPlaying) return;
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') ctx.resume();

          const source = ctx.createBufferSource();
          source.buffer = audioBufferRef.current;
          source.playbackRate.value = speed;
          sourceNodeRef.current = source;

          const mainGain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;

          const convolver = ctx.createConvolver();
          convolver.buffer = createReverbImpulseResponse(ctx);
          const revGain = ctx.createGain();
          revGain.gain.value = reverbWet;
          reverbGainRef.current = revGain;

          const crackleSource = ctx.createBufferSource();
          crackleSource.buffer = createVinylCrackleBuffer(ctx);
          crackleSource.loop = true;
          const crackGain = ctx.createGain();
          crackGain.gain.value = crackleVolume;
          crackleGainRef.current = crackGain;
          crackleSourceRef.current = crackleSource;

          source.connect(mainGain);
          source.connect(convolver);
          convolver.connect(revGain);
          revGain.connect(mainGain);
          crackleSource.connect(crackGain);
          crackGain.connect(mainGain);
          mainGain.connect(analyser);
          analyser.connect(ctx.destination);

          const offset = pauseTimeRef.current;
          startTimeRef.current = ctx.currentTime - (offset / speed);
          
          source.start(0, offset);
          crackleSource.start(0);
          setIsPlaying(true);

          trackProgress();
          drawVisualizer();
        };

        const pauseAudio = () => {
          if (!isPlaying) return;
          pauseTimeRef.current = (audioCtxRef.current.currentTime - startTimeRef.current) * speed;
          if (sourceNodeRef.current) { sourceNodeRef.current.stop(); sourceNodeRef.current.disconnect(); }
          if (crackleSourceRef.current) { crackleSourceRef.current.stop(); crackleSourceRef.current.disconnect(); }
          setIsPlaying(false);
          cancelAnimationFrame(animationRef.current);
        };

        const trackProgress = () => {
          if (!isPlaying) return;
          const currentLoc = (audioCtxRef.current.currentTime - startTimeRef.current) * speed;
          if (currentLoc <= duration) {
            setCurrentTime(currentLoc);
            requestAnimationFrame(trackProgress);
          }
        };

        const setupVisualizer = () => {
          const canvasCtx = canvasRef.current.getContext('2d');
          canvasCtx.fillStyle = '#161626';
          canvasCtx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        };

        const drawVisualizer = () => {
          if (!isPlaying || !analyserRef.current) return;
          requestAnimationFrame(drawVisualizer);
          const canvas = canvasRef.current;
          const canvasCtx = canvas.getContext('2d');
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          
          analyserRef.current.getByteFrequencyData(dataArray);
          canvasCtx.fillStyle = 'rgba(22, 22, 38, 0.3)';
          canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
          
          const barWidth = (canvas.width / bufferLength) * 1.5;
          let x = 0;
          for (let i = 0; i < bufferLength; i++) {
            let barHeight = dataArray[i] / 1.6;
            canvasCtx.fillStyle = 'rgb(' + (138 + (i * 2)) + ', 43, ' + (226 + i) + ')';
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
          }
        };

        return (
          <div className="min-h-screen bg-[#0f0f1b] text-slate-100 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-[#161626] border border-slate-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
                <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl">
                  <i data-lucide="disc" className={"w-6 h-6 text-white " + (isPlaying ? "animate-spin" : "")}></i>
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">VaporWave Studio Pro</h1>
                  <p className="text-xs text-slate-400">Stream Downloader & Live Audio Transformer Workbench</p>
                </div>
              </div>

              {!audioFileLabel ? (
                <div className="space-y-6">
                  <form onSubmit={handleUrlSubmit} className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">Fetch Media via URL Link</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <i data-lucide="link" className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500"></i>
                        <input 
                          type="url" 
                          placeholder="Paste Link Here..."
                          value={inputUrl}
                          onChange={(e) => setInputUrl(e.target.value)}
                          disabled={isDownloading}
                          className="w-full bg-[#1b1b30] border border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-200 outline-none focus:border-indigo-500"
                        />
                      </div>
                      <button type="submit" disabled={isDownloading} className="bg-indigo-600 rounded-xl px-4 text-sm font-semibold text-white min-w-[80px]">
                        {isDownloading ? 'Loading...' : 'Fetch'}
                      </button>
                    </div>
                  </form>
                  <div className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center relative bg-[#1b1b30]/60">
                    <input type="file" accept="audio/*" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <p className="text-xs text-slate-300">Browse local master tracks</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-[#1b1b30] border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-slate-200">{audioFileLabel}</p>
                    </div>
                    <button onClick={() => window.location.reload()} className="p-2 text-slate-400"><i data-lucide="refresh-cw" className="w-4 h-4"></i></button>
                  </div>

                  <div className="relative rounded-xl overflow-hidden bg-[#0a0a12] border border-slate-900">
                    <canvas ref={canvasRef} width="640" height="120" className="w-full block"></canvas>
                  </div>

                  <div className="flex justify-center items-center">
                    <button onClick={isPlaying ? pauseAudio : playAudio} className="p-4 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full text-white">
                      {isPlaying ? <i data-lucide="pause" className="w-5 h-5"></i> : <i data-lucide="play" className="w-5 h-5"></i>}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800 pt-5">
                    <div className="bg-[#1b1b30]/40 border border-slate-800 p-4 rounded-xl space-y-2">
                      <div className="text-xs font-semibold text-violet-400">Tempo Rate ({Math.round(speed*100)}%)</div>
                      <input type="range" min="0.5" max="1.0" step="0.01" value={speed} onChange={(e)=>setSpeed(parseFloat(e.target.value))} className="w-full" />
                    </div>
                    <div className="bg-[#1b1b30]/40 border border-slate-800 p-4 rounded-xl space-y-2">
                      <div className="text-xs font-semibold text-fuchsia-400">Space Echo ({Math.round(reverbWet*100)}%)</div>
                      <input type="range" min="0.0" max="1.0" step="0.02" value={reverbWet} onChange={(e)=>setReverbWet(parseFloat(e.target.value))} className="w-full" />
                    </div>
                    <div className="bg-[#1b1b30]/40 border border-slate-800 p-4 rounded-xl space-y-2">
                      <div className="text-xs font-semibold text-pink-400">Vinyl Dust ({Math.round(crackleVolume*100)}%)</div>
                      <input type="range" min="0.0" max="0.8" step="0.02" value={crackleVolume} onChange={(e)=>setCrackleVolume(parseFloat(e.target.value))} className="w-full" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<App />);
    </script>
</body>
</html>
  `);
});

// 2. Headless API Extraction Node: Handles downloading via yt-dlp core binaries
app.post('/api/extract-audio', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL query is required" });

  const command = `yt-dlp -f bestaudio -o - "${url}"`;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', 'attachment; filename="extracted_track.mp3"');

  const processStream = exec(command, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 });

  // Stream raw chunks back to the interface layer
  processStream.stdout.on('data', (chunk) => {
    res.write(chunk);
  });
  
  // Guard against complete network server failure on invalid URLs
  processStream.on('error', (err) => {
    console.error('Child execution stream encountered an error:', err);
    if (!res.headersSent) res.status(500).end();
  });

  processStream.on('close', (code) => {
    if (code !== 0) {
      console.error(`yt-dlp closed unexpectedly with code ${code}`);
      if (!res.headersSent) res.status(500).end();
      return;
    }
    res.end();
  });

  processStream.stderr.on('data', (err) => {
    // Standard informational logs from streaming tracking indicators
    console.log(`Log info: ${err.toString().slice(0, 60)}`);
  });
});

// 3. Bulletproof Port Binding: Listens correctly on Render or defaults locally
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`VaporWave Matrix Server Online on Port ${PORT}`);
});
