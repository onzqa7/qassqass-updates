// ffmpeg argument builders, shared by the main process and the editor.
(function (root) {
  const CRF = { best: 14, high: 17, medium: 21, low: 26 };
  // NVENC constant-quality targets mapped from the quality setting (lower = better)
  const CQ264 = { best: 16, high: 19, medium: 23, low: 28 }, CQ265 = { best: 18, high: 22, medium: 26, low: 31 };
  const QSVQ = { best: 16, high: 20, medium: 24, low: 29 };
  const TAG709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  function encodeArgs(o) {
    const fps = String(o.fps || 30), q = o.quality || 'high';
    const a = ['-y', '-hide_banner', '-loglevel', 'error', '-stats'];
    if (o.format === 'wav' || o.format === 'mp3' || o.format === 'aac') {
      a.push('-i', o.audio);
      if (o.format === 'wav') a.push('-c:a', 'pcm_s16le');
      else if (o.format === 'mp3') a.push('-c:a', 'libmp3lame', '-b:a', '320k');
      else a.push('-c:a', 'aac', '-b:a', '320k');
      a.push(o.out); return a;
    }
    // input: raw RGBA, or planar yuv420p already converted (BT.709, limited range) on the GPU
    const yuv = o.inFmt === 'yuv420p';
    a.push('-f', 'rawvideo', '-pix_fmt', yuv ? 'yuv420p' : 'rgba', '-s', `${o.w}x${o.h}`, '-r', fps);
    if (yuv) a.push('-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
    a.push('-thread_queue_size', '64', '-i', 'pipe:0');
    const hasAudio = !!o.audio && ['mp4', 'mp4h265', 'mov', 'webm'].includes(o.format);
    if (hasAudio) a.push('-i', o.audio);
    if (hasAudio) a.push('-map', '0:v:0', '-map', '1:a:0');
    // RGBA → YUV on the CPU: use the BT.709 matrix (HD/UHD) instead of swscale's BT.601 default
    const cpu709 = !yuv && ['mp4', 'mp4h265', 'webm'].includes(o.format) && !(o.format === 'webm' && o.alpha);
    if (cpu709) a.push('-vf', 'scale=out_color_matrix=bt709:out_range=tv');
    const hw = o.hw === 'nvenc' || o.hw === 'qsv' ? o.hw : null;
    switch (o.format) {
      case 'mp4h265':
        if (hw === 'nvenc') a.push('-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(CQ265[q] || 22), '-b:v', '0', '-spatial-aq', '1', '-rc-lookahead', '20', '-pix_fmt', 'yuv420p');
        else if (hw === 'qsv') a.push('-c:v', 'hevc_qsv', '-preset', 'medium', '-global_quality', String((QSVQ[q] || 20) + 2), '-pix_fmt', 'nv12');
        else a.push('-c:v', 'libx265', '-preset', 'medium', '-crf', String((CRF[q] || 18) + 3), '-pix_fmt', 'yuv420p');
        a.push('-tag:v', 'hvc1', ...TAG709, '-movflags', '+faststart');
        if (hasAudio) a.push('-c:a', 'aac', '-b:a', '320k');
        break;
      case 'mov':
        a.push('-c:v', 'prores_ks', '-profile:v', o.alpha ? '4444' : '3', '-pix_fmt', o.alpha ? 'yuva444p10le' : 'yuv422p10le', '-vendor', 'apl0');
        if (hasAudio) a.push('-c:a', 'pcm_s16le');
        break;
      case 'webm':
        a.push('-c:v', 'libvpx-vp9', '-pix_fmt', o.alpha ? 'yuva420p' : 'yuv420p', '-b:v', '0', '-crf', String((CRF[q] || 18) + 12), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2');
        if (!o.alpha) a.push(...TAG709);
        if (hasAudio) a.push('-c:a', 'libopus', '-b:a', '192k');
        break;
      case 'png':
        a.push('-c:v', 'png'); break;
      case 'jpg':
        a.push('-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj444p'); break;
      case 'gif':
        a.push('-vf', `fps=${Math.min(+fps, 20)},split[x][y];[x]palettegen=stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0'); break;
      default: // mp4 / h264
        if (hw === 'nvenc') a.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(CQ264[q] || 19), '-b:v', '0', '-spatial-aq', '1', '-rc-lookahead', '20', '-bf', '3', '-pix_fmt', 'yuv420p', '-profile:v', 'high');
        else if (hw === 'qsv') a.push('-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(QSVQ[q] || 20), '-pix_fmt', 'nv12', '-profile:v', 'high');
        else a.push('-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(CRF[q] || 17), '-pix_fmt', 'yuv420p', '-profile:v', 'high');
        a.push(...TAG709, '-movflags', '+faststart');
        if (hasAudio) a.push('-c:a', 'aac', '-b:a', '320k');
    }
    a.push(o.out);
    return a;
  }
  // full-resolution "optimized media" for sources the browser cannot decode (ProRes, DNxHR…). Used for export too.
  // o.enc: 'nvenc' | 'qsv' | 'x264' (default); o.fps → 1 s keyframe interval for fast seeking.
  function transcodeArgs(input, out, o) {
    o = o || {}; const g = String(Math.max(1, Math.round(o.fps || 30)));
    const a = ['-y', '-hide_banner', '-loglevel', 'error', '-stats'];
    if (o.enc === 'nvenc' || o.enc === 'qsv') a.push('-hwaccel', 'auto');
    a.push('-i', input, '-map', '0:v:0?', '-map', '0:a:0?');
    if (o.enc === 'nvenc') a.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-spatial-aq', '1', '-pix_fmt', 'yuv420p', '-g', g);
    else if (o.enc === 'qsv') a.push('-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '18', '-pix_fmt', 'nv12', '-g', g);
    else { a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p'); if (o.fps) a.push('-g', g); }
    a.push('-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out);
    return a;
  }
  // Premiere-style editing proxy: H.264 at 720p/1080p (short side), keyframe every second, AAC audio.
  // o.enc: 'nvenc-cuda' (decode+scale+encode on the GPU) | 'nvenc' | 'qsv' | 'x264'; o.res: 720 | 1080; o.w/o.h/o.fps of the source
  function proxyArgs(input, out, o) {
    o = o || {}; const res = +o.res || 720; const w = o.w || 1920, h = o.h || 1080;
    const short = Math.min(w, h), tgt = Math.min(res, short - (short % 2));
    const land = w >= h; const g = String(Math.max(1, Math.round(o.fps || 30)));
    const a = ['-y', '-hide_banner', '-loglevel', 'error', '-stats'];
    const enc = o.enc || 'x264';
    if (enc === 'nvenc-cuda') a.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda');
    else if (enc === 'nvenc' || enc === 'qsv') a.push('-hwaccel', 'auto');
    a.push('-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1');
    if (enc === 'nvenc-cuda') a.push('-vf', `scale_cuda=${land ? -2 : tgt}:${land ? tgt : -2}:format=nv12`);
    else a.push('-vf', `scale=${land ? -2 : tgt}:${land ? tgt : -2}:flags=bilinear,format=yuv420p`);
    const br = res >= 1080 ? ['12M', '24M'] : ['6M', '12M'];
    if (enc === 'nvenc' || enc === 'nvenc-cuda') a.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '24', '-b:v', '0', '-maxrate', br[0], '-bufsize', br[1], '-bf', '0', '-g', g, '-forced-idr', '1');
    else if (enc === 'qsv') a.push('-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '25', '-look_ahead', '0', '-bf', '0', '-g', g);
    else a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-bf', '0', '-g', g, '-keyint_min', g, '-sc_threshold', '0');
    a.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', out);
    return a;
  }
  // conformed audio cache: raw interleaved s16le stereo 48 kHz (headerless → random access, no RIFF 4 GB limit)
  function audioArgs(input, out) {
    const raw = /\.pcm$/i.test(out);
    return ['-y', '-hide_banner', '-loglevel', 'error', '-stats', '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', ...(raw ? ['-f', 's16le'] : []), out];
  }
  // tiny lavfi encode used once to detect a working hardware encoder (driver + GPU present)
  function capsTestArgs(enc) {
    return ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=0.3', '-frames:v', '6', '-pix_fmt', enc.endsWith('_qsv') ? 'nv12' : 'yuv420p', '-c:v', enc, '-f', 'null', '-'];
  }
  function parseProbe(log) {
    const r = { duration: 0, video: null, audio: null };
    const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(log);
    if (d) r.duration = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]);
    const v = /Stream #\d+:\d+[^:]*: Video: (\w+)[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?(?:([\d.]+) fps|([\d.]+) tbr)?/.exec(log);
    if (v) {
      const line = (/Stream #\d+:\d+[^:]*: Video:[^\n]*/.exec(log) || [''])[0]; const fpsM = /([\d.]+) fps/.exec(line) || /([\d.]+) tbr/.exec(line);
      const pix = (/, (yuv\w+|yuvj\w+|nv\d+|p01\d\w*|gbr\w*|rgb\w*|bgr\w*|gray\w*|rgba|argb|bgra|pal8)[(,]/.exec(line) || /, (yuv\w+|yuvj\w+|nv\d+|p01\d\w*|gbr\w*|rgba|pal8)\b/.exec(line) || [])[1] || '';
      r.video = { codec: v[1], w: +v[2], h: +v[3], fps: fpsM ? parseFloat(fpsM[1]) : 0, alpha: /yuva|rgba|argb|bgra|pal8/.test(v[0]), pix, bits: /1[02]le|1[02]be|p01[02]|p210|p410/.test(pix) ? (/12/.test(pix) ? 12 : 10) : 8 };
      const br = /, (\d+) kb\/s/.exec(line); if (br) r.video.kbps = +br[1];
    }
    const a = /Stream #\d+:\d+[^:]*: Audio: (\w+)[^\n]*?(\d+) Hz[^\n]*?(mono|stereo|5\.1|7\.1|\d+ channels)?/.exec(log);
    if (a) r.audio = { codec: a[1], rate: +a[2], ch: a[3] === 'mono' ? 1 : 2 };
    const rot = /rotate\s*:\s*(-?\d+)/.exec(log) || /displaymatrix: rotation of (-?[\d.]+)/.exec(log);
    if (rot) r.rotate = parseFloat(rot[1]);
    return r;
  }
  const api = { encodeArgs, transcodeArgs, proxyArgs, audioArgs, capsTestArgs, parseProbe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FFArgs = api;
})(typeof window !== 'undefined' ? window : globalThis);
