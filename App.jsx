import React, { useState, useEffect, useRef } from 'react';
import { Upload, Play, Pause, Sliders, Volume2, Music, Disc, RefreshCw, Link, Download, Loader2 } from 'lucide-react';

export default function IntegratedStudioApp() {
  // Navigation & Sourcing States
  const [inputUrl, setInputUrl] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [audioFileLabel, setAudioFileLabel] = useState(null);
  
  // Audio Engine State 
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // FX Parameters
  const [speed, setSpeed] = useState(0.85);
  const [reverbWet, setReverbWet] = useState(0.6);
  const [crackleVolume, setCrackleVolume] = useState(0.3);

  // Core Web Audio References
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const audioBufferRef = useRef(null);
  const reverbGainRef = useRef(null);
  const crackleGainRef = useRef(null);
  const crackleSourceRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const analyserRef = useRef(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) audioCtxRef.current.close();
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    if (sourceNodeRef.current && isPlaying) sourceNodeRef.current.playbackRate.value = speed;
  }, [speed, isPlaying]);

  useEffect(() => {
    if (reverbGainRef.current) reverbGainRef.current.gain.value = reverbWet;
  }, [reverbWet]);

  useEffect(() => {
    if (crackleGainRef.current) crackleGainRef.current.gain.value = crackleVolume;
  }, [crackleVolume]);

  // Handler: Handle Remote Web URL Processing via local endpoint proxy
  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    setIsDownloading(true);
    resetEngine();

    try {
      // Connect to your node backend extraction server microservice
      const response = await fetch('http://localhost:5000/api/extract-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl })
      });

      if (!response.ok) throw new Error("Backend extraction error");

      const blob = await response.blob();
      setAudioFileLabel(`Remote Stream (${inputUrl.slice(0, 25)}...)`);
      
      const arrayBuffer = await blob.arrayBuffer();
      initAudioEngine(arrayBuffer);
    } catch (err) {
      alert("Failed to extract or resolve media from that link. Ensure server is active.");
      console.error(err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Handler: Standard Native Local File Uploader Stream
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
    }, (err) => console.error("PCM Decoding Error", err));
  };

  const resetEngine = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    pauseTimeRef.current = 0;
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e){}
    }
    cancelAnimationFrame(animationRef.current);
  };

  // Procedural Sound FX Synthesizers
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

    source.onended = () => {
      if (ctx.currentTime - startTimeRef.current >= (audioBufferRef.current.duration / speed)) {
        setIsPlaying(false);
        setCurrentTime(0);
        pauseTimeRef.current = 0;
      }
    };
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
    animationRef.current = requestAnimationFrame(drawVisualizer);
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
      canvasCtx.fillStyle = `rgb(${138 + (i * 2)}, 43, ${226 + i})`;
      canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
      x += barWidth;
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f1b] text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#161626] border border-slate-800 rounded-2xl p-6 shadow-2xl">
        
        {/* Header App Info */}
        <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
            <Disc className={`w-6 h-6 text-white ${isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">VaporWave Studio Pro</h1>
            <p className="text-xs text-slate-400">Stream Downloader & Live Audio Transformer Workbench</p>
          </div>
        </div>

        {/* Input Interface Matrix */}
        {!audioBufferRef.current ? (
          <div className="space-y-6">
            {/* Input Route 1: URL Fetch Core */}
            <form onSubmit={handleUrlSubmit} className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">Fetch Media via URL Link</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" />
                  <input 
                    type="url" 
                    placeholder="Paste YouTube, SoundCloud, Instagram link here..."
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    disabled={isDownloading}
                    className="w-full bg-[#1b1b30] border border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-60 transition-all"
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isDownloading || !inputUrl}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 rounded-xl px-4 text-sm font-semibold transition-all flex items-center gap-2 min-w-[100px] justify-center text-white"
                >
                  {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch Stream'}
                </button>
              </div>
            </form>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink mx-4 text-xs font-bold uppercase tracking-widest text-slate-600">OR</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            {/* Input Route 2: Native File Dropzone */}
            <div className="border-2 border-dashed border-slate-700 hover:border-purple-500 transition-colors rounded-xl p-8 text-center cursor-pointer relative bg-[#1b1b30]/60 group">
              <input type="file" accept="audio/*" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3 group-hover:-translate-y-0.5 transition-transform" />
              <p className="text-xs font-medium text-slate-300">Browse local master tracks from internal file directories</p>
            </div>
          </div>
        ) : (
          /* Editor Workbench Rack workspace */
          <div className="space-y-6">
            <div className="bg-[#1b1b30] border border-slate-800 rounded-xl p-4 flex items-center gap-4">
              <div className="p-2.5 bg-slate-800 text-purple-400 rounded-lg"><Music className="w-4 h-4" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-slate-200">{audioFileLabel}</p>
                <p className="text-xs text-slate-400 mt-0.5">{Math.floor(currentTime/60)}:{(currentTime%60 < 10 ? '0':'') + Math.floor(currentTime%60)} / {Math.floor(duration/60)}:{(duration%60 < 10 ? '0':'') + Math.floor(duration%60)}</p>
              </div>
              <button onClick={() => { resetEngine(); audioBufferRef.current = null; setAudioFileLabel(null); }} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-[#0a0a12] border border-slate-900 shadow-inner">
              <canvas ref={canvasRef} width="640" height="120" className="w-full block"></canvas>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-900/40">
                <div className="h-full bg-gradient-to-r from-violet-500 to-pink-500 transition-all duration-100 ease-linear" style={{ width: `${(currentTime / duration) * 100}%` }}></div>
              </div>
            </div>

            <div className="flex justify-center items-center py-1">
              <button onClick={isPlaying ? pauseAudio : playAudio} className="p-4 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full shadow-lg active:scale-95 transition-all text-white">
                {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white translate-x-0.5" />}
              </button>
            </div>

            {/* Mixer Sliders Layer Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800/60 pt-5">
              <div className="bg-[#1b1b30]/40 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex justify-between items-center"><span className="text-xs font-semibold tracking-wide text-violet-400">Tempo Rate</span><span className="text-xs font-bold font-mono text-violet-300">{Math.round(speed*100)}%</span></div>
                <input type="range" min="0.5" max="1.0" step="0.01" value={speed} onChange={(e)=>setSpeed(parseFloat(e.target.value))} className="w-full accent-violet-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
              </div>
              <div className="bg-[#1b1b30]/40 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex justify-between items-center"><span className="text-xs font-semibold tracking-wide text-fuchsia-400">Ambient Decay</span><span className="text-xs font-bold font-mono text-fuchsia-300">{Math.round(reverbWet*100)}%</span></div>
                <input type="range" min="0.0" max="1.0" step="0.02" value={reverbWet} onChange={(e)=>setReverbWet(parseFloat(e.target.value))} className="w-full accent-fuchsia-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
              </div>
              <div className="bg-[#1b1b30]/40 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex justify-between items-center"><span className="text-xs font-semibold tracking-wide text-pink-400">Vinyl Dust</span><span className="text-xs font-bold font-mono text-pink-300">{Math.round(crackleVolume*100)}%</span></div>
                <input type="range" min="0.0" max="0.8" step="0.02" value={crackleVolume} onChange={(e)=>setCrackleVolume(parseFloat(e.target.value))} className="w-full accent-pink-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
