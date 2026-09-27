/* labels.ts: Turn protocol tokens ("cinema_film1", "2.35_1_zoom") into names people recognize from the projector's own menus. */

// Words that are acronyms or have a conventional spelling on Sony's on-screen menus.
const WORDS: Record<string, string> = {

  brt: "Bright",
  hdmi: "HDMI",
  hdr: "HDR",
  imax: "IMAX",
  tv: "TV"
};

function titleCase(token: string): string {

  return token.split("_").filter(Boolean).map((word) => {

    // Split a trailing number off a word ("film1" -> "Film 1", "hdmi2" -> "HDMI 2").
    const match = /^([a-z]+)(\d+)$/.exec(word);
    const [ base, number ] = match ? [ match[1] ?? word, match[2] ] : [ word, undefined ];
    const label = WORDS[base] ?? (base.charAt(0).toUpperCase() + base.slice(1));

    return (number === undefined) ? label : (label + " " + number);
  }).join(" ");
}

export function inputLabel(token: string): string {

  return titleCase(token);
}

export function pictureModeLabel(token: string): string {

  return titleCase(token);
}

export function aspectLabel(token: string): string {

  // "2.35_1_zoom" -> "2.35:1 Zoom".
  const ratio = /^(\d+\.\d+)_1(?:_(.+))?$/.exec(token);

  if(ratio?.[1]) {

    return ratio[1] + ":1" + (ratio[2] ? " " + titleCase(ratio[2]) : "");
  }

  return titleCase(token);
}
