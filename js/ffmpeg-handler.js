

const FFmpegHandler = (function () {
  "use strict";

  let ffmpeg = null;
  let isLoaded = false;
  let isLoading = false;
  let loadPromise = null;
  let currentProgressCallback = null;

  
  const ANALYSIS_CHUNK_SIZE = 10 * 1024 * 1024;

  
  async function safeReadFile(fileOrBlob) {
    try {
      return await fileOrBlob.arrayBuffer();
    } catch (error) {
      const sizeGB = fileOrBlob.size / (1024 * 1024 * 1024);
      if (error.name === 'NotReadableError') {
        if (sizeGB > 1.5) {
          throw new Error(
            `File is too large (${sizeGB.toFixed(1)} GB) to load into browser memory. ` +
            `Browsers typically can't allocate more than ~2GB for a single file. ` +
            `Please use a smaller file or convert the MKV to MP4 using a desktop tool like HandBrake or FFmpeg.`
          );
        }
        throw new Error('File could not be read. It may have been moved, deleted, or is on a disconnected drive. Please try selecting the file again.');
      }
      throw error;
    }
  }

  
  function isCrossOriginIsolated() {
    return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
  }

  
  async function fetchToBlobURL(url, mimeType) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(new Blob([blob], { type: mimeType }));
  }

  
  function setProgressCallback(callback) {
    currentProgressCallback = callback;
  }

  
  async function loadFFmpeg(progressCallback) {
    if (isLoaded && ffmpeg) {
      return ffmpeg;
    }

    if (isLoading && loadPromise) {
      return loadPromise;
    }

    isLoading = true;

    loadPromise = (async () => {
      try {
        if (progressCallback) {
          progressCallback("Checking browser support...");
        }

        
        if (!isCrossOriginIsolated()) {
          throw new Error(
            "Cross-Origin Isolation not enabled. Please run: node server.js",
          );
        }

        if (progressCallback) {
          progressCallback("Loading FFmpeg library...");
        }

        
        const { FFmpeg } = await import("/vendor/ffmpeg/index.js");

        ffmpeg = new FFmpeg();

        
        ffmpeg.on("log", ({ message }) => {
          console.log("[FFmpeg]", message);
        });

        
        ffmpeg.on("progress", ({ progress }) => {
          if (currentProgressCallback && progress > 0) {
            const percent = Math.round(progress * 100);
            currentProgressCallback(`Processing: ${percent}%`);
          }
        });

        if (progressCallback) {
          progressCallback("Loading FFmpeg core...");
        }

        
        const baseURL = "/vendor/ffmpeg";

        const [coreURL, wasmURL] = await Promise.all([
          fetchToBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          fetchToBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        ]);

        await ffmpeg.load({
          coreURL,
          wasmURL,
        });

        isLoaded = true;
        isLoading = false;

        if (progressCallback) {
          progressCallback("FFmpeg ready");
        }

        return ffmpeg;
      } catch (error) {
        isLoading = false;
        loadPromise = null;
        console.error("Failed to load FFmpeg:", error);
        throw error;
      }
    })();

    return loadPromise;
  }

  
  function isMkvFile(file) {
    const name = file.name.toLowerCase();
    return name.endsWith(".mkv");
  }

  
  const SUPPORTED_VIDEO_CODECS = [
    "h264",
    "avc1",
    "avc",
    "x264",
    "vp8",
    "vp9",
    "av1",
    "av01",
  ];

  const BITMAP_SUBTITLE_CODECS = [
    "hdmv_pgs_subtitle",
    "pgssub",
    "pgs",
    "dvd_subtitle",
    "dvdsub",
    "dvb_subtitle",
    "dvbsub",
    "xsub",
  ];

  
  function isVideoCodecSupported(codec) {
    const lowerCodec = codec.toLowerCase();
    return SUPPORTED_VIDEO_CODECS.some((c) => lowerCodec.includes(c));
  }

  function isBitmapSubtitle(codec) {
    const lowerCodec = codec.toLowerCase();
    return BITMAP_SUBTITLE_CODECS.some((c) => lowerCodec.includes(c));
  }

  
  async function getMediaInfo(file, progressCallback) {
    await loadFFmpeg(progressCallback);

    const inputName = "input" + getExtension(file.name);

    try {
      if (progressCallback) progressCallback("Analyzing file...");
      const fileData = await safeReadFile(file);
      await ffmpeg.writeFile(inputName, new Uint8Array(fileData));

      const streams = {
        video: [],
        audio: [],
        subtitle: [],
      };

      let logOutput = "";

      const logHandler = ({ message }) => {
        logOutput += message + "\n";
      };

      ffmpeg.on("log", logHandler);

      try {
        await ffmpeg.exec(["-i", inputName, "-f", "null", "-"]);
      } catch (e) {
        
      }

      
      const lines = logOutput.split("\n");

      for (const line of lines) {
        
        const streamMatch = line.match(
          /Stream #(\d+):(\d+)(?:\[0x[a-f0-9]+\])?(?:\((\w+)\))?.*?: (Video|Audio|Subtitle): ([^,\n(]+)/i,
        );

        if (streamMatch) {
          const [, fileIdx, streamIdx, language, type, codecInfo] = streamMatch;
          const codec = codecInfo.trim().split(" ")[0].toLowerCase();

          const streamInfo = {
            index: parseInt(streamIdx),
            language: language || "und",
            codec: codec,
            codecFull: codecInfo.trim(),
            details: line,
          };

          console.log(`Found ${type} stream:`, streamInfo);

          switch (type.toLowerCase()) {
            case "video":
              streamInfo.supported = isVideoCodecSupported(codec);
              streams.video.push(streamInfo);
              break;
            case "audio":
              streams.audio.push(streamInfo);
              break;
            case "subtitle":
              streams.subtitle.push(streamInfo);
              break;
          }
        }
      }

      await ffmpeg.deleteFile(inputName);

      console.log("Parsed media info:", streams);
      return streams;
    } catch (error) {
      console.error("Error getting media info:", error);
      try {
        await ffmpeg.deleteFile(inputName);
      } catch (e) {}
      throw error;
    }
  }

  
  async function extractAllSubtitles(file, subtitleStreams, progressCallback) {
    await loadFFmpeg(progressCallback);

    const inputName = "input" + getExtension(file.name);
    const subtitles = [];

    try {
      if (progressCallback) progressCallback("Extracting subtitles...");
      const fileData = await safeReadFile(file);
      await ffmpeg.writeFile(inputName, new Uint8Array(fileData));

      for (let i = 0; i < subtitleStreams.length; i++) {
        const stream = subtitleStreams[i];
        const outputName = `subtitle_${i}.vtt`;

        if (progressCallback) {
          progressCallback(
            `Extracting subtitle ${i + 1}/${subtitleStreams.length}...`,
          );
        }

        try {
          await ffmpeg.exec([
            "-i",
            inputName,
            "-map",
            `0:s:${i}`,
            "-c:s",
            "webvtt",
            outputName,
          ]);

          const data = await ffmpeg.readFile(outputName);
          const vttContent = new TextDecoder("utf-8").decode(data);

          let label = stream.title || stream.language || `Track ${i + 1}`;
          if (
            stream.language &&
            stream.language !== "und" &&
            !label.includes(stream.language)
          ) {
            label += ` (${stream.language})`;
          }

          subtitles.push({
            index: i,
            label: label,
            language: stream.language || "und",
            content: vttContent,
          });

          await ffmpeg.deleteFile(outputName);
        } catch (e) {
          console.warn(`Failed to extract subtitle track ${i}:`, e);
        }
      }

      await ffmpeg.deleteFile(inputName);
      return subtitles;
    } catch (error) {
      console.error("Error extracting subtitles:", error);
      try {
        await ffmpeg.deleteFile(inputName);
      } catch (e) {}
      throw error;
    }
  }

  
  async function transmuxToMp4(file, audioTrackIndex = 0, progressCallback, videoCodec = null) {
    await loadFFmpeg(progressCallback);

    const inputName = "input" + getExtension(file.name);
    const outputName = "output.mp4";

    try {
      if (progressCallback) progressCallback("Reading file...");
      const fileData = await safeReadFile(file);
      await ffmpeg.writeFile(inputName, new Uint8Array(fileData));

      
      const isHevc = videoCodec === 'hevc' || videoCodec === 'h265' || videoCodec === 'h.265';
      
      if (progressCallback) {
        progressCallback(isHevc ? "Transcoding HEVC to H.264..." : "Converting to MP4...");
      }

      let args;
      if (isHevc) {
        
        args = [
          "-i",
          inputName,
          "-map",
          "0:v:0",
          "-map",
          `0:a:${audioTrackIndex}?`,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "fastdecode",
          "-crf",
          "28",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          outputName,
        ];
      } else {
        
        args = [
          "-i",
          inputName,
          "-map",
          "0:v:0",
          "-map",
          `0:a:${audioTrackIndex}?`,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          outputName,
        ];
      }

      console.log("FFmpeg command:", args.join(" "));

      await ffmpeg.exec(args);

      if (progressCallback) progressCallback("Finalizing...");

      const data = await ffmpeg.readFile(outputName);
      console.log("Output file size:", data.length, "bytes");

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);

      const blob = new Blob([data.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      console.log("Created blob URL:", url);

      return url;
    } catch (error) {
      console.error("Error transmuxing to MP4:", error);
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch (e) {}
      throw new Error(`Failed to convert video: ${error.message}`);
    }
  }

  
  async function analyzeStreams(file, progressCallback) {
    await loadFFmpeg(progressCallback);
    
    // Use 10MB chunk for fast analysis (stream info is in file headers)
    const inputPath = "analysis" + getExtension(file.name);
    const chunkSize = Math.min(file.size, ANALYSIS_CHUNK_SIZE);
    const chunk = file.slice(0, chunkSize);
    const chunkData = await safeReadFile(chunk);
    await ffmpeg.writeFile(inputPath, new Uint8Array(chunkData));
    
    let logOutput = "";
    const logHandler = ({ message }) => {
      logOutput += message + "\n";
    };
    ffmpeg.on("log", logHandler);
    
    try {
      await ffmpeg.exec(["-i", inputPath, "-f", "null", "-"]);
    } catch (e) {
      // FFmpeg returns error when no output specified, but logs contain stream info
    }
    
    ffmpeg.off("log", logHandler);
    await ffmpeg.deleteFile(inputPath);
    
    // Parse stream information from FFmpeg output
    const videoStreams = [];
    const audioStreams = [];
    const subtitleStreams = [];
    const lines = logOutput.split("\n");
    
    for (const line of lines) {
      const streamMatch = line.match(
        /Stream #(\d+):(\d+)(?:\[0x[a-f0-9]+\])?(?:\((\w+)\))?.*?: (Video|Audio|Subtitle): ([^,\n(]+)/i,
      );
      
      if (streamMatch) {
        const [, fileIdx, streamIdx, language, type, codecInfo] = streamMatch;
        const codec = codecInfo.trim().split(" ")[0].toLowerCase();
        
        if (type.toLowerCase() === "video") {
          videoStreams.push({
            index: videoStreams.length,
            streamIdx: parseInt(streamIdx),
            codec: codec,
          });
        } else if (type.toLowerCase() === "audio") {
          audioStreams.push({
            index: audioStreams.length,
            streamIdx: parseInt(streamIdx),
            language: language || "und",
            codec: codec,
          });
        } else if (type.toLowerCase() === "subtitle") {
          const isBitmap = isBitmapSubtitle(codec);
          subtitleStreams.push({
            index: subtitleStreams.length,
            streamIdx: parseInt(streamIdx),
            language: language || "und",
            codec: codec,
            isBitmap: isBitmap,
          });
        }
      }
    }
    
    console.log(`[analyzeStreams] Found: ${videoStreams.length} video, ${audioStreams.length} audio, ${subtitleStreams.length} subtitle`);
    
    return { videoStreams, audioStreams, subtitleStreams };
  }

  
  async function extractSubtitle(file, subtitleIndex, language, progressCallback, subtitleCodec = null) {
    if (subtitleCodec && isBitmapSubtitle(subtitleCodec)) {
      console.warn(`Cannot extract subtitle track ${subtitleIndex}: ${subtitleCodec} is a bitmap format`);
      return {
        index: subtitleIndex,
        label: language || `Track ${subtitleIndex + 1}`,
        language: language || "und",
        content: null,
        error: `This subtitle track uses ${subtitleCodec.toUpperCase()} format (bitmap-based). Bitmap subtitles from Blu-rays/DVDs cannot be converted to text in the browser. They require OCR (Optical Character Recognition) which is not available here.`,
        isBitmap: true,
      };
    }

    await loadFFmpeg(progressCallback);
    setProgressCallback(progressCallback);
    
    const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024 * 1024; 
    const isLargeFile = file.size >= LARGE_FILE_THRESHOLD;
    const outputName = `subtitle_${subtitleIndex}.vtt`;
    
    let inputPath;
    let mountDir = null;
    
    try {
      if (progressCallback) progressCallback(`Extracting subtitle track ${subtitleIndex + 1}...`);
      
      if (isLargeFile) {
        
        console.log(`Using WORKERFS for subtitle extraction (file: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        
        mountDir = `/workerfs_sub_${Date.now()}`;
        
        
        await ffmpeg.createDir(mountDir);
        await ffmpeg.mount("WORKERFS", { files: [file] }, mountDir);
        inputPath = `${mountDir}/${file.name}`;
      } else {
        
        inputPath = "sub_input" + getExtension(file.name);
        const fileData = await safeReadFile(file);
        await ffmpeg.writeFile(inputPath, new Uint8Array(fileData));
      }
      
      await ffmpeg.exec([
        "-i",
        inputPath,
        "-map",
        `0:s:${subtitleIndex}`,
        "-c:s",
        "webvtt",
        outputName,
      ]);
      
      const data = await ffmpeg.readFile(outputName);
      const vttContent = new TextDecoder("utf-8").decode(data);
      
      
      await ffmpeg.deleteFile(outputName);
      if (isLargeFile && mountDir) {
        await ffmpeg.unmount(mountDir);
      } else {
        await ffmpeg.deleteFile(inputPath);
      }
      
      return {
        index: subtitleIndex,
        label: language || `Track ${subtitleIndex + 1}`,
        language: language || "und",
        content: vttContent,
      };
    } catch (e) {
      console.warn(`Failed to extract subtitle track ${subtitleIndex}:`, e);
      try {
        await ffmpeg.deleteFile(outputName);
        if (isLargeFile && mountDir) {
          await ffmpeg.unmount(mountDir);
        } else if (!isLargeFile) {
          await ffmpeg.deleteFile(inputPath);
        }
      } catch (cleanupErr) {}
      return null;
    }
  }

  async function extractPgsSubtitle(file, subtitleIndex, language, progressCallback) {
    await loadFFmpeg(progressCallback);
    setProgressCallback(progressCallback);
    
    const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024 * 1024;
    const isLargeFile = file.size >= LARGE_FILE_THRESHOLD;
    const outputName = `subtitle_${subtitleIndex}.sup`;
    
    let inputPath;
    let mountDir = null;
    
    try {
      if (progressCallback) progressCallback(`Extracting PGS subtitle track ${subtitleIndex + 1}...`);
      
      if (isLargeFile) {
        console.log(`Using WORKERFS for PGS extraction (file: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        
        mountDir = `/workerfs_pgs_${Date.now()}`;
        await ffmpeg.createDir(mountDir);
        await ffmpeg.mount("WORKERFS", { files: [file] }, mountDir);
        inputPath = `${mountDir}/${file.name}`;
      } else {
        inputPath = "pgs_input" + getExtension(file.name);
        const fileData = await safeReadFile(file);
        await ffmpeg.writeFile(inputPath, new Uint8Array(fileData));
      }
      
      await ffmpeg.exec([
        "-i",
        inputPath,
        "-map",
        `0:s:${subtitleIndex}`,
        "-c:s",
        "copy",
        outputName,
      ]);
      
      const data = await ffmpeg.readFile(outputName);
      console.log(`[PGS] Extracted ${data.length} bytes of SUP data`);
      
      await ffmpeg.deleteFile(outputName);
      if (isLargeFile && mountDir) {
        await ffmpeg.unmount(mountDir);
      } else {
        await ffmpeg.deleteFile(inputPath);
      }
      
      return {
        index: subtitleIndex,
        label: language || `Track ${subtitleIndex + 1}`,
        language: language || "und",
        supData: data.buffer,
        isPgs: true,
      };
    } catch (e) {
      console.warn(`Failed to extract PGS subtitle track ${subtitleIndex}:`, e);
      try {
        await ffmpeg.deleteFile(outputName);
        if (isLargeFile && mountDir) {
          await ffmpeg.unmount(mountDir);
        } else if (!isLargeFile) {
          await ffmpeg.deleteFile(inputPath);
        }
      } catch (cleanupErr) {}
      return null;
    }
  }

  // List of audio codecs supported by browsers (no extraction needed)
  // Be VERY specific - only known-good codecs
  const SUPPORTED_AUDIO_CODECS = ['aac', 'mp3', 'mp4a', 'flac', 'opus', 'vorbis'];
  
  // List of audio codecs definitely NOT supported by browsers (need extraction)
  const UNSUPPORTED_AUDIO_CODECS = ['ac3', 'eac3', 'e-ac-3', 'dts', 'truehd', 'mlp', 'dca', 'pcm_bluray', 'pcm_dvd'];

  function isAudioCodecSupported(codec) {
    if (!codec) return false; // Unknown = assume unsupported (safer default)
    const lowerCodec = codec.toLowerCase();
    
    // Only return true if it's EXPLICITLY a known supported codec
    // This is the safest approach - better to transcode unnecessarily 
    // than to have no audio
    return SUPPORTED_AUDIO_CODECS.some(c => lowerCodec.includes(c));
  }

  function isAudioCodecUnsupported(codec) {
    if (!codec) return true; // Unknown = assume unsupported (safer default)
    const lowerCodec = codec.toLowerCase();
    
    // First check if it's explicitly supported
    if (SUPPORTED_AUDIO_CODECS.some(c => lowerCodec.includes(c))) {
      return false; // Supported
    }
    
    // Otherwise, it's unsupported (either explicitly or unknown)
    return true;
  }

  // Extract and transcode audio track for browser playback
  // Uses WORKERFS for large files to avoid memory issues
  // Outputs WAV (PCM audio) - larger but guaranteed to work in all browsers
  async function extractAudioTrack(file, audioIndex, progressCallback) {
    await loadFFmpeg(progressCallback);
    setProgressCallback(progressCallback);
    
    const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024 * 1024;
    const isLargeFile = file.size >= LARGE_FILE_THRESHOLD;
    const outputName = `audio_${audioIndex}_${Date.now()}.wav`;
    
    let inputPath;
    let mountDir = null;
    let ffmpegLogs = "";
    
    // Capture FFmpeg logs for debugging
    const logHandler = ({ message }) => {
      ffmpegLogs += message + "\n";
    };
    
    try {
      if (progressCallback) progressCallback(`Preparing to extract audio track ${audioIndex + 1}...`);
      
      if (isLargeFile) {
        console.log(`[extractAudioTrack] Using WORKERFS (file: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        
        mountDir = `/workerfs_audio_${Date.now()}`;
        await ffmpeg.createDir(mountDir);
        await ffmpeg.mount("WORKERFS", { files: [file] }, mountDir);
        inputPath = `${mountDir}/${file.name}`;
      } else {
        inputPath = "audio_input" + getExtension(file.name);
        const fileData = await safeReadFile(file);
        await ffmpeg.writeFile(inputPath, new Uint8Array(fileData));
      }
      
      if (progressCallback) progressCallback(`Extracting audio (this may take a while)...`);
      
      ffmpeg.on("log", logHandler);
      
      // Extract audio to WAV (PCM) format
      // WAV is uncompressed and universally supported - no encoder issues possible
      // Using 16-bit signed PCM at 48kHz stereo (standard for video)
      const result = await ffmpeg.exec([
        "-i",
        inputPath,
        "-map",
        `0:a:${audioIndex}`,
        "-vn",              // No video
        "-sn",              // No subtitles
        "-c:a",
        "pcm_s16le",        // 16-bit signed little-endian PCM
        "-ar",
        "48000",            // 48kHz sample rate
        "-ac",
        "2",                // Stereo
        "-f",
        "wav",              // WAV container
        "-y",
        outputName,
      ]);
      
      ffmpeg.off("log", logHandler);
      
      console.log('[extractAudioTrack] FFmpeg exit code:', result);
      
      let data;
      try {
        data = await ffmpeg.readFile(outputName);
      } catch (readErr) {
        console.error('[extractAudioTrack] Failed to read output file');
        console.error('[extractAudioTrack] FFmpeg logs:', ffmpegLogs);
        throw new Error('Audio extraction failed - output file not created');
      }
      
      const sizeMB = data.length / 1024 / 1024;
      console.log(`[extractAudioTrack] Extracted ${sizeMB.toFixed(2)} MB of WAV audio`);
      
      // Validate output - WAV should have reasonable size
      if (data.length < 10000) {
        console.error('[extractAudioTrack] Output too small, FFmpeg logs:', ffmpegLogs);
        throw new Error(`Audio extraction produced invalid output (${data.length} bytes)`);
      }
      
      // Check for valid WAV header (RIFF....WAVE)
      const header = new Uint8Array(data.slice(0, 12));
      const riffStr = String.fromCharCode(header[0], header[1], header[2], header[3]);
      const waveStr = String.fromCharCode(header[8], header[9], header[10], header[11]);
      if (riffStr !== 'RIFF' || waveStr !== 'WAVE') {
        console.warn('[extractAudioTrack] Warning: WAV header not found, file may be corrupted');
        console.error('[extractAudioTrack] First 12 bytes:', Array.from(header));
      } else {
        console.log('[extractAudioTrack] Valid WAV file detected');
      }
      
      // Cleanup FFmpeg files
      try {
        await ffmpeg.deleteFile(outputName);
      } catch (e) { /* ignore */ }
      
      if (isLargeFile && mountDir) {
        try {
          await ffmpeg.unmount(mountDir);
        } catch (e) { /* ignore */ }
      } else {
        try {
          await ffmpeg.deleteFile(inputPath);
        } catch (e) { /* ignore */ }
      }
      
      // Create a copy of the data to ensure clean memory
      const audioData = new Uint8Array(data.length);
      audioData.set(data);
      
      // Create blob from the copied Uint8Array
      const blob = new Blob([audioData], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      
      console.log(`[extractAudioTrack] Created audio blob URL: ${url}, size: ${blob.size} bytes`);
      
      return {
        index: audioIndex,
        url: url,
        blob: blob,
      };
    } catch (e) {
      ffmpeg.off("log", logHandler);
      console.error(`[extractAudioTrack] Failed:`, e);
      console.error('[extractAudioTrack] FFmpeg logs:', ffmpegLogs);
      
      // Cleanup on error
      try {
        await ffmpeg.deleteFile(outputName);
      } catch (cleanupErr) { /* ignore */ }
      
      if (isLargeFile && mountDir) {
        try {
          await ffmpeg.unmount(mountDir);
        } catch (cleanupErr) { /* ignore */ }
      } else if (!isLargeFile && inputPath) {
        try {
          await ffmpeg.deleteFile(inputPath);
        } catch (cleanupErr) { /* ignore */ }
      }
      
      throw new Error(`Failed to extract audio: ${e.message}`);
    }
  }

  
  async function processMkvFile(file, progressCallback) {
    const result = {
      videoUrl: null,
      audioTracks: [],
      subtitles: [],        
      subtitleStreams: [],  
      originalFile: file,
    };

    const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024 * 1024; 
    const SEGMENT_DURATION = 600; 
    const isLargeFile = file.size >= LARGE_FILE_THRESHOLD;

    try {
      if (progressCallback) progressCallback("Loading FFmpeg...");
      await loadFFmpeg(progressCallback);
      setProgressCallback(progressCallback);

      
      if (progressCallback) progressCallback("Analyzing streams...");
      const { videoStreams, audioStreams, subtitleStreams } = await analyzeStreams(file, progressCallback);
      
      console.log(`Found ${videoStreams.length} video, ${audioStreams.length} audio, ${subtitleStreams.length} subtitle streams`);
      
      
      const videoCodec = videoStreams.length > 0 ? videoStreams[0].codec : 'unknown';
      const isHevc = videoCodec === 'hevc' || videoCodec === 'h265' || videoCodec === 'h.265';
      console.log(`Video codec: ${videoCodec}, needs transcoding: ${isHevc}`);

      
      result.audioTracks = audioStreams.map((track) => ({
        index: track.index,
        label: track.language || `Audio ${track.index + 1}`,
        language: track.language || "und",
        codec: track.codec,
      }));

      
      result.subtitleStreams = subtitleStreams.map((stream) => ({
        index: stream.index,
        label: stream.language || `Track ${stream.index + 1}`,
        language: stream.language || "und",
        codec: stream.codec,
        isBitmap: stream.isBitmap || false,
        extracted: false,
      }));

      const outputName = "output.mp4";
      let inputPath;

      if (isLargeFile) {
        
        if (progressCallback) progressCallback("Mounting file (large file mode)...");
        console.log("Using WORKERFS mount for large file:", (file.size / (1024*1024*1024)).toFixed(2), "GB");
        
        try {
          
          await ffmpeg.createDir("/work");
          
          
          await ffmpeg.mount("WORKERFS", { files: [file] }, "/work");
          inputPath = "/work/" + file.name;
          
          console.log("Mounted file at:", inputPath);
        } catch (mountError) {
          console.warn("WORKERFS mount failed, falling back to memory load:", mountError);
          
          inputPath = "input" + getExtension(file.name);
          if (progressCallback) progressCallback("Reading file (fallback mode)...");
          const fileData = await safeReadFile(file);
          await ffmpeg.writeFile(inputPath, new Uint8Array(fileData));
        }
      } else {
        
        inputPath = "input" + getExtension(file.name);
        if (progressCallback) progressCallback("Reading file...");
        const fileData = await safeReadFile(file);
        await ffmpeg.writeFile(inputPath, new Uint8Array(fileData));
      }

      if (progressCallback) {
        progressCallback(isHevc ? "Transcoding HEVC to H.264 (this may take a while)..." : "Converting to MP4...");
      }

      let args;
      if (isHevc) {
        
        
        args = [
          "-i",
          inputPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",    
          "-tune",
          "fastdecode",   
          "-crf",
          "28",           
          "-c:a",
          "aac",
          "-b:a",
          "128k",         
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          outputName,
        ];
      } else {
        
        args = [
          "-i",
          inputPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          outputName,
        ];
      }

      console.log("FFmpeg command:", args.join(" "));
      await ffmpeg.exec(args);

      if (progressCallback) progressCallback("Finalizing...");

      let videoUrl;

      
      if (isLargeFile) {
        if (progressCallback) progressCallback("Large file: processing in segments...");
        
        
        
        const segmentDuration = SEGMENT_DURATION;
        const estimatedDuration = 7200; 
        const numSegments = Math.ceil(estimatedDuration / segmentDuration);
        
        const segments = [];
        let segmentIndex = 0;
        let hasMoreSegments = true;
        
        while (hasMoreSegments) {
          const startTime = segmentIndex * segmentDuration;
          const segmentName = `segment_${segmentIndex}.mp4`;
          
          if (progressCallback) {
            progressCallback(`Processing segment ${segmentIndex + 1}...`);
          }
          
          
          let segmentArgs;
          if (isHevc) {
            segmentArgs = [
              "-ss", String(startTime),
              "-i", inputPath,
              "-t", String(segmentDuration),
              "-map", "0:v:0",
              "-map", "0:a:0?",
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-tune", "fastdecode",
              "-crf", "28",
              "-c:a", "aac",
              "-b:a", "128k",
              "-avoid_negative_ts", "1",
              "-f", "mp4",
              segmentName,
            ];
          } else {
            segmentArgs = [
              "-ss", String(startTime),
              "-i", inputPath,
              "-t", String(segmentDuration),
              "-map", "0:v:0",
              "-map", "0:a:0?",
              "-c", "copy",
              "-avoid_negative_ts", "1",
              "-f", "mp4",
              segmentName,
            ];
          }
          
          try {
            await ffmpeg.exec(segmentArgs);
            
            
            const segmentData = await ffmpeg.readFile(segmentName);
            
            if (segmentData.length < 1000) {
              
              hasMoreSegments = false;
              await ffmpeg.deleteFile(segmentName);
            } else {
              
              const segmentBlob = new Blob([segmentData.buffer], { type: "video/mp4" });
              segments.push(URL.createObjectURL(segmentBlob));
              console.log(`Segment ${segmentIndex}: ${(segmentData.length / 1024 / 1024).toFixed(1)} MB`);
              
              
              await ffmpeg.deleteFile(segmentName);
              segmentIndex++;
              
              
              if (segmentIndex > 50) hasMoreSegments = false;
            }
          } catch (segErr) {
            console.log("Segment extraction ended:", segErr.message);
            hasMoreSegments = false;
          }
        }
        
        if (segments.length === 0) {
          throw new Error("Failed to create any video segments");
        }
        
        console.log(`Created ${segments.length} segments`);
        
        
        
        if (segments.length === 1) {
          videoUrl = segments[0];
        } else {
          
          result.segments = segments;
          videoUrl = segments[0]; 
          console.log("Multiple segments created. Full seamless playback requires MSE implementation.");
        }
      } else {
        
        const data = await ffmpeg.readFile(outputName);
        console.log("Output file size:", data.length, "bytes");
        const blob = new Blob([data.buffer], { type: "video/mp4" });
        videoUrl = URL.createObjectURL(blob);
      }

      
      if (isLargeFile) {
        try {
          await ffmpeg.unmount("/work");
          await ffmpeg.deleteDir("/work");
        } catch (e) {
          console.warn("Cleanup warning:", e);
        }
      } else {
        await ffmpeg.deleteFile(inputPath);
      }
      try {
        await ffmpeg.deleteFile(outputName);
      } catch (e) {}

      result.videoUrl = videoUrl;
      return result;
    } catch (error) {
      console.error("Error processing MKV:", error);
      
      try {
        await ffmpeg.unmount("/work");
        await ffmpeg.deleteDir("/work");
      } catch (e) {}
      throw error;
    }
  }

  
  function getExtension(filename) {
    const idx = filename.lastIndexOf(".");
    return idx !== -1 ? filename.substring(idx) : "";
  }

  
  function isFFmpegLoaded() {
    return isLoaded;
  }

  
  function checkSupport() {
    return {
      crossOriginIsolated: isCrossOriginIsolated(),
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      webAssembly: typeof WebAssembly !== "undefined",
    };
  }

  // MSE-related state for persistent file mount
  let mseMountDir = null;
  let mseMountedFile = null;
  let mseInputPath = null;
  
  /**
   * Mount file for MSE operations (keeps file accessible across multiple segment generations)
   */
  async function mountFileForMSE(file) {
    // If already mounted with same file, reuse
    if (mseMountedFile === file && mseInputPath) {
      return mseInputPath;
    }
    
    // Unmount any previous file
    await unmountMSEFile();
    
    await loadFFmpeg();
    
    mseMountDir = `/mse_${Date.now()}`;
    
    try {
      await ffmpeg.createDir(mseMountDir);
      await ffmpeg.mount("WORKERFS", { files: [file] }, mseMountDir);
      mseInputPath = `${mseMountDir}/${file.name}`;
      mseMountedFile = file;
      
      console.log('[FFmpeg] Mounted file for MSE at:', mseInputPath);
      return mseInputPath;
    } catch (e) {
      console.error('[FFmpeg] Failed to mount file for MSE:', e);
      mseMountDir = null;
      mseInputPath = null;
      mseMountedFile = null;
      throw e;
    }
  }
  
  /**
   * Unmount MSE file
   */
  async function unmountMSEFile() {
    if (mseMountDir && ffmpeg) {
      try {
        await ffmpeg.unmount(mseMountDir);
        await ffmpeg.deleteDir(mseMountDir);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    mseMountDir = null;
    mseInputPath = null;
    mseMountedFile = null;
  }
  
  /**
   * Check if video codec can be copied (already browser-compatible)
   */
  function canCopyVideoCodec(codec) {
    if (!codec) return false;
    const lowerCodec = codec.toLowerCase();
    // H.264/AVC can be copied directly
    return lowerCodec.includes('h264') || 
           lowerCodec.includes('avc') || 
           lowerCodec.includes('x264');
  }

  /**
   * Generate fragmented MP4 initialization segment (moov atom)
   * This contains codec info but no media data
   * @param {File} file - The input file
   * @param {number} audioTrackIndex - Which audio track to use
   * @param {string} videoCodec - The video codec (to determine copy vs transcode)
   * @param {Function} progressCallback - Progress callback
   */
  async function generateInitSegment(file, audioTrackIndex = 0, videoCodec = null, progressCallback) {
    await loadFFmpeg(progressCallback);
    setProgressCallback(progressCallback);
    
    const inputPath = await mountFileForMSE(file);
    const outputName = `init_${Date.now()}.mp4`;
    
    // Determine if we can copy video or need to transcode
    const copyVideo = canCopyVideoCodec(videoCodec);
    console.log(`[FFmpeg] Video codec: ${videoCodec}, copy mode: ${copyVideo}`);
    
    let ffmpegLogs = "";
    const logHandler = ({ message }) => {
      ffmpegLogs += message + "\n";
    };
    
    try {
      if (progressCallback) progressCallback('Generating initialization segment...');
      
      ffmpeg.on("log", logHandler);
      
      // Build args based on whether we can copy video
      const args = [
        "-i", inputPath,
        "-t", "0.1",                      // Small duration for init segment
        "-map", "0:v:0",                  // First video stream
        "-map", `0:a:${audioTrackIndex}?`, // Selected audio stream
      ];
      
      if (copyVideo) {
        // Copy video stream (FAST!)
        args.push("-c:v", "copy");
      } else {
        // Transcode video to H.264
        args.push(
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-tune", "zerolatency",
          "-profile:v", "high",
          "-level", "4.0"
        );
      }
      
      // Always transcode audio to AAC (the whole point of MSE mode)
      args.push(
        "-c:a", "aac",
        "-b:a", "192k",
        "-ac", "2",                       // Stereo
        "-ar", "48000",                   // 48kHz
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "-y",
        outputName
      );
      
      console.log('[FFmpeg] Init segment command:', args.join(' '));
      await ffmpeg.exec(args);
      
      ffmpeg.off("log", logHandler);
      
      let data;
      try {
        data = await ffmpeg.readFile(outputName);
      } catch (readErr) {
        console.error('[FFmpeg] Failed to read init segment:', readErr);
        console.error('[FFmpeg] Logs:', ffmpegLogs);
        throw new Error('Failed to generate init segment');
      }
      
      await ffmpeg.deleteFile(outputName);
      
      console.log(`[FFmpeg] Init segment: ${data.length} bytes`);
      
      // Return as ArrayBuffer
      return data.buffer;
      
    } catch (e) {
      ffmpeg.off("log", logHandler);
      console.error('[FFmpeg] Init segment generation failed:', e);
      console.error('[FFmpeg] Logs:', ffmpegLogs);
      
      try {
        await ffmpeg.deleteFile(outputName);
      } catch (cleanupErr) {}
      
      throw e;
    }
  }
  
  /**
   * Generate a fragmented MP4 segment for a time range
   * @param {File} file - The input file
   * @param {number} startTime - Start time in seconds
   * @param {number} duration - Duration in seconds
   * @param {number} audioTrackIndex - Which audio track to use
   * @param {string} videoCodec - The video codec (to determine copy vs transcode)
   * @param {Function} progressCallback - Progress callback
   * @param {AbortSignal} abortSignal - Abort signal
   */
  async function generateSegment(file, startTime, duration, audioTrackIndex = 0, videoCodec = null, progressCallback, abortSignal) {
    await loadFFmpeg(progressCallback);
    setProgressCallback(progressCallback);
    
    // Check if aborted before starting
    if (abortSignal && abortSignal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    
    const inputPath = await mountFileForMSE(file);
    const outputName = `segment_${startTime}_${Date.now()}.mp4`;
    
    // Determine if we can copy video or need to transcode
    const copyVideo = canCopyVideoCodec(videoCodec);
    
    let ffmpegLogs = "";
    const logHandler = ({ message }) => {
      ffmpegLogs += message + "\n";
    };
    
    try {
      if (copyVideo) {
        if (progressCallback) progressCallback(`Processing ${startTime.toFixed(0)}s - ${(startTime + duration).toFixed(0)}s...`);
      } else {
        if (progressCallback) progressCallback(`Transcoding ${startTime.toFixed(0)}s - ${(startTime + duration).toFixed(0)}s...`);
      }
      
      ffmpeg.on("log", logHandler);
      
      // Build args - use copy for H.264, transcode otherwise
      const args = [
        "-ss", String(startTime),         // Seek to start time (input seeking for speed)
        "-i", inputPath,
        "-t", String(duration),           // Duration of segment
        "-map", "0:v:0",                  // First video stream
        "-map", `0:a:${audioTrackIndex}?`, // Selected audio stream
      ];
      
      if (copyVideo) {
        // Copy video stream (FAST!)
        args.push("-c:v", "copy");
      } else {
        // Transcode video to H.264
        args.push(
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-tune", "zerolatency",
          "-profile:v", "high",
          "-level", "4.0",
          "-g", "30",
          "-keyint_min", "30",
          "-sc_threshold", "0"
        );
      }
      
      // Always transcode audio to AAC
      args.push(
        "-c:a", "aac",
        "-b:a", "192k",
        "-ac", "2",
        "-ar", "48000",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-frag_duration", "1000000",
        "-f", "mp4",
        "-y",
        outputName
      );
      
      console.log('[FFmpeg] Segment command:', args.join(' '));
      
      // Check abort before exec
      if (abortSignal && abortSignal.aborted) {
        ffmpeg.off("log", logHandler);
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      
      await ffmpeg.exec(args);
      
      ffmpeg.off("log", logHandler);
      
      // Check abort after exec
      if (abortSignal && abortSignal.aborted) {
        try {
          await ffmpeg.deleteFile(outputName);
        } catch (e) {}
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      
      let data;
      try {
        data = await ffmpeg.readFile(outputName);
      } catch (readErr) {
        // Could be end of file
        console.log('[FFmpeg] Could not read segment, may be end of file');
        return null;
      }
      
      await ffmpeg.deleteFile(outputName);
      
      // Check for very small output (likely end of file or error)
      if (data.length < 1000) {
        console.log('[FFmpeg] Segment too small, likely end of file');
        return null;
      }
      
      console.log(`[FFmpeg] Segment ${startTime}s: ${data.length} bytes`);
      
      // Return as ArrayBuffer
      return data.buffer;
      
    } catch (e) {
      ffmpeg.off("log", logHandler);
      
      if (e.name === 'AbortError') {
        throw e;
      }
      
      console.error('[FFmpeg] Segment generation failed:', e);
      console.error('[FFmpeg] Logs:', ffmpegLogs);
      
      try {
        await ffmpeg.deleteFile(outputName);
      } catch (cleanupErr) {}
      
      throw e;
    }
  }
  
  /**
   * Get media duration using FFprobe-style analysis
   */
  async function getMediaDuration(file, progressCallback) {
    await loadFFmpeg(progressCallback);
    
    const inputPath = await mountFileForMSE(file);
    
    let logOutput = "";
    const logHandler = ({ message }) => {
      logOutput += message + "\n";
    };
    
    ffmpeg.on("log", logHandler);
    
    try {
      // Run FFmpeg to get duration from stream info
      await ffmpeg.exec(["-i", inputPath, "-f", "null", "-"]);
    } catch (e) {
      // Expected to fail, but logs will have duration
    }
    
    ffmpeg.off("log", logHandler);
    
    // Parse duration from logs
    // Format: Duration: HH:MM:SS.ms
    const durationMatch = logOutput.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
    if (durationMatch) {
      const hours = parseInt(durationMatch[1]);
      const minutes = parseInt(durationMatch[2]);
      const seconds = parseInt(durationMatch[3]);
      const ms = parseInt(durationMatch[4]);
      
      const totalSeconds = hours * 3600 + minutes * 60 + seconds + ms / 100;
      console.log('[FFmpeg] Detected duration:', totalSeconds, 'seconds');
      return totalSeconds;
    }
    
    console.warn('[FFmpeg] Could not detect duration');
    return 0;
  }

  return {
    loadFFmpeg,
    isMkvFile,
    getMediaInfo,
    extractAllSubtitles,
    extractSubtitle,
    extractPgsSubtitle,
    extractAudioTrack,
    isAudioCodecSupported,
    isAudioCodecUnsupported,
    transmuxToMp4,
    processMkvFile,
    isFFmpegLoaded,
    checkSupport,
    // MSE support
    generateInitSegment,
    generateSegment,
    getMediaDuration,
    mountFileForMSE,
    unmountMSEFile,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = FFmpegHandler;
}
