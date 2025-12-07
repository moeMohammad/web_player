

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

  
  function isVideoCodecSupported(codec) {
    const lowerCodec = codec.toLowerCase();
    return SUPPORTED_VIDEO_CODECS.some((c) => lowerCodec.includes(c));
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
    
    const analysisName = "analysis" + getExtension(file.name);
    
    
    const chunkSize = Math.min(file.size, ANALYSIS_CHUNK_SIZE);
    const chunk = file.slice(0, chunkSize);
    const chunkData = await safeReadFile(chunk);
    
    await ffmpeg.writeFile(analysisName, new Uint8Array(chunkData));
    
    let logOutput = "";
    const logHandler = ({ message }) => {
      logOutput += message + "\n";
    };
    ffmpeg.on("log", logHandler);
    
    try {
      
      await ffmpeg.exec(["-i", analysisName, "-f", "null", "-"]);
    } catch (e) {
      
    }
    
    ffmpeg.off("log", logHandler);
    await ffmpeg.deleteFile(analysisName);
    
    
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
          subtitleStreams.push({
            index: subtitleStreams.length,
            streamIdx: parseInt(streamIdx),
            language: language || "und",
            codec: codec,
          });
        }
      }
    }
    
    return { videoStreams, audioStreams, subtitleStreams };
  }

  
  async function extractSubtitle(file, subtitleIndex, language, progressCallback) {
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

  return {
    loadFFmpeg,
    isMkvFile,
    getMediaInfo,
    extractAllSubtitles,
    extractSubtitle,
    transmuxToMp4,
    processMkvFile,
    isFFmpegLoaded,
    checkSupport,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = FFmpegHandler;
}
