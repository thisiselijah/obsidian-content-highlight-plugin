function trim(str: string) {
  return str.replace(/^\s+|\s+$/gm, "");
}

export function rgbaToHex(rgba: string) {
  const inParts = rgba.substring(rgba.indexOf("(")).split(",");
  const r = parseInt(trim(inParts[0].substring(1)), 10);
  const g = parseInt(trim(inParts[1]), 10);
  const b = parseInt(trim(inParts[2]), 10);
  const a = parseFloat(
    trim(inParts[3].substring(0, inParts[3].length - 1))
  ).toFixed(2);
  const outParts = [
    r.toString(16),
    g.toString(16),
    b.toString(16),
    Math.round(parseFloat(a) * 255)
      .toString(16)
      .substring(0, 2),
  ];

  outParts.forEach(function (part, i) {
    if (part.length === 1) {
      outParts[i] = "0" + part;
    }
  });

  return "#" + outParts.join("");
}
