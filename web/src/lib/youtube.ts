// Draw evidence is YouTube Live metadata only — a URL and its stable video id; no video is
// ever uploaded. This extracts the id from the URL shapes YouTube uses for live streams.

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const ID = /^[A-Za-z0-9_-]{6,32}$/;

/** The video id of an https YouTube URL, or null when the URL is not one. */
export function youtubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return null;
  let id: string | null = null;
  if (url.hostname === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (url.pathname === "/watch") id = url.searchParams.get("v");
  else {
    const m = /^\/(live|embed|shorts)\/([^/?#]+)/.exec(url.pathname);
    id = m ? m[2]! : null;
  }
  return id && ID.test(id) ? id : null;
}
