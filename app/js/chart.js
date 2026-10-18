/* 雷达图渲染（纯 SVG，无外部依赖） */
function renderRadar(svg, dims) {
  var axes = [
    { key: 'evidence',  label: '论据' },
    { key: 'logic',     label: '逻辑' },
    { key: 'relevance', label: '针对性' },
    { key: 'novelty',   label: '增量' },
    { key: 'civility',  label: '礼仪' }
  ];
  var cx = 170, cy = 155, R = 105;
  var rings = [25, 50, 75, 100];
  var s = '';

  function point(i, ratio) {
    var ang = -Math.PI / 2 + i * (Math.PI * 2 / axes.length);
    var r = R * ratio;
    return (cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1);
  }

  rings.forEach(function (ring) {
    var pts = axes.map(function (_, i) { return point(i, ring / 100); }).join(' ');
    s += '<polygon points="' + pts + '" fill="none" stroke="#D3D1C7" stroke-width="0.5"/>';
  });
  axes.forEach(function (_, i) {
    s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + point(i, 1).split(',')[0] + '" y2="' + point(i, 1).split(',')[1] + '" stroke="#D3D1C7" stroke-width="0.5"/>';
  });
  rings.forEach(function (ring) {
    var p = point(0, ring / 100).split(',');
    s += '<text x="' + (Number(p[0]) + 4) + '" y="' + (Number(p[1]) - 2) + '" font-size="11" fill="#888780">' + ring + '</text>';
  });

  var valPts = axes.map(function (a, i) { return point(i, (dims[a.key] || 0) / 100); }).join(' ');
  s += '<polygon points="' + valPts + '" fill="rgba(24,95,165,0.15)" stroke="#185FA5" stroke-width="1.5"/>';
  axes.forEach(function (a, i) {
    var p = point(i, (dims[a.key] || 0) / 100).split(',');
    s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#185FA5"/>';
  });

  axes.forEach(function (a, i) {
    var ang = -Math.PI / 2 + i * (Math.PI * 2 / axes.length);
    var lx = cx + (R + 26) * Math.cos(ang), ly = cy + (R + 26) * Math.sin(ang);
    var anchor = Math.abs(Math.cos(ang)) < 0.3 ? 'middle' : (Math.cos(ang) > 0 ? 'start' : 'end');
    s += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + anchor + '" dominant-baseline="central" font-size="13" fill="#2C2C2A">' + a.label + '</text>';
    s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 16).toFixed(1) + '" text-anchor="' + anchor + '" dominant-baseline="central" font-size="11" fill="#888780">' + (dims[a.key] || 0) + '</text>';
  });

  svg.setAttribute('viewBox', '0 0 340 300');
  svg.innerHTML = s;
}
