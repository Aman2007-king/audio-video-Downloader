import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// API Endpoint to process external URL links
app.post('/api/extract-audio', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL query is required" });

  // Stream audio extraction pipeline directly into express output stream buffer
  // -f bestaudio: Pulls the best audio track available
  // -o -: Streams the binary data directly out via Standard Output (stdout)
  const command = `yt-dlp -f bestaudio -o - "${url}"`;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', 'attachment; filename="extracted_track.mp3"');

  const process = exec(command, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 });

  // Stream binary buffers straight out to the client
  process.stdout.on('data', (chunk) => res.write(chunk));
  
  process.on('close', (code) => {
    if (code !== 0) {
      console.error(`Extraction failed with code ${code}`);
      return res.status(500).end();
    }
    res.end();
  });

  process.stderr.on('data', (err) => console.log(`yt-dlp log: ${err}`));
});

app.listen(5000, () => console.log('Downloader core online on port 5000'));
