const assert = require('node:assert/strict');
const test = require('node:test');

const FFmpegHandler = require('../js/ffmpeg-handler.js');

test('chooses direct playback for directly playable H.264 MKV', () => {
  const strategy = FFmpegHandler.choosePlaybackStrategy({
    container: 'mkv',
    videoStreams: [{ codec: 'h264' }],
    audioStreams: [{ codec: 'aac' }],
  }, {
    directPlaybackWorks: true,
    mediaSourceSupported: true,
  });

  assert.equal(strategy.mode, 'direct');
  assert.equal(strategy.canStartImmediately, true);
});

test('chooses MSE remux for H.264 MKV when direct playback fails', () => {
  const strategy = FFmpegHandler.choosePlaybackStrategy({
    container: 'mkv',
    videoStreams: [{ codec: 'h264' }],
    audioStreams: [{ codec: 'ac3' }],
  }, {
    directPlaybackWorks: false,
    mediaSourceSupported: true,
  });

  assert.equal(strategy.mode, 'mse-remux');
  assert.equal(strategy.videoMode, 'copy');
  assert.equal(strategy.audioMode, 'transcode-aac');
});

test('marks HEVC/x265 as deferred instead of selecting a full-file transcode', () => {
  const strategy = FFmpegHandler.choosePlaybackStrategy({
    container: 'mkv',
    videoStreams: [{ codec: 'hevc' }],
    audioStreams: [{ codec: 'aac' }],
  }, {
    directPlaybackWorks: false,
    mediaSourceSupported: true,
  });

  assert.equal(strategy.mode, 'unsupported');
  assert.equal(strategy.reason, 'hevc-deferred');
  assert.equal(strategy.canStartImmediately, false);
});

test('normalizes common x264, H.264, and x265 codec spellings', () => {
  assert.equal(FFmpegHandler.normalizeVideoCodec('h264 (High)'), 'h264');
  assert.equal(FFmpegHandler.normalizeVideoCodec('avc1'), 'h264');
  assert.equal(FFmpegHandler.normalizeVideoCodec('x264'), 'h264');
  assert.equal(FFmpegHandler.normalizeVideoCodec('h265'), 'hevc');
  assert.equal(FFmpegHandler.normalizeVideoCodec('x265'), 'hevc');
});

test('identifies only PGS as a renderable bitmap subtitle format', () => {
  assert.equal(FFmpegHandler.isPgsSubtitle('hdmv_pgs_subtitle'), true);
  assert.equal(FFmpegHandler.isPgsSubtitle('dvd_subtitle'), false);
  assert.equal(FFmpegHandler.isPgsSubtitle('dvb_subtitle'), false);
});
