/**
 * badge.ts — Generate shields.io badge or standalone SVG for README
 */

export function badgeMarkdown(score: number): string {
  const color = score >= 71 ? "brightgreen" : score >= 41 ? "yellow" : "red";
  const encoded = encodeURIComponent(`${score}/100`);
  return `![X-Ray: ${score}](https://img.shields.io/badge/xray-${encoded}-${color})`;
}

export function badgeUrl(score: number): string {
  const color = score >= 71 ? "brightgreen" : score >= 41 ? "yellow" : "red";
  const encoded = encodeURIComponent(`${score}/100`);
  return `https://img.shields.io/badge/xray-${encoded}-${color}`;
}

export function badgeSvg(score: number): string {
  const color = score >= 71 ? "#4c1" : score >= 41 ? "#dfb317" : "#e05d44";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="20">
  <rect width="42" height="20" fill="#555" rx="3"/>
  <rect x="42" width="48" height="20" fill="${color}" rx="3"/>
  <rect x="42" width="4" height="20" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,sans-serif" font-size="11">
    <text x="6" y="14">X-Ray</text>
    <text x="48" y="14">${score}/100</text>
  </g>
</svg>`;
}
